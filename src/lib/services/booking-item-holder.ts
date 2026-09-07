import { AllocationKind, BookingCustodyScope, BookingKind, BookingStatus, Prisma, Role, ScanPhase, ScanSessionStatus } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { staleBookingError } from "@/lib/booking-concurrency";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { nextBookingRef } from "./booking-ref";

/** Transfer existing custody. Original scan/photo/session records stay immutable. */
export async function updateBookingItemHolder(args: {
  bookingId: string;
  serializedItemId: string;
  actorUserId: string;
  targetUserId: string | null;
  reason?: string;
  expectedUpdatedAt: Date;
}) {
  return db.$transaction(async (tx) => {
    const [source, item, actor, target] = await Promise.all([
      tx.booking.findUnique({
        where: { id: args.bookingId },
        include: {
          events: { orderBy: { ordinal: "asc" } },
          accountabilityExclusion: true,
        },
      }),
      tx.bookingSerializedItem.findUnique({
        where: { id: args.serializedItemId },
        include: { asset: { select: { assetTag: true } } },
      }),
      tx.user.findUnique({ where: { id: args.actorUserId }, select: { role: true } }),
      args.targetUserId ? tx.user.findUnique({
        where: { id: args.targetUserId },
        select: { id: true, name: true, active: true, hiddenFromRoster: true },
      }) : null,
    ]);
    if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.STAFF)) {
      throw new HttpError(403, "Only staff or admin can transfer checkout items");
    }
    if (!source) throw new HttpError(404, "Checkout not found");
    if (!target || !target.active || target.hiddenFromRoster) {
      throw new HttpError(400, "Select an active, visible person to receive this item");
    }
    if (!item) throw new HttpError(404, "Checkout item not found");

    // A response may be lost after commit. Only the receipt for this exact
    // source snapshot, item, actor and recipient can acknowledge that retry.
    if (item.bookingId !== source.id) {
      const receipt = await tx.auditLog.findFirst({
        where: {
          entityType: "booking", entityId: source.id,
          action: "serialized_item_transferred_out", actorUserId: args.actorUserId,
          AND: [
            { afterJson: { path: ["serializedItemId"], equals: item.id } },
            { afterJson: { path: ["targetUserId"], equals: target.id } },
            { afterJson: { path: ["targetBookingId"], equals: item.bookingId } },
            { afterJson: { path: ["sourceSnapshot"], equals: args.expectedUpdatedAt.toISOString() } },
          ],
        },
        select: { id: true },
      });
      const destination = receipt ? await tx.booking.findUnique({ where: { id: item.bookingId } }) : null;
      if (!destination || destination.requesterUserId !== target.id || destination.custodyScope !== BookingCustodyScope.PERSON) {
        throw new HttpError(409, "This item has moved. Refresh the checkout before transferring it again.");
      }
      return { sourceBookingId: source.id, targetBookingId: destination.id, targetRefNumber: destination.refNumber,
        targetUserName: target.name, endsAt: destination.endsAt, sourceClosed: source.status !== BookingStatus.OPEN };
    }
    // This custody operation uses full timestamp precision, including swaps
    // made within the same second; legacy second-precision edits are separate.
    if (source.updatedAt.getTime() !== args.expectedUpdatedAt.getTime()) throw staleBookingError();
    if (source.kind !== BookingKind.CHECKOUT || source.status !== BookingStatus.OPEN) {
      throw new HttpError(400, "Items can be transferred only from an open checkout");
    }
    if (item.allocationStatus !== "active") throw new HttpError(400, "Only an active checkout item can be transferred");
    if (source.accountabilityExclusion && !source.accountabilityExclusion.restoredAt) {
      throw new HttpError(409, "Resolve the checkout accountability exclusion before transferring gear");
    }
    if (source.custodyScope === BookingCustodyScope.PERSON && source.requesterUserId === target.id) {
      throw new HttpError(400, "This person already owns the item's checkout");
    }
    const [allocations, returnSession] = await Promise.all([
      tx.assetAllocation.findMany({
        where: { assetId: item.assetId, active: true, kind: AllocationKind.CHECKOUT },
      }),
      tx.scanSession.findFirst({
        where: { bookingId: source.id, phase: ScanPhase.CHECKIN, status: ScanSessionStatus.OPEN },
        select: { id: true },
      }),
    ]);
    if (returnSession) throw new HttpError(409, "Finish the in-progress return before transferring this item");
    const allocation = allocations[0];
    if (!allocation || allocations.length !== 1 || allocation.bookingId !== source.id || allocation.endsAt.getTime() !== source.endsAt.getTime()) {
      throw new HttpError(409, "The item's active allocation needs reconciliation before transfer");
    }

    const eventIds = source.events.map((event) => event.eventId);
    const destination = await tx.booking.findFirst({
      where: {
        id: { not: source.id }, kind: BookingKind.CHECKOUT, status: BookingStatus.OPEN,
        custodyScope: BookingCustodyScope.PERSON, requesterUserId: target.id,
        locationId: source.locationId, endsAt: source.endsAt,
        title: source.title, eventId: source.eventId, sportCode: source.sportCode,
        sourceReservationId: source.sourceReservationId,
        startsAt: { lte: new Date() },
        serializedItems: { none: { assetId: item.assetId } },
        events: { every: { eventId: { in: eventIds } } },
        AND: eventIds.map((eventId) => ({ events: { some: { eventId } } })),
        OR: [{ accountabilityExclusion: null }, { accountabilityExclusion: { restoredAt: { not: null } } }],
        scanSessions: { none: { phase: ScanPhase.CHECKIN, status: ScanSessionStatus.OPEN } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const now = new Date(Math.max(Date.now(), source.updatedAt.getTime() + 1, (destination?.updatedAt.getTime() ?? 0) + 1));
    const receiving = destination ?? await tx.booking.create({
      data: {
        kind: BookingKind.CHECKOUT, status: BookingStatus.OPEN, custodyScope: BookingCustodyScope.PERSON,
        requesterUserId: target.id, title: source.title, locationId: source.locationId,
        startsAt: source.startsAt, endsAt: source.endsAt, createdBy: source.createdBy,
        sourceReservationId: source.sourceReservationId, eventId: source.eventId, sportCode: source.sportCode,
        pickupKioskDeviceId: source.pickupKioskDeviceId,
        refNumber: await nextBookingRef(tx, "CO"),
        notes: `Transferred from ${source.refNumber ?? source.id}. Original pickup evidence remains on that checkout.`,
        events: { create: source.events.map(({ eventId, ordinal }) => ({ eventId, ordinal })) },
      },
    });

    // Keep row IDs, allocation dates, asset location and original creation
    // evidence. The unique booking/asset constraint rejects a duplicate line.
    await tx.bookingSerializedItem.update({
      where: { id: item.id },
      data: { bookingId: receiving.id, assignedUserId: null, assignedAt: null },
    });
    await tx.assetAllocation.update({ where: { id: allocation.id }, data: { bookingId: receiving.id } });

    const [remainingItems, remainingBulk, remainingAllocations] = await Promise.all([
      tx.bookingSerializedItem.count({ where: { bookingId: source.id, allocationStatus: { not: "returned" } } }),
      tx.bookingBulkItem.findMany({ where: { bookingId: source.id }, include: { unitAllocations: true } }),
      tx.assetAllocation.count({ where: { bookingId: source.id, active: true } }),
    ]);
    const bulkOutstanding = remainingBulk.some((bulk) =>
      bulk.checkedInQuantity < bulk.checkedOutQuantity
      || bulk.unitAllocations.some((unit) => unit.checkedOutAt && !unit.checkedInAt));
    const sourceClosed = remainingItems === 0 && remainingAllocations === 0 && !bulkOutstanding;
    await tx.booking.update({
      where: { id: source.id },
      data: { updatedAt: now, ...(sourceClosed ? { status: BookingStatus.CANCELLED } : {}) },
    });
    await tx.booking.update({ where: { id: receiving.id }, data: { updatedAt: now } });

    const before = {
      sourceBookingId: source.id, sourceRefNumber: source.refNumber, assetTag: item.asset.assetTag, sourceRequesterUserId: source.requesterUserId,
      sourceCustodyScope: source.custodyScope, sourceStatus: source.status,
      serializedItemId: item.id, assetId: item.assetId, allocationId: allocation.id,
      assignedUserId: item.assignedUserId, assignedAt: item.assignedAt,
      allocationStartsAt: allocation.startsAt, allocationEndsAt: allocation.endsAt,
    };
    const after = {
      sourceBookingId: source.id, sourceRefNumber: source.refNumber, assetTag: item.asset.assetTag, targetBookingId: receiving.id, targetRefNumber: receiving.refNumber,
      targetUserId: target.id, targetUserName: target.name,
      serializedItemId: item.id, assetId: item.assetId, allocationId: allocation.id,
      sourceSnapshot: args.expectedUpdatedAt.toISOString(),
      sourceClosed, destinationCreated: !destination, originalEvidenceBookingId: source.id,
      reason: args.reason?.trim() || null,
    };
    await createAuditEntryTx(tx, { actorId: args.actorUserId, actorRole: actor.role,
      entityType: "booking", entityId: source.id, action: "serialized_item_transferred_out", before, after });
    await createAuditEntryTx(tx, { actorId: args.actorUserId, actorRole: actor.role,
      entityType: "booking", entityId: receiving.id, action: "serialized_item_transferred_in", before, after });

    return { sourceBookingId: source.id, targetBookingId: receiving.id, targetRefNumber: receiving.refNumber,
      targetUserName: target.name, endsAt: receiving.endsAt, sourceClosed };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 1_000, timeout: 6_000 });
}
