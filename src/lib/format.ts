/* ── Shared formatting helpers (client-safe) ──────────────── */

// ── Duration helpers ─────────────────────────────────────

/** Explicit duration: "2 days 3 hours", "5 hours 12 minutes", "8 minutes" */
function formatExplicitDuration(ms: number): string {
  const absDiff = Math.abs(ms);
  const days = Math.floor(absDiff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((absDiff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((absDiff % (60 * 60 * 1000)) / (60 * 1000));

  if (days > 0) {
    const parts = [`${days} ${days === 1 ? "day" : "days"}`];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    return parts.join(" ");
  }
  if (hours > 0) {
    const parts = [`${hours} ${hours === 1 ? "hour" : "hours"}`];
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
    return parts.join(" ");
  }
  if (minutes > 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return "less than a minute";
}

// ── Counts / numbers ─────────────────────────────────────

/** "1 item", "3 items" — count with its singular/plural noun */
export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Just the noun form for a count: "item" or "items" */
export function pluralWord(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

/** Zero-pad a number to two digits: 7 → "07" */
export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Whole-number percent from a 0–1 ratio: 0.256 → "26%" */
export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

// ── Urgency / countdown ──────────────────────────────────

type UrgencyLevel = "overdue" | "critical" | "warning" | "normal";

export function getUrgency(startsAt: string, endsAt: string, now: Date): UrgencyLevel {
  const end = new Date(endsAt).getTime();
  const remaining = end - now.getTime();
  if (remaining <= 0) return "overdue";

  const duration = end - new Date(startsAt).getTime();
  if (duration <= 0) return "critical";

  const pctRemaining = remaining / duration;
  if (pctRemaining <= 0.10) return "critical";
  if (pctRemaining <= 0.25) return "warning";
  return "normal";
}

export function formatCountdown(endsAt: string, now: Date): string {
  const diff = new Date(endsAt).getTime() - now.getTime();
  const timeStr = formatExplicitDuration(diff);

  if (diff <= 0) return `OVERDUE BY ${timeStr}`;
  return `DUE BACK IN ${timeStr}`;
}

/** Compact duration: "2d 23h", "5h 12m", "8m" */
function formatCompactDuration(ms: number): string {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

/** Compact countdown for badges: "2d 23h left", "Overdue 2d 23h" */
export function formatCountdownCompact(endsAt: string, now: Date): string {
  const diff = new Date(endsAt).getTime() - now.getTime();
  const compact = formatCompactDuration(diff);
  return diff <= 0 ? `Overdue ${compact}` : `${compact} left`;
}

// ── Date formatting ──────────────────────────────────────

/**
 * For all-day events, ICS dates are stored as midnight UTC (e.g. "2026-09-05T00:00:00Z").
 * Converting to local time shifts them to the previous evening in CDT/CST, showing the
 * wrong day. This helper returns a local Date object that preserves the correct calendar
 * date by reading UTC parts directly for all-day events.
 */
export function calendarDate(iso: string, allDay: boolean): Date {
  if (!allDay) return new Date(iso);
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** "Mar 11" */
export function formatDateShort(iso: string, allDay = false) {
  return calendarDate(iso, allDay).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    // All-day dates are already a local calendar day; real instants read in Central time.
    ...(allDay ? {} : { timeZone: INSTITUTION_TZ }),
  });
}

/** "Mar 11" on the Central calendar, so the server (UTC) and the browser render the same text. */
export function formatDateShortCentral(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: INSTITUTION_TZ });
}

/** "3:00 PM" */
export function formatTimeShort(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: INSTITUTION_TZ,
  });
}

/**
 * Whole calendar days from `now` to `iso` on the Central (institution) calendar:
 * 0 = today, 1 = tomorrow, -1 = yesterday. Uses a fixed zone rather than the
 * runtime's, because the server renders in UTC and would otherwise file tonight's
 * 7 PM event under tomorrow. Client-safe, so it does not read `env`.
 */
export const INSTITUTION_TZ = "America/Chicago";
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: INSTITUTION_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
function institutionDayNumber(date: Date): number {
  const parts = dayFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000);
}
function institutionYear(date: Date): number {
  return Number(dayFormatter.formatToParts(date).find((p) => p.type === "year")?.value);
}
/** `YYYY-MM-DD` of an instant on the Central calendar, for file names and "today" keys. */
export function institutionDateKey(date: Date = new Date()): string {
  const parts = dayFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month").padStart(2, "0")}-${get("day").padStart(2, "0")}`;
}
export function institutionDayOffset(iso: string | Date, now: Date): number {
  return institutionDayNumber(new Date(iso)) - institutionDayNumber(now);
}

