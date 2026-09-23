import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const hook = source("src/hooks/use-schedule-data.ts");
const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");
const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
const page = source("src/app/(app)/schedule/page.tsx");
const appShell = source("src/components/AppShell.tsx");
const timelinePosition = source("src/lib/schedule-timeline-position.ts");

describe("schedule timeline", () => {
  it("reads one continuous window instead of an upcoming-only page", () => {
    expect(hook).toContain('evParams.set("includePast", "true")');
    // The scope toggle is gone: past is a direction you scroll, not a mode.
    expect(hook).not.toContain("timeScope");
    expect(filters).not.toContain("timeScope");
    expect(listView).not.toContain("timeScope");
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
    expect(listView).toContain("data-schedule-scroll-sentinel");
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
    expect(listView).toContain("Showing a limited stretch of the schedule");
  });

  it("holds the reading position instead of yanking it back to today", () => {
    // Background refetch and filter changes both re-run the anchor effects.
    expect(listView).toContain("readerOwnsScrollRef");
    expect(listView).toContain("if (readerOwnsScrollRef.current) return;");
  });

  it("claims scroll ownership from input events, not the scroll event itself", () => {
    // A plain `scroll` listener also fires for the anchor's own programmatic
    // scroll, which raced the settle pass and left today mispositioned.
    expect(listView).toContain('["wheel", "touchstart", "keydown", "mousedown"]');
    expect(listView).toContain("input, textarea, select, [contenteditable='true']");
  });

  it("re-anchors on layout change rather than for a fixed stretch of time", () => {
    // A deadline expired before the readiness cards rendered, leaving today
    // roughly 38px below the frame on a fresh load.
    expect(listView).toContain("const observer = new ResizeObserver(keepAnchored);");
    expect(listView).toContain("Math.abs(el.getBoundingClientRect().top - stickyBottom()) > 2");
  });

  it("opens on today after a refresh", () => {
    // A leftover filter snapshot or the topmost event from the previous
    // viewport claimed the list, then older rows prepended and the reader
    // landed a week above today. Refresh is the timeline home; back keeps place.
    expect(listView).toContain("function isScheduleReload()");
    expect(listView).toContain("const reload = isScheduleReload();");
    expect(listView).toContain("if (isScheduleReload()) {");
    expect(listView).toContain("discardScheduleTimelineReadingPosition();");
    expect(listView).toContain("if (anchorToday()) didAnchorRef.current = true;");
    expect(listView).not.toContain("readScheduleTimelineReadingPosition");
    expect(listView).toContain('window.history.scrollRestoration = "manual";');
    expect(listView).toContain("window.history.scrollRestoration = previous;");
  });

  it("still opens a fresh visit on today rather than the stored position", () => {
    expect(listView).toContain("const historyRestore = fromHistory ? storedHistoryScroll() : null;");
    expect(listView).toContain("new URL(entry.name).pathname === window.location.pathname");
  });

  it("gives a back navigation its scroll position instead of today", () => {
    // Opening an event from last April and returning must not lose the reader
    // their place -- that is the review loop this list exists for.
    expect(listView).toContain("let arrivedByHistory = false;");
    expect(listView).toContain('window.addEventListener("popstate"');
    expect(listView).toContain('const HISTORY_SCROLL_KEY = "scheduleTimelineScroll";');
    expect(listView).toContain('const HISTORY_RETURN_KEY = "schedule:timeline-history-return";');
    expect(listView).toContain("const fromHistory = !reload && (arrivedByHistory || hasScheduleHistoryReturn());");
    expect(listView).toContain("const historyRestore = fromHistory ? storedHistoryScroll() : null;");
    expect(listView).toContain("sessionStorage.removeItem(HISTORY_RETURN_KEY);");
    expect(listView).toContain("? historyRestore ?? storedScroll()");
    expect(listView).toContain("const captureEventNavigation = (event: MouseEvent) => {");
    expect(listView).toContain("window.history.replaceState(");
    expect(listView).toContain("navigatingToEvent = true;");
  });

  it("uses a logical visible-event anchor for filters and view round trips", () => {
    expect(hook).toContain("captureScheduleTimelinePosition");
    expect(hook).toContain('if (viewMode === "list") captureScheduleTimelinePosition();');
    expect(listView).toContain("readScheduleTimelinePosition");
    expect(timelinePosition).not.toContain("sessionStorage.removeItem(TIMELINE_TRANSITION_KEY);\n  try {");
    expect(listView).toContain("restoreScheduleTimelinePosition");
    expect(listView).toContain("data-schedule-event-id={entry.id}");
    expect(listView).toContain("data-schedule-day={groupDate.getTime()}");
    expect(timelinePosition).toContain("chooseScheduleTimelineTarget");
    expect(timelinePosition).toContain("availableEventIds.has(event.id)");
  });

  it("pins the header, filters, and activity strip so the timeline runs beneath them", () => {
    expect(page).toContain('style={{ top: "var(--schedule-sticky-top, 0px)" }}');
    expect(page).toContain('--schedule-sticky-bottom');
    expect(page).toContain("data-schedule-sticky-frame");
    const stickyStart = page.indexOf("data-schedule-sticky-frame");
    const listStart = page.indexOf("{canDisplaySchedule && data.filters.viewMode === \"calendar\"");
    expect(page.indexOf("<ScheduleFilters", stickyStart)).toBeGreaterThan(stickyStart);
    expect(page.indexOf("<ScheduleReadiness", stickyStart)).toBeGreaterThan(stickyStart);
    expect(page.indexOf("<ScheduleReadiness", stickyStart)).toBeLessThan(listStart);
    // Day headers stack below both sticky frames, and the anchor lands there too.
    expect(listView).toContain('style={{ top: "var(--schedule-sticky-bottom, 0px)" }}');
    expect(listView).toContain('scrollMarginTop: "var(--schedule-sticky-bottom, 0px)"');
  });

  it("keeps the Schedule frame below the app-shell header", () => {
    expect(appShell).toContain("data-app-shell-header");
    expect(appShell).toContain("sticky top-0 z-40");
    expect(appShell).toContain('data-app-shell-breadcrumb-frame={pathname === "/schedule" ? "" : undefined}');
    // Top-level Schedule hides breadcrumbs, so the command bar sits under the
    // 48px app header. The empty frame still exists for height measurement.
    expect(appShell).not.toContain('"sticky z-[35]');
    expect(page).toContain("sticky z-30");
    expect(listView).toContain("sticky z-10");
    expect(page).toContain('[data-app-shell-header]');
    expect(page).toContain('[data-app-shell-breadcrumb-frame]');
    expect(page).toContain("+ Math.round(appShellBreadcrumb?.getBoundingClientRect().height ?? 0);");
    expect(page).toContain('document.documentElement.style.setProperty("--schedule-sticky-top"');
    expect(page).toContain("const bottom = Math.round(el.getBoundingClientRect().bottom);");
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
    expect(listView).toContain("transitionAnchorRef");
    expect(listView).toContain("const observer = new ResizeObserver(apply);");
    expect(listView).toContain("prependSnapshotRef");
    // The wider window keeps the old rows, but view and sport changes do not.
    expect(hook).toContain("shouldKeepPreviousScheduleData(previousScope, scheduleScope)");
    expect(timelinePosition).toContain('previous.includeArchived === false');
    expect(timelinePosition).toContain('next.includeArchived === true');
  });

  it("does not delete the archive row by treating archived as a filter", () => {
    expect(hook).toContain("const hasContentFilters =");
    expect(listView).toContain("if (hasContentFilters) return null;");
  });

  it("keeps a Today row even when nothing is scheduled", () => {
    // The timeline scrolls to today on open, so the anchor has to exist.
    expect(hook).toContain("if (!groups.some(([key]) => key === todayKey))");
    expect(listView).toContain('{eventCount === 0 ? "No events"');
  });

  it("anchors to today before paint, once", () => {
    expect(listView).toContain("useLayoutEffect");
    expect(listView).toContain('behavior: "instant"');
    expect(listView).toContain("didAnchorRef");
  });

  it("retries the Today anchor when rows arrive after loading settles", () => {
    expect(listView).toContain("groupedEntries.length === 0");
    expect(listView).toContain("}, [groupedEntries, isTimeline, loading, anchorToday]);");
  });

  it("does not walk older history until the reader scrolls toward it", () => {
    expect(listView).toContain("allowOlderFetch");
    expect(listView).toContain("disabled={!allowOlderFetch || loadingPast || loadPastError}");
    expect(listView).toContain("setAllowOlderFetch(true)");
  });

  it("names the archive floor and offers the way through it", () => {
    expect(listView).toContain("Older records are archived");
    expect(listView).toContain("Load older records");
    expect(listView).toContain("Beginning of records");
  });

  it("offers a way back to today once it scrolls off", () => {
    expect(listView).toContain("Jump to today");
    expect(listView).toContain("todayDirection");
    expect(listView).toContain('window.addEventListener("scroll", schedule');
    expect(listView).toContain("const observer = new ResizeObserver(schedule);");
    expect(listView).toContain('[data-schedule-sticky-frame]');
    expect(listView).toContain("max-md:bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))]");
    expect(listView).toContain("bg-white");
    expect(listView).toContain("text-black");
  });

  it("separates ordinary past crew history from older archived records", () => {
    expect(hook).toContain("eventArchivedAt: ev.archivedAt ?? null");
    expect(filters).toContain("Past events are already in List view.");
    expect(listView).toContain("entry.eventArchivedAt");
    expect(listView).toContain("Past above · upcoming below");
  });

  it("does not replace unavailable coverage with an empty crew", () => {
    expect(hook).not.toContain(".catch(() => ({ rows: [], truncated: false }))");
  });
});
