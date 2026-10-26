import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ListView } from "@/app/(app)/schedule/_components/ListView";
import { captureScheduleTimelinePosition } from "@/lib/schedule-timeline-position";
import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import { groupByDay, scheduleRange } from "./schedule-entries";

// The real Schedule list with its timeline props driven by local state. The
// page frame copies what schedule/page.tsx provides: a sticky frame that
// publishes --schedule-sticky-bottom, inside #main-content.

const STICKY_HEIGHT = 120;

type Controls = {
  refresh: () => void;
  prependOlder: () => void;
  growAbove: (px: number) => void;
  roundTrip: () => void;
  olderRequests: number;
  setupRequests: string[];
  expandedPointer: string | null;
};

const params = new URLSearchParams(window.location.search);
/** Rows land after loading has already settled, as a slow crew fetch does. */
const lateRows = params.has("late");
/** The published sticky offset can lag the live frame while filter chips wrap. */
const publishedBottom = Number(params.get("published") ?? STICKY_HEIGHT);
const controls: Controls = {
  refresh: () => undefined, prependOlder: () => undefined, growAbove: () => undefined, roundTrip: () => undefined,
  olderRequests: 0, setupRequests: [], expandedPointer: null,
};
Object.assign(window, { schedule: controls });

/** Tomorrow's second event has no crew yet, so staff see the setup choices. */
function withoutCrew(entries: CalendarEntry[]) {
  return entries.map((entry) => entry.id === "ev-1-1" ? { ...entry, shiftGroupId: null, shifts: [], coverage: null } : entry);
}

function Harness() {
  const [oldest, setOldest] = useState(-14);
  const [version, setVersion] = useState(0);
  const [spacer, setSpacer] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [arrived, setArrived] = useState(!lateRows);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const entries = useMemo(() => {
    void version;
    return arrived ? withoutCrew(scheduleRange(oldest, 14)) : [];
  }, [arrived, oldest, version]);
  const grouped = useMemo(() => (arrived ? groupByDay(entries) : []), [arrived, entries]);

  useEffect(() => {
    document.documentElement.style.setProperty("--schedule-sticky-bottom", `${publishedBottom}px`);
    Object.assign(controls, {
      refresh: () => setVersion((v) => v + 1),
      prependOlder: () => setOldest((value) => value - 7),
      growAbove: (px: number) => setSpacer((value) => value + px),
      // A filter or view change captures the visible event, then the list remounts.
      roundTrip: () => {
        captureScheduleTimelinePosition();
        setMounted(false);
        setTimeout(() => setMounted(true), 50);
      },
    });
    if (lateRows) setTimeout(() => setArrived(true), 300);
    // Opening an event leaves the list; going back remounts it, as App Router does.
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href^="/events/"]');
      if (!link) return;
      event.preventDefault();
      window.history.pushState({}, "", link.getAttribute("href"));
      setMounted(false);
    };
    const back = () => setMounted(window.location.pathname === "/schedule");
    document.addEventListener("click", leave);
    window.addEventListener("popstate", back);
    return () => {
      document.removeEventListener("click", leave);
      window.removeEventListener("popstate", back);
    };
  }, []);

  return (
    <div id="main-content">
      <div data-schedule-sticky-frame className="sticky top-0 z-30 bg-background" style={{ height: STICKY_HEIGHT }}>
        <h1>Schedule</h1>
        <div data-schedule-view-controls>
          <button type="button" onClick={() => controls.roundTrip()}>Week</button>
        </div>
      </div>
      <div style={{ height: spacer }} data-testid="late-content" />
      {mounted && (
        <ListView
          entries={entries}
          filteredEntries={entries}
          groupedEntries={grouped}
          loading={false}
          refreshing={false}
          loadError={false}
          loadData={() => undefined}
          myShiftsOnly={false}
          setMyShiftsOnly={() => undefined}
          clearFilters={() => undefined}
          hasFilters={false}
          timelineTruncated={false}
          isTimeline
          hasMorePast
          hasMoreFuture={false}
          loadingPast={false}
          loadingFuture={false}
          loadPastError={false}
          loadFutureError={false}
          onLoadOlder={() => { controls.olderRequests += 1; }}
          onLoadNewer={() => undefined}
          fillingWindow={false}
          hasContentFilters={false}
          includeArchived={false}
          setIncludeArchived={() => undefined}
          activeQueueMeta={null}
          clearQueue={() => undefined}
          currentUserId="u-viewer"
          isStaff
          expandedRowId={expandedRowId}
          setExpandedRowId={(id) => { controls.expandedPointer = id; setExpandedRowId(id); }}
          onSelectGroup={() => undefined}
          onHideEvent={() => undefined}
          onSetupCrew={(eventId, side) => { controls.setupRequests.push(`${eventId}:${side}`); }}
          onQuickManageCrew={() => undefined}
        />
      )}
    </div>
  );
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <TooltipProvider>
      <ConfirmProvider>
        <Harness />
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  </QueryClientProvider>,
);
