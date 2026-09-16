import { z } from "zod";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { parseDerivedBulkUnitQr } from "@/lib/bulk-unit-qr";
import { BookingCustodyScope, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withKiosk } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { findAssetByScanValue } from "@/lib/services/kiosk-scan";
import { findPickupSubstitutionCandidate } from "@/lib/services/kiosk-pickup-substitute";
import { pickupScanBody } from "@/lib/schemas/kiosk";
import { scanKioskPickupBulkUnit, stageKioskReservationPickupBulkUnit } from "@/lib/services/bulk-unit-scans";
import { kioskRosterUserWhere } from "@/lib/user-visibility";

/**
 * Scan an item for kiosk pickup flow.
 * Validates that the scanned item belongs to the PENDING_PICKUP checkout or
 * due BOOKED reservation.
 */
export const POST = withKiosk<{ id: string }>(async (req, { params }) => {
  const { scanValue, actorId } = pickupScanBody.parse(await req.json());

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, kind: true, requesterUserId: true, custodyScope: true, locationId: true },
  });

  if (
    !booking ||
    !(
      (booking.kind === "CHECKOUT" && booking.status === "PENDING_PICKUP") ||
      (booking.kind === "RESERVATION" && booking.status === "BOOKED")
    )
  ) {
    throw new HttpError(404, "Pending pickup not found");
  }
  const activeBooking = booking;
  if (activeBooking.custodyScope === BookingCustodyScope.SHARED) {
    if (!actorId) throw new HttpError(400, "Choose an operator before scanning shared gear");
    const actor = await db.user.findFirst({
      where: { id: actorId, ...kioskRosterUserWhere() },
      select: { id: true },
    });
    if (!actor) throw new HttpError(403, "This user cannot operate kiosk custody");
  }
  const scanActorId = activeBooking.custodyScope === BookingCustodyScope.SHARED
    ? actorId!
    : activeBooking.requesterUserId;

  const bulkResult = await db.$transaction(
    (tx) => activeBooking.kind === "RESERVATION"
      ? stageKioskReservationPickupBulkUnit(tx, {
          bookingId: params.id,
          scanValue,
          actorUserId: scanActorId,
          deviceContext: req.headers.get("user-agent") ?? "kiosk",
        })
      : scanKioskPickupBulkUnit(tx, { bookingId: params.id, scanValue }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (bulkResult.handled) {
    return ok(bulkResult);
  }

  const asset = await findAssetByScanValue(scanValue, {
    id: true,
    assetTag: true,
    name: true,
    type: true,
    categoryId: true,
  });

  if (!asset) {
    return ok({ success: false, error: "Item not found" });
  }

  const bookingItem = await db.bookingSerializedItem.findUnique({
    where: { bookingId_assetId: { bookingId: params.id, assetId: asset.id } },
  });

  if (!bookingItem) {
    if (activeBooking.kind === "RESERVATION") {
      const alreadyPicked = await db.bookingSerializedItem.findFirst({
        where: {
          assetId: asset.id,
          booking: { sourceReservationId: params.id, kind: "CHECKOUT" },
        },
        select: { id: true },
      });
      if (alreadyPicked) {
        const label = asset.name || asset.assetTag;
        return ok({ success: false, error: `${label} already picked up`, errorCode: "duplicate" });
      }
      const substitution = await findPickupSubstitutionCandidate({
        bookingId: params.id,
        scanned: asset,
      });
      if (substitution) {
        return ok({
          success: false,
          error: `${asset.assetTag} is not on this reservation. Swap ${substitution.reserved.tagName} for it?`,
          errorCode: "substitution_available",
          substitution,
        });
      }
    }
    return ok({
      success: false,
      error: `${asset.assetTag} is not in this checkout`,
      errorCode: "not_in_booking",
    });
  }
  if (activeBooking.kind === "RESERVATION" && bookingItem.allocationStatus === "picked_up") {
    const label = asset.name || asset.assetTag;
    return ok({ success: false, error: `${label} already picked up`, errorCode: "duplicate" });
  }

  const existingScan = await db.scanEvent.findFirst({
    where: {
      bookingId: activeBooking.id,
      phase: "CHECKOUT",
      success: true,
      assetId: asset.id,
    },
    select: { id: true },
  });
  if (existingScan) {
    const label = asset.name || asset.assetTag;
    return ok({ success: false, error: `${label} already scanned`, errorCode: "duplicate" });
  }

  await db.$transaction(async (tx) => {
    await tx.scanEvent.create({
      data: {
        bookingId: activeBooking.id,
        actorUserId: scanActorId,
        scanType: "SERIALIZED",
        scanValue,
        success: true,
        phase: "CHECKOUT",
        assetId: asset.id,
        deviceContext: req.headers.get("user-agent") ?? "kiosk",
      },
    });
  });

  return ok({
    success: true,
    item: {
      id: asset.id,
      name: asset.name || asset.assetTag,
      tagName: asset.assetTag,
    },
  });
});

