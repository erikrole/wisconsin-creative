import { getInitials } from "@/lib/avatar";
import { displayBookingTitle } from "@/lib/booking-display-title";
import { gearStatusForBooking, gearStatusPriority } from "@/lib/booking-status-display";
import { studentCallTimeAppliesToEvent } from "@/lib/shift-call-windows";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { normalizeTeamAbbreviations } from "@/lib/title-normalization";

/* Row shaping for the Home dashboard payload (`/api/dashboard`). */

type SiteValue = "HOME" | "AWAY" | "NEUTRAL" | null;
type SummaryAsset = { id: string; name: string | null; imageUrl: string | null; category: { name: string } | null };

export type DashboardBookingRow = {
  id: string;
  kind: string;
  title: string;
  refNumber: string | null;
  eventId: string | null;
  sportCode: string | null;
  events?: Array<{ eventId: string }>;
  shiftAssignment?: { shift: { shiftGroup: { eventId: string } } } | null;
  requester: { name: string; avatarUrl: string | null };
  requesterUserId: string;
  location?: { name: string } | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  _count: { serializedItems: number; bulkItems: number };
  serializedItems: Array<{ asset: SummaryAsset }>;
};

export type DashboardBookingSummary = ReturnType<typeof toBookingSummary>;

/** Overdue first, then the nearest due date. */
export function sortOverdueFirst(a: { isOverdue: boolean; endsAt: string }, b: { isOverdue: boolean; endsAt: string }) {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  return new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
}

/** Bodies and lenses lead the gear avatars. */
function sortItemsByCategory(items: Array<{ asset: SummaryAsset }>) {
  const isBodyOrLens = (item: { asset: SummaryAsset }) => /body|lens/i.test(item.asset.category?.name ?? "");
  return [...items].sort((a, b) => Number(isBodyOrLens(b)) - Number(isBodyOrLens(a)));
}

/** Every event a booking belongs to: its own, its linked events, and its shift's. */
export function bookingEventIds(c: Pick<DashboardBookingRow, "eventId" | "events" | "shiftAssignment">) {
  const ids = new Set<string>();
  if (c.eventId) ids.add(c.eventId);
  for (const event of c.events ?? []) ids.add(event.eventId);
  const shiftEventId = c.shiftAssignment?.shift.shiftGroup.eventId;
  if (shiftEventId) ids.add(shiftEventId);
  return [...ids];
}

export function toBookingSummary(c: DashboardBookingRow, now: Date, canBeOverdue: boolean) {
  const eventIds = bookingEventIds(c);
  return {
    id: c.id,
    kind: c.kind,
    title: displayBookingTitle(c.title),
    refNumber: c.refNumber,
    eventId: c.eventId ?? null,
    eventIds,
    linkedEventId: c.shiftAssignment?.shift.shiftGroup.eventId ?? c.eventId ?? eventIds[0] ?? null,
    sportCode: c.sportCode ?? null,
    requesterName: c.requester.name,
    requesterUserId: c.requesterUserId,
    requesterInitials: getInitials(c.requester.name),
    requesterAvatarUrl: c.requester.avatarUrl ?? null,
    locationName: c.location?.name ?? null,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    itemCount: c._count.serializedItems + c._count.bulkItems,
    status: c.status,
    isOverdue: canBeOverdue && c.endsAt < now,
    items: sortItemsByCategory(c.serializedItems).slice(0, 3).map((si) => ({
      id: si.asset.id,
      name: si.asset.name,
      imageUrl: si.asset.imageUrl,
    })),
  };
}

export type DashboardEventRow = {
  id: string;
  summary: string;
  sportCode: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: { id: string; name: string } | null;
  opponent: string | null;
  isHome: boolean | null;
  site: SiteValue;
  shiftGroup: {
    shifts: Array<{
      area: string;
      startsAt: Date;
      assignments: Array<{ user: { id: string; name: string; avatarUrl: string | null } }>;
    }>;
  } | null;
};

