import { BookingKind, BookingStatus, ShiftAssignmentStatus, type Prisma } from "@prisma/client";
import { csvField } from "@/lib/csv";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { buildScheduleEventWhere } from "@/lib/schedule-event-where";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@/lib/shift-constants";
import { shiftWorkerLabel, shiftWorkerLabelForProfile, shiftWorkerSlotLabel, type ShiftWorkerProfile } from "@/lib/shift-display";
import { getSchedulePublicationState } from "@/lib/services/schedule-publication";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";

export const SCHEDULE_EXPORT_TYPES = [
  "roster",
  "hours",
  "open-slots",
  "conflicts",
  "trades",
  "gear-readiness",
] as const;

export type ScheduleExportType = (typeof SCHEDULE_EXPORT_TYPES)[number];

export type ScheduleExportInput = {
  type: ScheduleExportType;
  parsedStartDate: Date;
  parsedEndDate: Date;
  includeArchived: boolean;
  sportCode: string | null;
  now?: Date;
};

export type ScheduleExportResult = {
  csv: string;
  filename: string;
  exportedCount: number;
  total: number;
  truncated: boolean;
  limit: number;
};

const SCHEDULE_EXPORT_LIMIT = 5000;
export const SCHEDULE_EXPORT_MAX_DAYS = 366;

const ACTIVE_STATUS_SET = new Set<ShiftAssignmentStatus>(ACTIVE_ASSIGNMENT_STATUSES);
const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.BOOKED,
  BookingStatus.PENDING_PICKUP,
  BookingStatus.OPEN,
] as const;

type ExportGroup = Awaited<ReturnType<typeof loadScheduleExportGroups>>[number];
type ExportShift = ExportGroup["shifts"][number];
type ExportAssignment = ExportShift["assignments"][number];

function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
}

function assertWindow(start: Date, end: Date) {
  if (end.getTime() < start.getTime()) {
    throw new HttpError(400, "endDate must be after startDate");
  }
  if (daysBetween(start, end) > SCHEDULE_EXPORT_MAX_DAYS) {
    throw new HttpError(400, `Schedule exports are capped at ${SCHEDULE_EXPORT_MAX_DAYS} days`);
  }
}

function exportDate(value: Date | null | undefined) {
  return value ? value.toISOString() : "";
}

function eventTitle(event: ExportGroup["event"]) {
  if (!event.opponent) return event.summary;
  const prefix = event.isHome === false ? "at" : event.isHome === true ? "vs" : "";
  return [event.summary, prefix, event.opponent].filter(Boolean).join(" ");
}

function effectiveStartsAt(shift: ExportShift, assignment?: ExportAssignment | null) {
  if (shift.workerType === "FT") return shift.startsAt;
  return assignment?.callStartsAt ?? shift.callStartsAt ?? shift.startsAt;
}

function effectiveEndsAt(shift: ExportShift, assignment?: ExportAssignment | null) {
  if (shift.workerType === "FT") return shift.endsAt;
  return assignment?.callEndsAt ?? shift.callEndsAt ?? shift.endsAt;
}

// An all-day event has no call time. Its shifts inherit the event's own
// UTC-midnight boundary, so without the flag the export states a call at
// midnight that nobody was ever told to report for.
function callStartsAt(
  shift: ExportShift,
  assignment: ExportAssignment | null | undefined,
  allDay: boolean,
  event?: Pick<ExportGroup["event"], "isHome" | "site" | "opponent" | "summary">,
) {
  if (allDay || shift.workerType !== "ST") return null;
  if (event && !studentCallTimeAppliesToEvent(event)) return null;
  return effectiveStartsAt(shift, assignment);
}

function callEndsAt(
  shift: ExportShift,
  assignment: ExportAssignment | null | undefined,
  allDay: boolean,
  event?: Pick<ExportGroup["event"], "isHome" | "site" | "opponent" | "summary">,
) {
  if (allDay || shift.workerType !== "ST") return null;
  if (event && !studentCallTimeAppliesToEvent(event)) return null;
  return effectiveEndsAt(shift, assignment);
}

function durationHours(startsAt: Date, endsAt: Date) {
  return Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3_600_000);
}

function bookingStatusLabel(status: BookingStatus) {
  if (status === BookingStatus.BOOKED) return "Reserved";
  if (status === BookingStatus.PENDING_PICKUP) return "Pending pickup";
  if (status === BookingStatus.OPEN) return "Checked out";
  return status;
}

function csv(headers: string[], rows: Array<Array<string | number | boolean | Date | null | undefined>>) {
  return [headers.join(","), ...rows.map((row) => row.map(csvField).join(","))].join("\n");
}

