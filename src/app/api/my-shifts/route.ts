import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireInternalActor } from "@/lib/rbac";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { startOfTodayInAppTz } from "@/lib/app-time";
import { isShiftAssignmentAcknowledged } from "@/lib/schedule-publication-types";

function gearStatusForBooking(status: string) {
  if (status === "OPEN") return "checked_out";
  if (status === "PENDING_PICKUP") return "pickup_ready";
  if (status === "BOOKED") return "reserved";
  return "draft";
}

function gearStatusPriority(status: string) {
  switch (status) {
    case "pickup_ready":
      return 4;
    case "checked_out":
      return 3;
    case "reserved":
      return 2;
    case "draft":
      return 1;
    default:
      return 0;
  }
}

/**
 * GET /api/my-shifts
 *
 * Returns the current user's upcoming shift assignments with gear checkout status.
 *
 * Query params:
 *   - eventId: (optional) filter to a specific event
 *   - userId:  (optional, defaults to the caller) whose shifts to return
 *   - limit:   (optional, default 5) max results
 *   - offset:  (optional, default 0) page offset
 */
export const GET = withAuth(async (req, { user }) => {
  // Live assignments, including groups that were never published, and readable
  // for any userId. Collaborators read crew from the published snapshot instead,
  // so this route stays internal.
  requireInternalActor(user);

  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  const rawLimit = Number(url.searchParams.get("limit") || "5");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 20) : 5;
  const rawOffset = Number(url.searchParams.get("offset") || "0");
  const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(Math.trunc(rawOffset), 0), 10_000) : 0;
  // Whose shifts. Defaults to the caller, so every existing request is
  // unchanged. Another person's assignments are not private here -- the
  // Schedule tab already shows who is covering what to everyone -- and a
  // teammate's profile needs them to answer "what is this person up to".
  const targetUserId = url.searchParams.get("userId") || user.id;

  const now = new Date();

  // Build where clause for active assignments
  const where: Record<string, unknown> = {
    userId: targetUserId,
    status: { in: ["DIRECT_ASSIGNED", "APPROVED"] },
    shift: {
      shiftGroup: {
        event: eventId
          ? { id: eventId }
          // Keep a shift on today's events listed until local midnight (endsAt
          // past the start of today), so an all-day shift doesn't vanish at
          // 12:00am and an evening game's shift isn't hidden the moment it ends.
          // Archived events are excluded; hidden events stay — a real
          // assignment beats list hygiene.
          : { endsAt: { gt: startOfTodayInAppTz(now) }, status: "CONFIRMED", archivedAt: null },
      },
    },
  };

  const [total, assignments] = await Promise.all([
    db.shiftAssignment.count({ where }),
    db.shiftAssignment.findMany({
      where,
      // Several assignments can share a shift start. Keep the offset cursor
      // stable while native Schedule follows every page.
      orderBy: [{ shift: { startsAt: "asc" } }, { id: "asc" }],
      skip: offset,
      take: limit,
      include: {
        shift: {
          include: {
            shiftGroup: {
              include: {
                event: {
                  select: {
                    id: true,
                    summary: true,
                    startsAt: true,
                    endsAt: true,
                    allDay: true,
                    sportCode: true,
                    isHome: true,
                    opponent: true,
                    locationId: true,
                    location: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  // For each assignment, check if that same person has gear linked to the event.
  // This must follow `targetUserId`, not the caller: pointed at somebody else's
  // shifts it would otherwise attach the viewer's own bookings to their rows.
  const eventIds = [...new Set(assignments.map((a) => a.shift.shiftGroup.event.id))];
  const assignmentIds = assignments.map((a) => a.id);

  const gearBookings = eventIds.length > 0
    ? await db.booking.findMany({
        where: {
          requesterUserId: targetUserId,
          status: { in: ["DRAFT", "BOOKED", "PENDING_PICKUP", "OPEN"] },
          OR: [
            { eventId: { in: eventIds } },
            { events: { some: { eventId: { in: eventIds } } } },
            { shiftAssignmentId: { in: assignmentIds } },
            { shiftAssignment: { shift: { shiftGroup: { eventId: { in: eventIds } } } } },
          ],
        },
        select: {
          id: true,
          eventId: true,
          status: true,
          kind: true,
          events: { select: { eventId: true } },
          shiftAssignment: {
            select: {
              shift: {
                select: {
                  shiftGroup: { select: { eventId: true } },
                },
              },
            },
          },
          _count: { select: { serializedItems: true, bulkItems: true } },
        },
      })
    : [];

  // Index bookings by eventId for fast lookup
  const bookingsByEvent = new Map<string, typeof gearBookings>();
  for (const b of gearBookings) {
    const bookingEventIds = new Set<string>();
    if (b.eventId) bookingEventIds.add(b.eventId);
    for (const event of b.events) bookingEventIds.add(event.eventId);
    const shiftEventId = b.shiftAssignment?.shift.shiftGroup.eventId;
    if (shiftEventId) bookingEventIds.add(shiftEventId);

    for (const eventId of bookingEventIds) {
      const existing = bookingsByEvent.get(eventId) || [];
      existing.push(b);
      existing.sort((a, b) => {
        const statusDelta = gearStatusPriority(gearStatusForBooking(b.status)) - gearStatusPriority(gearStatusForBooking(a.status));
        if (statusDelta !== 0) return statusDelta;
        return a.id.localeCompare(b.id);
      });
      bookingsByEvent.set(eventId, existing);
    }
  }

  const data = assignments.map((a) => {
    const event = a.shift.shiftGroup.event;
    const eventBookings = bookingsByEvent.get(event.id) || [];
    const gearStatus = eventBookings[0] ? gearStatusForBooking(eventBookings[0].status) : "none";

    return {
      id: a.id,
      shiftId: a.shift.id,
      area: a.shift.area,
      workerType: a.shift.workerType,
      workerLabel: shiftWorkerLabel(a.shift.workerType),
      startsAt: a.shift.startsAt.toISOString(),
      endsAt: a.shift.endsAt.toISOString(),
      // An all-day event has no call time. Its shift window is the event's own
      // encoded UTC-midnight boundary, so falling back to it here would hand
      // clients a meaningless instant that renders as 7:00 PM the day before.
      callStartsAt: a.shift.workerType === "ST" && !event.allDay
        ? (a.callStartsAt ?? a.shift.callStartsAt ?? a.shift.startsAt).toISOString()
        : null,
      callEndsAt: a.shift.workerType === "ST" && !event.allDay
        ? (a.callEndsAt ?? a.shift.callEndsAt ?? a.shift.endsAt).toISOString()
        : null,
      callNote: a.callNote,
      status: a.status,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
      acknowledgedById: a.acknowledgedById,
      schedulePublishedAt: a.shift.shiftGroup.publishedAt?.toISOString() ?? null,
      scheduleAcknowledged: isShiftAssignmentAcknowledged(
        a.shift.shiftGroup.publishedAt,
        a.acknowledgedAt,
      ),
      event: {
        id: event.id,
        summary: event.summary,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        allDay: event.allDay,
        sportCode: event.sportCode,
        isHome: event.isHome,
        opponent: event.opponent,
        locationId: event.locationId,
        locationName: event.location?.name ?? null,
      },
      gear: {
        status: gearStatus,
        bookings: eventBookings.map((b) => ({
          id: b.id,
          status: b.status,
          kind: b.kind,
          itemCount: b._count.serializedItems + b._count.bulkItems,
        })),
      },
    };
  });

  // Echo whose shifts these are. A client asking for a teammate's shifts has no
  // other way to tell a server that honoured `userId` from one that ignored it
  // and returned the caller's own -- and silently attributing one person's
  // shifts to another on their profile is worse than showing none.
  return ok({ data, userId: targetUserId, total, limit, offset });
});
