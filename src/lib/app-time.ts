import { env } from "@/lib/env";

/**
 * Timezone-aware "today" helpers for the app's institution timezone
 * (`env.appTimezone`, default America/Chicago).
 *
 * Why this exists: server runtimes (Vercel) run in UTC, so `new Date()` +
 * `setHours(0,0,0,0)` gives *UTC* midnight, not the local day boundary the
 * staff actually experience. For "is this event today?" style filters that
 * difference shifts evening events onto the wrong day. Compute the day window
 * in the app timezone instead.
 */

/** Minutes/ms the given instant is offset from UTC in `timeZone`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

/** The app-timezone calendar date (year/month/day) of an instant. */
function appTzYmd(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The UTC instant of midnight that begins `today + dayOffset` in the app
 * timezone. DST-correct: the offset is applied to the calendar date, then the
 * zone offset is resolved at that target day. `dayOffset: 1` is start of
 * tomorrow.
 */
export function startOfDayInAppTz(
  now: Date = new Date(),
  dayOffset = 0,
  timeZone: string = env.appTimezone,
): Date {
  const { year, month, day } = appTzYmd(now, timeZone);
  const utcGuess = Date.UTC(year, month - 1, day + dayOffset, 0, 0, 0, 0);
  return new Date(utcGuess - zoneOffsetMs(new Date(utcGuess), timeZone));
}

/**
 * The UTC instant of the start of "today" (midnight) in the app timezone.
 *
 * Use as an event lower bound: `endsAt > startOfTodayInAppTz()` keeps every
 * event that occurs today visible until the day actually ends at local
 * midnight — a 7pm game stays listed all evening instead of vanishing the
 * moment it ends — while dropping events that ended yesterday or earlier.
 */
export function startOfTodayInAppTz(now: Date = new Date(), timeZone: string = env.appTimezone): Date {
  return startOfDayInAppTz(now, 0, timeZone);
}

/**
 * Canonicalize an all-day event boundary to UTC midnight of its calendar date.
 *
 * All-day events are *dates*, not instants, but they reach us two ways:
 *   - ICS sync stores UTC midnight (`Date.UTC(y,m,d)`), already canonical.
 *   - Manual creation historically stored *local* (Central) midnight
 *     (e.g. `2026-06-17T05:00Z`), which makes the instant's UTC date ambiguous
 *     across timezones.
 *
 * This returns UTC midnight of the intended date so every reader can treat
 * all-day events as plain dates. Idempotent: an instant already at UTC midnight
 * is returned unchanged (so re-saving an ICS event never shifts it); a
 * local-midnight instant is mapped to UTC midnight of its app-timezone date.
 */
export function normalizeAllDayToUtcMidnight(instant: Date, timeZone: string = env.appTimezone): Date {
  const alreadyUtcMidnight =
    instant.getUTCHours() === 0 &&
    instant.getUTCMinutes() === 0 &&
    instant.getUTCSeconds() === 0 &&
    instant.getUTCMilliseconds() === 0;
  if (alreadyUtcMidnight) {
    return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  }
  const { year, month, day } = appTzYmd(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * A date and time the way a worker reads it, in the app's timezone.
 *
 * Notification copy must go through this rather than a bare `toLocaleString`:
 * on the server that has no timezone of its own, so call times render in UTC
 * and land five or six hours off the shift they describe. The weekday is
 * included because these are scanned on a lock screen, where "Sat Oct 12"
 * answers the question "is that today?" and "Oct 12" does not.
 */
export function formatAppDateTime(
  value: Date | string,
  timeZone: string = env.appTimezone,
): string {
  return toDate(value).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The clock time alone, for the closing half of a window. */
export function formatAppTime(
  value: Date | string,
  timeZone: string = env.appTimezone,
): string {
  return toDate(value).toLocaleString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A call window, collapsed to a single time when it has no duration. */
export function formatAppWindow(
  start: Date | string,
  end: Date | string | null | undefined,
  timeZone: string = env.appTimezone,
): string {
  const startsAt = toDate(start);
  if (!end) return formatAppDateTime(startsAt, timeZone);
  const endsAt = toDate(end);
  if (startsAt.getTime() === endsAt.getTime()) return formatAppDateTime(startsAt, timeZone);
  return `${formatAppDateTime(startsAt, timeZone)} - ${formatAppTime(endsAt, timeZone)}`;
}

/**
 * A calendar date the way a worker reads it, in the app's timezone.
 *
 * The timed sibling of `formatAllDayDate`. Server code has no timezone of its
 * own, so a bare `toLocaleDateString` renders UTC and pushes an evening event
 * onto the following day.
 */
export function formatAppDate(
  value: Date | string,
  timeZone: string = env.appTimezone,
): string {
  return toDate(value).toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The calendar date of an all-day boundary.
 *
 * All-day events are stored as encoded dates at UTC midnight (see
 * `normalizeAllDayToUtcMidnight`), so they must be read back in UTC. Rendering
 * one in Central instead subtracts the offset and shows the previous day.
 */
export function formatAllDayDate(value: Date | string): string {
  return toDate(value).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * The `YYYY-MM-DD` calendar day of an instant in the app timezone.
 *
 * Report day buckets and heatmap cells key off this. `toISOString().slice(0,10)`
 * keys off the UTC day instead, which files every evening event under the
 * following date.
 */
export function appTzDateKey(instant: Date, timeZone: string = env.appTimezone): string {
  const { year, month, day } = appTzYmd(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The `[start, end)` UTC window covering one app-timezone calendar day,
 * given its `YYYY-MM-DD` key. DST-correct via `startOfDayInAppTz`.
 */
export function appTzDayRange(
  dayKey: string,
  timeZone: string = env.appTimezone,
): { gte: Date; lt: Date } {
  const [year, month, day] = dayKey.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12));
  const gte = startOfDayInAppTz(noonUtc, 0, timeZone);
  const lt = startOfDayInAppTz(noonUtc, 1, timeZone);
  return { gte, lt };
}
