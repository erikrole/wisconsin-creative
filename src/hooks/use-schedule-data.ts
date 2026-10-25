"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import { getMonday, LS_VIEW_MODE, LS_MY_SHIFTS } from "@/app/(app)/schedule/_components/types";
import {
  buildScheduleSourceSignal,
  getCalendarSourceFreshness,
  type ScheduleSourceSignal,
} from "@/lib/calendar-source-freshness";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";
import type { ScheduleAutomationDigest } from "@/lib/schedule-automation-types";
import {
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
import {
  createInitialScheduleTimelineWindow,
  mergeRowsById,
  newestScheduleCursor,
  oldestScheduleCursor,
  type ScheduleTimelineCursor,
} from "@/lib/schedule-timeline-window";
import {
  defaultScheduleMonth,
  defaultScheduleWeek,
  parseScheduleDeepLink,
  parseScheduleMonth,
  parseScheduleViewMode,
  parseScheduleWeek,
  readScheduleUrlFilters,
  scheduleHref,
  withoutScheduleDateRange,
  withoutScheduleFilters,
  withScheduleQueue,
  writeScheduleUrlState,
  type HomeAwayFilter,
  type ScheduleDeepLink,
  type ViewMode,
} from "@/lib/schedule-url-state";
import {
  SCHEDULE_FRESH_QUERY_OPTIONS,
  buildScheduleUrls,
  fetchCalendarSources,
  fetchKeysetEvents,
  fetchSchedule,
  fetchScheduleAutomation,
  fetchScheduleHealth,
  fetchScheduleSlice,
  fetchTradeCount,
  isScheduleAbort,
  listKeysetEventsUrl,
} from "@/lib/schedule-read";
import { filterScheduleEntries, groupScheduleEntriesByDay } from "@/lib/schedule-entry-view";

export type { HomeAwayFilter, ViewMode } from "@/lib/schedule-url-state";

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
  dateRange: { startDate: string; endDate: string } | null;
  clearDateRange: () => void;
  hasFilters: boolean;
  clearAll: () => void;
};

