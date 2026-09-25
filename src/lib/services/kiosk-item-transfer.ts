import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { staleBookingError } from "@/lib/booking-concurrency";
import { createAuditEntryTx } from "@/lib/audit";
import { nextBookingRef } from "@/lib/services/booking-ref";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { withSerializationRetry } from "@/lib/serialization";
import { formatAppDateTime } from "@/lib/app-time";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";
import { canManageAnyCheckout } from "@/lib/services/kiosk-actor";
import { claimKioskOperationReceiptTx, finishKioskOperationReceiptTx, type KioskOperationContext } from "./kiosk-operation-receipts";

export async function transferKioskItems(args: {
  sourceId: string; actorId: string; expectedUpdatedAt: Date;
  targetBookingId?: string; targetUserId?: string; assetIds: string[];
  bulkUnitIds: string[]; reason?: string; kioskId: string;
  receipt?: KioskOperationContext;
}) {
  const { response, handover } = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({ where: { id: args.actorId, ...kioskRosterUserWhere() }, select: { id: true, role: true } });
    if (!actor) throw new HttpError(403, "Choose an active operator");
    const source = await tx.booking.findUnique({ where: { id: args.sourceId }, include: {
      requester: { select: { id: true, name: true } },
      events: true, accountabilityExclusion: true,
      serializedItems: { include: { asset: { select: { assetTag: true } } } },
      bulkItems: { include: { unitAllocations: true } },
      scanSessions: { where: { phase: "CHECKIN", status: "OPEN" } },
    } });
    if (!source || source.kind !== "CHECKOUT" || source.status !== "OPEN") throw new HttpError(409, "Refresh the open checkout before transferring gear");
    // Peer transfer (Erik, 2026-09-25): the holder of a personal checkout may
    // hand all or part of it to anyone on the roster, immediately. Merging into
    // another checkout and moving SHARED custody stay staff-only.
    const isOwner = source.custodyScope === "PERSON" && source.requesterUserId === actor.id;
    const isStaff = canManageAnyCheckout(actor.role);
    if (isStaff) {
      requirePermission(actor.role, "checkout", "manage_custody");
    } else if (!isOwner || args.targetBookingId) {
      throw new HttpError(403, "Only the person who checked this out, or staff, can hand it to someone else.", { code: "transfer_not_allowed" });
    }
    const reason = args.reason ?? (isOwner ? OWNER_TRANSFER_REASON : null);
    if (!reason) throw new HttpError(400, "Add a reason for this transfer");
    if (args.targetUserId && source.custodyScope === "PERSON" && args.targetUserId === source.requesterUserId) {
      throw new HttpError(400, "This gear is already on their record. Choose someone else.");
    }
    await claimKioskOperationReceiptTx(tx, args.receipt);
    if (source.updatedAt.getTime() !== args.expectedUpdatedAt.getTime()) throw staleBookingError();
    if (source.scanSessions.length || (source.accountabilityExclusion && !source.accountabilityExclusion.restoredAt)) throw new HttpError(409, "Finish the return or resolve the accountability exclusion before transferring gear");
    if (new Set(args.assetIds).size !== args.assetIds.length || new Set(args.bulkUnitIds).size !== args.bulkUnitIds.length) throw new HttpError(400, "Select each item only once");
    const serialized = source.serializedItems.filter((item) => args.assetIds.includes(item.assetId) && item.allocationStatus === "active");
    const units = source.bulkItems.flatMap((bulk) => bulk.unitAllocations.filter((unit) => args.bulkUnitIds.includes(unit.bulkSkuUnitId) && unit.checkedOutAt && !unit.checkedInAt).map((unit) => ({ ...unit, bulkSkuId: bulk.bulkSkuId })));
    if (serialized.length !== args.assetIds.length || units.length !== args.bulkUnitIds.length || serialized.length + units.length === 0) throw new HttpError(409, "Some selected items are no longer out on this checkout. Refresh and select again.");
    const allocations = await tx.assetAllocation.findMany({ where: { assetId: { in: args.assetIds }, active: true, kind: "CHECKOUT" } });
    if (allocations.length !== serialized.length || allocations.some((item) => item.bookingId !== source.id || item.endsAt.getTime() !== source.endsAt.getTime())) throw new HttpError(409, "An item's custody record needs reconciliation before transfer");
    const target = args.targetUserId ? await tx.user.findFirst({ where: { id: args.targetUserId, ...kioskRosterUserWhere() }, select: { id: true, name: true } }) : null;
    if (!args.targetBookingId && !target) throw new HttpError(400, "Choose the person or checkout receiving these items");
    const destination = args.targetBookingId ? await tx.booking.findUnique({ where: { id: args.targetBookingId }, include: {
      accountabilityExclusion: true, scanSessions: { where: { phase: "CHECKIN", status: "OPEN" } },
    } }) : null;
    if (args.targetBookingId && (!destination || destination.id === source.id || destination.kind !== "CHECKOUT" || destination.status !== "OPEN" || destination.locationId !== source.locationId || destination.endsAt.getTime() !== source.endsAt.getTime() || destination.scanSessions.length || (destination.accountabilityExclusion && !destination.accountabilityExclusion.restoredAt))) throw new HttpError(409, "Choose an open checkout at the same location with the same due time, or create a checkout for the recipient");
    const receiving = destination ?? await tx.booking.create({ data: {
      kind: "CHECKOUT", status: "OPEN", custodyScope: "PERSON", requesterUserId: target!.id,
      title: source.title, startsAt: source.startsAt, endsAt: source.endsAt, locationId: source.locationId,
      createdBy: actor.id, sourceReservationId: source.sourceReservationId,
      eventId: source.eventId, sportCode: source.sportCode, pickupKioskDeviceId: source.pickupKioskDeviceId,
      refNumber: await nextBookingRef(tx, "CO"),
      notes: `Transferred from ${source.refNumber ?? source.id}. Original pickup evidence remains on that checkout.`,
      events: { create: source.events.map(({ eventId, ordinal }) => ({ eventId, ordinal })) },
    } });
    const duplicates = await tx.bookingSerializedItem.count({ where: { bookingId: receiving.id, assetId: { in: args.assetIds } } });
    if (duplicates) throw new HttpError(409, "The receiving checkout already has history for a selected item. Choose a new checkout for this transfer.");
    await tx.bookingSerializedItem.updateMany({ where: { id: { in: serialized.map((item) => item.id) } }, data: { bookingId: receiving.id, assignedUserId: null, assignedAt: null } });
    await tx.assetAllocation.updateMany({ where: { id: { in: allocations.map((item) => item.id) } }, data: { bookingId: receiving.id } });
    const quantityBySku = new Map<string, number>();
    for (const unit of units) quantityBySku.set(unit.bulkSkuId, (quantityBySku.get(unit.bulkSkuId) ?? 0) + 1);
    for (const [bulkSkuId, quantity] of quantityBySku) {
      const sourceBulk = source.bulkItems.find((item) => item.bulkSkuId === bulkSkuId)!;
      const receivingBulk = await tx.bookingBulkItem.upsert({
        where: { bookingId_bulkSkuId: { bookingId: receiving.id, bulkSkuId } },
        create: { bookingId: receiving.id, bulkSkuId, plannedQuantity: quantity, checkedOutQuantity: quantity },
        update: { plannedQuantity: { increment: quantity }, checkedOutQuantity: { increment: quantity } },
      });
      const selectedUnits = units.filter((unit) => unit.bulkSkuId === bulkSkuId);
      const prior = await tx.bookingBulkUnitAllocation.count({ where: { bookingBulkItemId: receivingBulk.id, bulkSkuUnitId: { in: selectedUnits.map((unit) => unit.bulkSkuUnitId) } } });
      if (prior) throw new HttpError(409, "A selected unit already has history on the receiving checkout. Choose a new checkout for this transfer.");
      await tx.bookingBulkUnitAllocation.updateMany({ where: { id: { in: selectedUnits.map((unit) => unit.id) } }, data: { bookingBulkItemId: receivingBulk.id } });
      await tx.bookingBulkItem.update({ where: { id: sourceBulk.id }, data: { plannedQuantity: { decrement: quantity }, checkedOutQuantity: { decrement: quantity } } });
      // Reassign the ledger obligation, without changing shelf stock or unit
      // status. Paired movements net to zero and prevent either checkout's
      // completion reconciler from restocking the transferred unit twice.
      await tx.bulkStockMovement.createMany({ data: [
        { bookingId: source.id, kind: "CHECKIN", reason: "Custody transfer out; no physical shelf return" },
        { bookingId: receiving.id, kind: "CHECKOUT", reason: "Custody transfer in; no physical shelf pickup" },
      ].map((movement) => ({ ...movement, kind: movement.kind as "CHECKIN" | "CHECKOUT", actorUserId: actor.id, bulkSkuId, locationId: source.locationId, quantity })) });
    }
    const remainingSerialized = source.serializedItems.some((item) => item.allocationStatus === "active" && !args.assetIds.includes(item.assetId));
    const remainingBulk = source.bulkItems.some((item) => item.checkedOutQuantity - item.checkedInQuantity - (quantityBySku.get(item.bulkSkuId) ?? 0) > 0);
    const sourceClosed = !remainingSerialized && !remainingBulk;
    const updatedAt = new Date(Math.max(Date.now(), source.updatedAt.getTime() + 1, receiving.updatedAt.getTime() + 1));
    await tx.booking.update({ where: { id: source.id }, data: { updatedAt, ...(sourceClosed ? { status: "CANCELLED" } : {}) } });
    await tx.booking.update({ where: { id: receiving.id }, data: { updatedAt } });
    const evidence = { sourceBookingId: source.id, targetBookingId: receiving.id, assetIds: args.assetIds, bulkUnitIds: args.bulkUnitIds, reason, kioskId: args.kioskId, originalEvidenceBookingId: source.id, sourceClosed };
    const auditEntries: Array<[string, string]> = [
      [source.id, "kiosk_items_transferred_out"],
      [receiving.id, "kiosk_items_transferred_in"],
    ];
    for (const [entityId, action] of auditEntries) await createAuditEntryTx(tx, { actorId: actor.id, actorRole: actor.role, entityType: "booking", entityId, action, before: { sourceSnapshot: source.updatedAt.toISOString(), custodyScope: source.custodyScope, requesterId: source.custodyScope === "PERSON" ? source.requesterUserId : null }, after: evidence });
    const response = { success: true, targetBookingId: receiving.id, sourceClosed, itemCount: serialized.length + units.length, message: `${serialized.length + units.length} items transferred to ${target?.name ?? receiving.title}`, endsAt: receiving.endsAt };
    await finishKioskOperationReceiptTx(tx, args.receipt, response);
    const handover = isOwner && !isStaff && target ? {
      sourceId: source.id,
      receivingId: receiving.id,
      stamp: updatedAt.getTime(),
      title: displayBookingTitle(source.title),
      endsAt: receiving.endsAt,
      owner: source.requester,
      target,
      itemCount: serialized.length + units.length,
      sourceClosed,
    } : null;
    return { response, handover };
  }, { isolationLevel: "Serializable" }));
  if (handover) await notifyKioskHandover(handover);
  return response;
}

