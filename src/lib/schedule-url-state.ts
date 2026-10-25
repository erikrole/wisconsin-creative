import { getMonday } from "@/app/(app)/schedule/_components/types";
import type { VenueFilter } from "@/lib/venue-tone";
import type { ScheduleQueue } from "@/lib/schedule-queues";

/**
 * The Schedule page keeps its whole list context in the query string, so
 * detail -> Back and a shared link land on the same filtered result. These are
 * the readers and writers for that query string; the hook only wires them to
 * React state and the router.
 */

export type ViewMode = "list" | "calendar" | "week";

export type HomeAwayFilter = VenueFilter;

export type ScheduleDateRange = { startDate: string; endDate: string };

export type ScheduleDeepLink = {
  myShiftsOnly: boolean;
  sportCode: string;
  dateRange: ScheduleDateRange | null;
};

export type ScheduleUrlFilters = {
  sportFilter: string;
  areaFilter: string;
  coverageFilter: string;
  homeAwayFilter: HomeAwayFilter;
  includeArchived: boolean;
  myShiftsOnly: boolean;
};

export type ScheduleUrlState = ScheduleUrlFilters & {
  viewMode: ViewMode;
  calMonth: Date;
  weekStart: Date;
};

export function parseScheduleViewMode(raw: string | null): ViewMode | null {
  return raw === "list" || raw === "calendar" || raw === "week" ? raw : null;
}

export function defaultScheduleMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function defaultScheduleWeek() {
  return getMonday(new Date());
}

export function parseScheduleMonth(raw: string | null): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

export function parseScheduleWeek(raw: string | null): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
  return getMonday(parsed);
}

function formatScheduleMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatScheduleDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseScheduleCoverage(raw: string | null) {
  return raw === "unfilled" || raw === "filled" ? raw : "";
}

function parseScheduleVenue(raw: string | null): HomeAwayFilter {
  return raw === "home" || raw === "away" || raw === "neutral" || raw === "non-game" ? raw : "all";
}

/** Links from Home and My Shifts: a personal filter, a sport, or a dated window. */
export function parseScheduleDeepLink(query: URLSearchParams): ScheduleDeepLink {
  const start = query.get("startDate");
  const end = query.get("endDate");
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  const dateRange = startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate > startDate
    ? { startDate: startDate.toISOString(), endDate: endDate.toISOString() }
    : null;
  return {
    myShiftsOnly: query.get("myShifts") === "true",
    sportCode: query.get("sportCode") ?? "",
    dateRange,
  };
}

export function readScheduleUrlFilters(query: URLSearchParams): ScheduleUrlFilters {
  return {
    sportFilter: query.get("sportCode") ?? "",
    areaFilter: query.get("area") ?? "",
    coverageFilter: parseScheduleCoverage(query.get("coverage")),
    homeAwayFilter: parseScheduleVenue(query.get("venue")),
    includeArchived: query.get("includeArchived") === "true",
    myShiftsOnly: query.get("myShifts") === "true",
  };
}

/**
 * Write the view and filters over an existing query string. Parameters the
 * Schedule does not own (queue, a deep-linked date range, trades=open) pass
 * through untouched.
 */
export function writeScheduleUrlState(current: URLSearchParams, state: ScheduleUrlState): URLSearchParams {
  const params = new URLSearchParams(current);
  if (state.viewMode === "list") params.delete("view");
  else params.set("view", state.viewMode);
  if (state.viewMode === "calendar") params.set("month", formatScheduleMonth(state.calMonth));
  else params.delete("month");
  if (state.viewMode === "week") params.set("week", formatScheduleDate(state.weekStart));
  else params.delete("week");

  if (state.sportFilter) params.set("sportCode", state.sportFilter);
  else params.delete("sportCode");
  if (state.areaFilter) params.set("area", state.areaFilter);
  else params.delete("area");
  if (state.coverageFilter) params.set("coverage", state.coverageFilter);
  else params.delete("coverage");
  if (state.homeAwayFilter !== "all") params.set("venue", state.homeAwayFilter);
  else params.delete("venue");
  if (state.includeArchived) params.set("includeArchived", "true");
  else params.delete("includeArchived");
  if (state.myShiftsOnly) params.set("myShifts", "true");
  else params.delete("myShifts");
  return params;
}

export function withScheduleQueue(current: URLSearchParams, queue: ScheduleQueue | null): URLSearchParams {
  const params = new URLSearchParams(current);
  if (queue) params.set("queue", queue);
  else params.delete("queue");
  return params;
}

export function withoutScheduleDateRange(current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current);
  params.delete("startDate");
  params.delete("endDate");
  return params;
}

/** Clear all: every narrowing filter goes, the view and My Shifts stay. */
export function withoutScheduleFilters(current: URLSearchParams): URLSearchParams {
  const params = withoutScheduleDateRange(current);
  for (const key of ["queue", "sportCode", "area", "coverage", "venue", "includeArchived"]) {
    params.delete(key);
  }
  return params;
}

export function scheduleHref(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