/** An upcoming event with its crew coverage, its crew (each person once) and a home-game call time. */
export function toDashboardEvent(e: DashboardEventRow) {
  const shifts = e.shiftGroup?.shifts ?? [];
  const totalShiftSlots = shifts.length;
  const filledShiftSlots = shifts.filter((s) => s.assignments.length > 0).length;
  const coverage = totalShiftSlots > 0
    ? {
        total: totalShiftSlots,
        filled: filledShiftSlots,
        percentage: Math.round((filledShiftSlots / totalShiftSlots) * 100),
      }
    : null;
  const earliestShift = shifts.reduce<Date | null>(
    (earliest, shift) => (!earliest || shift.startsAt < earliest ? shift.startsAt : earliest),
    null,
  );
  const assignedUsers = new Map<string, { id: string; name: string; avatarUrl: string | null; area: string | null }>();
  for (const shift of shifts) for (const a of shift.assignments) {
    if (!assignedUsers.has(a.user.id)) {
      assignedUsers.set(a.user.id, { id: a.user.id, name: a.user.name, avatarUrl: a.user.avatarUrl ?? null, area: shift.area });
    }
  }
  return {
    id: e.id,
    title: normalizeTeamAbbreviations(e.summary),
    sportCode: e.sportCode ?? null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    allDay: e.allDay,
    location: e.location?.name ?? null,
    locationId: e.location?.id ?? null,
    opponent: e.opponent ? normalizeTeamAbbreviations(e.opponent) : null,
    isHome: e.isHome ?? null,
    site: e.site ?? null,
    coverage,
    // An all-day event has no call time; its shifts inherit the event's own
    // UTC-midnight boundary, which would surface as "Call 7:00 PM".
    callTime: e.isHome === true
      && !e.allDay
      && studentCallTimeAppliesToEvent(e)
      && earliestShift
      ? earliestShift.toISOString()
      : null,
    totalShiftSlots,
    filledShiftSlots,
    assignedUsers: [...assignedUsers.values()],
  };
}

export type DashboardOverdueRow = {
  id: string;
  title: string;
  requester: { name: string; avatarUrl: string | null };
  serializedItems: Array<{ asset: { id: string; assetTag: string; name: string | null; imageUrl: string | null } }>;
  startsAt: Date;
  endsAt: Date;
  _count: { serializedItems: number; bulkItems: number };
};

export function toOverdueItem(b: DashboardOverdueRow) {
  return {
    bookingId: b.id,
    bookingTitle: displayBookingTitle(b.title),
    requesterName: b.requester.name,
    requesterInitials: getInitials(b.requester.name),
    requesterAvatarUrl: b.requester.avatarUrl ?? null,
    assetTags: b.serializedItems.map((si) => si.asset.assetTag),
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    itemCount: b._count.serializedItems + b._count.bulkItems,
    items: b.serializedItems.map((si) => ({
      id: si.asset.id,
      name: si.asset.name,
      imageUrl: si.asset.imageUrl,
    })),
  };
}

export type DashboardShiftRow = {
  id: string;
  callStartsAt: Date | null;
  callEndsAt: Date | null;
  callNote: string | null;
  shift: {
    area: string;
    workerType: string;
    startsAt: Date;
    endsAt: Date;
    callStartsAt: Date | null;
    callEndsAt: Date | null;
    shiftGroup: {
      event: {
        id: string;
        summary: string;
        startsAt: Date;
        endsAt: Date;
        allDay: boolean;
        sportCode: string | null;
        opponent: string | null;
        isHome: boolean | null;
        site: SiteValue;
        locationId: string | null;
        location: { id: string; name: string } | null;
      };
    };
  };
};

function toShiftEvent(ev: DashboardShiftRow["shift"]["shiftGroup"]["event"]) {
  return {
    id: ev.id,
    summary: normalizeTeamAbbreviations(ev.summary),
    startsAt: ev.startsAt.toISOString(),
    endsAt: ev.endsAt.toISOString(),
    allDay: ev.allDay,
    sportCode: ev.sportCode,
    opponent: ev.opponent ? normalizeTeamAbbreviations(ev.opponent) : null,
    isHome: ev.isHome,
    site: ev.site,
    locationId: ev.locationId,
    locationName: ev.location?.name ?? null,
  };
}

/**
 * A shift and, for a student at a home or non-game event, their call window.
 * An all-day event has no call time: its shift window is the event's encoded
 * UTC-midnight boundary, which would read as 7:00 PM the day before.
 */
function toShift(a: DashboardShiftRow) {
  const event = a.shift.shiftGroup.event;
  const studentCallTimeVisible = a.shift.workerType === "ST"
    && !event.allDay
    && studentCallTimeAppliesToEvent(event);
  return {
    id: a.id,
    area: a.shift.area,
    workerType: a.shift.workerType,
    workerLabel: shiftWorkerLabel(a.shift.workerType),
    startsAt: a.shift.startsAt.toISOString(),
    endsAt: a.shift.endsAt.toISOString(),
    callStartsAt: studentCallTimeVisible ? (a.callStartsAt ?? a.shift.callStartsAt ?? a.shift.startsAt).toISOString() : null,
    callEndsAt: studentCallTimeVisible ? (a.callEndsAt ?? a.shift.callEndsAt ?? a.shift.endsAt).toISOString() : null,
    callNote: studentCallTimeVisible ? a.callNote : null,
  };
}

/**
 * The caller's gear for each of their shift events, best status first
 * (pickup ready, then checked out, reserved, draft), then soonest. Built from
 * every durable booking-event link, never from matching titles. Callers look
 * up only their shift events, so gear filed under any other event is unused.
 */
