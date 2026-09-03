"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import type {
  CalendarEvent,
  CalendarEntry,
  ShiftGroup,
} from "@/app/(app)/schedule/_components/types";
import { getMonday, userHasShift, LS_VIEW_MODE, LS_MY_SHIFTS } from "@/app/(app)/schedule/_components/types";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { calendarDate } from "@/lib/format";
import { sortCalendarEventsForDisplay } from "@/lib/calendar-event-dates";
import {
  buildScheduleSourceSignal,
  getCalendarSourceFreshness,
  type CalendarSourceFreshnessInput,
  type ScheduleSourceSignal,
} from "@/lib/calendar-source-freshness";
import { venueToneFromEvent, type VenueFilter } from "@/lib/venue-tone";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";
import type { ScheduleAutomationDigest } from "@/lib/schedule-automation-types";
import {
  filterEntriesForScheduleQueue,
  parseScheduleQueue,
  SCHEDULE_QUEUE_META,
  type ScheduleQueue,
  type ScheduleQueueMeta,
} from "@/lib/schedule-queues";
import {
  captureScheduleTimelinePosition,
  chooseScheduleViewContextDate,
  discardScheduleTimelineReadingPosition,
  discardScheduleTimelinePosition,
  readScheduleTimelinePosition,
  readScheduleTimelineReadingPosition,
  saveScheduleTimelinePosition,
  scheduleTimelineSnapshotDate,
  shouldKeepPreviousScheduleData,
  type ScheduleQueryScope,
} from "@/lib/schedule-timeline-position";

export type ViewMode = "list" | "calendar" | "week";

export type HomeAwayFilter = VenueFilter;

function parseScheduleViewMode(raw: string | null): ViewMode | null {
  return raw === "list" || raw === "calendar" || raw === "week" ? raw : null;
}

function defaultScheduleMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function defaultScheduleWeek() {
  return getMonday(new Date());
}

function parseScheduleMonth(raw: string | null): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

function parseScheduleWeek(raw: string | null): Date | null {
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

type ScheduleDeepLink = {
  myShiftsOnly: boolean;
  sportCode: string;
  dateRange: { startDate: string; endDate: string } | null;
};

export type ScheduleFilters = {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  sportFilter: string;
  setSportFilter: (v: string) => void;
  areaFilter: string;
  setAreaFilter: (v: string) => void;
  coverageFilter: string;
  setCoverageFilter: (v: string) => void;
  homeAwayFilter: HomeAwayFilter;
  setHomeAwayFilter: (v: HomeAwayFilter) => void;
  includeArchived: boolean;
  setIncludeArchived: (v: boolean) => void;
  myShiftsOnly: boolean;
  setMyShiftsOnly: (v: boolean) => void;
  queue: ScheduleQueue | null;
  queueMeta: ScheduleQueueMeta | null;
  setQueue: (v: ScheduleQueue | null) => void;
  hasFilters: boolean;
  clearAll: () => void;
};

export type UseScheduleDataResult = {
  entries: CalendarEntry[];
  filteredEntries: CalendarEntry[];
  groupedEntries: [string, CalendarEntry[]][];
  /** The window hit the page cap, so the oldest events are not loaded. */
  timelineTruncated: boolean;
  /** The list is the continuous today-anchored timeline. */
  isTimeline: boolean;
  /** A filter is narrowing which events appear, rather than how far back the window reaches. */
  hasContentFilters: boolean;
  loading: boolean;
  refreshing: boolean;
  loadError: false | "network" | "server";
  loadData: () => Promise<void>;
  filters: ScheduleFilters;
  calMonth: Date;
  setCalMonth: (d: Date) => void;
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  currentUserId: string;
  currentUserRole: string;
  openTradeCount: number;
  tradeSheetOpen: boolean;
  setTradeSheetOpen: (v: boolean) => void;
  loadTradeCount: () => void;
  sourceSignal: ScheduleSourceSignal | null;
  scheduleHealth: ScheduleHealthSnapshot | null;
  scheduleAutomation: ScheduleAutomationDigest | null;
  selectedGroupId: string | null;
  setSelectedGroupId: (id: string | null) => void;
  expandedRowId: string | null;
  setExpandedRowId: (id: string | null) => void;
  expandedDay: number | null;
  setExpandedDay: (d: number | null) => void;
};

const SCHEDULE_READ_FETCH_INIT: RequestInit = { cache: "no-store" };
const SCHEDULE_FRESH_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: true,
};

