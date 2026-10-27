import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("list state preservation source contracts", () => {
  it("keeps Items query state in the App Router history", () => {
    const filters = source("src/app/(app)/items/hooks/use-url-filters.ts");
    const query = source("src/app/(app)/items/hooks/use-items-query.ts");

    expect(filters).toContain("usePathname, useRouter, useSearchParams");
    expect(filters).toContain("router.replace(newUrl, { scroll: false })");
    expect(filters).not.toContain("window.history.replaceState");
    expect(query).toContain("usePathname, useRouter, useSearchParams");
    expect(query).toContain("router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })");
    expect(query).not.toContain("window.history.replaceState");
  });

  it("writes and rehydrates the Schedule list context through App Router history", () => {
    // What goes in the query string is behavior-tested in
    // tests/schedule-url-state.test.ts; this pins the hook's history wiring.
    const schedule = source("src/hooks/use-schedule-data.ts");

    expect(schedule).toContain("scheduleSearchSignatureRef");
    expect(schedule).toContain("skipNextScheduleUrlWriteRef");
    expect(schedule).toContain("router.replace(nextUrl, { scroll: false })");
    expect(schedule).toContain("readScheduleUrlFilters(query)");
    expect(schedule).toContain("writeScheduleUrlState(");
  });

  it("keeps the complete Bookings list context in App Router history", () => {
    const page = source("src/app/(app)/bookings/BookingsPageClient.tsx");
    const list = source("src/components/BookingListPage.tsx");
    const filters = source("src/components/booking-list/BookingFilters.tsx");

    for (const key of ["page", "q", "sort", "status", "sport_code", "location_id", "requester_id", "filter"]) {
      expect(list).toContain(`get("${key}")`);
    }

    expect(list).toContain('router.replace(qs ? `/bookings?${qs}` : "/bookings", { scroll: false })');
    expect(list).toContain('replaceListParams({ page: boundedPage > 0 ? String(boundedPage) : null }, false)');
    expect(list).toContain('status: value || (config.defaultStatusFilter ? "all" : null)');
    expect(list).not.toContain("window.history.replaceState");
    expect(filters).toContain("onClick={onClearAll}");
    expect(filters).toContain("search || statusFilter");
    expect(page).toContain('next.set("view", mode)');
    expect(page.match(/next\.delete\("page"\)/g)).toHaveLength(2);
  });
});
