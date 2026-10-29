import type { CalendarEvent, CalendarEntry, ShiftGroup } from "@/app/(app)/schedule/_components/types";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import type { CalendarSourceFreshnessInput } from "@/lib/calendar-source-freshness";
import type { ScheduleHealthSnapshot } from "@/lib/schedule-health-types";
import type { ScheduleAutomationDigest } from "@/lib/schedule-automation-types";
import type { ScheduleDateRange } from "@/lib/schedule-url-state";
import {
  SCHEDULE_TIMELINE_SLICE_SIZE,
  eventBoundsForGroups,
  sliceHasMore,
  type ScheduleTimelineCursor,
  type ScheduleTimelineWindow,
} from "@/lib/schedule-timeline-window";

/**
 * Schedule page reads. Every request skips the HTTP cache: React Query owns
 * freshness, and a cached crew list is how a filled slot shows as open.
 */

const SCHEDULE_READ_FETCH_INIT: RequestInit = { cache: "no-store" };
export const SCHEDULE_FRESH_QUERY_OPTIONS = {
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
      pendingReview: g?.pendingReview,
      claimsPaused: g?.claimsPaused ?? false,
      autoReleaseAt: g?.autoReleaseAt ?? null,
      autoReleaseError: g?.autoReleaseError ?? null,
      combinedEventCount: members.length,
    };
  });
}

/** Build schedule fetch URL based on current view params */
export function buildScheduleUrls(
  viewMode: string,
  calMonth: Date,
  weekStart: Date,
  includeArchived: boolean,
  sportFilter: string,
  dateRange: ScheduleDateRange | null,
  timelineWindow?: ScheduleTimelineWindow | null,
) {
  const evParams = new URLSearchParams({ limit: "200" });
  const sgParams = new URLSearchParams({ limit: "200", slim: "1" });
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
    } else if (timelineWindow) {
      // First paint is a today-centered window. Infinite scroll then walks
      // older and newer events with keyset pages instead of loading the whole
      // archive before the list can appear.
      evParams.set("startDate", timelineWindow.start.toISOString());
      evParams.set("endDate", timelineWindow.end.toISOString());
      evParams.set("includePast", "true");
      sgParams.set("startDate", timelineWindow.start.toISOString());
      sgParams.set("endDate", timelineWindow.end.toISOString());
      healthParams.set("includePast", "true");
      automationParams.set("includePast", "true");
    } else {
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
 * Calendar and week views still load their dated window up front. The list
 * timeline uses a today-centered first window, then keyset pages as the reader
 * scrolls. `PAGE_SIZE` is the server's own cap. `MAX_PAGES` keeps a runaway
 * dated window from hanging the browser.
 */
export const PAGE_SIZE = 200;
export const MAX_PAGES = 15;

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
export async function fetchAllPages<T extends { id: string }>(
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

export async function fetchSchedule(
  eventsUrl: string,
  groupsUrl: string,
  signal?: AbortSignal,
): Promise<{ entries: CalendarEntry[]; truncated: boolean }> {
  const [events, groups] = await Promise.all([
    fetchAllPages<CalendarEvent>(eventsUrl, signal),
    // Crew data determines personal assignments and whether setup is offered.
    // Reject incomplete snapshots so Query retains the last complete result.
    fetchAllPages<ShiftGroup>(groupsUrl, signal),
  ]);
  if (groups.truncated) throw new Error("Crew information is incomplete. Narrow the schedule window and retry.");

  return {
    entries: mergeScheduleData(events.rows, groups.rows),
    truncated: events.truncated,
  };
}

export function isScheduleAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function listKeysetEventsUrl(
  includeArchived: boolean,
  sportFilter: string,
  cursor: ScheduleTimelineCursor,
  direction: "before" | "after",
  limit = SCHEDULE_TIMELINE_SLICE_SIZE,
) {
  const params = new URLSearchParams({
    limit: String(limit),
    includePast: "true",
  });
  if (sportFilter) params.set("sportCode", sportFilter);
  if (includeArchived) {
    params.set("includeArchived", "true");
    params.set("includePast", "true");
  }
  if (direction === "before") {
    params.set("beforeStartsAt", cursor.startsAt);
    if (cursor.id) params.set("beforeId", cursor.id);
  } else {
    params.set("afterStartsAt", cursor.startsAt);
    if (cursor.id) params.set("afterId", cursor.id);
  }
  return `/api/calendar-events?${params}`;
}

function listGroupsUrl(sportFilter: string) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), slim: "1" });
  if (sportFilter) params.set("sportCode", sportFilter);
  return `/api/shift-groups?${params}`;
}

