/**
 * Pure projections for the redesigned kiosk home (frames A1–A3): pickups,
 * people tiles, crew without gear, and the next thing coming up. The dashboard
 * route loads rows in a fixed number of batched queries and hands them here, so
 * nothing in this file touches the database.
 *
 * SHARED travel-case bookings keep a requester only as compatibility metadata
 * (D-061): they never name a person, never produce a people tile, and never
 * count as someone's own gear.
 */

export const SHIFT_SOON_WINDOW_MS = 2 * 60 * 60 * 1000;

type Person = { id: string; name: string; avatarUrl: string | null };

export type HomeCheckoutRow = {
  id: string;
  endsAt: Date;
  custodyScope: "PERSON" | "SHARED";
  eventId: string | null;
  shiftAssignmentId: string | null;
  events: Array<{ eventId: string }>;
  requester: Person;
};

export type HomePickupRow = {
  id: string;
  kind: "CHECKOUT" | "RESERVATION";
  title: string;
  startsAt: Date;
  custodyScope: "PERSON" | "SHARED";
  eventId: string | null;
  events?: Array<{ eventId: string }>;
  requester: Person;
  _count: { serializedItems: number };
  bulkItems: Array<{ plannedQuantity: number; checkedOutQuantity: number | null }>;
};

export type HomeEventRow = {
  id: string;
  summary: string;
  startsAt: Date;
  allDay: boolean;
  shiftGroup: {
    shifts: Array<{
      callStartsAt: Date | null;
      startsAt: Date;
      endsAt: Date;
      assignments: Array<{ id?: string; callStartsAt?: Date | null; user: Person }>;
    }>;
  } | null;
};

export type KioskHomePickup = {
  bookingId: string;
  title: string;
  requester: Person | null;
  itemCount: number;
  readyAt: Date;
  custodyScope: "PERSON" | "SHARED";
  eventId: string | null;
};

export type KioskTodayReason = "overdue" | "pickup" | "return_due" | "shift_soon";

export type KioskTodayTile = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  reasons: KioskTodayReason[];
  pickupAt?: Date;
  callAt?: Date;
};

/** The booking's linked event: `Booking.eventId` first, then its first `BookingEvent`. */
export function linkedEventId(row: { eventId: string | null; events?: Array<{ eventId: string }> }) {
  return row.eventId ?? row.events?.[0]?.eventId ?? null;
}

export function isInWindow(at: Date, window: { start: Date; end: Date }) {
  return at >= window.start && at < window.end;
}

export function projectPickups(rows: HomePickupRow[], displayTitle: (title: string) => string): KioskHomePickup[] {
  return rows
    .map((row) => {
      const bulkRemaining = row.bulkItems.reduce(
        (sum, item) => sum + Math.max(0, item.plannedQuantity - (row.kind === "RESERVATION" ? item.checkedOutQuantity ?? 0 : 0)),
        0,
      );
      return {
        bookingId: row.id,
        title: displayTitle(row.title),
        requester: row.custodyScope === "SHARED" ? null : row.requester,
        itemCount: row._count.serializedItems + bulkRemaining,
        readyAt: row.startsAt,
        custodyScope: row.custodyScope,
        eventId: linkedEventId(row),
      };
    })
    .filter((pickup) => pickup.itemCount > 0)
    .sort((a, b) => a.readyAt.getTime() - b.readyAt.getTime());
}

/** Call time for one assignment: its own override, then the shift's call, then shift start. */
type HomeShift = NonNullable<HomeEventRow["shiftGroup"]>["shifts"][number];

function assignmentCallAt(shift: HomeShift, assignment: { callStartsAt?: Date | null }) {
  return assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt;
}

function peopleWithOwnGear(checkouts: HomeCheckoutRow[]) {
  return new Set(checkouts.filter((c) => c.custodyScope === "PERSON").map((c) => c.requester.id));
}

/**
 * People tiles: overdue personal checkouts, pickups today, personal returns due
 * today, and anyone whose call is within two hours with no personal OPEN
 * checkout yet. One tile per person with merged reasons.
 */
