import { BookingKind, BookingStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createAuditEntryTx } from "@/lib/audit";
import { withSerializationRetry } from "@/lib/serialization";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import { bookingInclude } from "./bookings-helpers";

const mergeInclude = {
  events: { select: { eventId: true } },
  serializedItems: {
    select: { id: true, assetId: true, allocationStatus: true },
  },
  allocations: {
    where: { active: true },
    select: { assetId: true },
  },
  bulkItems: {
    select: {
      id: true,
      bulkSkuId: true,
      plannedQuantity: true,
      checkedOutQuantity: true,
      checkedInQuantity: true,
      unitAllocations: {
        select: {
          id: true,
          bulkSkuUnitId: true,
          checkedOutAt: true,
          checkedInAt: true,
        },
      },
    },
  },
  accountabilityExclusion: { select: { id: true } },
} satisfies Prisma.BookingInclude;

type CheckoutMergeCandidate = Prisma.BookingGetPayload<{
  include: typeof mergeInclude;
}>;

function eventIdsFor(booking: CheckoutMergeCandidate) {
  return (booking.events.length > 0
    ? booking.events.map((event) => event.eventId)
    : booking.eventId ? [booking.eventId] : []
  ).sort();
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function combinedNotes(bookings: CheckoutMergeCandidate[]) {
  const notes = [...new Set(bookings.map((booking) => booking.notes?.trim()).filter(Boolean))];
  return notes.length > 0 ? notes.join("\n\n") : null;
}

function checkoutSnapshot(booking: CheckoutMergeCandidate) {
  return {
    id: booking.id,
    refNumber: booking.refNumber,
    status: booking.status,
    title: booking.title,
    requesterUserId: booking.requesterUserId,
    custodyScope: booking.custodyScope,
    locationId: booking.locationId,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    sourceReservationId: booking.sourceReservationId,
    eventIds: eventIdsFor(booking),
    serializedAssetIds: booking.serializedItems.map((item) => item.assetId),
    bulkItems: booking.bulkItems.map((item) => ({
      bulkSkuId: item.bulkSkuId,
      plannedQuantity: item.plannedQuantity,
      checkedOutQuantity: item.checkedOutQuantity,
      checkedInQuantity: item.checkedInQuantity,
      numberedUnitIds: item.unitAllocations.map((allocation) => allocation.bulkSkuUnitId),
    })),
  };
}

function validateMergeCandidates(
  bookings: CheckoutMergeCandidate[],
  requestedIds: string[],
) {
  if (bookings.length !== requestedIds.length) {
    throw new HttpError(404, "One or more checkouts were not found");
  }

  const ordered = [...bookings].sort((a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const canonical = ordered[0];
  if (!canonical) throw new HttpError(404, "Checkouts were not found");

  const expectedEvents = eventIdsFor(canonical);
  if (expectedEvents.length === 0) {
    throw new HttpError(409, "Only event-linked checkouts can be merged");
  }

  const expectedTitle = normalizeBookingTitle(canonical.title).toLocaleLowerCase();
  const seenAssetIds = new Set<string>();
  const seenUnitIds = new Set<string>();

  for (const booking of ordered) {
    if (booking.kind !== BookingKind.CHECKOUT || booking.status !== BookingStatus.OPEN) {
      throw new HttpError(409, "Only open checkouts can be merged");
    }
    if (booking.requesterUserId !== canonical.requesterUserId) {
      throw new HttpError(409, "Checkouts for different people cannot be merged");
    }
    if (booking.custodyScope !== canonical.custodyScope) {
      throw new HttpError(409, "Personal and shared checkouts cannot be merged");
    }
    if (normalizeBookingTitle(booking.title).toLocaleLowerCase() !== expectedTitle) {
      throw new HttpError(409, "Checkout titles must match before merging");
    }
    if (booking.locationId !== canonical.locationId) {
      throw new HttpError(409, "Checkouts at different locations cannot be merged");
    }
    if (
      booking.startsAt.getTime() !== canonical.startsAt.getTime()
      || booking.endsAt.getTime() !== canonical.endsAt.getTime()
    ) {
      throw new HttpError(409, "Checkout pickup and return windows must match before merging");
    }
    if (booking.sourceReservationId !== canonical.sourceReservationId) {
      throw new HttpError(409, "Checkouts must come from the same reservation or both be direct event checkouts");
    }
    if (!sameStrings(eventIdsFor(booking), expectedEvents)) {
      throw new HttpError(409, "Checkouts must link the same exact events before merging");
    }
    if (booking.accountabilityExclusion) {
      throw new HttpError(409, "Accountability-excluded checkouts cannot be merged");
    }

    const itemAssetIds = booking.serializedItems.map((item) => item.assetId);
    const activeAllocationAssetIds = booking.allocations.map((allocation) => allocation.assetId);
    if (
      booking.serializedItems.some((item) => item.allocationStatus !== "active")
      || !sameStrings([...itemAssetIds].sort(), [...activeAllocationAssetIds].sort())
    ) {
      throw new HttpError(409, "Checkout custody records are not in a mergeable active state");
    }

    for (const assetId of itemAssetIds) {
      if (seenAssetIds.has(assetId)) {
        throw new HttpError(409, "The selected checkouts contain the same serialized item");
      }
      seenAssetIds.add(assetId);
    }

    for (const item of booking.bulkItems) {
      if (item.checkedOutQuantity !== item.plannedQuantity) {
        throw new HttpError(409, "A checkout with staged or partially picked up bulk items cannot be merged");
      }
      if (item.checkedInQuantity > 0) {
        throw new HttpError(409, "A checkout with returned bulk items cannot be merged");
      }
      for (const allocation of item.unitAllocations) {
        if (allocation.checkedInAt !== null || allocation.checkedOutAt === null) {
          throw new HttpError(409, "A checkout with returned or staged numbered units cannot be merged");
        }
        if (seenUnitIds.has(allocation.bulkSkuUnitId)) {
          throw new HttpError(409, "The selected checkouts contain the same numbered unit");
        }
        seenUnitIds.add(allocation.bulkSkuUnitId);
      }
    }
  }

  return { ordered, canonical, eventIds: expectedEvents };
}

function mergeSummary(bookings: CheckoutMergeCandidate[], requestedIds: string[]) {
  const { ordered, canonical, eventIds } = validateMergeCandidates(bookings, requestedIds);
  const serializedAssetIds = ordered.flatMap((booking) =>
    booking.serializedItems.map((item) => item.assetId),
  );
  const bulkBySku = new Map<string, number>();
  for (const item of ordered.flatMap((booking) => booking.bulkItems)) {
    bulkBySku.set(item.bulkSkuId, (bulkBySku.get(item.bulkSkuId) ?? 0) + item.plannedQuantity);
  }
  const bulkItems = [...bulkBySku].map(([bulkSkuId, quantity]) => ({ bulkSkuId, quantity }));
  return {
    ordered,
    canonical,
    eventIds,
    serializedAssetIds,
    bulkItems,
    sourceIds: ordered.slice(1).map((booking) => booking.id),
    notes: combinedNotes(ordered),
  };
}

function mergeSourceNote(source: CheckoutMergeCandidate, canonical: CheckoutMergeCandidate) {
  const marker = `Merged into checkout ${canonical.refNumber ?? canonical.id}.`;
  return [source.notes?.trim(), marker].filter(Boolean).join("\n\n");
}

async function moveLiveActivityStarts(
  tx: Prisma.TransactionClient,
  canonicalId: string,
  sourceIds: string[],
) {
  if (sourceIds.length === 0) return;
  const starts = await tx.liveActivityStart.findMany({
    where: { bookingId: { in: [canonicalId, ...sourceIds] } },
    select: { id: true, bookingId: true, userId: true, activity: true, startedAt: true },
    orderBy: { startedAt: "asc" },
  });
  const targetKeys = new Set(
    starts
      .filter((start) => start.bookingId === canonicalId)
      .map((start) => `${start.userId}:${start.activity}`),
  );
  const movableIds: string[] = [];
  for (const start of starts) {
    if (start.bookingId === canonicalId) continue;
    const key = `${start.userId}:${start.activity}`;
    if (targetKeys.has(key)) continue;
    targetKeys.add(key);
    movableIds.push(start.id);
  }
  if (movableIds.length > 0) {
    await tx.liveActivityStart.updateMany({
      where: { id: { in: movableIds } },
      data: { bookingId: canonicalId },
    });
  }
}

export async function previewCheckoutMerge(ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length < 2 || uniqueIds.length > 25) {
    throw new HttpError(400, "Select between 2 and 25 checkouts to merge");
  }
  const bookings = await db.booking.findMany({
    where: { id: { in: uniqueIds } },
    include: mergeInclude,
  });
  const summary = mergeSummary(bookings, uniqueIds);
  return {
    targetCheckoutId: summary.canonical.id,
    sourceCheckoutIds: summary.sourceIds,
    title: summary.canonical.title,
    requesterUserId: summary.canonical.requesterUserId,
    custodyScope: summary.canonical.custodyScope,
    eventIds: summary.eventIds,
    serializedItemCount: summary.serializedAssetIds.length,
    bulkQuantity: summary.bulkItems.reduce((total, item) => total + item.quantity, 0),
  };
}

export async function mergeCheckouts(args: {
  ids: string[];
  actorUserId: string;
  actorRole: Role;
}) {
  if (args.actorRole !== Role.ADMIN && args.actorRole !== Role.STAFF) {
    throw new HttpError(403, "Only staff can merge checkouts");
  }
  const uniqueIds = [...new Set(args.ids)];
  if (uniqueIds.length < 2 || uniqueIds.length > 25) {
    throw new HttpError(400, "Select between 2 and 25 checkouts to merge");
  }

  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const bookings = await tx.booking.findMany({
      where: { id: { in: uniqueIds } },
      include: mergeInclude,
    });
    const summary = mergeSummary(bookings, uniqueIds);
    const sourceSnapshots = summary.ordered.slice(1).map(checkoutSnapshot);

    await tx.bookingSerializedItem.updateMany({
      where: { bookingId: { in: summary.sourceIds } },
      data: { bookingId: summary.canonical.id },
    });
    await tx.assetAllocation.updateMany({
      where: { bookingId: { in: summary.sourceIds }, active: true },
      data: { bookingId: summary.canonical.id },
    });

    const canonicalBulkItems = new Map(
      summary.canonical.bulkItems.map((item) => [item.bulkSkuId, item.id]),
    );
    for (const source of summary.ordered.slice(1)) {
      for (const sourceItem of source.bulkItems) {
        const targetItemId = canonicalBulkItems.get(sourceItem.bulkSkuId);
        if (targetItemId) {
          await tx.bookingBulkUnitAllocation.updateMany({
            where: { bookingBulkItemId: sourceItem.id },
            data: { bookingBulkItemId: targetItemId },
          });
          await tx.bookingBulkItem.update({
            where: { id: targetItemId },
            data: {
              plannedQuantity: { increment: sourceItem.plannedQuantity },
              checkedOutQuantity: { increment: sourceItem.checkedOutQuantity },
              checkedInQuantity: { increment: sourceItem.checkedInQuantity },
            },
          });
          await tx.bookingBulkItem.delete({ where: { id: sourceItem.id } });
        } else {
          await tx.bookingBulkItem.update({
            where: { id: sourceItem.id },
            data: { bookingId: summary.canonical.id },
          });
          canonicalBulkItems.set(sourceItem.bulkSkuId, sourceItem.id);
        }
      }
    }

    await Promise.all([
      tx.scanEvent.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.scanSession.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.overrideEvent.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.bulkStockMovement.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.bookingPhoto.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.checkinItemReport.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.liveActivityToken.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
      tx.bookingDueDateChange.updateMany({
        where: { bookingId: { in: summary.sourceIds } },
        data: { bookingId: summary.canonical.id },
      }),
    ]);
    await moveLiveActivityStarts(tx, summary.canonical.id, summary.sourceIds);

    await tx.booking.update({
      where: { id: summary.canonical.id },
      data: { notes: summary.notes },
    });
    for (const source of summary.ordered.slice(1)) {
      await tx.booking.update({
        where: { id: source.id },
        data: {
          status: BookingStatus.CANCELLED,
          notes: mergeSourceNote(source, summary.canonical),
        },
      });
    }

    await createAuditEntryTx(tx, {
      actorId: args.actorUserId,
      actorRole: args.actorRole,
      entityType: "booking",
      entityId: summary.canonical.id,
      action: "checkouts_merged",
      before: {
        sourceCheckoutIds: summary.sourceIds,
        sourceCheckouts: sourceSnapshots,
      },
      after: {
        targetCheckoutId: summary.canonical.id,
        status: BookingStatus.OPEN,
        serializedAssetIds: summary.serializedAssetIds,
        bulkItems: summary.bulkItems,
        eventIds: summary.eventIds,
      },
    });
    for (const source of summary.ordered.slice(1)) {
      await createAuditEntryTx(tx, {
        actorId: args.actorUserId,
        actorRole: args.actorRole,
        entityType: "booking",
        entityId: source.id,
        action: "merged_into_checkout",
        before: { status: BookingStatus.OPEN },
        after: {
          status: BookingStatus.CANCELLED,
          targetCheckoutId: summary.canonical.id,
        },
      });
    }

    return tx.booking.findUniqueOrThrow({
      where: { id: summary.canonical.id },
      include: bookingInclude,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
