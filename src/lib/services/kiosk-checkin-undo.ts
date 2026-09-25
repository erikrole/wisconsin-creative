import { BookingKind, BookingStatus, BulkMovementKind, BulkUnitStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { CLAIMABLE_BULK_UNIT_WHERE } from "@/lib/bulk-unit-status";
import { checkSerializedConflicts } from "@/lib/services/availability";
import { upsertBulkBalancesAndMovements } from "@/lib/services/bookings-helpers";
import { requireKioskActor } from "@/lib/services/kiosk-actor";
import { isBookingAllocationConstraintError } from "@/lib/prisma-errors";

/**
 * Undo window for a return scan: the kiosk keeps an unfinished return for 20
 * minutes, so an Undo is only offered for scans from that session.
 */
export const CHECKIN_UNDO_WINDOW_MS = 20 * 60 * 1000;

export type CheckinUndoTarget = { assetId: string } | { bulkSkuId: string; unitNumber: number };

/**
 * Put one return scan back out, while the return is still OPEN.
 *
 * A non-final return scan writes only reversible rows, and each is restored
 * exactly: serialized — item `returned` → `active`, its CHECKOUT allocation
 * reactivated (after the same overlap check extensions use), the asset's saved
 * location restored from the scan's recorded prior location, and the scan
 * marked unsuccessful; numbered unit — allocation reopened, unit claimed back
 * (only if still on the shelf), `checkedInQuantity` decremented, a paired
 * CHECKOUT movement cancelling the per-scan restock, and the scan marked
 * unsuccessful.
 *
 * The scan that returns the LAST item auto-completes the checkout (ledger
 * settle, completion audit, badges, live-activity end), which is not cleanly
 * reversible, so a COMPLETED checkout refuses Undo.
 */
export async function undoKioskCheckinScan(args: {
  bookingId: string;
  actorId: string;
  target: CheckinUndoTarget;
  kiosk: { kioskId: string; locationId: string };
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - CHECKIN_UNDO_WINDOW_MS);
  try {
    return await db.$transaction(async (tx) => {
      const actor = await requireKioskActor(tx, args.actorId);
      const booking = await tx.booking.findUnique({
        where: { id: args.bookingId },
        select: { id: true, kind: true, status: true, endsAt: true, locationId: true },
      });
      if (!booking || booking.kind !== BookingKind.CHECKOUT) throw new HttpError(404, "Active checkout not found");
      if (booking.status !== BookingStatus.OPEN) {
        throw new HttpError(409, "This return is already finished, so its scans can't be undone.", { code: "return_finished" });
      }

      if ("assetId" in args.target) {
        const assetId = args.target.assetId;
        const [item, scan] = await Promise.all([
          tx.bookingSerializedItem.findUnique({
            where: { bookingId_assetId: { bookingId: booking.id, assetId } },
            select: { id: true, allocationStatus: true, asset: { select: { assetTag: true, name: true } } },
          }),
          tx.scanEvent.findFirst({
            where: { bookingId: booking.id, assetId, phase: "CHECKIN", success: true, createdAt: { gte: since } },
            orderBy: { createdAt: "desc" },
            select: { id: true, actualLocationId: true },
          }),
        ]);
        if (!item || item.allocationStatus !== "returned" || !scan) {
          throw new HttpError(409, "There's no recent return scan of that item to undo.", { code: "nothing_to_undo" });
        }
        const allocation = await tx.assetAllocation.findFirst({
          where: { bookingId: booking.id, assetId, kind: "CHECKOUT", active: false },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
        if (!allocation) throw new HttpError(409, "That item's custody record changed. Refresh the return.");
        const conflicts = await checkSerializedConflicts(tx, {
          serializedAssetIds: [assetId],
          startsAt: now,
          endsAt: new Date(Math.max(booking.endsAt.getTime(), now.getTime() + 1)),
          excludeBookingId: booking.id,
          enforceTurnaroundBuffer: false,
        });
        if (conflicts.length > 0) {
          throw new HttpError(409, `${item.asset.assetTag} is already claimed again, so it stays returned.`, { code: "claimed_again" });
        }
        await tx.bookingSerializedItem.update({ where: { id: item.id }, data: { allocationStatus: "active" } });
        await tx.assetAllocation.update({ where: { id: allocation.id }, data: { active: true } });
        if (scan.actualLocationId) {
          await tx.asset.update({ where: { id: assetId }, data: { locationId: scan.actualLocationId } });
        }
        await tx.scanEvent.update({ where: { id: scan.id }, data: { success: false } });
        await createAuditEntryTx(tx, {
          actorId: actor.id,
          actorRole: actor.role,
          entityType: "booking",
          entityId: booking.id,
          action: "kiosk_checkin_scan_undone",
          before: { assetId, allocationStatus: "returned", scanId: scan.id },
          after: { assetId, allocationStatus: "active", restoredLocationId: scan.actualLocationId, kioskDeviceId: args.kiosk.kioskId },
        });
        const label = item.asset.name || item.asset.assetTag;
        return { success: true, message: `${label} is back on the list.`, item: { id: assetId, tagName: item.asset.assetTag, name: label } };
      }

      const { bulkSkuId, unitNumber } = args.target;
      const allocation = await tx.bookingBulkUnitAllocation.findFirst({
        where: {
          checkedOutAt: { not: null },
          checkedInAt: { not: null, gte: since },
          bulkSkuUnit: { bulkSkuId, unitNumber },
          bookingBulkItem: { bookingId: booking.id },
        },
        orderBy: { checkedInAt: "desc" },
        include: {
          bulkSkuUnit: { select: { id: true, bulkSku: { select: { name: true, binQrCodeValue: true, trackByNumber: true, id: true } } } },
          bookingBulkItem: { select: { id: true, checkedInQuantity: true } },
        },
      });
      if (!allocation || allocation.bookingBulkItem.checkedInQuantity < 1) {
        throw new HttpError(409, "There's no recent return scan of that battery to undo.", { code: "nothing_to_undo" });
      }
      const sku = allocation.bulkSkuUnit.bulkSku;
      const scans = await tx.scanEvent.findMany({
        where: { bookingId: booking.id, bulkSkuId, phase: "CHECKIN", success: true, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { id: true, scanValue: true, actualLocationId: true },
      });
      const scan = scans.find((row) => parseDerivedBulkUnitQr(row.scanValue, [sku])?.unitNumber === unitNumber);
      if (!scan) throw new HttpError(409, "There's no recent return scan of that battery to undo.", { code: "nothing_to_undo" });

      const claimed = await tx.bulkSkuUnit.updateMany({
        where: { id: allocation.bulkSkuUnit.id, ...CLAIMABLE_BULK_UNIT_WHERE },
        data: { status: BulkUnitStatus.CHECKED_OUT },
      });
      if (claimed.count !== 1) {
        throw new HttpError(409, `${sku.name} #${unitNumber} is already out again, so it stays returned.`, { code: "claimed_again" });
      }
      await tx.bookingBulkUnitAllocation.update({ where: { id: allocation.id }, data: { checkedInAt: null } });
      await tx.bookingBulkItem.update({ where: { id: allocation.bookingBulkItem.id }, data: { checkedInQuantity: { decrement: 1 } } });
      // Cancel the per-scan restock where it happened.
      await upsertBulkBalancesAndMovements(tx, {
        bookingId: booking.id,
        locationId: scan.actualLocationId ?? args.kiosk.locationId,
        actorUserId: actor.id,
        kind: BulkMovementKind.CHECKOUT,
        items: [{ bulkSkuId, quantity: 1 }],
      });
      await tx.scanEvent.update({ where: { id: scan.id }, data: { success: false } });
      await createAuditEntryTx(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        entityType: "booking",
        entityId: booking.id,
        action: "kiosk_checkin_scan_undone",
        before: { bulkSkuId, unitNumber, checkedInAt: allocation.checkedInAt?.toISOString() ?? null, scanId: scan.id },
        after: { bulkSkuId, unitNumber, checkedInAt: null, kioskDeviceId: args.kiosk.kioskId },
      });
      return {
        success: true,
        message: `${sku.name} #${unitNumber} is back on the list.`,
        item: { id: allocation.bulkSkuUnit.id, tagName: `#${unitNumber}`, name: `${sku.name} #${unitNumber}`, bulkSkuId, unitNumber },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isBookingAllocationConstraintError(error)) {
      throw new HttpError(409, "That item is already claimed again, so it stays returned.", { code: "claimed_again" });
    }
    throw error;
  }
}