export function projectTodayTiles(args: {
  now: Date;
  today: { start: Date; end: Date };
  checkouts: HomeCheckoutRow[];
  pickups: KioskHomePickup[];
  events: HomeEventRow[];
}): KioskTodayTile[] {
  const tiles = new Map<string, KioskTodayTile>();
  const tileFor = (person: Person) => {
    let tile = tiles.get(person.id);
    if (!tile) {
      tile = { userId: person.id, name: person.name, avatarUrl: person.avatarUrl, reasons: [] };
      tiles.set(person.id, tile);
    }
    return tile;
  };
  const addReason = (tile: KioskTodayTile, reason: KioskTodayReason) => {
    if (!tile.reasons.includes(reason)) tile.reasons.push(reason);
  };

  for (const checkout of args.checkouts) {
    if (checkout.custodyScope !== "PERSON") continue;
    if (checkout.endsAt < args.now) {
      addReason(tileFor(checkout.requester), "overdue");
    } else if (isInWindow(checkout.endsAt, args.today)) {
      addReason(tileFor(checkout.requester), "return_due");
    }
  }

  for (const pickup of args.pickups) {
    if (!pickup.requester || !isInWindow(pickup.readyAt, { start: new Date(0), end: args.today.end })) continue;
    const tile = tileFor(pickup.requester);
    addReason(tile, "pickup");
    if (!tile.pickupAt || pickup.readyAt < tile.pickupAt) tile.pickupAt = pickup.readyAt;
  }

  const withGear = peopleWithOwnGear(args.checkouts);
  const soonEnd = new Date(args.now.getTime() + SHIFT_SOON_WINDOW_MS);
  for (const event of args.events) {
    if (event.allDay) continue;
    for (const shift of event.shiftGroup?.shifts ?? []) {
      if (shift.endsAt <= args.now) continue;
      for (const assignment of shift.assignments) {
        if (withGear.has(assignment.user.id)) continue;
        const callAt = assignmentCallAt(shift, assignment);
        if (callAt <= args.now || callAt > soonEnd) continue;
        const tile = tileFor(assignment.user);
        addReason(tile, "shift_soon");
        if (!tile.callAt || callAt < tile.callAt) tile.callAt = callAt;
      }
    }
  }

  const urgency = (tile: KioskTodayTile) => {
    if (tile.reasons.includes("overdue")) return 0;
    const times = [tile.pickupAt, tile.callAt].filter((t): t is Date => Boolean(t)).map((t) => t.getTime());
    return times.length > 0 ? Math.min(...times) : Number.MAX_SAFE_INTEGER;
  };
  return [...tiles.values()].sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name));
}

/**
 * Assigned crew for one event with no personal OPEN checkout linked to that
 * event (`Booking.eventId` or `BookingEvent`) or to their own shift assignment.
 */
export function crewWithoutGear(event: HomeEventRow, checkouts: HomeCheckoutRow[]) {
  const covered = new Set<string>();
  const assignmentIds = new Set(
    (event.shiftGroup?.shifts ?? []).flatMap((shift) => shift.assignments.map((a) => a.id).filter(Boolean)),
  );
  for (const checkout of checkouts) {
    if (checkout.custodyScope !== "PERSON") continue;
    const linked =
      checkout.eventId === event.id ||
      checkout.events.some((link) => link.eventId === event.id) ||
      (checkout.shiftAssignmentId !== null && assignmentIds.has(checkout.shiftAssignmentId));
    if (linked) covered.add(checkout.requester.id);
  }
  const seen = new Set<string>();
  const crew: Person[] = [];
  for (const shift of event.shiftGroup?.shifts ?? []) {
    for (const assignment of shift.assignments) {
      if (seen.has(assignment.user.id) || covered.has(assignment.user.id)) continue;
      seen.add(assignment.user.id);
      crew.push(assignment.user);
    }
  }
  return crew;
}

/** The next event call (or start) or pickup window after now. */
export function projectNextUp(args: {
  now: Date;
  events: Array<{ title: string; startsAt: Date; callStartsAt: Date | null; allDay: boolean }>;
  pickups: KioskHomePickup[];
}): { title: string; at: Date; kind: "event" | "pickup" } | null {
  const candidates: Array<{ title: string; at: Date; kind: "event" | "pickup" }> = [];
  for (const event of args.events) {
    if (event.allDay) continue;
    const at = event.callStartsAt ?? event.startsAt;
    if (at > args.now) candidates.push({ title: event.title, at, kind: "event" });
  }
  for (const pickup of args.pickups) {
    if (pickup.readyAt > args.now) candidates.push({ title: pickup.title, at: pickup.readyAt, kind: "pickup" });
  }
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] ?? null;
}