/** Remove only a staged reservation scan. Custody already handed over on a
 * derived checkout is immutable here; replacing a unit never returns it. */
export const DELETE = withKiosk<{ id: string }>(async (req, { params, kiosk }) => {
  const body = z.object({
    actorId: z.string().min(1),
    bulkSkuId: z.string().min(1),
    unitNumber: z.number().int().positive(),
  }).parse(await req.json());
  await db.$transaction(async (tx) => {
    const [booking, actor] = await Promise.all([
      tx.booking.findUnique({ where: { id: params.id }, include: { bulkItems: { include: { bulkSku: true } }, derivedCheckouts: { include: { bulkItems: { include: { unitAllocations: { include: { bulkSkuUnit: true } } } } } } } }),
      tx.user.findFirst({ where: { id: body.actorId, ...kioskRosterUserWhere() }, select: { id: true, role: true } }),
    ]);
    if (!actor) throw new HttpError(403, "Choose an active operator");
    requirePermission(actor.role, "checkout", "scan");
    if (!booking || booking.kind !== "RESERVATION" || booking.status !== "BOOKED") throw new HttpError(409, "Refresh the reservation before replacing a staged unit");
    if (booking.custodyScope !== "SHARED" && booking.requesterUserId !== actor.id && actor.role !== "ADMIN" && actor.role !== "STAFF") throw new HttpError(403, "Only the requester or staff can change this pickup");
    const bulk = booking.bulkItems.find((item) => item.bulkSkuId === body.bulkSkuId);
    if (!bulk || booking.derivedCheckouts.some((checkout) => checkout.bulkItems.some((item) => item.bulkSkuId === body.bulkSkuId && item.unitAllocations.some((unit) => unit.bulkSkuUnit.unitNumber === body.unitNumber)))) throw new HttpError(409, "That unit was already picked up. Return or transfer it from its checkout.");
    const scans = await tx.scanEvent.findMany({ where: { bookingId: params.id, bulkSkuId: body.bulkSkuId, phase: "CHECKOUT", success: true }, select: { id: true, scanValue: true } });
    const ids = scans.filter((scan) => parseDerivedBulkUnitQr(scan.scanValue, [bulk.bulkSku])?.unitNumber === body.unitNumber).map((scan) => scan.id);
    await tx.scanEvent.updateMany({ where: { id: { in: ids } }, data: { success: false } });
    await tx.booking.update({ where: { id: params.id }, data: { updatedAt: new Date() } });
    await createAuditEntryTx(tx, { actorId: actor.id, actorRole: actor.role, entityType: "booking", entityId: params.id, action: "kiosk_pickup_scan_removed", before: { bulkSkuId: body.bulkSkuId, unitNumber: body.unitNumber, scanIds: ids }, after: { kioskDeviceId: kiosk.kioskId, custodyChanged: false } });
  }, { isolationLevel: "Serializable" });
  return ok({ success: true, message: "Staged unit cleared. Scan the replacement unit." });
});