/** Merge events + shift groups into unified entries */
export function mergeScheduleData(events: CalendarEvent[], groups: ShiftGroup[]): CalendarEntry[] {
  const groupByEventId = new Map<string, ShiftGroup>();
  for (const g of groups) groupByEventId.set(g.eventId, g);

  const secondaryIds = new Set(events.flatMap((event) => (event.combinedEvents ?? []).map((member) => member.id)));
  return events.filter((event) => !secondaryIds.has(event.id) && !event.combinedIntoId).map((ev) => {
    const g = groupByEventId.get(ev.id);
    const members = [ev, ...(ev.combinedEvents ?? [])];
    return {
      ...ev,
      startsAt: new Date(Math.min(...members.map((member) => new Date(member.startsAt).getTime()))).toISOString(),
      endsAt: new Date(Math.max(...members.map((member) => new Date(member.endsAt).getTime()))).toISOString(),
      allDay: members.every((member) => member.allDay),
      eventArchivedAt: ev.archivedAt ?? null,
      shiftGroupId: g?.id ?? null,
      coverage: g?.coverage ?? null,
      shifts: g?.shifts ?? [],
      archivedAt: g?.archivedAt ?? null,
      publication: g?.publication ?? null,
      hasWorkingCopy: g?.hasWorkingCopy ?? false,
      combinedEventCount: members.length,
    };
  });
}

/** Build schedule fetch URL based on current view params */
function buildScheduleUrls(
  viewMode: string,
  calMonth: Date,
  weekStart: Date,
  includeArchived: boolean,
  sportFilter: string,
  dateRange: ScheduleDeepLink["dateRange"],
) {
  const evParams = new URLSearchParams({ limit: "200" });
  const sgParams = new URLSearchParams({ limit: "200" });
  const healthParams = new URLSearchParams();
  const automationParams = new URLSearchParams();

  if (viewMode === "calendar") {
    const startDate = calMonth.toISOString();
    const endDate = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0, 23, 59, 59).toISOString();
    evParams.set("startDate", startDate);
    evParams.set("endDate", endDate);
    evParams.set("includePast", "true");
    sgParams.set("startDate", startDate);
    sgParams.set("endDate", endDate);
    healthParams.set("startDate", startDate);
    healthParams.set("endDate", endDate);
    healthParams.set("includePast", "true");
    automationParams.set("startDate", startDate);
    automationParams.set("endDate", endDate);
    automationParams.set("includePast", "true");
  } else if (viewMode === "week") {
    const startDate = weekStart.toISOString();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const endDate = weekEnd.toISOString();
    evParams.set("startDate", startDate);
    evParams.set("endDate", endDate);
    evParams.set("includePast", "true");
    sgParams.set("startDate", startDate);
    sgParams.set("endDate", endDate);
    healthParams.set("startDate", startDate);
    healthParams.set("endDate", endDate);
    healthParams.set("includePast", "true");
    automationParams.set("startDate", startDate);
    automationParams.set("endDate", endDate);
    automationParams.set("includePast", "true");
  } else {
    if (dateRange) {
      evParams.set("startDate", dateRange.startDate);
      evParams.set("endDate", dateRange.endDate);
      sgParams.set("startDate", dateRange.startDate);
      sgParams.set("endDate", dateRange.endDate);
      healthParams.set("startDate", dateRange.startDate);
      healthParams.set("endDate", dateRange.endDate);
      automationParams.set("startDate", dateRange.startDate);
      automationParams.set("endDate", dateRange.endDate);
    } else {
      // One continuous timeline: everything unarchived, past and future, in
      // chronological order. Scrolling up is how you reach the past, so there
      // is no upcoming-only window to ask for.
      evParams.set("includePast", "true");
      healthParams.set("includePast", "true");
      automationParams.set("includePast", "true");
    }
  }

  if (sportFilter) {
    evParams.set("sportCode", sportFilter);
    sgParams.set("sportCode", sportFilter);
    healthParams.set("sportCode", sportFilter);
    automationParams.set("sportCode", sportFilter);
  }

  // Archived events are always in the past — also pass includePast so the
  // startsAt >= now default doesn't filter them out.
  if (includeArchived) {
    evParams.set("includeArchived", "true");
    evParams.set("includePast", "true");
    healthParams.set("includeArchived", "true");
    healthParams.set("includePast", "true");
    automationParams.set("includeArchived", "true");
    automationParams.set("includePast", "true");
  }

  return {
    eventsUrl: `/api/calendar-events?${evParams}`,
    groupsUrl: `/api/shift-groups?${sgParams}`,
    healthUrl: `/api/schedule/health?${healthParams}`,
    automationUrl: `/api/schedule/automation?${automationParams}`,
  };
}

