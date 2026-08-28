/**
 * Period presets for schedule auto-assignment.
 *
 * Auto assignment is scoped by a date window, and staff think about that window
 * in operational terms ("the rest of this week", "through the end of the
 * semester") rather than as two dates. This module is the one place that turns
 * those words into an explicit `[startsAt, endsAt)` UTC window, so the dialog,
 * the API, and the audit trail all agree on what "this semester" meant.
 *
 * Every window starts at *today* in the app timezone, never earlier: assigning
 * into the past is never the intent, and the scope loader already drops events
 * that have already ended.
 */

import { appTzDateKey, appTzDayRange } from "@/lib/app-time";

export const ASSIGNMENT_PERIODS = ["week", "month", "semester", "season"] as const;
export type AssignmentPeriod = (typeof ASSIGNMENT_PERIODS)[number];

/** `custom` covers a window the caller supplied itself (the month grid on `/schedule/assign`). */
export const ASSIGNMENT_PERIOD_VALUES = [...ASSIGNMENT_PERIODS, "custom"] as const;
export type AssignmentPeriodValue = (typeof ASSIGNMENT_PERIOD_VALUES)[number];

/**
 * UW-Madison operational term boundaries, as `MM-DD` app-timezone dates.
 *
 * These are the *scheduling* boundaries the department works to, not the
 * registrar's instruction days: crews shoot events before classes start and
 * after they end, so each term runs to the edge of its athletic window. Fall
 * ends December 20 (commencement weekend); spring hands off to the summer
 * session in mid-May. Confirm these against the published academic calendar
 * once a year -- this array is the only place they live.
 */
export const ACADEMIC_TERMS = [
  { id: "SPRING", label: "Spring semester", startsOn: "01-01", endsOn: "05-15" },
  { id: "SUMMER", label: "Summer session", startsOn: "05-16", endsOn: "08-19" },
  { id: "FALL", label: "Fall semester", startsOn: "08-20", endsOn: "12-20" },
] as const;

export type AcademicTerm = (typeof ACADEMIC_TERMS)[number];

/**
 * The athletics season rolls over on July 1: a "full season" scope runs from
 * today through the next June 30, which is how coaches and staff talk about a
 * year of coverage.
 */
export const SEASON_ROLLOVER_MONTH_DAY = "07-01";

export type AssignmentWindow = {
  period: AssignmentPeriodValue;
  /** Inclusive lower bound: midnight of today in the app timezone. */
  rangeStartsAt: string;
  /** Exclusive upper bound: midnight of the first day *after* the window. */
  rangeEndsAt: string;
  /** Short control label, e.g. "This semester". */
  label: string;
  /** What the window actually resolved to, e.g. "Fall semester, through Dec 20". */
  detail: string;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const ASSIGNMENT_PERIOD_LABELS: Record<AssignmentPeriodValue, string> = {
  week: "This week",
  month: "This month",
  semester: "This semester",
  season: "Full season",
  custom: "Custom range",
};

export function isAssignmentPeriod(value: string): value is AssignmentPeriod {
  return (ASSIGNMENT_PERIODS as readonly string[]).includes(value);
}

function dayKey(year: number, monthDay: string) {
  return `${year}-${monthDay}`;
}

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

/** Midnight (app timezone) that begins the given `YYYY-MM-DD` calendar date. */
function startOfDay(key: string, timeZone?: string) {
  return appTzDayRange(key, timeZone).gte;
}

/** Midnight (app timezone) that begins the day *after* the given date. */
function startOfNextDay(key: string, timeZone?: string) {
  return appTzDayRange(key, timeZone).lt;
}

function addDaysToKey(key: string, days: number) {
  const { year, month, day } = parseDayKey(key);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function compareMonthDay(key: string, monthDay: string) {
  return key.slice(5).localeCompare(monthDay);
}

export function formatWindowDate(key: string) {
  const { month, day } = parseDayKey(key);
  return `${MONTH_LABELS[month - 1] ?? month} ${day}`;
}

/**
 * The academic term containing the given app-timezone date key. Terms tile the
 * whole year, so this always resolves.
 */
export function academicTermForDayKey(key: string): AcademicTerm {
  const term = ACADEMIC_TERMS.find(
    (candidate) => compareMonthDay(key, candidate.startsOn) >= 0 && compareMonthDay(key, candidate.endsOn) <= 0,
  );
  // Dec 21-31 falls past the fall term's end; it belongs to the fall term that
  // is closing out, not to the spring term that has not begun.
  return term ?? ACADEMIC_TERMS[ACADEMIC_TERMS.length - 1]!;
}

/**
 * The last day (inclusive, `YYYY-MM-DD`) of the window for `period`, measured
 * from `todayKey`.
 */
function lastDayForPeriod(period: AssignmentPeriod, todayKey: string): string {
  const { year, month, day } = parseDayKey(todayKey);

  if (period === "week") {
    // Weeks run Monday-Sunday, matching candidate workload scoring.
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const daysUntilSunday = (7 - weekday) % 7;
    return addDaysToKey(todayKey, daysUntilSunday);
  }

  if (period === "month") {
    const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(lastOfMonth).padStart(2, "0")}`;
  }

  if (period === "semester") {
    const term = academicTermForDayKey(todayKey);
    // A date past the fall end (Dec 21-31) still belongs to that fall term, so
    // roll its end into the following calendar year rather than backwards.
    const endYear = compareMonthDay(todayKey, term.endsOn) > 0 ? year + 1 : year;
    return dayKey(endYear, term.endsOn);
  }

  // Season: through the day before the next July 1 rollover.
  const rolloverYear = compareMonthDay(todayKey, SEASON_ROLLOVER_MONTH_DAY) < 0 ? year : year + 1;
  return addDaysToKey(dayKey(rolloverYear, SEASON_ROLLOVER_MONTH_DAY), -1);
}

function detailForPeriod(period: AssignmentPeriod, todayKey: string, lastKey: string) {
  const through = `through ${formatWindowDate(lastKey)}`;
  if (period === "semester") {
    const term = academicTermForDayKey(todayKey);
    return `${term.label}, ${through}`;
  }
  if (period === "season") return `Athletics season, ${through}`;
  if (period === "month") return `${MONTH_LABELS[parseDayKey(todayKey).month - 1]}, ${through}`;
  return `Rest of the week, ${through}`;
}

/**
 * Resolve a named period into the concrete window auto assignment will scan.
 */
export function resolveAssignmentWindow(
  period: AssignmentPeriod,
  now: Date = new Date(),
  timeZone?: string,
): AssignmentWindow {
  const todayKey = appTzDateKey(now, timeZone);
  const lastKey = lastDayForPeriod(period, todayKey);
  return {
    period,
    rangeStartsAt: startOfDay(todayKey, timeZone).toISOString(),
    rangeEndsAt: startOfNextDay(lastKey, timeZone).toISOString(),
    label: ASSIGNMENT_PERIOD_LABELS[period],
    detail: detailForPeriod(period, todayKey, lastKey),
  };
}

/** Every preset, resolved against the same instant. Drives the period toggle. */
export function resolveAssignmentWindows(now: Date = new Date(), timeZone?: string): AssignmentWindow[] {
  return ASSIGNMENT_PERIODS.map((period) => resolveAssignmentWindow(period, now, timeZone));
}
