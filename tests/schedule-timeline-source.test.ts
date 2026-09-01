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
const timelinePosition = source("src/lib/schedule-timeline-position.ts");

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
    expect(listView).toContain("if (readerOwnsScrollRef.current) return;");
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

  it("pins the header and filters so the timeline runs beneath them", () => {
    expect(page).toContain('style={{ top: "var(--schedule-sticky-top, 0px)" }}');
    expect(page).toContain('--schedule-sticky-bottom');
    expect(page).toContain("data-schedule-sticky-frame");
    // Day headers stack below both sticky frames, and the anchor lands there too.
    expect(listView).toContain('style={{ top: "var(--schedule-sticky-bottom, 0px)" }}');
    expect(listView).toContain('scrollMarginTop: "var(--schedule-sticky-bottom, 0px)"');
  });

  it("keeps the Schedule frame below the app-shell header", () => {
    expect(appShell).toContain("data-app-shell-header");
    expect(appShell).toContain("sticky top-0 z-40");
    expect(appShell).toContain('data-app-shell-breadcrumb-frame={pathname === "/schedule" ? "" : undefined}');
    // The frame's offset moved onto its own clause so the role-preview banner
    // can push it down; the default is still flush under the 48px header.
    expect(appShell).toContain('"sticky z-[35]');
    expect(appShell).toContain('isRolePreview ? "top-[5.5rem]" : "top-12"');
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
    expect(listView).toContain("transitionAnchorRef");
    expect(listView).toContain("const observer = new ResizeObserver(apply);");
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
  });

  it("separates ordinary past crew history from older archived records", () => {
    expect(hook).toContain("eventArchivedAt: ev.archivedAt ?? null");
    expect(filters).toContain("Past events are already in List view.");
    expect(listView).toContain("entry.eventArchivedAt");
    expect(listView).toContain("Past above · upcoming below");
  });

  it("does not let a coverage read failure empty the schedule", () => {
    expect(hook).toContain(".catch(() => ({ rows: [], truncated: false }))");
  });
});