function capped<T>(rows: T[]) {
  return {
    rows: rows.slice(0, SCHEDULE_EXPORT_LIMIT),
    total: rows.length,
    truncated: rows.length > SCHEDULE_EXPORT_LIMIT,
  };
}

function filename(type: ScheduleExportType, start: Date, end: Date) {
  return `schedule-${type}-${start.toISOString().slice(0, 10)}-to-${end.toISOString().slice(0, 10)}.csv`;
}

async function loadScheduleExportGroups(input: ScheduleExportInput) {
  return db.shiftGroup.findMany({
    where: {
      event: buildScheduleEventWhere({
        ...input,
        includePast: true,
      }),
    },
    orderBy: { event: { startsAt: "asc" } },
    take: SCHEDULE_EXPORT_LIMIT,
    select: {
      id: true,
      publishedAt: true,
      publishedById: true,
      lastPublishedSnapshot: true,
      archivedAt: true,
      event: {
        select: {
          id: true,
          summary: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          sportCode: true,
          opponent: true,
          isHome: true,
          site: true,
          location: { select: { name: true } },
        },
      },
      shifts: {
        orderBy: [{ area: "asc" }, { workerType: "asc" }, { startsAt: "asc" }],
        select: {
          id: true,
          area: true,
          workerType: true,
          startsAt: true,
          endsAt: true,
          callStartsAt: true,
          callEndsAt: true,
          assignments: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              userId: true,
              status: true,
              callStartsAt: true,
              callEndsAt: true,
              hasConflict: true,
              conflictNote: true,
              acknowledgedAt: true,
              user: { select: { name: true, role: true, staffingType: true, primaryArea: true } },
            },
          },
        },
      },
    },
  });
}

function activeAssignment(shift: ExportShift) {
  return shift.assignments.find((assignment) => ACTIVE_STATUS_SET.has(assignment.status)) ?? null;
}

function assignedClassLabel(assignment: ExportAssignment | null | undefined) {
  return assignment ? shiftWorkerLabelForProfile(assignment.user) ?? "" : "";
}

function rosterRows(groups: ExportGroup[]) {
  return groups.flatMap((group) => {
    const publication = getSchedulePublicationState(group);
    return group.shifts.map((shift) => {
      const assignment = activeAssignment(shift);
      return [
        group.event.id,
        eventTitle(group.event),
        exportDate(group.event.startsAt),
        exportDate(group.event.endsAt),
        group.event.location?.name ?? "",
        group.event.sportCode ?? "",
        shift.area,
        assignedClassLabel(assignment),
        shiftWorkerSlotLabel(shift.workerType),
        assignment?.user.name ?? "",
        assignment?.status ?? "OPEN",
        exportDate(callStartsAt(shift, assignment, group.event.allDay, group.event)),
        exportDate(callEndsAt(shift, assignment, group.event.allDay, group.event)),
        publication.status,
        exportDate(publication.publishedAt ? new Date(publication.publishedAt) : null),
        assignment?.acknowledgedAt ? "yes" : "no",
        exportDate(assignment?.acknowledgedAt ?? null),
        assignment?.hasConflict ? "yes" : "no",
        assignment?.conflictNote ?? "",
      ];
    });
  });
}

function hoursRows(groups: ExportGroup[]) {
  const byUser = new Map<string, {
    name: string;
    user: ShiftWorkerProfile;
    shiftCount: number;
    hours: number;
    eventCount: Set<string>;
    conflictCount: number;
  }>();

  for (const group of groups) {
    for (const shift of group.shifts) {
      const assignment = activeAssignment(shift);
      if (!assignment) continue;
      const current = byUser.get(assignment.userId) ?? {
        name: assignment.user.name,
        user: assignment.user,
        shiftCount: 0,
        hours: 0,
        eventCount: new Set<string>(),
        conflictCount: 0,
      };
      current.shiftCount += 1;
      current.hours += durationHours(effectiveStartsAt(shift, assignment), effectiveEndsAt(shift, assignment));
      current.eventCount.add(group.event.id);
      if (assignment.hasConflict) current.conflictCount += 1;
      byUser.set(assignment.userId, current);
    }
  }

  return [...byUser.values()]
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
    .map((row) => [
      row.name,
      shiftWorkerLabelForProfile(row.user) ?? "",
      row.shiftCount,
      row.eventCount.size,
      row.hours.toFixed(2),
      row.conflictCount,
    ]);
}

