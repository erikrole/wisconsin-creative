import { BookingCustodyScope, BookingKind, BookingStatus } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requirePermission, requirePermissionOrCollaboratorCapability } from "@/lib/rbac";
import { normalizeBookingTitle } from "@/lib/title-normalization";
import { MAX_LINKED_EVENTS_PER_BOOKING } from "@/lib/request-limits";
import { assertSupportedReservationPickupLocation } from "@/lib/services/reservation-pickup-location";

const schema = z.object({
  requesterUserId: z.string().cuid(),
  title: z.string().trim().min(1).max(500),
  locationId: z.string().cuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  eventIds: z.array(z.string().cuid()).min(1).max(MAX_LINKED_EVENTS_PER_BOOKING),
  custodyScope: z.nativeEnum(BookingCustodyScope).default(BookingCustodyScope.PERSON),
}).strict();

function exactSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const values = new Set(right);
  return left.every((value) => values.has(value));
}

export const POST = withAuth(async (req, { user }) => {
  requirePermissionOrCollaboratorCapability(user, "booking", "view", "MY_GEAR_VIEW");
  const body = schema.parse(await req.json());
  await assertSupportedReservationPickupLocation(body.locationId);
  if (body.custodyScope === BookingCustodyScope.SHARED) {
    requirePermission(user.role, "checkout", "manage_custody");
    body.requesterUserId = user.id;
  }
  if (
    (user.role === "STUDENT" || user.role === "COLLABORATOR")
    && body.requesterUserId !== user.id
  ) {
    throw new HttpError(403, "You can only review your own reservation plan");
  }

  const normalizedTitle = normalizeBookingTitle(body.title);
  const primaryEventId = body.eventIds[0]!;
  const candidates = await db.booking.findMany({
    where: {
      kind: BookingKind.RESERVATION,
      status: BookingStatus.BOOKED,
      requesterUserId: body.requesterUserId,
      custodyScope: body.custodyScope,
      eventId: primaryEventId,
      title: { equals: normalizedTitle, mode: "insensitive" },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 10,
    select: {
      id: true,
      title: true,
      refNumber: true,
      locationId: true,
      startsAt: true,
      endsAt: true,
      events: { select: { eventId: true } },
      serializedItems: { select: { allocationStatus: true } },
      bulkItems: { select: { plannedQuantity: true, checkedOutQuantity: true } },
    },
  });
  const exactEventCandidates = candidates.filter((candidate) => {
    const ids = candidate.events.length > 0
      ? candidate.events.map((event) => event.eventId)
      : [primaryEventId];
    return exactSet(ids, body.eventIds);
  });
  const startsAt = new Date(body.startsAt).getTime();
  const endsAt = new Date(body.endsAt).getTime();
  const data = exactEventCandidates.map((candidate) => {
    const exact = candidate.locationId === body.locationId
      && candidate.startsAt.getTime() === startsAt
      && candidate.endsAt.getTime() === endsAt;
    const pickupStarted = candidate.serializedItems.some((item) => item.allocationStatus !== "active")
      || candidate.bulkItems.some((item) => item.checkedOutQuantity > 0);
    return {
      id: candidate.id,
      title: candidate.title,
      refNumber: candidate.refNumber,
      locationId: candidate.locationId,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      serializedItemCount: candidate.serializedItems.length,
      bulkQuantity: candidate.bulkItems.reduce((sum, item) => sum + item.plannedQuantity, 0),
      disposition: exact && pickupStarted ? "pickup_started" : exact ? "will_consolidate" : "review_differences",
    };
  });

  return ok({ data });
});
