import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PAGES,
  PAGE_SIZE,
  SCHEDULE_FRESH_QUERY_OPTIONS,
  buildScheduleUrls,
  fetchAllPages,
  fetchCalendarSources,
  fetchSchedule,
  fetchScheduleAutomation,
  fetchScheduleHealth,
  fetchScheduleSlice,
  fetchTradeCount,
  listKeysetEventsUrl,
  mergeScheduleData,
} from "@/lib/schedule-read";
import type { CalendarEvent, ShiftGroup } from "@/app/(app)/schedule/_components/types";

type FetchCall = { url: URL; init: RequestInit | undefined };
let calls: FetchCall[] = [];

function stubFetch(respond: (url: URL) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    calls.push({ url, init });
    return respond(url);
  }));
}

function rows(prefix: string, count: number, from = 0) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${from + index}` }));
}

function offsetOf(url: URL) {
  return Number(url.searchParams.get("offset"));
}

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost", pathname: "/schedule", search: "", href: "" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Schedule reads skip the HTTP cache", () => {
  it("keeps React Query in charge of freshness", () => {
    // Long stale times hid a filled slot as open after another tab's change.
    expect(SCHEDULE_FRESH_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    });
  });

  it("sends no-store, and the abort signal where there is one, on every read", async () => {
    stubFetch((url) => url.pathname === "/api/shift-trades"
      ? Response.json({ data: [], total: 4 })
      : url.pathname.startsWith("/api/schedule/")
        ? Response.json({ data: { partialFailures: [] } })
        : Response.json({ data: [], total: 0 }));
    const signal = new AbortController().signal;

    await fetchAllPages("/api/calendar-events?limit=200", signal);
    await fetchCalendarSources(signal);
    await fetchScheduleHealth("/api/schedule/health?includePast=true", signal);
    await fetchScheduleAutomation("/api/schedule/automation?includePast=true", signal);
    await fetchTradeCount();

    expect(calls.map((call) => call.init?.cache)).toEqual(["no-store", "no-store", "no-store", "no-store", "no-store"]);
    expect(calls.slice(0, 4).map((call) => call.init?.signal)).toEqual([signal, signal, signal, signal]);
  });
});

describe("fetchAllPages", () => {
  it("stops after one request when the first page is short", async () => {
    stubFetch(() => Response.json({ data: rows("e", 3), total: 3 }));

    const result = await fetchAllPages("/api/calendar-events");

    expect(result).toEqual({ rows: rows("e", 3), truncated: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("limit")).toBe(String(PAGE_SIZE));
    expect(offsetOf(calls[0]!.url)).toBe(0);
  });

  it("requests every remaining page at once when the server reports a total", async () => {
    let inFlight = 0;
    let peak = 0;
    stubFetch(async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const offset = offsetOf(url);
      return Response.json({ data: rows("e", Math.min(PAGE_SIZE, 450 - offset), offset), total: 450 });
    });

    const result = await fetchAllPages("/api/calendar-events");

    expect(calls.map((call) => offsetOf(call.url))).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2]);
    expect(peak).toBe(2);
    expect(result.rows).toHaveLength(450);
    expect(result.truncated).toBe(false);
  });

  it("drops a row that offset paging hands back twice", async () => {
    stubFetch((url) => {
      const offset = offsetOf(url);
      // An insert between requests shifts the second page back by one row.
      return Response.json({ data: rows("e", offset === 0 ? PAGE_SIZE : 10, offset === 0 ? 0 : PAGE_SIZE - 1), total: PAGE_SIZE + 10 });
    });

    const result = await fetchAllPages("/api/calendar-events");

    expect(result.rows).toHaveLength(PAGE_SIZE + 9);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
  });

  it("caps a runaway window and says it did", async () => {
    const total = PAGE_SIZE * (MAX_PAGES + 2);
    stubFetch((url) => Response.json({ data: rows("e", PAGE_SIZE, offsetOf(url)), total }));

    const result = await fetchAllPages("/api/calendar-events");

    expect(calls).toHaveLength(MAX_PAGES);
    expect(result.rows).toHaveLength(PAGE_SIZE * MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  it("walks one page at a time when there is no total to plan against", async () => {
    stubFetch((url) => {
      const offset = offsetOf(url);
      return Response.json({ data: rows("e", offset < PAGE_SIZE * 2 ? PAGE_SIZE : 5, offset) });
    });

    const result = await fetchAllPages("/api/calendar-events");

    expect(calls.map((call) => offsetOf(call.url))).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2]);
    expect(result).toMatchObject({ truncated: false });
    expect(result.rows).toHaveLength(PAGE_SIZE * 2 + 5);
  });

  it("marks an uncounted window truncated once it reaches the page cap", async () => {
    stubFetch((url) => Response.json({ data: rows("e", PAGE_SIZE, offsetOf(url)) }));

    const result = await fetchAllPages("/api/calendar-events");

    expect(calls).toHaveLength(MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  it("fails a page instead of treating it as empty", async () => {
    stubFetch(() => new Response("down", { status: 503 }));
    await expect(fetchAllPages("/api/calendar-events")).rejects.toThrow("schedule page fetch failed");

    stubFetch(() => Response.json({ rows: [] }));
    await expect(fetchAllPages("/api/calendar-events")).rejects.toThrow("schedule page response malformed");
  });
});

describe("fetchSchedule", () => {
  it("reports a truncated event window and merges crew onto events", async () => {
    stubFetch((url) => url.pathname === "/api/shift-groups"
      ? Response.json({ data: [{ id: "group-1", eventId: "e-0", shifts: [], coverage: null }], total: 1 })
      : Response.json({ data: rows("e", PAGE_SIZE, offsetOf(url)).map((row) => ({ ...row, startsAt: "2026-10-22T17:00:00Z", endsAt: "2026-10-22T19:00:00Z" })), total: PAGE_SIZE * (MAX_PAGES + 1) }));

    const result = await fetchSchedule("/api/calendar-events", "/api/shift-groups");

    expect(result.truncated).toBe(true);
    expect(result.entries[0]).toMatchObject({ id: "e-0", shiftGroupId: "group-1" });
  });
});

describe("buildScheduleUrls", () => {
  const calMonth = new Date(2026, 9, 1);
  const weekStart = new Date(2026, 9, 19);

  function params(url: string) {
    return Object.fromEntries(new URL(url, "http://localhost").searchParams);
  }

  it("asks for past events on the timeline, bounded by its first window", () => {
    const window = { start: new Date("2026-10-01T05:00:00Z"), end: new Date("2027-01-15T05:59:59Z") };
    const urls = buildScheduleUrls("list", calMonth, weekStart, false, "", null, window);

    expect(params(urls.eventsUrl)).toMatchObject({
      includePast: "true",
      startDate: window.start.toISOString(),
      endDate: window.end.toISOString(),
    });
    expect(params(urls.groupsUrl)).toMatchObject({ startDate: window.start.toISOString() });
    expect(params(urls.healthUrl)).toEqual({ includePast: "true" });
    expect(urls.automationUrl).toBe("/api/schedule/automation?includePast=true");
  });

  it("loads a calendar month and a week as fixed windows", () => {
    const month = params(buildScheduleUrls("calendar", calMonth, weekStart, false, "", null).eventsUrl);
    expect(month.startDate).toBe(calMonth.toISOString());
    expect(month.endDate).toBe(new Date(2026, 9, 31, 23, 59, 59).toISOString());

    const week = params(buildScheduleUrls("week", calMonth, weekStart, false, "", null).eventsUrl);
    expect(week.startDate).toBe(weekStart.toISOString());
    expect(week.endDate).toBe(new Date(2026, 9, 25, 23, 59, 59, 999).toISOString());
  });

  it("uses a deep-linked range as-is and carries sport and archive choices everywhere", () => {
    const range = { startDate: "2026-11-01T05:00:00.000Z", endDate: "2026-11-08T05:00:00.000Z" };
    const urls = buildScheduleUrls("list", calMonth, weekStart, true, "FB", range);

    for (const url of [urls.eventsUrl, urls.healthUrl, urls.automationUrl]) {
      expect(params(url)).toMatchObject({ ...range, sportCode: "FB", includeArchived: "true", includePast: "true" });
    }
    expect(params(urls.groupsUrl)).toMatchObject({ ...range, sportCode: "FB" });
  });
});

describe("timeline keyset slices", () => {
  it("pages before or after a cursor, with the id as tiebreaker", () => {
    const cursor = { startsAt: "2026-10-22T17:00:00.000Z", id: "ev-1" };
    const before = new URL(listKeysetEventsUrl(false, "FB", cursor, "before"), "http://localhost").searchParams;
    const after = new URL(listKeysetEventsUrl(true, "", { ...cursor, id: "" }, "after", 1), "http://localhost").searchParams;

    expect(Object.fromEntries(before)).toEqual({
      limit: "80",
      includePast: "true",
      sportCode: "FB",
      beforeStartsAt: cursor.startsAt,
      beforeId: "ev-1",
    });
    expect(Object.fromEntries(after)).toEqual({
      limit: "1",
      includePast: "true",
      includeArchived: "true",
      afterStartsAt: cursor.startsAt,
    });
  });

  it("does not ask for crew when the slice is empty", async () => {
    stubFetch(() => Response.json({ data: [] }));

    const slice = await fetchScheduleSlice(false, "", { startsAt: "2026-10-22T17:00:00.000Z", id: "" }, "before");

    expect(slice).toEqual({ entries: [], hasMore: false });
    expect(calls).toHaveLength(1);
  });

  it("loads crew for exactly the slice's span", async () => {
    const events = [
      { id: "a", startsAt: "2026-10-20T17:00:00.000Z", endsAt: "2026-10-20T19:00:00.000Z" },
      { id: "b", startsAt: "2026-10-18T17:00:00.000Z", endsAt: "2026-10-18T21:00:00.000Z" },
    ];
    stubFetch((url) => url.pathname === "/api/shift-groups"
      ? Response.json({ data: [{ id: "g-a", eventId: "a", shifts: [] }], total: 1 })
      : Response.json({ data: events }));

    const slice = await fetchScheduleSlice(false, "WVB", { startsAt: "2026-10-21T00:00:00.000Z", id: "" }, "before");

    const groups = calls.find((call) => call.url.pathname === "/api/shift-groups")!.url.searchParams;
    expect(groups.get("startDate")).toBe("2026-10-18T17:00:00.000Z");
    expect(groups.get("endDate")).toBe("2026-10-20T19:00:00.000Z");
    expect(groups.get("sportCode")).toBe("WVB");
    expect(slice.hasMore).toBe(false);
    expect(slice.entries.map((entry) => [entry.id, entry.shiftGroupId])).toEqual([["a", "g-a"], ["b", null]]);
  });
});

describe("fetchTradeCount", () => {
  it("prefers the server total and falls back to the rows returned", async () => {
    stubFetch(() => Response.json({ data: [{}], total: 7 }));
    await expect(fetchTradeCount()).resolves.toBe(7);
    expect(calls[0]?.url.search).toBe("?status=OPEN&limit=1");

    stubFetch(() => Response.json({ data: [{}, {}] }));
    await expect(fetchTradeCount()).resolves.toBe(2);
  });

  it("fails loudly so the badge keeps its last good count", async () => {
    stubFetch(() => new Response("down", { status: 500 }));
    await expect(fetchTradeCount()).rejects.toThrow("trade count fetch failed");
  });
});

describe("mergeScheduleData", () => {
  it("keeps the event's own archive date apart from its crew's", () => {
    const event = {
      id: "e-1",
      startsAt: "2026-10-22T17:00:00Z",
      endsAt: "2026-10-22T19:00:00Z",
      allDay: false,
      archivedAt: "2026-10-23T00:00:00Z",
    } as unknown as CalendarEvent;
    const group = { id: "g-1", eventId: "e-1", shifts: [], archivedAt: null } as unknown as ShiftGroup;

    const [entry] = mergeScheduleData([event], [group]);

    expect(entry).toMatchObject({ eventArchivedAt: "2026-10-23T00:00:00Z", archivedAt: null, shiftGroupId: "g-1" });
  });
});