function openSlotRows(groups: ExportGroup[]) {
  return groups.flatMap((group) =>
    group.shifts
      .filter((shift) => !activeAssignment(shift))
      .map((shift) => [
        group.event.id,
        eventTitle(group.event),
        exportDate(group.event.startsAt),
        group.event.location?.name ?? "",
        group.event.sportCode ?? "",
        shift.id,
        shift.area,
        shiftWorkerLabel(shift.workerType),
        exportDate(callStartsAt(shift, null, group.event.allDay, group.event)),
        exportDate(callEndsAt(shift, null, group.event.allDay, group.event)),
        shift.assignments.filter((assignment) => assignment.status === ShiftAssignmentStatus.REQUESTED).length,
      ]),
  );
}

function conflictRows(groups: ExportGroup[]) {
  return groups.flatMap((group) =>
    group.shifts.flatMap((shift) =>
      shift.assignments
        .filter((assignment) => ACTIVE_STATUS_SET.has(assignment.status) && assignment.hasConflict)
        .map((assignment) => [
          group.event.id,
          eventTitle(group.event),
          exportDate(group.event.startsAt),
          shift.area,
          shiftWorkerSlotLabel(shift.workerType),
          shiftWorkerLabelForProfile(assignment.user) ?? "",
          assignment.user.name,
          assignment.status,
          exportDate(callStartsAt(shift, assignment, group.event.allDay, group.event)),
          exportDate(callEndsAt(shift, assignment, group.event.allDay, group.event)),
          assignment.conflictNote ?? "",
        ]),
    ),
  );
}

async function tradeRows(groups: ExportGroup[]) {
  const assignmentEvent = new Map<string, { group: ExportGroup; shift: ExportShift; assignment: ExportAssignment }>();
  for (const group of groups) {
    for (const shift of group.shifts) {
      for (const assignment of shift.assignments) {
        assignmentEvent.set(assignment.id, { group, shift, assignment });
      }
    }
  }

  const assignmentIds = [...assignmentEvent.keys()];
  const trades = assignmentIds.length
    ? await db.shiftTrade.findMany({
        where: { shiftAssignmentId: { in: assignmentIds } },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          shiftAssignmentId: true,
          status: true,
          postedAt: true,
          claimedAt: true,
          resolvedAt: true,
          postedBy: { select: { name: true } },
          claimedBy: { select: { name: true } },
        },
      })
    : [];

  const tradeRowsForCsv = trades.map((trade) => {
    const linked = assignmentEvent.get(trade.shiftAssignmentId);
    return [
      "trade",
      linked?.group.event.id ?? "",
      linked ? eventTitle(linked.group.event) : "",
      linked ? exportDate(linked.group.event.startsAt) : "",
      linked?.shift.area ?? "",
      linked ? shiftWorkerSlotLabel(linked.shift.workerType) : "",
      linked ? shiftWorkerLabelForProfile(linked.assignment.user) ?? "" : "",
      linked?.assignment.user.name ?? "",
      trade.status,
      trade.postedBy.name,
      trade.claimedBy?.name ?? "",
      exportDate(trade.postedAt),
      exportDate(trade.claimedAt),
      exportDate(trade.resolvedAt),
    ];
  });

  const pickupRows = groups.flatMap((group) =>
    group.shifts.flatMap((shift) =>
      shift.assignments
        .filter((assignment) => assignment.status === ShiftAssignmentStatus.REQUESTED)
        .map((assignment) => [
          "open-work-request",
          group.event.id,
          eventTitle(group.event),
          exportDate(group.event.startsAt),
          shift.area,
          shiftWorkerSlotLabel(shift.workerType),
          shiftWorkerLabelForProfile(assignment.user) ?? "",
          assignment.user.name,
          assignment.status,
          assignment.user.name,
          "",
          "",
          "",
          "",
        ]),
    ),
  );

  return [...tradeRowsForCsv, ...pickupRows];
}

