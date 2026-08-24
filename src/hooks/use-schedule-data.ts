"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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

export type ViewMode = "list" | "calendar" | "week";

export type HomeAwayFilter = VenueFilter;

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
function mergeData(events: CalendarEvent[], groups: ShiftGroup[]): CalendarEntry[] {
  const groupByEventId = new Map<string, ShiftGroup>();
  for (const g of groups) groupByEventId.set(g.eventId, g);

  return events.map((ev) => {
    const g = groupByEventId.get(ev.id);
    return {
      ...ev,
      shiftGroupId: g?.id ?? null,
      coverage: g?.coverage ?? null,
      shifts: g?.shifts ?? [],
      archivedAt: g?.archivedAt ?? null,
      publication: g?.publication ?? null,
      hasWorkingCopy: g?.hasWorkingCopy ?? false,
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
    entries: mergeData(events.rows, groups.rows),
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
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  // Filters
  const [sportFilter, setSportFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [coverageFilter, setCoverageFilter] = useState("");
  const [homeAwayFilter, setHomeAwayFilter] = useState<HomeAwayFilter>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [myShiftsOnly, setMyShiftsOnly] = useState(false);

  // UI state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const searchParamsString = searchParams.toString();
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

  const setQueue = useCallback((queue: ScheduleQueue | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (queue) {
      params.set("queue", queue);
      setViewMode("list");
    } else {
      params.delete("queue");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const storedView = localStorage.getItem(LS_VIEW_MODE);
    if (!deepLink.myShiftsOnly && !deepLink.dateRange && (storedView === "calendar" || storedView === "week")) {
      setViewMode(storedView);
    }

    const storedMyShifts = localStorage.getItem(LS_MY_SHIFTS);
    if (storedMyShifts !== null) {
      setMyShiftsOnly(storedMyShifts === "true");
    }

    if (deepLink.myShiftsOnly || deepLink.dateRange) {
      setViewMode("list");
      if (deepLink.myShiftsOnly) setMyShiftsOnly(true);
    }
    if (deepLink.sportCode) setSportFilter(deepLink.sportCode);

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

  // --- React Query: user info ---
  const { data: meData } = useCurrentUser();
  const currentUserId = meData?.id ?? "";
  const currentUserRole = meData?.role ?? "STUDENT";
  const canViewSourceStatus = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const canViewScheduleHealth = currentUserRole === "ADMIN" || currentUserRole === "STAFF";

  // Set default myShiftsOnly for students
  useEffect(() => {
    if (!preferencesLoaded) return;
    if (meData?.role === "STUDENT" && localStorage.getItem(LS_MY_SHIFTS) === null) {
      setMyShiftsOnly(true);
    }
  }, [meData?.role, preferencesLoaded]);

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
  const scheduleQueryKey = ["schedule", eventsUrl, groupsUrl];

  const { data: schedule, isLoading, error: scheduleError, refetch: refetchSchedule } = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: ({ signal }) => fetchSchedule(eventsUrl, groupsUrl, signal),
    // Widening the window -- loading archived events, changing sport -- is a new
    // query key. Without this the list would empty to a spinner and come back
    // with the reader's position gone; keeping the previous rows on screen makes
    // the wider window arrive as an extension of what they were already reading.
    placeholderData: keepPreviousData,
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
        setSportFilter("");
        setAreaFilter("");
        setCoverageFilter("");
        setHomeAwayFilter("all");
        setIncludeArchived(false);
        setMyShiftsOnly(false);
        const params = new URLSearchParams(searchParams.toString());
        params.delete("queue");
        params.delete("myShifts");
        params.delete("sportCode");
        params.delete("startDate");
        params.delete("endDate");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      },
    },
    calMonth,
    setCalMonth,
    weekStart,
    setWeekStart,
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
