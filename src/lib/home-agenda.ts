/**
 * Personal Home agenda: what the viewer is doing next and what needs them
 * now, derived from the dashboard payload. Pure so web and the iOS mirror
 * (`ios/Wisconsin/Views/HomeAgenda.swift`) can share one contract.
 *
 * Times compare in the viewer's local calendar, matching the rest of the web
 * dashboard (`formatDayLabel`, `isDueToday`).
 */

import { calendarDate } from "@/lib/format";
import { sportLabel } from "@/lib/sports";

export type AgendaBooking = {
  id: string;
  kind: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  isOverdue: boolean;
  itemCount: number;
  locationName: string | null;
  linkedEventId: string | null;
  eventIds: string[];
};

export type AgendaEventWork = {
  id: string;
  event: {
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
    site: "HOME" | "AWAY" | "NEUTRAL" | null;
    locationId: string | null;
    locationName: string | null;
  };
  shift: {
    id: string;
    area: string;
    workerType: string;
    startsAt: string;
    endsAt: string;
    callStartsAt: string | null;
    callEndsAt: string | null;
    callNote: string | null;
  };
  gearBookings: AgendaBooking[];
  needsGear: boolean;
};

export type AgendaInput = {
  myCheckouts: AgendaBooking[];
  myReservations: AgendaBooking[];
  myPendingPickups: AgendaBooking[];
  myEventWork: AgendaEventWork[];
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How far ahead "Next up" looks. Beyond this the week strip carries it. */
export const NEXT_UP_HORIZON_MS = 12 * HOUR;

// ── Event cards ─────────────────────────────────────────────

export type EventCard = AgendaEventWork & {
  /** The Student call time, else the event start. */
  reportAt: string;
  /** False for all-day events. */
  hasReportTime: boolean;
  /** True only when `reportAt` is a Student call time. */
  isCallTime: boolean;
};

function isFullDayWindow(startsAt: string, endsAt: string): boolean {
  return new Date(endsAt).getTime() - new Date(startsAt).getTime() >= DAY - 60_000;
}

/**
 * Students report at their call time. Staff timing is set outside Schedule,
 * so their cards anchor on the event start and never name a call time.
 */
export function eventReportTime(work: AgendaEventWork): { at: string; timed: boolean; isCall: boolean } {
  if (work.event.allDay) return { at: work.event.startsAt, timed: false, isCall: false };
  const call = work.shift.workerType === "ST" && work.shift.callStartsAt && work.shift.callEndsAt
    && !isFullDayWindow(work.shift.callStartsAt, work.shift.callEndsAt)
    ? work.shift.callStartsAt
    : null;
  return call
    ? { at: call, timed: true, isCall: true }
    : { at: work.event.startsAt, timed: true, isCall: false };
}

/** One card per event, soonest first, with the event's gear attached. */
export function buildEventCards(input: AgendaInput): EventCard[] {
  return input.myEventWork
    .map((work) => {
      const report = eventReportTime(work);
      return { ...work, reportAt: report.at, hasReportTime: report.timed, isCallTime: report.isCall };
    })
    .sort((a, b) => new Date(a.reportAt).getTime() - new Date(b.reportAt).getTime());
}

/**
 * Booking ids already shown inside an event card. My reservations drops
 * these so the same volleyball reservation doesn't appear twice.
 */
export function eventLinkedBookingIds(input: AgendaInput): Set<string> {
  const ids = new Set<string>();
  for (const work of input.myEventWork) for (const booking of work.gearBookings) ids.add(booking.id);
  return ids;
}

// ── Context banner ──────────────────────────────────────────

export type ContextBannerKind = "overdue" | "pickup" | "prep-gear" | "due-today";

export type ContextBanner = {
  kind: ContextBannerKind;
  /** Stable per item, for per-day dismissal. */
  key: string;
  tone: "red" | "orange" | "blue";
  title: string;
  detail: string;
  bookingId?: string;
  eventWork?: AgendaEventWork;
};

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function itemsLabel(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Volleyball vs Nebraska": the sport keeps a lone "vs Nebraska" readable in a sentence. */
export function eventFullTitle(work: Pick<AgendaEventWork, "event">): string {
  const sport = work.event.sportCode ? sportLabel(work.event.sportCode) : null;
  return sport && work.event.opponent ? `${sport} ${eventTitle(work)}` : eventTitle(work);
}

export function eventTitle(work: Pick<AgendaEventWork, "event">): string {
  const { opponent, isHome, summary } = work.event;
  if (!opponent) return summary;
  return `${isHome === false ? "at" : "vs"} ${opponent}`;
}

/**
 * The single most urgent thing that needs the viewer, or null. Ordered by
 * consequence: gear someone else is waiting on, gear waiting for you, a game
 * today with nothing reserved, then a return due later today.
 */
export function pickContextBanner(input: AgendaInput, now: Date): ContextBanner | null {
  const overdue = input.myCheckouts
    .filter((b) => b.isOverdue)
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
  if (overdue.length > 0) {
    const first = overdue[0]!;
    return {
      kind: "overdue",
      key: `overdue:${first.id}`,
      tone: "red",
      title: overdue.length === 1 ? `Return ${first.title}` : `${overdue.length} checkouts are overdue`,
      detail: `Was due ${sameLocalDay(new Date(first.endsAt), now) ? "today" : new Date(first.endsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeLabel(first.endsAt)}${first.locationName ? ` · Return to ${first.locationName}` : ""}`,
      bookingId: first.id,
    };
  }

  const pickup = input.myPendingPickups[0];
  if (pickup) {
    const lateMs = now.getTime() - new Date(pickup.startsAt).getTime();
    return {
      kind: "pickup",
      key: `pickup:${pickup.id}`,
      tone: "orange",
      title: lateMs > 15 * 60_000 ? `Pickup was due at ${timeLabel(pickup.startsAt)}` : "Your gear is ready for pickup",
      detail: `${pickup.title} · ${itemsLabel(pickup.itemCount)}${pickup.locationName ? ` at ${pickup.locationName}` : ""}`,
      bookingId: pickup.id,
    };
  }

  const prep = buildEventCards(input).find((card) => (
    card.needsGear
    && sameLocalDay(calendarDate(card.event.startsAt, card.event.allDay), now)
    && new Date(card.event.endsAt).getTime() > now.getTime()
  ));
  if (prep) {
    return {
      kind: "prep-gear",
      key: `prep-gear:${prep.event.id}`,
      tone: "blue",
      title: `No gear reserved for ${eventFullTitle(prep)}`,
      detail: prep.hasReportTime
        ? `${prep.isCallTime ? "Call" : "Starts"} ${timeLabel(prep.reportAt)}${prep.event.locationName ? ` · ${prep.event.locationName}` : ""}`
        : `You're working today${prep.event.locationName ? ` · ${prep.event.locationName}` : ""}`,
      eventWork: prep,
    };
  }

  const dueToday = input.myCheckouts
    .filter((b) => !b.isOverdue && sameLocalDay(new Date(b.endsAt), now) && new Date(b.endsAt) > now)
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime())[0];
  if (dueToday) {
    return {
      kind: "due-today",
      key: `due-today:${dueToday.id}`,
      tone: "orange",
      title: `Return ${dueToday.title} by ${timeLabel(dueToday.endsAt)}`,
      detail: `${itemsLabel(dueToday.itemCount)}${dueToday.locationName ? ` · ${dueToday.locationName}` : ""}`,
      bookingId: dueToday.id,
    };
  }

  return null;
}

// ── Next up ─────────────────────────────────────────────────

export type NextUp =
  | { kind: "event"; at: string; card: EventCard }
  | { kind: "pickup"; at: string; booking: AgendaBooking }
  | { kind: "return"; at: string; booking: AgendaBooking };

/**
 * The soonest timed commitment within the horizon that the banner is not
 * already about. Event-linked pickups fold into their event card.
 */
export function pickNextUp(input: AgendaInput, now: Date, banner: ContextBanner | null): NextUp | null {
  const linked = eventLinkedBookingIds(input);
  const horizon = now.getTime() + NEXT_UP_HORIZON_MS;
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t > now.getTime() && t <= horizon;
  };
  const candidates: NextUp[] = [];

  for (const card of buildEventCards(input)) {
    if (card.hasReportTime && inWindow(card.reportAt)) candidates.push({ kind: "event", at: card.reportAt, card });
  }
  for (const booking of input.myReservations) {
    if (!linked.has(booking.id) && inWindow(booking.startsAt)) candidates.push({ kind: "pickup", at: booking.startsAt, booking });
  }
  for (const booking of input.myCheckouts) {
    if (!booking.isOverdue && booking.id !== banner?.bookingId && inWindow(booking.endsAt)) {
      candidates.push({ kind: "return", at: booking.endsAt, booking });
    }
  }

  candidates.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return candidates[0] ?? null;
}

