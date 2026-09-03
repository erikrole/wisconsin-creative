import { BookingKind, BookingStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { checkAvailability } from "@/lib/services/availability";
import { createAuditEntryTx } from "@/lib/audit";
import { withSerializationRetry } from "@/lib/serialization";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import { bookingInclude } from "./bookings-helpers";

const mergeInclude = {
  events: { select: { eventId: true } },
  serializedItems: { select: { assetId: true, allocationStatus: true } },
  bulkItems: {
    select: { bulkSkuId: true, plannedQuantity: true, checkedOutQuantity: true },
  },
} satisfies Prisma.BookingInclude;

type MergeCandidate = Prisma.BookingGetPayload<{ include: typeof mergeInclude }>;

function eventIdsFor(candidate: MergeCandidate) {
  return candidate.events.length > 0
    ? candidate.events.map((event) => event.eventId).sort()
    : candidate.eventId ? [candidate.eventId] : [];
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function combinedNotes(bookings: MergeCandidate[]) {
  const notes = [...new Set(bookings.map((booking) => booking.notes?.trim()).filter(Boolean))];
  return notes.length > 0 ? notes.join("\n\n") : null;
}

function validateMergeCandidates(bookings: MergeCandidate[], requestedIds: string[]) {
  if (bookings.length !== requestedIds.length) {
    throw new HttpError(404, "One or more reservations were not found");
  }
  const ordered = [...bookings].sort((a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const canonical = ordered[0];
  if (!canonical) throw new HttpError(404, "Reservations were not found");
  const expectedEvents = eventIdsFor(canonical);
  const expectedTitle = normalizeBookingTitle(canonical.title).toLocaleLowerCase();

  for (const booking of ordered) {
    if (booking.kind !== BookingKind.RESERVATION || booking.status !== BookingStatus.BOOKED) {
      throw new HttpError(409, "Only active booked reservations can be merged");
    }
    if (booking.requesterUserId !== canonical.requesterUserId) {
      throw new HttpError(409, "Reservations for different people cannot be merged");
    }
    if (booking.custodyScope !== canonical.custodyScope) {
      throw new HttpError(409, "Personal and shared travel-case reservations cannot be merged");
    }
    if (normalizeBookingTitle(booking.title).toLocaleLowerCase() !== expectedTitle) {
      throw new HttpError(409, "Reservation titles must match before merging");
    }
    if (booking.locationId !== canonical.locationId) {
      throw new HttpError(409, "Reservations at different pickup locations cannot be merged");
    }
    if (
      booking.startsAt.getTime() !== canonical.startsAt.getTime()
      || booking.endsAt.getTime() !== canonical.endsAt.getTime()
    ) {
      throw new HttpError(409, "Reservation pickup and return windows must match before merging");
    }
    if (!sameStrings(eventIdsFor(booking), expectedEvents)) {
      throw new HttpError(409, "Reservations must link the same exact events before merging");
    }
    if (
      booking.serializedItems.some((item) => item.allocationStatus !== "active")
      || booking.bulkItems.some((item) => item.checkedOutQuantity > 0)
    ) {
      throw new HttpError(409, "A reservation with a started pickup cannot be merged");
    }
  }
  if (expectedEvents.length === 0) {
    throw new HttpError(409, "Only event-linked reservations can be merged");
  }
  return { ordered, canonical, eventIds: expectedEvents };
}

function mergeSummary(bookings: MergeCandidate[], requestedIds: string[]) {
  const { ordered, canonical, eventIds } = validateMergeCandidates(bookings, requestedIds);
  const serializedAssetIds = [...new Set(ordered.flatMap((booking) =>
    booking.serializedItems.map((item) => item.assetId),
  ))];
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

export async function previewReservationMerge(ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length < 2 || uniqueIds.length > 25) {
    throw new HttpError(400, "Select between 2 and 25 reservations to merge");
  }
  const bookings = await db.booking.findMany({
    where: { id: { in: uniqueIds } },
    include: mergeInclude,
  });
  const summary = mergeSummary(bookings, uniqueIds);
  return {
    targetReservationId: summary.canonical.id,
    sourceReservationIds: summary.sourceIds,
    title: summary.canonical.title,
    requesterUserId: summary.canonical.requesterUserId,
    eventIds: summary.eventIds,
    serializedItemCount: summary.serializedAssetIds.length,
    bulkQuantity: summary.bulkItems.reduce((total, item) => total + item.quantity, 0),
  };
}

export async function mergeReservations(args: {
  ids: string[];
  actorUserId: string;
  actorRole: Role;
}) {
  if (args.actorRole !== Role.ADMIN && args.actorRole !== Role.STAFF) {
    throw new HttpError(403, "Only staff can merge reservations");
  }
  const uniqueIds = [...new Set(args.ids)];
  if (uniqueIds.length < 2 || uniqueIds.length > 25) {
    throw new HttpError(400, "Select between 2 and 25 reservations to merge");
  }

  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const bookings = await tx.booking.findMany({
      where: { id: { in: uniqueIds } },
      include: mergeInclude,
    });
    const summary = mergeSummary(bookings, uniqueIds);

    await tx.booking.updateMany({
      where: { id: { in: summary.sourceIds }, status: BookingStatus.BOOKED },
      data: { status: BookingStatus.CANCELLED },
    });
    await tx.assetAllocation.updateMany({
      where: { bookingId: { in: summary.sourceIds }, active: true },
      data: { active: false },
    });

    const availability = await checkAvailability(tx, {
      locationId: summary.canonical.locationId,
      startsAt: summary.canonical.startsAt,
      endsAt: summary.canonical.endsAt,
      serializedAssetIds: summary.serializedAssetIds,
      bulkItems: summary.bulkItems,
      excludeBookingId: summary.canonical.id,
      bookingKind: BookingKind.RESERVATION,
    });
    if (
      availability.conflicts.length > 0
      || availability.shortages.length > 0
      || availability.unavailableAssets.length > 0
    ) {
      throw new HttpError(409, "The combined reservation is no longer available", availability);
    }

    const canonicalAssetIds = new Set(
      summary.canonical.serializedItems.map((item) => item.assetId),
    );
    const addedAssetIds = summary.serializedAssetIds.filter((id) => !canonicalAssetIds.has(id));
    if (addedAssetIds.length > 0) {
      await tx.bookingSerializedItem.createMany({
        data: addedAssetIds.map((assetId) => ({
          bookingId: summary.canonical.id,
          assetId,
          allocationStatus: "active",
        })),
        skipDuplicates: true,
      });
      await tx.assetAllocation.createMany({
        data: addedAssetIds.map((assetId) => ({
          bookingId: summary.canonical.id,
          assetId,
          startsAt: summary.canonical.startsAt,
          endsAt: summary.canonical.endsAt,
          active: true,
          kind: "RESERVATION" as const,
        })),
      });
    }

    for (const item of summary.bulkItems) {
      await tx.bookingBulkItem.upsert({
        where: {
          bookingId_bulkSkuId: {
            bookingId: summary.canonical.id,
            bulkSkuId: item.bulkSkuId,
          },
        },
        create: {
          bookingId: summary.canonical.id,
          bulkSkuId: item.bulkSkuId,
          plannedQuantity: item.quantity,
        },
        update: { plannedQuantity: item.quantity },
      });
    }
    await tx.booking.update({
      where: { id: summary.canonical.id },
      data: { notes: summary.notes },
    });

    await createAuditEntryTx(tx, {
      actorId: args.actorUserId,
      actorRole: args.actorRole,
      entityType: "booking",
      entityId: summary.canonical.id,
      action: "reservations_merged",
      before: { sourceReservationIds: summary.sourceIds },
      after: {
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
        action: "merged_into_reservation",
        before: { status: BookingStatus.BOOKED },
        after: {
          status: BookingStatus.CANCELLED,
          targetReservationId: summary.canonical.id,
        },
      });
    }

    return tx.booking.findUniqueOrThrow({
      where: { id: summary.canonical.id },
      include: bookingInclude,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