export const OWNER_TRANSFER_REASON = "Handed over at the kiosk";

export function kioskHandoverCopy(args: {
  title: string; endsAt: Date; ownerName: string; targetName: string; itemCount: number; sourceClosed: boolean;
}) {
  return {
    toNewHolder: {
      title: `${args.ownerName} handed you ${args.title}`,
      body: `It's on your record now. It's due ${formatAppDateTime(args.endsAt)}.`,
    },
    toOldHolder: {
      title: `You handed ${args.title} to ${args.targetName}`,
      body: args.sourceClosed
        ? "It's off your record now."
        : `${args.itemCount} ${args.itemCount === 1 ? "item is" : "items are"} off your record now. The rest is still with you.`,
    },
  };
}

/** Owner-to-peer handovers tell both people. Delivery never fails the transfer. */
async function notifyKioskHandover(h: {
  sourceId: string; receivingId: string; stamp: number; title: string; endsAt: Date;
  owner: { id: string; name: string }; target: { id: string; name: string };
  itemCount: number; sourceClosed: boolean;
}) {
  const copy = kioskHandoverCopy({
    title: h.title, endsAt: h.endsAt, ownerName: h.owner.name, targetName: h.target.name,
    itemCount: h.itemCount, sourceClosed: h.sourceClosed,
  });
  const messages = [
    { userId: h.target.id, bookingId: h.receivingId, key: "in", ...copy.toNewHolder },
    { userId: h.owner.id, bookingId: h.sourceId, key: "out", ...copy.toOldHolder },
  ];
  try {
    const rows = await db.notification.createManyAndReturn({
      data: messages.map((m) => ({
        userId: m.userId,
        bookingId: m.bookingId,
        type: "kiosk_checkout_handover",
        title: m.title,
        body: m.body,
        payload: { bookingId: m.bookingId, href: `/checkouts/${m.bookingId}` },
        channel: "IN_APP" as const,
        sentAt: new Date(),
        dedupeKey: `kiosk-handover-${h.sourceId}-${h.receivingId}-${h.stamp}-${m.key}`,
      })),
      skipDuplicates: true,
      select: { id: true, userId: true },
    });
    for (const row of rows) {
      const message = messages.find((m) => m.userId === row.userId);
      if (!message) continue;
      deferPush(sendPushToUser(message.userId, {
        title: message.title,
        body: message.body,
        payload: { bookingId: message.bookingId, href: `/checkouts/${message.bookingId}` },
        category: "checkoutDue",
        notificationId: row.id,
      }));
    }
  } catch (error) {
    console.error("[kiosk/transfer] handover notification failed", error);
  }
}
