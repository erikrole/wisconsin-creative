import { BookingStatus, ShiftAssignmentStatus, ShiftTradeStatus, type Prisma } from "@prisma/client";
import { formatAllDayDate, formatAppDateTime } from "@/lib/app-time";
import { db } from "@/lib/db";
import { summarizeScheduleDataQuality } from "@/lib/schedule-data-quality";
import { buildScheduleEventWhere } from "@/lib/schedule-event-where";
import type { ScheduleGearAssignmentStatus, ScheduleHealthSnapshot } from "@/lib/schedule-health-types";
import { getScheduleChangeHistory } from "@/lib/services/schedule-change-history";

type ScheduleHealthInput = {
  userId: string;
  parsedStartDate?: Date | null;
  parsedEndDate?: Date | null;
  includePast: boolean;
  includeArchived: boolean;
  sportCode: string | null;
  includeWorkingCopy?: boolean;
  now?: Date;
};

const ACTIVE_ASSIGNMENT_STATUSES = [
  ShiftAssignmentStatus.DIRECT_ASSIGNED,
  ShiftAssignmentStatus.APPROVED,
] as const;
const ACTIVE_ASSIGNMENT_STATUS_SET = new Set<ShiftAssignmentStatus>(ACTIVE_ASSIGNMENT_STATUSES);

const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
] as const;

function gearStatusForBooking(status: BookingStatus): ScheduleGearAssignmentStatus | null {
  if (status === BookingStatus.OPEN) return "checked_out";
  if (status === BookingStatus.PENDING_PICKUP) return "awaiting_pickup";
  if (status === BookingStatus.BOOKED) return "reserved";
  return null;
}

function eventIdsFor(assignments: Array<{ shift: { shiftGroup: { eventId: string } } }>) {
  return new Set(assignments.map((assignment) => assignment.shift.shiftGroup.eventId)).size;
}

function uniqueEventIdsFor(assignments: Array<{ shift: { shiftGroup: { eventId: string } } }>) {
  return [...new Set(assignments.map((assignment) => assignment.shift.shiftGroup.eventId))];
}

function formatNextCallLabel(startsAt: Date | null, allDay: boolean) {
  if (!startsAt) return "No upcoming calls";
  // All-day boundaries are encoded dates at UTC midnight, so they read back in
  // UTC; a timed call is an instant and reads in the app timezone. Neither can
  // use a bare `toLocale*`, which renders UTC on a server that has no timezone.
  if (allDay) return `${formatAllDayDate(startsAt)} · All day`;
  return formatAppDateTime(startsAt);
}