async function gearRows(groups: ExportGroup[]) {
  const activeAssignments = groups.flatMap((group) =>
    group.shifts.flatMap((shift) => {
      const assignment = activeAssignment(shift);
      return assignment ? [{ group, shift, assignment }] : [];
    }),
  );
  const eventIds = groups.map((group) => group.event.id);
  const assignmentIds = activeAssignments.map((item) => item.assignment.id);
  const assignmentEventId = new Map(activeAssignments.map((item) => [item.assignment.id, item.group.event.id]));

  const bookingFilters: Prisma.BookingWhereInput[] = [
    { eventId: { in: eventIds } },
    { events: { some: { eventId: { in: eventIds } } } },
    ...(assignmentIds.length ? [{ shiftAssignmentId: { in: assignmentIds } }] : []),
  ];

  const bookings = eventIds.length
    ? await db.booking.findMany({
        where: {
          kind: BookingKind.RESERVATION,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          OR: bookingFilters,
        },
        select: {
          id: true,
          title: true,
          status: true,
          requesterUserId: true,
          eventId: true,
          shiftAssignmentId: true,
          events: { select: { eventId: true } },
        },
        take: SCHEDULE_EXPORT_LIMIT,
      })
    : [];

  const bookingsByAssignment = new Map(bookings.filter((booking) => booking.shiftAssignmentId).map((booking) => [booking.shiftAssignmentId!, booking]));
  const bookingsByEventAndUser = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const linkedEvents = new Set<string>();
    if (booking.eventId) linkedEvents.add(booking.eventId);
    for (const eventLink of booking.events) linkedEvents.add(eventLink.eventId);
    if (booking.shiftAssignmentId) {
      const eventId = assignmentEventId.get(booking.shiftAssignmentId);
      if (eventId) linkedEvents.add(eventId);
    }
    for (const eventId of linkedEvents) {
      const key = `${eventId}:${booking.requesterUserId}`;
      const rows = bookingsByEventAndUser.get(key) ?? [];
      rows.push(booking);
      bookingsByEventAndUser.set(key, rows);
    }
  }

  return activeAssignments.map(({ group, shift, assignment }) => {
    const assignmentBooking = bookingsByAssignment.get(assignment.id) ?? null;
    const eventBooking = bookingsByEventAndUser.get(`${group.event.id}:${assignment.userId}`)?.[0] ?? null;
    const booking = assignmentBooking ?? eventBooking;
    const linkType = assignmentBooking ? "assignment" : eventBooking ? "event" : "missing";
    return [
      group.event.id,
      eventTitle(group.event),
      exportDate(group.event.startsAt),
      shift.area,
      shiftWorkerSlotLabel(shift.workerType),
      shiftWorkerLabelForProfile(assignment.user) ?? "",
      assignment.user.name,
      booking ? bookingStatusLabel(booking.status) : "Missing",
      linkType,
      booking?.id ?? "",
      booking?.title ?? "",
    ];
  });
}

function buildResult(type: ScheduleExportType, input: ScheduleExportInput, headers: string[], rows: Array<Array<string | number | boolean | Date | null | undefined>>): ScheduleExportResult {
  const cappedRows = capped(rows);
  return {
    csv: `${csv(headers, cappedRows.rows)}\n`,
    filename: filename(type, input.parsedStartDate, input.parsedEndDate),
    exportedCount: cappedRows.rows.length,
    total: cappedRows.total,
    truncated: cappedRows.truncated,
    limit: SCHEDULE_EXPORT_LIMIT,
  };
}

export async function buildScheduleExport(input: ScheduleExportInput): Promise<ScheduleExportResult> {
  assertWindow(input.parsedStartDate, input.parsedEndDate);
  const groups = await loadScheduleExportGroups(input);

  if (input.type === "roster") {
    return buildResult(input.type, input, [
      "Event ID", "Event", "Starts", "Ends", "Location", "Sport", "Area", "Assigned Class", "Planned Slot", "Assignee", "Status", "Call Starts", "Call Ends", "Publication", "Published At", "Acknowledged", "Acknowledged At", "Conflict", "Conflict Note",
    ], rosterRows(groups));
  }
  if (input.type === "hours") {
    return buildResult(input.type, input, [
      "Worker", "Class", "Shifts", "Events", "Hours", "Conflicts",
    ], hoursRows(groups));
  }
  if (input.type === "open-slots") {
    return buildResult(input.type, input, [
      "Event ID", "Event", "Starts", "Location", "Sport", "Shift ID", "Area", "Planned Slot", "Call Starts", "Call Ends", "Pending Requests",
    ], openSlotRows(groups));
  }
  if (input.type === "conflicts") {
    return buildResult(input.type, input, [
      "Event ID", "Event", "Starts", "Area", "Planned Slot", "Assigned Class", "Worker", "Status", "Call Starts", "Call Ends", "Conflict Note",
    ], conflictRows(groups));
  }
  if (input.type === "trades") {
    return buildResult(input.type, input, [
      "Kind", "Event ID", "Event", "Starts", "Area", "Planned Slot", "Assigned Class", "Worker", "Status", "Posted By", "Claimed By", "Posted At", "Claimed At", "Resolved At",
    ], await tradeRows(groups));
  }

  return buildResult(input.type, input, [
    "Event ID", "Event", "Starts", "Area", "Planned Slot", "Assigned Class", "Worker", "Gear Status", "Link Type", "Booking ID", "Booking",
  ], await gearRows(groups));
}

export function parseScheduleExportType(value: string | null): ScheduleExportType {
  if (SCHEDULE_EXPORT_TYPES.includes(value as ScheduleExportType)) return value as ScheduleExportType;
  throw new HttpError(400, "type must be roster, hours, open-slots, conflicts, trades, or gear-readiness");
}
