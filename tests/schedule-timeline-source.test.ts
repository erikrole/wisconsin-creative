import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

const hook = source("src/hooks/use-schedule-data.ts");
const filters = source("src/app/(app)/schedule/_components/ScheduleFilters.tsx");
const listView = source("src/app/(app)/schedule/_components/ListView.tsx");
const page = source("src/app/(app)/schedule/page.tsx");
const appShell = source("src/components/AppShell.tsx");

describe("schedule timeline", () => {
  it("reads one continuous window instead of an upcoming-only page", () => {
    expect(hook).toContain('evParams.set("includePast", "true")');
    // The scope toggle is gone: past is a direction you scroll, not a mode.
    expect(hook).not.toContain("timeScope");
    expect(filters).not.toContain("timeScope");
    expect(listView).not.toContain("timeScope");
  });

  it("loads the whole window up front so client-side filters stay honest", () => {
    // Area, coverage, and my-shifts filter loaded rows. Loading on scroll would
    // make a filtered list look empty until the reader scrolled far enough.
    expect(hook).toContain("async function fetchAllPages");
    expect(hook).toContain("const PAGE_SIZE = 200");
    expect(hook).toContain("const MAX_PAGES =");
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
    expect(listView).toContain("Showing the most recent events only");
  });

  it("holds the reading position instead of yanking it back to today", () => {
    // Background refetch and filter changes both re-run the anchor effects.
    expect(listView).toContain("readerOwnsScrollRef");
    expect(listView).toContain("if (readerOwnsScrollRef.current || pendingArchiveScrollRef.current !== null) return;");
  });

  it("claims scroll ownership from input events, not the scroll event itself", () => {
    // A plain `scroll` listener also fires for the anchor's own programmatic
    // scroll, which raced the settle pass and left today mispositioned.
    expect(listView).toContain('["wheel", "touchstart", "keydown", "mousedown"]');
  });

  it("re-anchors on layout change rather than for a fixed stretch of time", () => {
    // A deadline expired before the readiness cards rendered, leaving today
    // roughly 38px below the frame on a fresh load.
    expect(listView).toContain("const observer = new ResizeObserver(keepAnchored);");
    expect(listView).toContain("Math.abs(el.getBoundingClientRect().top - stickyBottom()) > 2");
  });

  it("holds the reader's position across a refresh", () => {
    // The browser's own restore lands after the async list renders, so the
    // anchor had already snapped the page up to today before it arrived.
    expect(listView).toContain('const SCROLL_KEY = "schedule:timeline-scroll";');
    expect(listView).toContain("function isScheduleReload()");
    expect(listView).toContain("const reload = isScheduleReload();");
    expect(listView).toContain("? storedScroll()");
    // The list renders in stages, so one pass is not enough: bailing out when
    // the document was still short dropped the restore and left the reader at
    // the top of the timeline.
    expect(listView).toContain("const observer = new ResizeObserver(apply);");
    expect(listView).toContain("if (target <= max) pendingRestoreRef.current = null;");
    // Native restoration lands later than the async timeline and otherwise
    // overrides the custom restore after it appears to have succeeded.
    expect(listView).toContain('window.history.scrollRestoration = "manual";');
    expect(listView).toContain("window.history.scrollRestoration = previous;");
    // Persist an immediate refresh even if the throttled scroll write has not
    // reached its next animation frame yet.
    expect(listView).toContain('window.addEventListener("pagehide", write);');
    expect(listView).toContain('window.removeEventListener("pagehide", write);');
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

  it("never lets the archive restore and the today anchor fight", () => {
    // Asking for older history hands the position to the reader.
    expect(listView).toContain("const onLoadArchived = useCallback(() => {");
    expect(listView).toContain("readerOwnsScrollRef.current = true;\n    setIncludeArchived(true);");
  });

  it("pins the header and filters so the timeline runs beneath them", () => {
    expect(page).toContain('style={{ top: "var(--schedule-sticky-top, 0px)" }}');
    expect(page).toContain('--schedule-sticky-bottom');
    // Day headers stack below both sticky frames, and the anchor lands there too.
    expect(listView).toContain('style={{ top: "var(--schedule-sticky-bottom, 0px)" }}');
    expect(listView).toContain('scrollMarginTop: "var(--schedule-sticky-bottom, 0px)"');
  });

  it("keeps the Schedule frame below the app-shell header", () => {
    expect(appShell).toContain("data-app-shell-header");
    expect(appShell).toContain("sticky top-0 z-40");
    expect(appShell).toContain('data-app-shell-breadcrumb-frame={pathname === "/schedule" ? "" : undefined}');
    expect(appShell).toContain('"sticky top-12 z-[35]');
    expect(page).toContain("sticky z-30");
    expect(listView).toContain("sticky z-10");
    expect(page).toContain('[data-app-shell-header]');
    expect(page).toContain('[data-app-shell-breadcrumb-frame]');
    expect(page).toContain("+ Math.round(appShellBreadcrumb?.getBoundingClientRect().height ?? 0);");
    expect(page).toContain('document.documentElement.style.setProperty("--schedule-sticky-top"');
    expect(page).toContain('const bottom = top + Math.round(el.getBoundingClientRect().height);');
  });

  it("gives the pinned bar its own spacing instead of hugging the viewport", () => {
    // Flush against the top edge the title reads as clipped; CSS alone cannot
    // tell a sticky element it is currently stuck.
    expect(page).toContain("const [pinned, setPinned] = useState(false);");
    expect(page).toContain("setPinned(!entry?.isIntersecting)");
    expect(page).toContain("pt-4");
    expect(page).toContain("}, [pinned]);");
  });

  it("keeps the reader in place when archived events prepend above them", () => {
    expect(listView).toContain("pendingArchiveScrollRef");
    expect(listView).toContain("previousTimelineMetricsRef");
    expect(listView).toContain("if (includeArchived && !previousIncludeArchivedRef.current)");
    expect(listView).toContain("window.scrollTo({ top: height - anchorFromBottom");
    // A render before the older rows land must not spend the anchor.
    expect(listView).toContain("if (height - window.scrollY <= anchorFromBottom) return;");
    // The wider window is a new query key; the old rows stay on screen.
    expect(hook).toContain("placeholderData: keepPreviousData");
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

  it("names the archive floor and offers the way through it", () => {
    expect(listView).toContain("Earlier events are archived");
    expect(listView).toContain("Load archived events");
    expect(listView).toContain("Beginning of records");
  });

  it("offers a way back to today once it scrolls off", () => {
    expect(listView).toContain("Jump to today");
    expect(listView).toContain("IntersectionObserver");
  });

  it("does not let a coverage read failure empty the schedule", () => {
    expect(hook).toContain(".catch(() => ({ rows: [], truncated: false }))");
  });
});