export function groupShiftGearByEvent(bookings: DashboardBookingRow[], now: Date) {
  const gearByEvent = new Map<string, DashboardBookingSummary[]>();
  for (const booking of bookings) {
    const summary = toBookingSummary(booking, now, false);
    for (const eventId of bookingEventIds(booking)) {
      gearByEvent.set(eventId, [...(gearByEvent.get(eventId) ?? []), summary]);
    }
  }
  for (const rows of gearByEvent.values()) {
    rows.sort((a, b) => (
      gearStatusPriority(gearStatusForBooking(b.status)) - gearStatusPriority(gearStatusForBooking(a.status))
      || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    ));
  }
  return gearByEvent;
}

export function toMyShift(a: DashboardShiftRow, gearByEvent: Map<string, DashboardBookingSummary[]>) {
  const event = a.shift.shiftGroup.event;
  const primaryGear = gearByEvent.get(event.id)?.[0] ?? null;
  return {
    ...toShift(a),
    event: toShiftEvent(event),
    gearStatus: primaryGear ? gearStatusForBooking(primaryGear.status) : "none",
    gearItems: primaryGear?.items ?? [],
    gearItemCount: primaryGear?.itemCount ?? 0,
  };
}

/** One work item per shift event, from the caller's earliest shift there. */
export function toMyEventWork(shifts: DashboardShiftRow[], gearByEvent: Map<string, DashboardBookingSummary[]>) {
  const assignmentByEvent = new Map<string, DashboardShiftRow>();
  for (const assignment of shifts) {
    const eventId = assignment.shift.shiftGroup.event.id;
    const current = assignmentByEvent.get(eventId);
    if (!current || assignment.shift.startsAt < current.shift.startsAt) {
      assignmentByEvent.set(eventId, assignment);
    }
  }

  return [...assignmentByEvent.values()].map((a) => {
    const event = a.shift.shiftGroup.event;
    const gearBookings = gearByEvent.get(event.id) ?? [];
    const primaryGear = gearBookings[0] ?? null;
    return {
      id: event.id,
      event: toShiftEvent(event),
      shift: toShift(a),
      gearStatus: primaryGear ? gearStatusForBooking(primaryGear.status) : "none",
      gearBookings,
      needsGear: gearBookings.every((booking) => (
        booking.status !== "BOOKED"
        && booking.status !== "PENDING_PICKUP"
        && booking.status !== "OPEN"
      )),
    };
  });
}

export type DashboardReportRow = {
  id: string;
  type: string;
  description: string | null;
  imageUrl: string | null;
  lastReportedAt: Date;
  asset: { id: string; assetTag: string; name: string | null; status: string } | null;
  booking: { title: string } | null;
  reportedBy: { name: string };
};

export type DashboardMaintenanceRow = { id: string; assetTag: string; name: string | null; updatedAt: Date };

/** Open damage and loss cases on serialized items, then items in maintenance. */
export function toFlaggedItems(reports: DashboardReportRow[], maintenance: DashboardMaintenanceRow[]) {
  return [
    ...reports.flatMap((r) => !r.asset ? [] : [{
      id: r.id,
      assetId: r.asset.id,
      assetTag: r.asset.assetTag,
      assetName: r.asset.name,
      type: r.type as "DAMAGED" | "LOST",
      bookingTitle: r.booking ? displayBookingTitle(r.booking.title) : null,
      reportedBy: r.reportedBy.name as string | null,
      description: r.description ?? null,
      imageUrl: r.imageUrl ?? null,
      assetStatus: r.asset.status,
      createdAt: r.lastReportedAt.toISOString(),
    }]),
    ...maintenance.map((a) => ({
      id: `maint-${a.id}`,
      assetId: a.id,
      assetTag: a.assetTag,
      assetName: a.name,
      type: "MAINTENANCE" as const,
      bookingTitle: null,
      reportedBy: null,
      description: null,
      imageUrl: null,
      assetStatus: "MAINTENANCE",
      createdAt: a.updatedAt.toISOString(),
    })),
  ];
}

/** Lost bulk units per family, with unit numbers so a row can be settled from Home. */
export function toLostBulkUnits(
  groups: Array<{ bulkSkuId: string; _count: { id: number } }>,
  skus: Array<{ id: string; name: string }>,
  units: Array<{ bulkSkuId: string; unitNumber: number }>,
) {
  const nameMap = new Map(skus.map((s) => [s.id, s.name]));
  return groups.map((r) => ({
    skuName: nameMap.get(r.bulkSkuId) ?? "Unknown",
    count: r._count.id,
    bulkSkuId: r.bulkSkuId,
    units: units.filter((u) => u.bulkSkuId === r.bulkSkuId).map((u) => u.unitNumber),
  }));
}
