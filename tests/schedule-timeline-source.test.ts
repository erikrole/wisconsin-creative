import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const hook = source("src/hooks/use-schedule-data.ts");
const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");
const page = source("src/app/(app)/schedule/page.tsx");
const appShell = source("src/components/AppShell.tsx");
const timelinePosition = source("src/lib/schedule-timeline-position.ts");

// The list's own scroll, anchor and restore behavior runs in Chromium in
// tests/browser/schedule-list.spec.ts; these cover the data hook and page frame.
describe("schedule timeline", () => {
  it("reads one continuous window instead of an upcoming-only page", () => {
    expect(hook).toContain('evParams.set("includePast", "true")');
    // The scope toggle is gone: past is a direction you scroll, not a mode.
    expect(hook).not.toContain("timeScope");
    expect(filters).not.toContain("timeScope");
  });

  it("opens a today-centered window and loads more as the reader scrolls", () => {
    // Area, coverage, venue, my shifts, and queues still fill remaining pages
    // in the background so a filtered list cannot look empty while matches exist later.
    expect(hook).toContain("const hasClientContentFilters = !!(areaFilter || coverageFilter || homeAwayFilter !== \"all\" || myShiftsOnly || activeQueue);");
    expect(hook).toContain("async function fetchAllPages");
    expect(hook).toContain("const PAGE_SIZE = 200");
    expect(hook).toContain("const MAX_PAGES =");
    expect(hook).toContain("createInitialScheduleTimelineWindow");
    expect(hook).toContain("fetchScheduleSlice");
    expect(hook).toContain("beforeStartsAt");
    expect(hook).toContain("afterStartsAt");
  });

  it("requests the remaining pages together instead of walking offsets", () => {
    // The first page reports `total`, so the rest go out at once.
    expect(hook).toContain("if (first.rows.length < PAGE_SIZE) return { rows: first.rows, truncated: false };");
    expect(hook).toContain("const pagesNeeded = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);");
    expect(hook).toContain("await Promise.all(");
  });

  it("walks one page at a time when the server reports no total", () => {
    // Planning against a guessed page count would fire a burst of requests that
    // mostly come back empty.
    expect(hook).toContain("if (first.total === null) {");
  });

  it("deduplicates rows so offset drift cannot render an event twice", () => {
    expect(hook).toContain("if (seen.has(row.id)) continue;");
  });

  it("reports hitting the page cap instead of silently truncating", () => {
    expect(hook).toContain("truncated = first.total > PAGE_SIZE * MAX_PAGES;");
    expect(hook).toContain("timelineTruncated");
  });

  it("uses a logical visible-event anchor for filters and view round trips", () => {
    expect(hook).toContain("captureScheduleTimelinePosition");
    expect(hook).toContain('if (viewMode === "list") captureScheduleTimelinePosition();');
    expect(timelinePosition).not.toContain("sessionStorage.removeItem(TIMELINE_TRANSITION_KEY);\n  try {");
    expect(timelinePosition).toContain("chooseScheduleTimelineTarget");
    expect(timelinePosition).toContain("availableEventIds.has(event.id)");
  });

  it("pins the header, filters, and activity strip so the timeline runs beneath them", () => {
    expect(page).toContain('style={{ top: "var(--schedule-sticky-top, 0px)" }}');
    expect(page).toContain('--schedule-sticky-bottom');
    // Scroll-independent: a viewport-rect bottom goes stale when filters resize the frame.
    expect(page).toContain("const bottom = top + Math.round(el.getBoundingClientRect().height);");
    expect(page).toContain("data-schedule-sticky-frame");
    const stickyStart = page.indexOf("data-schedule-sticky-frame");
    const listStart = page.indexOf("{canDisplaySchedule && data.filters.viewMode === \"calendar\"");
    expect(page.indexOf("<ScheduleFilters", stickyStart)).toBeGreaterThan(stickyStart);
    expect(page.indexOf("<ScheduleReadiness", stickyStart)).toBeGreaterThan(stickyStart);
    expect(page.indexOf("<ScheduleReadiness", stickyStart)).toBeLessThan(listStart);
    // Day headers stack below both sticky frames, and the anchor lands there too.
  });

  it("keeps the Schedule frame below the app-shell header", () => {
    expect(source("src/components/AppTopBar.tsx")).toContain("data-app-shell-header");
    expect(appShell).toContain("sticky top-0 z-40");
    // Breadcrumbs live inside the 48px app header, so the header alone sets the offset.
    expect(appShell).not.toContain("data-app-shell-breadcrumb-frame");
    expect(appShell).not.toContain('"sticky z-[35]');
    expect(page).toContain("sticky z-30");
    expect(page).toContain('[data-app-shell-header]');
    expect(page).not.toContain("[data-app-shell-breadcrumb-frame]");
    expect(page).toContain('document.documentElement.style.setProperty("--schedule-sticky-top"');
  });

  it("gives the pinned bar its own spacing instead of hugging the viewport", () => {
    // Flush against the top edge the title reads as clipped; CSS alone cannot
    // tell a sticky element it is currently stuck. Resize recreates the observer
    // so a wrapping header cannot leave the pin detection on a stale margin.
    expect(page).toContain("const [pinned, setPinned] = useState(false);");
    expect(page).toContain("setPinned(!entry?.isIntersecting)");
    expect(page).toContain("pt-4");
    expect(page).toContain("const resizeObserver = new ResizeObserver(connect);");
    expect(page).toContain("}, [pinned]);");
  });

  it("keeps the reader in place when archived events prepend above them", () => {
    // The wider window keeps the old rows (schedule-timeline-position.test.ts).
    expect(hook).toContain("shouldKeepPreviousScheduleData(previousScope, scheduleScope)");
  });

  it("does not delete the archive row by treating archived as a filter", () => {
    expect(hook).toContain("const hasContentFilters =");
  });

  it("keeps a Today row even when nothing is scheduled", () => {
    // The timeline scrolls to today on open, so the anchor has to exist.
    expect(hook).toContain("if (!groups.some(([key]) => key === todayKey))");
  });

  it("separates ordinary past crew history from older archived records", () => {
    expect(hook).toContain("eventArchivedAt: ev.archivedAt ?? null");
    expect(filters).toContain("Past events are already in List view.");
  });

  it("does not replace unavailable coverage with an empty crew", () => {
    expect(hook).not.toContain(".catch(() => ({ rows: [], truncated: false }))");
  });
});