export async function fetchKeysetEvents(
  url: string,
  signal?: AbortSignal,
): Promise<{ rows: CalendarEvent[]; hasMore: boolean }> {
  const res = await fetch(url, { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("schedule page fetch failed");
  const json = await parseJsonSafely<{ data?: CalendarEvent[] }>(res);
  if (!json?.data) throw new Error("schedule page response malformed");
  return { rows: json.data, hasMore: sliceHasMore(json.data.length) };
}

async function fetchGroupsForEvents(
  groupsUrl: string,
  events: CalendarEvent[],
  signal?: AbortSignal,
): Promise<ShiftGroup[]> {
  const bounds = eventBoundsForGroups(events);
  if (!bounds) return [];
  const url = new URL(groupsUrl, window.location.origin);
  url.searchParams.set("startDate", bounds.startDate);
  url.searchParams.set("endDate", bounds.endDate);
  const groups = await fetchAllPages<ShiftGroup>(url.toString(), signal);
  if (groups.truncated) throw new Error("Crew information is incomplete. Narrow the schedule window and retry.");
  return groups.rows;
}

export async function fetchScheduleSlice(
  includeArchived: boolean,
  sportFilter: string,
  cursor: ScheduleTimelineCursor,
  direction: "before" | "after",
  signal?: AbortSignal,
): Promise<{ entries: CalendarEntry[]; hasMore: boolean }> {
  const events = await fetchKeysetEvents(
    listKeysetEventsUrl(includeArchived, sportFilter, cursor, direction),
    signal,
  );
  if (events.rows.length === 0) return { entries: [], hasMore: false };
  const groups = await fetchGroupsForEvents(listGroupsUrl(sportFilter), events.rows, signal);
  return {
    entries: mergeScheduleData(events.rows, groups),
    hasMore: events.hasMore,
  };
}

export async function fetchTradeCount(): Promise<number> {
  const r = await fetch("/api/shift-trades?status=OPEN&limit=1", SCHEDULE_READ_FETCH_INIT);
  if (handleAuthRedirect(r, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!r.ok) throw new Error("trade count fetch failed");
  const j = await parseJsonSafely<{ total?: number; data?: unknown[] }>(r);
  return typeof j?.total === "number" ? j.total : j?.data?.length ?? 0;
}

export async function fetchCalendarSources(signal?: AbortSignal): Promise<CalendarSourceFreshnessInput[]> {
  const res = await fetch("/api/calendar-sources", { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("calendar sources fetch failed");

  const json = await parseJsonSafely<{ data?: CalendarSourceFreshnessInput[] }>(res);
  if (!json?.data) throw new Error("calendar sources response malformed");
  return json.data;
}

export async function fetchScheduleHealth(url: string, signal?: AbortSignal): Promise<ScheduleHealthSnapshot> {
  const res = await fetch(url, { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("schedule health fetch failed");

  const json = await parseJsonSafely<{ data?: ScheduleHealthSnapshot }>(res);
  if (!json?.data) throw new Error("schedule health response malformed");
  return json.data;
}

export async function fetchScheduleAutomation(url: string, signal?: AbortSignal): Promise<ScheduleAutomationDigest> {
  const res = await fetch(url, { ...SCHEDULE_READ_FETCH_INIT, signal });
  if (handleAuthRedirect(res, "/schedule")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!res.ok) throw new Error("schedule automation fetch failed");

  const json = await parseJsonSafely<{ data?: ScheduleAutomationDigest }>(res);
  if (!json?.data) throw new Error("schedule automation response malformed");
  return json.data;
}