function getNextCall(
  events: Array<{
    id: string;
    summary: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    shiftGroup: {
      shifts: Array<{
        startsAt: Date;
        callStartsAt: Date | null;
        assignments: Array<{ callStartsAt: Date | null; status: ShiftAssignmentStatus }>;
      }>;
    } | null;
  }>,
  now: Date,
) {
  const candidates = events
    .filter((event) => event.endsAt.getTime() >= now.getTime())
    .map((event) => {
      // An all-day event has no call time, so a stray call window stored on one
      // of its slots must not become the "next call" instant.
      const callStartsAt = event.allDay ? undefined : event.shiftGroup?.shifts
        .flatMap((shift) => {
          const assignmentCalls = shift.assignments
            .filter((assignment) => ACTIVE_ASSIGNMENT_STATUS_SET.has(assignment.status))
            .map((assignment) => assignment.callStartsAt)
            .filter((value): value is Date => Boolean(value));
          return [shift.callStartsAt, ...assignmentCalls].filter((value): value is Date => Boolean(value));
        })
        .sort((a, b) => a.getTime() - b.getTime())[0];

      return {
        eventId: event.id,
        summary: event.summary,
        allDay: event.allDay,
        startsAt: callStartsAt ?? event.startsAt,
      };
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const next = candidates[0];
  return {
    eventId: next?.eventId ?? null,
    summary: next?.summary ?? null,
    startsAt: next?.startsAt.toISOString() ?? null,
    label: formatNextCallLabel(next?.startsAt ?? null, next?.allDay ?? false),
  };
}

export async function getScheduleHealth(input: ScheduleHealthInput): Promise<ScheduleHealthSnapshot> {
  const now = input.now ?? new Date();
  const visibleWhere = buildScheduleEventWhere({ ...input, now });
  const windowWhere = buildScheduleEventWhere({ ...input, includeHidden: true, includeArchived: true, now });

  const events = await db.calendarEvent.findMany({
    where: visibleWhere,
    orderBy: { startsAt: "asc" },
    include: {
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      shiftGroup: {
        include: {
          workingCopy: { select: { updatedAt: true, updatedById: true } },
          shifts: {
            include: {
              assignments: {
                select: {
                  id: true,
                  userId: true,
                  status: true,
                  hasConflict: true,
                  callStartsAt: true,
                  user: { select: { role: true, staffingType: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const activeAssignments = events.flatMap((event) =>
    event.shiftGroup?.shifts.flatMap((shift) =>
      shift.assignments
        .filter((assignment) => ACTIVE_ASSIGNMENT_STATUS_SET.has(assignment.status))
        .map((assignment) => ({
          ...assignment,
          shift: { id: shift.id, shiftGroup: { eventId: event.id } },
        })),
    ) ?? [],
  );
  const assignmentIds = activeAssignments.map((assignment) => assignment.id);
  const eventIds = events.map((event) => event.id);
  const dataQuality = summarizeScheduleDataQuality(events, now);
  const assignmentEventIds = new Map(activeAssignments.map((assignment) => [assignment.id, assignment.shift.shiftGroup.eventId]));

  let openSlots = 0;
  let needsCoverageEvents = 0;
  let coveredEvents = 0;
  let eventsWithoutCrew = 0;
  const needsCoverageEventIds: string[] = [];
  const eventsWithoutCrewIds: string[] = [];
  const coveredEventIds: string[] = [];

  // An open working copy holds every legacy edit path on this event and, until
  // the first publish, keeps assigned crew invisible to the workers themselves.
  const unpublishedDraftIds = events
    .filter((event) => event.shiftGroup?.workingCopy)
    .map((event) => event.id);

  for (const event of events) {
    const shifts = event.shiftGroup?.shifts ?? [];
    if (shifts.length === 0) {
      eventsWithoutCrew += 1;
      eventsWithoutCrewIds.push(event.id);
      continue;
    }
    const missingForEvent = shifts.filter(
      (shift) => !shift.assignments.some((assignment) => ACTIVE_ASSIGNMENT_STATUS_SET.has(assignment.status)),
    ).length;
    openSlots += missingForEvent;
    if (missingForEvent > 0) {
      needsCoverageEvents += 1;
      needsCoverageEventIds.push(event.id);
    } else {
      coveredEvents += 1;
      coveredEventIds.push(event.id);
    }
  }

  const pendingAssignments = events.flatMap((event) =>
    event.shiftGroup?.shifts.flatMap((shift) =>
      shift.assignments
        .filter((assignment) => assignment.status === ShiftAssignmentStatus.REQUESTED)
        .map((assignment) => ({
          ...assignment,
          shift: { id: shift.id, shiftGroup: { eventId: event.id } },
        })),
    ) ?? [],
  );
  const conflictingAssignments = activeAssignments.filter((assignment) => assignment.hasConflict);
  const myAssignments = activeAssignments.filter((assignment) => assignment.userId === input.userId);

  const bookingOrFilters: Prisma.BookingWhereInput[] = [
    ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
    ...(eventIds.length ? [{ events: { some: { eventId: { in: eventIds } } } }] : []),
    ...(assignmentIds.length ? [{ shiftAssignmentId: { in: assignmentIds } }] : []),
  ];

  const [hiddenCountResult, archivedCountResult, openTradeCountResult, tradeApprovalCountResult, bookingsResult, changeHistoryResult] =
    await Promise.allSettled([
      db.calendarEvent.count({ where: { ...windowWhere, isHidden: true } }),
      db.calendarEvent.count({ where: { ...windowWhere, archivedAt: { not: null } } }),
      db.shiftTrade.count({ where: { status: ShiftTradeStatus.OPEN } }),
      db.shiftTrade.count({ where: { status: ShiftTradeStatus.CLAIMED } }),
      bookingOrFilters.length
        ? db.booking.findMany({
            where: {
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              OR: bookingOrFilters,
            },
            select: {
              id: true,
              status: true,
              eventId: true,
              requesterUserId: true,
              shiftAssignmentId: true,
              events: { select: { eventId: true } },
            },
          })
        : Promise.resolve([]),
      getScheduleChangeHistory({
        eventIds,
        limitPerEvent: 3,
        since: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        includeWorkingCopy: input.includeWorkingCopy,
      }),
    ]);

  const partialFailures: string[] = [];
  const readSettled = <T>(result: PromiseSettledResult<T>, key: string, fallback: T) => {
    if (result.status === "fulfilled") return result.value;
    partialFailures.push(key);
    return fallback;
  };

  const bookings = readSettled(bookingsResult, "gearGaps", []);
  const usersWithGearByEvent = new Set<string>();
  const assignmentsWithGear = new Set<string>();
  const bookingsByAssignment = new Map<string, (typeof bookings)[number]>();
  const bookingsByEventAndUser = new Map<string, (typeof bookings)[number][]>();

  for (const booking of bookings) {
    const status = gearStatusForBooking(booking.status);
    if (!status) continue;
    if (booking.shiftAssignmentId) {
      assignmentsWithGear.add(booking.shiftAssignmentId);
      bookingsByAssignment.set(booking.shiftAssignmentId, booking);
    }

    const linkedEventIds = new Set<string>();
    if (booking.eventId) linkedEventIds.add(booking.eventId);
    for (const link of booking.events ?? []) linkedEventIds.add(link.eventId);
    if (booking.shiftAssignmentId) {
      const assignmentEventId = assignmentEventIds.get(booking.shiftAssignmentId);
      if (assignmentEventId) linkedEventIds.add(assignmentEventId);
    }

    for (const eventId of linkedEventIds) {
      usersWithGearByEvent.add(`${eventId}:${booking.requesterUserId}`);
      const key = `${eventId}:${booking.requesterUserId}`;
      const rows = bookingsByEventAndUser.get(key) ?? [];
      rows.push(booking);
      bookingsByEventAndUser.set(key, rows);
    }
  }

  const gearGapAssignments = activeAssignments.filter(
    (assignment) => !usersWithGearByEvent.has(`${assignment.shift.shiftGroup.eventId}:${assignment.userId}`) && !assignmentsWithGear.has(assignment.id),
  );
  const gearReadinessEvents: ScheduleHealthSnapshot["gearReadiness"]["events"] = {};
  const gearReadinessAssignments: ScheduleHealthSnapshot["gearReadiness"]["assignments"] = {};
  const unlinkedAssignmentGearEventIds = new Set<string>();

  for (const event of events) {
    gearReadinessEvents[event.id] = {
      eventId: event.id,
      counts: {
        ready: 0,
        reserved: 0,
        awaitingPickup: 0,
        checkedOut: 0,
        missing: 0,
        notLinked: 0,
      },
      assignmentIds: [],
    };
  }

  for (const assignment of activeAssignments) {
    const eventId = assignment.shift.shiftGroup.eventId;
    const eventReadiness = gearReadinessEvents[eventId];
    if (!eventReadiness) continue;
    const assignmentBooking = bookingsByAssignment.get(assignment.id) ?? null;
    const eventBookings = bookingsByEventAndUser.get(`${eventId}:${assignment.userId}`) ?? [];
    const eventBooking = eventBookings[0] ?? null;
    const booking = assignmentBooking ?? eventBooking;
    const status = booking ? gearStatusForBooking(booking.status) : null;
    const linkType = assignmentBooking ? "assignment" : eventBooking ? "event" : "missing";
    const readinessStatus = status ?? "missing";

    eventReadiness.assignmentIds.push(assignment.id);
    if (readinessStatus === "missing") {
      eventReadiness.counts.missing += 1;
    } else {
      eventReadiness.counts.ready += 1;
      if (readinessStatus === "reserved") eventReadiness.counts.reserved += 1;
      if (readinessStatus === "awaiting_pickup") eventReadiness.counts.awaitingPickup += 1;
      if (readinessStatus === "checked_out") eventReadiness.counts.checkedOut += 1;
      if (linkType === "event") {
        eventReadiness.counts.notLinked += 1;
        unlinkedAssignmentGearEventIds.add(eventId);
      }
    }

    gearReadinessAssignments[assignment.id] = {
      eventId,
      assignmentId: assignment.id,
      userId: assignment.userId,
      bookingId: booking?.id ?? null,
      status: readinessStatus,
      linkType,
    };
  }

  return {
    window: {
      startsAt: input.parsedStartDate?.toISOString() ?? null,
      endsAt: input.parsedEndDate?.toISOString() ?? null,
      includePast: input.includePast,
      includeArchived: input.includeArchived,
      sportCode: input.sportCode,
    },
    nextCall: getNextCall(events, now),
    queues: {
      openSlots: { count: openSlots, eventCount: needsCoverageEvents, eventIds: needsCoverageEventIds },
      eventsWithoutCrew: { count: eventsWithoutCrew, eventCount: eventsWithoutCrew, eventIds: eventsWithoutCrewIds },
      unpublishedDrafts: { count: unpublishedDraftIds.length, eventCount: unpublishedDraftIds.length, eventIds: unpublishedDraftIds },
      coveredEvents: { count: coveredEvents, eventCount: coveredEvents, eventIds: coveredEventIds, totalVisibleEvents: events.length },
      myShifts: { count: myAssignments.length, eventCount: eventIdsFor(myAssignments), eventIds: uniqueEventIdsFor(myAssignments) },
      pendingRequests: { count: pendingAssignments.length, eventCount: eventIdsFor(pendingAssignments), eventIds: uniqueEventIdsFor(pendingAssignments) },
      conflicts: { count: conflictingAssignments.length, eventCount: eventIdsFor(conflictingAssignments), eventIds: uniqueEventIdsFor(conflictingAssignments) },
      openTrades: { count: readSettled(openTradeCountResult, "openTrades", 0) },
      tradeApprovals: { count: readSettled(tradeApprovalCountResult, "tradeApprovals", 0) },
      gearGaps: { count: gearGapAssignments.length, eventCount: eventIdsFor(gearGapAssignments), eventIds: uniqueEventIdsFor(gearGapAssignments) },
      dataQuality,
      hiddenEvents: { count: readSettled(hiddenCountResult, "hiddenEvents", 0) },
      archivedEvents: { count: readSettled(archivedCountResult, "archivedEvents", 0) },
    },
    gearReadiness: {
      events: gearReadinessEvents,
      assignments: gearReadinessAssignments,
      queues: {
        missingGear: { count: gearGapAssignments.length, eventCount: eventIdsFor(gearGapAssignments), eventIds: uniqueEventIdsFor(gearGapAssignments) },
        unlinkedAssignmentGear: { count: Object.values(gearReadinessAssignments).filter((assignment) => assignment.linkType === "event").length, eventCount: unlinkedAssignmentGearEventIds.size, eventIds: [...unlinkedAssignmentGearEventIds] },
      },
    },
    changeHistory: readSettled(changeHistoryResult, "changeHistory", {
      events: Object.fromEntries(eventIds.map((eventId) => [eventId, {
        eventId,
        count: 0,
        latestAt: null,
        hasRecentChanges: false,
        needsReview: false,
        items: [],
      }])),
    }),
    partialFailures,
  };
}
