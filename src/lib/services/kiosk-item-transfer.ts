import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { staleBookingError } from "@/lib/booking-concurrency";
import { createAuditEntryTx } from "@/lib/audit";
import { nextBookingRef } from "@/lib/services/booking-ref";
import { kioskRosterUserWhere } from "@/lib/user-visibility";
import { withSerializationRetry } from "@/lib/serialization";
import { claimKioskOperationReceiptTx, finishKioskOperationReceiptTx, type KioskOperationContext } from "./kiosk-operation-receipts";

export async function transferKioskItems(args: {
  sourceId: string; actorId: string; expectedUpdatedAt: Date;
  targetBookingId?: string; targetUserId?: string; assetIds: string[];
  bulkUnitIds: string[]; reason: string; kioskId: string;
  receipt?: KioskOperationContext;
}) {
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({ where: { id: args.actorId, ...kioskRosterUserWhere() }, select: { id: true, role: true } });
    if (!actor) throw new HttpError(403, "Choose an active operator");
    requirePermission(actor.role, "checkout", "manage_custody");
    await claimKioskOperationReceiptTx(tx, args.receipt);
    const source = await tx.booking.findUnique({ where: { id: args.sourceId }, include: {
      events: true, accountabilityExclusion: true,
      serializedItems: { include: { asset: { select: { assetTag: true } } } },
      bulkItems: { include: { unitAllocations: true } },
      scanSessions: { where: { phase: "CHECKIN", status: "OPEN" } },
    } });
    if (!source || source.kind !== "CHECKOUT" || source.status !== "OPEN") throw new HttpError(409, "Refresh the open checkout before transferring gear");
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
    const evidence = { sourceBookingId: source.id, targetBookingId: receiving.id, assetIds: args.assetIds, bulkUnitIds: args.bulkUnitIds, reason: args.reason, kioskId: args.kioskId, originalEvidenceBookingId: source.id, sourceClosed };
    for (const [entityId, action] of [[source.id, "kiosk_items_transferred_out"], [receiving.id, "kiosk_items_transferred_in"]]) await createAuditEntryTx(tx, { actorId: actor.id, actorRole: actor.role, entityType: "booking", entityId, action, before: { sourceSnapshot: source.updatedAt.toISOString(), custodyScope: source.custodyScope, requesterId: source.custodyScope === "PERSON" ? source.requesterUserId : null }, after: evidence });
    const response = { success: true, targetBookingId: receiving.id, sourceClosed, itemCount: serialized.length + units.length, message: `${serialized.length + units.length} items transferred to ${target?.name ?? receiving.title}`, endsAt: receiving.endsAt };
    await finishKioskOperationReceiptTx(tx, args.receipt, response);
    return response;
  }, { isolationLevel: "Serializable" }));
}
