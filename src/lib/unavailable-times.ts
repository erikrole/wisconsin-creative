/**
 * When a student can't work, as they think of it: things that repeat every week
 * (a class, a job, practice) and dates they're away. Storage stays the existing
 * CANNOT_WORK availability blocks, one per weekday for weekly items, so scheduling,
 * conflicts and the staff Availability tab read them unchanged.
 */

export type AvailabilityBlockLite = {
  id: string;
  kind?: "WEEKLY" | "AD_HOC";
  intent?: "CANNOT_WORK" | "PREFER" | "DISLIKE" | "TIME_OFF";
  dayOfWeek: number | null;
  date?: string | null;
  dateEndsOn?: string | null;
  allDay?: boolean;
  startsAt: string;
  endsAt: string;
  label: string | null;
  semesterEndsOn?: string | null;
};

export type WeeklyItem = {
  key: string;
  label: string | null;
  days: number[];
  startsAt: string;
  endsAt: string;
  endsOn: string | null;
  blockIds: string[];
};

export type AwayItem = {
  id: string;
  label: string | null;
  from: string;
  through: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
};

/** Fired on window after a "can't work" entry is saved, so other cards on the page recheck. */
export const UNAVAILABLE_CHANGED_EVENT = "wc:unavailable-changed";

/** Monday-first, the way a week reads. */
export const WEEK_DAYS = [
  { day: 1, short: "M", name: "Monday" },
  { day: 2, short: "T", name: "Tuesday" },
  { day: 3, short: "W", name: "Wednesday" },
  { day: 4, short: "Th", name: "Thursday" },
  { day: 5, short: "F", name: "Friday" },
  { day: 6, short: "Sa", name: "Saturday" },
  { day: 0, short: "Su", name: "Sunday" },
] as const;

const DAY_ORDER = WEEK_DAYS.map((d) => d.day as number);
const kindOf = (block: AvailabilityBlockLite) => block.kind ?? "WEEKLY";
const dateOnly = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);

/** Any "can't work" signal, weekly or dated. Preferences and time-off requests are not this. */
export function isUnavailableBlock(block: AvailabilityBlockLite): boolean {
  return (block.intent ?? "CANNOT_WORK") === "CANNOT_WORK";
}

/** Folds per-day weekly blocks back into one item: same name, time and end date. */
export function groupWeekly(blocks: AvailabilityBlockLite[], today = localToday()): WeeklyItem[] {
  const groups = new Map<string, WeeklyItem>();
  for (const block of blocks) {
    if (!isUnavailableBlock(block) || kindOf(block) !== "WEEKLY" || block.dayOfWeek === null) continue;
    const endsOn = dateOnly(block.semesterEndsOn);
    if (endsOn && endsOn < today) continue;
    const key = [block.label?.trim().toLowerCase() ?? "", block.startsAt, block.endsAt, endsOn ?? ""].join("|");
    const group = groups.get(key) ?? { key, label: block.label?.trim() || null, days: [], startsAt: block.startsAt, endsAt: block.endsAt, endsOn, blockIds: [] };
    if (!group.days.includes(block.dayOfWeek)) group.days.push(block.dayOfWeek);
    group.blockIds.push(block.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, days: g.days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)) }))
    .sort((a, b) => DAY_ORDER.indexOf(a.days[0]!) - DAY_ORDER.indexOf(b.days[0]!) || a.startsAt.localeCompare(b.startsAt));
}

/** Dated "can't work" entries that haven't ended yet, soonest first. */
export function upcomingAway(blocks: AvailabilityBlockLite[], today = localToday()): AwayItem[] {
  return blocks
    .filter((b) => isUnavailableBlock(b) && kindOf(b) === "AD_HOC" && b.date)
    .map((b) => {
      const from = dateOnly(b.date)!;
      return { id: b.id, label: b.label?.trim() || null, from, through: dateOnly(b.dateEndsOn) ?? from, allDay: b.allDay === true, startsAt: b.startsAt, endsAt: b.endsAt };
    })
    .filter((item) => item.through >= today)
    .sort((a, b) => a.from.localeCompare(b.from) || a.startsAt.localeCompare(b.startsAt));
}

export function formatWeekDays(days: number[]): string {
  return days.map((d) => WEEK_DAYS.find((w) => w.day === d)?.short ?? "").join(" ");
}

export function formatClockTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function shortDate(iso: string): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Fri, Nov 6" or "Fri, Nov 6 – Sun, Nov 8". */
export function formatAwayDates(item: Pick<AwayItem, "from" | "through">): string {
  return item.through === item.from ? shortDate(item.from) : `${shortDate(item.from)} – ${shortDate(item.through)}`;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * A safe guess at when this term ends, so weekly items stop creating warnings
 * after it. Students can change it. Errs a little late, since an item left on a
 * few extra days only adds a warning staff can ignore.
 */
export function defaultWeeklyEndsOn(today = new Date()): string {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  if (month === 12 && today.getDate() > 23) return iso(year + 1, 5, 17);
  if (month >= 8) return iso(year, 12, 23);
  if (month <= 5) return iso(year, 5, 17);
  return iso(year, 8, 15);
}

/** A newly blocked stretch, as the "can't work" form saved it. */
export type BlockedRange = { from: string; through: string; allDay: boolean; startsAt: string; endsAt: string };

/** The fields of a /api/my-shifts row this check needs. */
export type ShiftLite = {
  id: string;
  startsAt: string;
  endsAt: string;
  event: { summary: string; allDay: boolean; startsAt: string };
};

function localInstant(day: string, hhmm: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const [h = 0, min = 0] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

/** The local-time query window for /api/my-shifts covering a blocked range. */
export function blockedWindow(range: BlockedRange): { start: Date; end: Date } {
  return { start: new Date(localInstant(range.from, "00:00")), end: new Date(localInstant(range.through, "23:59")) };
}

/**
 * Shifts the student is already on during a stretch they just blocked. Part-day
 * blocks repeat their hours on every day of the range. All-day events are
 * stored as UTC-midnight dates, so they match by calendar day, not instant.
 */
export function shiftsDuring<T extends ShiftLite>(shifts: T[], range: BlockedRange): T[] {
  return shifts.filter((shift) => {
    if (shift.event.allDay) {
      const day = shift.event.startsAt.slice(0, 10);
      return day >= range.from && day <= range.through;
    }
    const start = new Date(shift.startsAt).getTime();
    const end = new Date(shift.endsAt).getTime();
    if (range.allDay) return start < localInstant(range.through, "23:59") + 60_000 && end > localInstant(range.from, "00:00");
    for (let day = range.from; day <= range.through; day = nextDay(day)) {
      if (start < localInstant(day, range.endsAt) && end > localInstant(day, range.startsAt)) return true;
    }
    return false;
  });
}

function nextDay(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return iso(next.getFullYear(), next.getMonth() + 1, next.getDate());
}