type UseScheduleDataResult = {
  entries: CalendarEntry[];
  filteredEntries: CalendarEntry[];
  groupedEntries: [string, CalendarEntry[]][];
  /** The window hit the page cap, so the oldest events are not loaded. */
  timelineTruncated: boolean;
  /** The list is the continuous today-anchored timeline. */
  isTimeline: boolean;
  /** Older events exist beyond the rows currently loaded. */
  hasMorePast: boolean;
  /** Later events exist beyond the rows currently loaded. */
  hasMoreFuture: boolean;
  loadingPast: boolean;
  loadingFuture: boolean;
  loadPastError: boolean;
  loadFutureError: boolean;
  loadOlder: () => Promise<void>;
  loadNewer: () => Promise<void>;
  /** A client-side filter is still searching rows that have not been loaded yet. */
  fillingWindow: boolean;
  /** A filter is narrowing which events appear, rather than how far back the window reaches. */
  hasContentFilters: boolean;
  loading: boolean;
  refreshing: boolean;
  loadError: false | "network" | "server";
  refreshError: boolean;
  healthUnavailable: boolean;
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
  const [initialFilters] = useState(() => readScheduleUrlFilters(new URLSearchParams(searchParams.toString())));
  const [sportFilter, setSportFilterRaw] = useState(initialFilters.sportFilter);
  const [areaFilter, setAreaFilterRaw] = useState(initialFilters.areaFilter);
  const [coverageFilter, setCoverageFilterRaw] = useState(initialFilters.coverageFilter);
  const [homeAwayFilter, setHomeAwayFilterRaw] = useState<HomeAwayFilter>(initialFilters.homeAwayFilter);
  const [includeArchived, setIncludeArchivedRaw] = useState(initialFilters.includeArchived);
  const [myShiftsOnly, setMyShiftsOnlyRaw] = useState(initialFilters.myShiftsOnly);

  // UI state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  // Home links straight to the board with ?trades=open.
  const [tradeSheetOpen, setTradeSheetOpen] = useState(() => searchParams.get("trades") === "open");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const searchParamsString = searchParams.toString();
  const scheduleSearchSignatureRef = useRef(searchParamsString);
  const skipNextScheduleUrlWriteRef = useRef(false);
  const initialPreferencesAppliedRef = useRef(false);
  const listViewRoundTripRef = useRef(false);
  const periodContextDateRef = useRef<Date | null>(null);
  const pendingArchivedLoadRef = useRef(false);
  const deepLink = useMemo<ScheduleDeepLink>(
    () => parseScheduleDeepLink(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  );
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
    const filters = readScheduleUrlFilters(query);
    setSportFilterRaw(filters.sportFilter);
    setAreaFilterRaw(filters.areaFilter);
    setCoverageFilterRaw(filters.coverageFilter);
    setHomeAwayFilterRaw(filters.homeAwayFilter);
    setIncludeArchivedRaw(filters.includeArchived);
    setMyShiftsOnlyRaw(filters.myShiftsOnly);
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
    if (next) pendingArchivedLoadRef.current = true;
    setIncludeArchivedRaw(next);
  }, [captureTimelineContext]);
  const setMyShiftsOnly = useCallback((next: boolean) => {
    captureTimelineContext();
    setMyShiftsOnlyRaw(next);
  }, [captureTimelineContext]);

  const setQueue = useCallback((queue: ScheduleQueue | null) => {
    captureTimelineContext();
    if (queue) setViewModeRaw("list");
    const params = withScheduleQueue(new URLSearchParams(searchParams.toString()), queue);
    router.replace(scheduleHref(pathname, params), { scroll: false });
  }, [captureTimelineContext, pathname, router, searchParams]);

  const clearDateRange = useCallback(() => {
    captureTimelineContext();
    skipNextScheduleUrlWriteRef.current = true;
    const params = withoutScheduleDateRange(new URLSearchParams(searchParams.toString()));
    router.replace(scheduleHref(pathname, params), { scroll: false });
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

    const params = writeScheduleUrlState(new URLSearchParams(searchParamsString), {
      viewMode,
      calMonth,
      weekStart,
      sportFilter,
      areaFilter,
      coverageFilter,
      homeAwayFilter,
      includeArchived,
      myShiftsOnly,
    });
    const query = params.toString();
    const nextUrl = scheduleHref(pathname, params);
    const currentUrl = scheduleHref(pathname, new URLSearchParams(searchParamsString));
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
  const { data: tradeCount, refetch: refetchTrades } = useQuery({
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
  const timelineWindow = useMemo(
    () => (isTimeline ? createInitialScheduleTimelineWindow() : null),
    [isTimeline],
  );
  const { eventsUrl, groupsUrl, healthUrl, automationUrl } = buildScheduleUrls(
    effectiveViewMode,
    calMonth,
    weekStart,
    includeArchived,
    effectiveSportFilter,
    deepLink.dateRange,
    timelineWindow,
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

  const timelineResetKey = `${effectiveViewMode}|${effectiveSportFilter}|${scheduleScope.dateRangeKey}`;
  const [timelineExtra, setTimelineExtra] = useState<CalendarEntry[]>([]);
  const [hasMorePast, setHasMorePast] = useState(true);
  const [hasMoreFuture, setHasMoreFuture] = useState(true);
  const [loadingPast, setLoadingPast] = useState(false);
  const [loadingFuture, setLoadingFuture] = useState(false);
  const [loadPastError, setLoadPastError] = useState(false);
  const [loadFutureError, setLoadFutureError] = useState(false);
  const timelineExtraRef = useRef<CalendarEntry[]>([]);
  const timelineResetRef = useRef(timelineResetKey);
  const loadingPastRef = useRef(false);
  const loadingFutureRef = useRef(false);
  const loadedEntriesRef = useRef<CalendarEntry[]>([]);

  if (timelineResetRef.current !== timelineResetKey) {
    timelineResetRef.current = timelineResetKey;
    timelineExtraRef.current = [];
    if (timelineExtra.length > 0) setTimelineExtra([]);
    if (!hasMorePast) setHasMorePast(true);
    if (!hasMoreFuture) setHasMoreFuture(true);
    if (loadPastError) setLoadPastError(false);
    if (loadFutureError) setLoadFutureError(false);
  }

  const entries = useMemo(
    () => mergeRowsById(schedule?.entries ?? [], timelineExtra),
    [schedule, timelineExtra],
  );
  useLayoutEffect(() => {
    loadedEntriesRef.current = entries;
  }, [entries]);
  const timelineTruncated = schedule?.truncated ?? false;
  const { data: healthData = null, error: healthError, refetch: refetchScheduleHealth } = useQuery({
    queryKey: ["schedule-health", healthUrl],
    queryFn: ({ signal }) => fetchScheduleHealth(healthUrl, signal),
    enabled: canViewScheduleHealth,
    ...SCHEDULE_FRESH_QUERY_OPTIONS,
  });
  const healthUnavailable = canViewScheduleHealth && (!healthData || Boolean(healthError) || healthData.partialFailures.length > 0);
  const scheduleHealth = healthUnavailable ? null : healthData;
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
  const refreshError = Boolean(preferencesLoaded && scheduleError && visibleEntries.length > 0);

  // Client-side filtering
  const filteredEntries = useMemo(() => filterScheduleEntries(visibleEntries, {
    myShiftsOnly,
    currentUserId,
    homeAwayFilter,
    areaFilter,
    coverageFilter,
    queue: activeQueue,
    health: scheduleHealth,
    staleSourceIds,
  }), [visibleEntries, homeAwayFilter, areaFilter, coverageFilter, myShiftsOnly, currentUserId, activeQueue, scheduleHealth, staleSourceIds]);

  // Group entries by date for list view
  const groupedEntries = useMemo(
    () => groupScheduleEntriesByDay(filteredEntries, { isTimeline }),
    [filteredEntries, isTimeline],
  );

  const hasFilters = !!(sportFilter || areaFilter || coverageFilter || homeAwayFilter !== "all" || includeArchived || activeQueue || deepLink.dateRange);
  /**
   * Filters that narrow *which* events are listed, as opposed to how far back
   * the timeline reaches. Loading archived events is not a filter -- treating it
   * as one made the archive row delete itself the moment it was used.
   */
  const hasContentFilters = !!(sportFilter || areaFilter || coverageFilter || homeAwayFilter !== "all" || myShiftsOnly || activeQueue || deepLink.dateRange);
  const hasClientContentFilters = !!(areaFilter || coverageFilter || homeAwayFilter !== "all" || myShiftsOnly || activeQueue);

  const fallbackTimelineCursor = useCallback((edge: "past" | "future"): ScheduleTimelineCursor => {
    const now = new Date();
    const start = timelineWindow?.start ?? now;
    const end = timelineWindow?.end ?? now;
    return {
      startsAt: (edge === "past" ? start : end).toISOString(),
      id: "",
    };
  }, [timelineWindow]);

  const loadOlder = useCallback(async () => {
    if (!isTimeline || loadingPastRef.current) return;
    const cursor = oldestScheduleCursor(loadedEntriesRef.current) ?? fallbackTimelineCursor("past");
    loadingPastRef.current = true;
    setLoadingPast(true);
    setLoadPastError(false);
    try {
      const slice = await fetchScheduleSlice(includeArchived, effectiveSportFilter, cursor, "before");
      if (slice.entries.length === 0) {
        setHasMorePast(false);
        return;
      }
      timelineExtraRef.current = mergeRowsById(timelineExtraRef.current, slice.entries);
      setTimelineExtra(timelineExtraRef.current);
      setHasMorePast(slice.hasMore);
    } catch (error) {
      if (isScheduleAbort(error)) return;
      setLoadPastError(true);
    } finally {
      loadingPastRef.current = false;
      setLoadingPast(false);
    }
  }, [effectiveSportFilter, fallbackTimelineCursor, includeArchived, isTimeline]);

  const loadNewer = useCallback(async () => {
    if (!isTimeline || loadingFutureRef.current) return;
    const cursor = newestScheduleCursor(loadedEntriesRef.current) ?? fallbackTimelineCursor("future");
    loadingFutureRef.current = true;
    setLoadingFuture(true);
    setLoadFutureError(false);
    try {
      const slice = await fetchScheduleSlice(includeArchived, effectiveSportFilter, cursor, "after");
      if (slice.entries.length === 0) {
        setHasMoreFuture(false);
        return;
      }
      timelineExtraRef.current = mergeRowsById(timelineExtraRef.current, slice.entries);
      setTimelineExtra(timelineExtraRef.current);
      setHasMoreFuture(slice.hasMore);
    } catch (error) {
      if (isScheduleAbort(error)) return;
      setLoadFutureError(true);
    } finally {
      loadingFutureRef.current = false;
      setLoadingFuture(false);
    }
  }, [effectiveSportFilter, fallbackTimelineCursor, includeArchived, isTimeline]);

  useEffect(() => {
    if (!isTimeline || !includeArchived || !pendingArchivedLoadRef.current) return;
    pendingArchivedLoadRef.current = false;
    setHasMorePast(true);
    void loadOlder();
  }, [includeArchived, isTimeline, loadOlder]);

  useEffect(() => {
    if (!isTimeline || !schedule || isLoading) return;
    if (timelineExtraRef.current.length > 0) return;
    let cancelled = false;
    const oldest = oldestScheduleCursor(loadedEntriesRef.current) ?? fallbackTimelineCursor("past");
    const newest = newestScheduleCursor(loadedEntriesRef.current) ?? fallbackTimelineCursor("future");
    void (async () => {
      try {
        const [past, future] = await Promise.all([
          fetchKeysetEvents(listKeysetEventsUrl(includeArchived, effectiveSportFilter, oldest, "before", 1)),
          fetchKeysetEvents(listKeysetEventsUrl(includeArchived, effectiveSportFilter, newest, "after", 1)),
        ]);
        if (cancelled) return;
        setHasMorePast(past.rows.length > 0);
        setHasMoreFuture(future.rows.length > 0);
      } catch {
        // Peek failure leaves the last known bounds; the edge retry can recover.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveSportFilter, fallbackTimelineCursor, includeArchived, isLoading, isTimeline, schedule]);

  useEffect(() => {
    if (!isTimeline || !hasClientContentFilters || loading || loadingPast || loadingFuture) return;
    if (loadPastError || loadFutureError) return;
    if (hasMorePast) {
      void loadOlder();
      return;
    }
    if (hasMoreFuture) void loadNewer();
  }, [
    hasClientContentFilters,
    hasMoreFuture,
    hasMorePast,
    isTimeline,
    loadFutureError,
    loadNewer,
    loadOlder,
    loadPastError,
    loading,
    loadingFuture,
    loadingPast,
  ]);

  const fillingWindow = Boolean(
    isTimeline && hasClientContentFilters && (hasMorePast || hasMoreFuture || loadingPast || loadingFuture),
  );

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
    hasMorePast,
    hasMoreFuture,
    loadingPast,
    loadingFuture,
    loadPastError,
    loadFutureError,
    loadOlder,
    loadNewer,
    fillingWindow,
    hasContentFilters,
    loading,
    refreshing: preferencesLoaded && isFetching && !isLoading,
    loadError,
    refreshError,
    healthUnavailable,
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
      dateRange: deepLink.dateRange,
      clearDateRange,
      hasFilters,
      clearAll: () => {
        captureTimelineContext();
        setSportFilterRaw("");
        setAreaFilterRaw("");
        setCoverageFilterRaw("");
        setHomeAwayFilterRaw("all");
        setIncludeArchivedRaw(false);
        skipNextScheduleUrlWriteRef.current = true;
        const params = withoutScheduleFilters(new URLSearchParams(searchParams.toString()));
        router.replace(scheduleHref(pathname, params), { scroll: false });
      },
    },
    calMonth,
    setCalMonth: setCalendarMonth,
    weekStart,
    setWeekStart: setScheduleWeek,
    currentUserId,
    currentUserRole,
    openTradeCount: tradeCount ?? 0,
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