/**
 * Calendar-relative operational time, such as "Today, 2:30 PM",
 * "Tomorrow, 2:30 PM", "Yesterday, 2:30 PM", or "July 29, 2:30 PM".
 * Dense surfaces can pass `{ month: "short" }` for "Jul 29, 2:30 PM".
 */
export function formatOperationalDateTime(
  iso: string,
  now: Date,
  options?: { month?: "long" | "short" },
): string {
  const date = new Date(iso);
  const offset = institutionDayOffset(date, now);

  let dayLabel: string;
  if (offset === 0) {
    dayLabel = "Today";
  } else if (offset === 1) {
    dayLabel = "Tomorrow";
  } else if (offset === -1) {
    dayLabel = "Yesterday";
  } else {
    dayLabel = date.toLocaleDateString("en-US", {
      month: options?.month ?? "long",
      day: "numeric",
      timeZone: INSTITUTION_TZ,
      ...(institutionYear(date) !== institutionYear(now) && { year: "numeric" }),
    });
  }

  return `${dayLabel}, ${formatTimeShort(iso)}`;
}

/** "Mar 11, 2026" */
export function formatDateFull(iso: string | null, allDay = false) {
  if (!iso) return "—";
  return calendarDate(iso, allDay).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Mon 3:00 pm" — compact day + time, used in event chips */
export function formatChipTime(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  return `${day} ${time}`;
}

/** "Mar 11, 2026, 3:00 PM" */
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Explicit overdue elapsed: "3 days 2 hours overdue" */
function formatOverdueElapsed(endsAt: string, now: Date): string {
  const diff = now.getTime() - new Date(endsAt).getTime();
  if (diff <= 0) return "";
  return `${formatExplicitDuration(diff)} overdue`;
}

/** Check if endsAt falls on today */
export function isDueToday(endsAt: string, now: Date): boolean {
  return institutionDayOffset(endsAt, now) === 0;
}

/** Check if startsAt falls on today (mirrors isDueToday for reservations) */
export function isStartingToday(startsAt: string, now: Date): boolean {
  return institutionDayOffset(startsAt, now) === 0;
}

/** Compact relative start time: "Started 2h ago" / "Starts in 3h" / "Starts in 30m" */
export function formatStartsIn(startsAt: string, now: Date): string {
  const diff = new Date(startsAt).getTime() - now.getTime();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((absDiff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((absDiff % (60 * 60 * 1000)) / (60 * 1000));

  let timeStr: string;
  if (days > 0) timeStr = `${days}d`;
  else if (hours > 0) timeStr = `${hours}h`;
  else timeStr = `${minutes}m`;

  if (diff <= 0) return `Started ${timeStr} ago`;
  return `Starts in ${timeStr}`;
}

/** Relative time: "just now", "5m ago", "2h ago", "3d ago" */
export function formatRelativeTime(iso: string, now: Date): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateShort(iso);
}

/** Explicit due label: "2 days 3 hours overdue", "Due in 5 hours 12 minutes", "Due Mar 24" */
export function formatDueLabel(endsAt: string, now: Date): string {
  const end = new Date(endsAt);
  const diff = end.getTime() - now.getTime();
  if (diff < 0) return formatOverdueElapsed(endsAt, now);
  if (diff <= 7 * 24 * 60 * 60 * 1000) return `Due in ${formatExplicitDuration(diff)}`;
  return `Due ${formatDateShort(endsAt)}`;
}

/** Human-readable duration: "2 days", "5 hours", "30 minutes" */
export function formatDuration(startsAt: string, endsAt: string): string {
  const diff = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (diff <= 0) return "—";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(diff / (60 * 60_000));
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.round(diff / (24 * 60 * 60_000));
  return days === 1 ? "1 day" : `${days} days`;
}

/** "Mar 11, Friday 12:00 PM" — date with day-of-week and time */
export function formatDateWithDayTime(iso: string): { date: string; dayTime: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dayTime = d.toLocaleDateString("en-US", { weekday: "long" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { date, dayTime };
}

/** "Today", "Tomorrow", or "Wednesday, Apr 9" */
export function formatDayLabel(dateStr: string, now: Date, allDay = false): string {
  const date = calendarDate(dateStr, allDay);
  const offset = allDay
    ? Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
    : institutionDayOffset(date, now);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** "None", "45min", "1 hr", "2 hrs", or "1h 30m" for a call-time offset in minutes. */
export function formatMinutes(minutes: number): string {
  if (minutes === 0) return "None";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}min`;
  if (remainder === 0) return hours === 1 ? "1 hr" : `${hours} hrs`;
  return `${hours}h ${remainder}m`;
}

/** "Mar 11 – Mar 14" or "Mar 11" if same day */
export function formatDateRange(startsAt: string, endsAt: string) {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (s.toDateString() === e.toDateString()) {
    return s.toLocaleDateString("en-US", opts);
  }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}