/** "in 45m", "in 2h 10m" — countdown for a Next up time. */
export function formatCountdownTo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}

// ── Week strip ──────────────────────────────────────────────

export type WeekDay = {
  date: Date;
  isToday: boolean;
  shifts: number;
  pickups: number;
  returns: number;
};

/** Seven days from today with what the viewer has on each. */
export function buildWeekStrip(input: AgendaInput, now: Date): WeekDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, isToday: index === 0, shifts: 0, pickups: 0, returns: 0 };
  });
  const dayFor = (date: Date) => days.find((day) => sameLocalDay(day.date, date));

  for (const card of buildEventCards(input)) {
    const day = dayFor(calendarDate(card.hasReportTime ? card.reportAt : card.event.startsAt, !card.hasReportTime && card.event.allDay));
    if (day) day.shifts += 1;
  }
  const seenPickups = new Set<string>();
  for (const booking of [...input.myPendingPickups, ...input.myReservations]) {
    if (seenPickups.has(booking.id)) continue;
    seenPickups.add(booking.id);
    // A pickup already due still belongs on today.
    const day = dayFor(new Date(Math.max(new Date(booking.startsAt).getTime(), start.getTime())));
    if (day) day.pickups += 1;
  }
  for (const booking of input.myCheckouts) {
    const day = booking.isOverdue ? days[0] : dayFor(new Date(booking.endsAt));
    if (day) day.returns += 1;
  }
  return days;
}