/**
 * The list is one continuous timeline rather than a page of results, so it
 * loads its whole window up front instead of chunking as the user scrolls.
 *
 * Loading on scroll would break the filters: area, coverage, and my-shifts run
 * client-side over loaded rows, so filtering to one area would show a handful
 * of matches until the user happened to scroll far enough. Everything loaded
 * means every filter answers from the whole window, the same as before.
 *
 * `PAGE_SIZE` is the server's own cap. `MAX_PAGES` is the stop that keeps a
 * runaway window from hanging the browser; hitting it is reported rather than
 * silently truncating the timeline.
 */
const PAGE_SIZE = 200;
const MAX_PAGES = 15;

type PagedResult<T> = { rows: T[]; truncated: boolean };

function pagedUrl(url: string, offset: number): string {
  const paged = new URL(url, window.location.origin);
  paged.searchParams.set("limit", String(PAGE_SIZE));
  paged.searchParams.set("offset", String(offset));
  return paged.toString();
}

async function fetchPage<T>(
  url: string,
  offset: number,
  signal?: AbortSignal,
): Promise<{ rows: T[]; total: number | null }> {
  const res = await fetch(pagedUrl(url, offset), { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("schedule page fetch failed");

  const json = await parseJsonSafely<{ data?: T[]; total?: number }>(res);
  if (!json?.data) throw new Error("schedule page response malformed");
  return { rows: json.data, total: typeof json.total === "number" ? json.total : null };
}

/**
 * Read a whole window.
 *
 * The first page reports `total`, so every remaining page is requested at once
 * rather than walking offsets one round trip at a time -- the difference
 * between the list appearing in one step and unfolding in three.
 *
 * Offset paging can hand back the same row twice if an event is added between
 * requests, so ids are deduplicated on the way in; a duplicate would otherwise
 * reach React as a repeated key and render the event twice.
 */
async function fetchAllPages<T extends { id: string }>(
  url: string,
  signal?: AbortSignal,
): Promise<PagedResult<T>> {
  const first = await fetchPage<T>(url, 0, signal);
  if (first.rows.length < PAGE_SIZE) return { rows: first.rows, truncated: false };

  const pages = [first];
  let truncated = false;

  if (first.total === null) {
    // No count to plan against. Walk one page at a time rather than guessing a
    // page count and firing a burst of requests that mostly come back empty.
    let offset = PAGE_SIZE;
    for (let page = 1; page < MAX_PAGES; page += 1, offset += PAGE_SIZE) {
      const next = await fetchPage<T>(url, offset, signal);
      pages.push(next);
      if (next.rows.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
  } else {
    const pagesNeeded = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
    pages.push(...await Promise.all(
      Array.from({ length: Math.max(0, pagesNeeded - 1) }, (_unused, index) =>
        fetchPage<T>(url, (index + 1) * PAGE_SIZE, signal)),
    ));
    truncated = first.total > PAGE_SIZE * MAX_PAGES;
  }

  const seen = new Set<string>();
  const rows: T[] = [];
  for (const row of pages.flatMap((page) => page.rows)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }

  return { rows, truncated };
}

async function fetchSchedule(
  eventsUrl: string,
  groupsUrl: string,
  signal?: AbortSignal,
): Promise<{ entries: CalendarEntry[]; truncated: boolean }> {
  const [events, groups] = await Promise.all([
    fetchAllPages<CalendarEvent>(eventsUrl, signal),
    // Coverage is supporting detail: a shift-group read that fails leaves the
    // events listed without crew counts rather than emptying the schedule.
    fetchAllPages<ShiftGroup>(groupsUrl, signal).catch(() => ({ rows: [], truncated: false })),
  ]);

  return {
    entries: mergeScheduleData(events.rows, groups.rows),
    truncated: events.truncated,
  };
}

async function fetchTradeCount(): Promise<number> {
  const r = await fetch("/api/shift-trades?status=OPEN&limit=1", SCHEDULE_READ_FETCH_INIT);
  if (handleAuthRedirect(r)) return 0;
  if (!r.ok) return 0;
  const j = await parseJsonSafely<{ total?: number; data?: unknown[] }>(r);
  return typeof j?.total === "number" ? j.total : j?.data?.length ?? 0;
}

async function fetchCalendarSources(signal?: AbortSignal): Promise<CalendarSourceFreshnessInput[]> {
  const res = await fetch("/api/calendar-sources", { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("calendar sources fetch failed");

  const json = await parseJsonSafely<{ data?: CalendarSourceFreshnessInput[] }>(res);
  if (!json?.data) throw new Error("calendar sources response malformed");
  return json.data;
}

async function fetchScheduleHealth(url: string, signal?: AbortSignal): Promise<ScheduleHealthSnapshot> {
  const res = await fetch(url, { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("schedule health fetch failed");

  const json = await parseJsonSafely<{ data?: ScheduleHealthSnapshot }>(res);
  if (!json?.data) throw new Error("schedule health response malformed");
  return json.data;
}

async function fetchScheduleAutomation(url: string, signal?: AbortSignal): Promise<ScheduleAutomationDigest> {
  const res = await fetch(url, { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("schedule automation fetch failed");

  const json = await parseJsonSafely<{ data?: ScheduleAutomationDigest }>(res);
  if (!json?.data) throw new Error("schedule automation response malformed");
  return json.data;
}

export function useScheduleData(): UseScheduleDataResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => parseScheduleViewMode(searchParams.get("view")) ?? "list");
  const [calMonth, setCalMonth] = useState(() => parseScheduleMonth(searchParams.get("month")) ?? defaultScheduleMonth());
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => parseScheduleWeek(searchParams.get("week")) ?? defaultScheduleWeek());

  // Filters
  const [sportFilter, setSportFilterRaw] = useState(() => searchParams.get("sportCode") ?? "");
  const [areaFilter, setAreaFilterRaw] = useState(() => searchParams.get("area") ?? "");
  const [coverageFilter, setCoverageFilterRaw] = useState(() => parseScheduleCoverage(searchParams.get("coverage")));
  const [homeAwayFilter, setHomeAwayFilterRaw] = useState<HomeAwayFilter>(() => parseScheduleVenue(searchParams.get("venue")));
  const [includeArchived, setIncludeArchivedRaw] = useState(() => searchParams.get("includeArchived") === "true");
  const [myShiftsOnly, setMyShiftsOnlyRaw] = useState(() => searchParams.get("myShifts") === "true");

  // UI state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const searchParamsString = searchParams.toString();
  const scheduleSearchSignatureRef = useRef(searchParamsString);
  const skipNextScheduleUrlWriteRef = useRef(false);
  const initialPreferencesAppliedRef = useRef(false);
  const listViewRoundTripRef = useRef(false);
  const periodContextDateRef = useRef<Date | null>(null);
  const deepLink = useMemo<ScheduleDeepLink>(() => {
    const query = new URLSearchParams(searchParamsString);
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
  }, [searchParamsString]);
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  const activeQueue = parseScheduleQueue(searchParams.get("queue"));
  const activeQueueMeta = activeQueue ? SCHEDULE_QUEUE_META[activeQueue] : null;

  // Rehydrate the list context when browser Back/Forward or another route
  // changes the query string. The matching URL-write effect below skips this
  // render so it cannot immediately overwrite the history entry with stale
  // React state.
  useEffect(() => {
    if (scheduleSearchSignatureRef.current === searchParamsString) return;
    scheduleSearchSignatureRef.current = searchParamsString;
    skipNextScheduleUrlWriteRef.current = true;

    const query = new URLSearchParams(searchParamsString);
    setViewModeRaw(parseScheduleViewMode(query.get("view")) ?? "list");
    const requestedMonth = parseScheduleMonth(query.get("month"));
    const requestedWeek = parseScheduleWeek(query.get("week"));
    // A period parameter disappears by design when another view owns the URL.
    // Keep the last known month/week in memory until a URL explicitly supplies
    // a replacement; resetting both to today here makes a List round trip lose
    // the date the reader was actually looking at.
    if (requestedMonth) {
      setCalMonth(requestedMonth);
      if (parseScheduleViewMode(query.get("view")) === "calendar") {
        periodContextDateRef.current = requestedMonth;
      }
    }
    if (requestedWeek) {
      setWeekStart(requestedWeek);
      if (parseScheduleViewMode(query.get("view")) === "week") {
        periodContextDateRef.current = requestedWeek;
      }
    }
    setSportFilterRaw(query.get("sportCode") ?? "");
    setAreaFilterRaw(query.get("area") ?? "");
    setCoverageFilterRaw(parseScheduleCoverage(query.get("coverage")));
    setHomeAwayFilterRaw(parseScheduleVenue(query.get("venue")));
    setIncludeArchivedRaw(query.get("includeArchived") === "true");
    setMyShiftsOnlyRaw(query.get("myShifts") === "true");
  }, [searchParamsString]);

  const captureTimelineContext = useCallback(() => {
    if (viewMode === "list") captureScheduleTimelinePosition();
  }, [viewMode]);

  const setViewMode = useCallback((next: ViewMode) => {
    if (viewMode === next) return;

    const priorSnapshot = readScheduleTimelinePosition();
    const rememberedSnapshot = viewMode === "list"
      ? readScheduleTimelineReadingPosition()
      : null;
    const capturedSnapshot = viewMode === "list" ? captureScheduleTimelinePosition() : null;
    const listSnapshot = priorSnapshot ?? rememberedSnapshot ?? capturedSnapshot;
    if (viewMode === "list" && listSnapshot) saveScheduleTimelinePosition(listSnapshot);
    const contextDate = viewMode === "list"
      ? scheduleTimelineSnapshotDate(listSnapshot) ?? new Date()
      : periodContextDateRef.current ?? chooseScheduleViewContextDate({
          viewMode,
          snapshot: listViewRoundTripRef.current ? priorSnapshot : null,
          calMonth,
          weekStart,
        });
    if (viewMode === "list") listViewRoundTripRef.current = true;
    if (next === "list") {
      // A real List round trip restores its saved reading position. Opening
      // List from a standalone Week/Calendar visit is a fresh timeline visit,
      // so do not leak that period's date into List's default Today anchor.
      if (!listViewRoundTripRef.current) {
        discardScheduleTimelinePosition();
        discardScheduleTimelineReadingPosition();
      }
      listViewRoundTripRef.current = false;
    }
    if (next === "calendar") {
      setExpandedDay(null);
      setCalMonth(new Date(contextDate.getFullYear(), contextDate.getMonth(), 1));
      periodContextDateRef.current = contextDate;
    } else if (next === "week") {
      setWeekStart(getMonday(contextDate));
      periodContextDateRef.current = contextDate;
    }
    setViewModeRaw(next);
  }, [calMonth, viewMode, weekStart]);
  const setCalendarMonth = useCallback((next: Date) => {
    const month = new Date(next.getFullYear(), next.getMonth(), 1);
    periodContextDateRef.current = month;
    setCalMonth(month);
  }, []);
  const setScheduleWeek = useCallback((next: Date) => {
    const monday = getMonday(next);
    periodContextDateRef.current = monday;
    setWeekStart(monday);
  }, []);
  const setSportFilter = useCallback((next: string) => {
    captureTimelineContext();
    setSportFilterRaw(next);
  }, [captureTimelineContext]);
  const setAreaFilter = useCallback((next: string) => {
    captureTimelineContext();
    setAreaFilterRaw(next);
  }, [captureTimelineContext]);
  const setCoverageFilter = useCallback((next: string) => {
    captureTimelineContext();
    setCoverageFilterRaw(next);
  }, [captureTimelineContext]);
  const setHomeAwayFilter = useCallback((next: HomeAwayFilter) => {
    captureTimelineContext();
    setHomeAwayFilterRaw(next);
  }, [captureTimelineContext]);
  const setIncludeArchived = useCallback((next: boolean) => {
    captureTimelineContext();
    setIncludeArchivedRaw(next);
  }, [captureTimelineContext]);
  const setMyShiftsOnly = useCallback((next: boolean) => {
    captureTimelineContext();
    setMyShiftsOnlyRaw(next);
  }, [captureTimelineContext]);

  const setQueue = useCallback((queue: ScheduleQueue | null) => {
    captureTimelineContext();
    const params = new URLSearchParams(searchParams.toString());
    if (queue) {
      params.set("queue", queue);
      setViewModeRaw("list");
    } else {
      params.delete("queue");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [captureTimelineContext, pathname, router, searchParams]);

  useEffect(() => {
    if (initialPreferencesAppliedRef.current) return;
    initialPreferencesAppliedRef.current = true;

    const query = new URLSearchParams(searchParamsString);
    if (!query.has("view") && !deepLink.myShiftsOnly && !deepLink.dateRange) {
      const storedView = localStorage.getItem(LS_VIEW_MODE);
      if (storedView === "calendar" || storedView === "week") setViewModeRaw(storedView);
    }

    if (!query.has("myShifts")) {
      const storedMyShifts = localStorage.getItem(LS_MY_SHIFTS);
      if (storedMyShifts !== null) setMyShiftsOnlyRaw(storedMyShifts === "true");
    }

    if (deepLink.myShiftsOnly || deepLink.dateRange) setViewModeRaw("list");

    setPreferencesLoaded(true);
    setDeepLinkApplied(true);
  }, [deepLink, searchParamsString]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    localStorage.setItem(LS_VIEW_MODE, viewMode);
  }, [preferencesLoaded, viewMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    localStorage.setItem(LS_MY_SHIFTS, String(myShiftsOnly));
  }, [myShiftsOnly, preferencesLoaded]);

  // Keep the complete list context in the App Router's history state. This is
  // what lets detail -> Back restore the same filtered result instead of the
  // default Schedule view.
  useEffect(() => {
    if (!preferencesLoaded) return;
    if (skipNextScheduleUrlWriteRef.current) {
      skipNextScheduleUrlWriteRef.current = false;
      return;
    }

    const params = new URLSearchParams(searchParamsString);
    if (viewMode === "list") params.delete("view");
    else params.set("view", viewMode);
    if (viewMode === "calendar") params.set("month", formatScheduleMonth(calMonth));
    else params.delete("month");
    if (viewMode === "week") params.set("week", formatScheduleDate(weekStart));
    else params.delete("week");

    if (sportFilter) params.set("sportCode", sportFilter);
    else params.delete("sportCode");
    if (areaFilter) params.set("area", areaFilter);
    else params.delete("area");
    if (coverageFilter) params.set("coverage", coverageFilter);
    else params.delete("coverage");
    if (homeAwayFilter !== "all") params.set("venue", homeAwayFilter);
    else params.delete("venue");
    if (includeArchived) params.set("includeArchived", "true");
    else params.delete("includeArchived");
    if (myShiftsOnly) params.set("myShifts", "true");
    else params.delete("myShifts");

    const query = params.toString();
    const nextUrl = query ? `${pathname}?${query}` : pathname;
    const currentUrl = searchParamsString ? `${pathname}?${searchParamsString}` : pathname;
    if (nextUrl !== currentUrl) {
      // Mark our own URL before App Router publishes it. Otherwise a fast
      // Week -> Calendar -> Week sequence can receive the first replace after
      // the second click and rehydrate stale view state over the newer choice.
      scheduleSearchSignatureRef.current = query;
      router.replace(nextUrl, { scroll: false });
    }
  }, [
    calMonth,
    coverageFilter,
    homeAwayFilter,
    includeArchived,
    myShiftsOnly,
    pathname,
    router,
    searchParamsString,
    areaFilter,
    sportFilter,
    viewMode,
    weekStart,
    preferencesLoaded,
  ]);

  // --- React Query: user info ---
  const { data: meData } = useCurrentUser();
  const currentUserId = meData?.id ?? "";
  const currentUserRole = meData?.role ?? "STUDENT";
  const canViewSourceStatus = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const canViewScheduleHealth = currentUserRole === "ADMIN" || currentUserRole === "STAFF";

  // Set default myShiftsOnly for students
  useEffect(() => {
    if (!preferencesLoaded) return;
    const hasMyShiftsParam = searchParams.get("myShifts") !== null;
    if (meData?.role === "STUDENT" && !hasMyShiftsParam && localStorage.getItem(LS_MY_SHIFTS) === null) {
      setMyShiftsOnlyRaw(true);
    }
  }, [meData?.role, preferencesLoaded, searchParams]);

  // --- React Query: trade count ---
  const { data: tradeCount = 0, refetch: refetchTrades } = useQuery({
    queryKey: ["shift-trades", "OPEN", "count"],
    queryFn: fetchTradeCount,
    ...SCHEDULE_FRESH_QUERY_OPTIONS,
  });

  const {
    data: calendarSources = [],
    isLoading: sourceStatusLoading,
    error: sourceStatusError,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ["calendar-sources", "schedule-source-signal"],
    queryFn: ({ signal }) => fetchCalendarSources(signal),
    enabled: canViewSourceStatus,
    ...SCHEDULE_FRESH_QUERY_OPTIONS,
  });
  const staleSourceIds = useMemo(() => {
    return new Set(
      calendarSources
        .filter((source) => {
          const state = getCalendarSourceFreshness(source);
          return state === "error" || state === "stale" || state === "never-synced";
        })
        .map((source) => source.id),
    );
  }, [calendarSources]);

  // --- React Query: schedule entries ---
  const effectiveViewMode = deepLink.myShiftsOnly || deepLink.dateRange ? "list" : viewMode;
  /** The list is the continuous today-anchored timeline unless a deep link pinned a window. */
  const isTimeline = effectiveViewMode === "list" && !deepLink.dateRange;
  const effectiveSportFilter = deepLinkApplied ? sportFilter : sportFilter || deepLink.sportCode;
  const { eventsUrl, groupsUrl, healthUrl, automationUrl } = buildScheduleUrls(
    effectiveViewMode,
    calMonth,
    weekStart,
    includeArchived,
    effectiveSportFilter,
    deepLink.dateRange,
  );
  const scheduleScope: ScheduleQueryScope = {
    viewMode: effectiveViewMode,
    includeArchived,
    sportFilter: effectiveSportFilter,
    dateRangeKey: deepLink.dateRange
      ? `${deepLink.dateRange.startDate}|${deepLink.dateRange.endDate}`
      : "",
  };
  const scheduleQueryKey = ["schedule", scheduleScope, eventsUrl, groupsUrl] as const;

  const { data: schedule, isLoading, isFetching, error: scheduleError, refetch: refetchSchedule } = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: ({ signal }) => fetchSchedule(eventsUrl, groupsUrl, signal),
    // Only an older-record prepend is the same list becoming wider. A view or
    // sport change is a different scope; showing its predecessor under the new
    // controls briefly presents the wrong events as current truth.
    placeholderData: (previousData, previousQuery) => {
      const previousScope = previousQuery?.queryKey[1] as ScheduleQueryScope | undefined;
      return shouldKeepPreviousScheduleData(previousScope, scheduleScope)
        ? previousData
        : undefined;
    },
    ...SCHEDULE_FRESH_QUERY_OPTIONS,
  });
  const entries = useMemo(() => schedule?.entries ?? [], [schedule]);
  const timelineTruncated = schedule?.truncated ?? false;
  const { data: scheduleHealth = null, refetch: refetchScheduleHealth } = useQuery({
    queryKey: ["schedule-health", healthUrl],
    queryFn: ({ signal }) => fetchScheduleHealth(healthUrl, signal),
    enabled: canViewScheduleHealth,
    ...SCHEDULE_FRESH_QUERY_OPTIONS,
  });
  const { data: scheduleAutomation = null, refetch: refetchScheduleAutomation } = useQuery({
    queryKey: ["schedule-automation", automationUrl],
    queryFn: ({ signal }) => fetchScheduleAutomation(automationUrl, signal),
    enabled: canViewScheduleHealth,
    ...SCHEDULE_FRESH_QUERY_OPTIONS,
  });
  const visibleEntries = useMemo(
    () => preferencesLoaded ? entries : [],
    [entries, preferencesLoaded],
  );
  const loading = !preferencesLoaded || isLoading;

  // Classify error — only show error screen when no cached data
  const loadError: false | "network" | "server" =
    preferencesLoaded && scheduleError && visibleEntries.length === 0
      ? (scheduleError as Error).name === "TypeError" ? "network" : "server"
      : false;

  // Client-side filtering
  const filteredEntries = useMemo(() => {
    let result = visibleEntries;
    if (myShiftsOnly && currentUserId) {
      result = result.filter((e) => userHasShift(e, currentUserId));
    }
    if (homeAwayFilter !== "all") {
      result = result.filter((e) => venueToneFromEvent(e) === homeAwayFilter);
    }
    if (areaFilter) {
      result = result.filter((e) => e.shifts.some((s) => s.area === areaFilter));
    }
    if (coverageFilter === "unfilled") {
      result = result.filter((e) => !e.coverage || e.coverage.percentage < 100);
    } else if (coverageFilter === "filled") {
      result = result.filter((e) => e.coverage && e.coverage.percentage >= 100);
    }
    result = filterEntriesForScheduleQueue({
      entries: result,
      queue: activeQueue,
      health: scheduleHealth,
      currentUserId,
      staleSourceIds,
    });
    return sortCalendarEventsForDisplay(result);
  }, [visibleEntries, homeAwayFilter, areaFilter, coverageFilter, myShiftsOnly, currentUserId, activeQueue, scheduleHealth, staleSourceIds]);

  // Group entries by date for list view
  const groupedEntries = useMemo(() => {
    const groups: [string, CalendarEntry[]][] = [];
    let lastKey = "";
    for (const entry of filteredEntries) {
      const key = calendarDate(entry.startsAt, entry.allDay).toDateString();
      if (key !== lastKey) {
        groups.push([key, []]);
        lastKey = key;
      }
      groups[groups.length - 1]![1]!.push(entry); // at least one group pushed above in this iteration
    }

    // The timeline scrolls to today on open, so today has to exist as a row
    // even when nothing is scheduled -- otherwise a quiet day has no anchor and
    // the list opens wherever the nearest event happens to be.
    //
    // A deep link to an explicit date range is the exception: that reader asked
    // for a window, and dropping today into it would both invent a row outside
    // the range and drag the view away from what they followed the link to see.
    if (isTimeline) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayKey = today.toDateString();
      if (!groups.some(([key]) => key === todayKey)) {
        const index = groups.findIndex(([key]) => new Date(key).getTime() > today.getTime());
        groups.splice(index === -1 ? groups.length : index, 0, [todayKey, []]);
      }
    }

    return groups;
  }, [filteredEntries, isTimeline]);

  const hasFilters = !!(sportFilter || areaFilter || coverageFilter || homeAwayFilter !== "all" || includeArchived || myShiftsOnly || activeQueue || deepLink.dateRange);
  /**
   * Filters that narrow *which* events are listed, as opposed to how far back
   * the timeline reaches. Loading archived events is not a filter -- treating it
   * as one made the archive row delete itself the moment it was used.
   */
  const hasContentFilters = !!(sportFilter || areaFilter || coverageFilter || homeAwayFilter !== "all" || myShiftsOnly || activeQueue || deepLink.dateRange);

  const sourceSignal = useMemo(() => {
    if (!canViewSourceStatus) return null;
    const status = sourceStatusLoading && calendarSources.length === 0
      ? "loading"
      : sourceStatusError && calendarSources.length === 0
        ? "unavailable"
        : "ready";
    return buildScheduleSourceSignal(filteredEntries, calendarSources, { status });
  }, [calendarSources, canViewSourceStatus, filteredEntries, sourceStatusError, sourceStatusLoading]);

  const loadData = useCallback(async () => {
    const tasks: Promise<unknown>[] = [refetchSchedule()];
    if (canViewScheduleHealth) tasks.push(refetchScheduleHealth());
    if (canViewScheduleHealth) tasks.push(refetchScheduleAutomation());
    if (canViewSourceStatus) tasks.push(refetchSources());
    await Promise.allSettled(tasks);
  }, [canViewScheduleHealth, canViewSourceStatus, refetchSchedule, refetchScheduleAutomation, refetchScheduleHealth, refetchSources]);

  return {
    entries: visibleEntries,
    filteredEntries,
    groupedEntries,
    timelineTruncated,
    isTimeline,
    hasContentFilters,
    loading,
    refreshing: preferencesLoaded && isFetching && !isLoading,
    loadError,
    loadData,
    filters: {
      viewMode,
      setViewMode,
      sportFilter,
      setSportFilter,
      areaFilter,
      setAreaFilter,
      coverageFilter,
      setCoverageFilter,
      homeAwayFilter,
      setHomeAwayFilter,
      includeArchived,
      setIncludeArchived,
      myShiftsOnly,
      setMyShiftsOnly,
      queue: activeQueue,
      queueMeta: activeQueueMeta,
      setQueue,
      hasFilters,
      clearAll: () => {
        captureTimelineContext();
        setSportFilterRaw("");
        setAreaFilterRaw("");
        setCoverageFilterRaw("");
        setHomeAwayFilterRaw("all");
        setIncludeArchivedRaw(false);
        setMyShiftsOnlyRaw(false);
        skipNextScheduleUrlWriteRef.current = true;
        const params = new URLSearchParams(searchParams.toString());
        params.delete("queue");
        params.delete("myShifts");
        params.delete("sportCode");
        params.delete("area");
        params.delete("coverage");
        params.delete("venue");
        params.delete("includeArchived");
        params.delete("startDate");
        params.delete("endDate");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      },
    },
    calMonth,
    setCalMonth: setCalendarMonth,
    weekStart,
    setWeekStart: setScheduleWeek,
    currentUserId,
    currentUserRole,
    openTradeCount: tradeCount,
    tradeSheetOpen,
    setTradeSheetOpen,
    loadTradeCount: refetchTrades,
    sourceSignal,
    scheduleHealth,
    scheduleAutomation,
    selectedGroupId,
    setSelectedGroupId,
    expandedRowId,
    setExpandedRowId,
    expandedDay,
    setExpandedDay,
  };
}
