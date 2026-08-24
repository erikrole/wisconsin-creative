import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("Schedule freshness source contract", () => {
  it("bypasses browser HTTP cache for operational Schedule reads", () => {
    const hook = read("src/hooks/use-schedule-data.ts");

    expect(hook).toContain('const SCHEDULE_READ_FETCH_INIT: RequestInit = { cache: "no-store" };');
    // Event and shift-group reads page through one loader, so the no-store
    // init is asserted there rather than at two hand-written call sites.
    expect(hook).toContain("fetch(pagedUrl(url, offset), { ...SCHEDULE_READ_FETCH_INIT, signal })");
    expect(hook).toContain("fetchAllPages<CalendarEvent>(eventsUrl, signal)");
    expect(hook).toContain("fetchAllPages<ShiftGroup>(groupsUrl, signal)");
    expect(hook).toContain('fetch("/api/shift-trades?status=OPEN&limit=1", SCHEDULE_READ_FETCH_INIT)');
    expect(hook).toContain('fetch("/api/calendar-sources", { ...SCHEDULE_READ_FETCH_INIT, signal })');
    expect(hook).toContain("fetch(url, { ...SCHEDULE_READ_FETCH_INIT, signal })");
  });

  it("overrides global React Query staleness for Schedule surfaces", () => {
    const hook = read("src/hooks/use-schedule-data.ts");

    expect(hook).toContain("const SCHEDULE_FRESH_QUERY_OPTIONS = {");
    expect(hook).toContain("staleTime: 0");
    expect(hook).toContain('refetchOnMount: "always" as const');
    expect(hook).toContain("refetchOnWindowFocus: true");
    expect(hook.match(/\.\.\.SCHEDULE_FRESH_QUERY_OPTIONS/g)?.length).toBe(5);
    expect(hook).not.toContain("staleTime: 60_000");
    expect(hook).not.toContain("staleTime: 30_000");
  });
});
