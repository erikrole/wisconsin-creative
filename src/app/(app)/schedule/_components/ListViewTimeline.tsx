"use client";

import { useRef, useEffect, useSyncExternalStore } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A reload should put the reader back on the event they were looking at, not
 * at a pixel offset from a previous document height.
 *
 * Raw window.scrollY is poisoned by the error boundary, the loading skeleton,
 * and the first paint at the archive floor. Restoring 0 then lets the past
 * sentinel walk the timeline back to May before today can claim the view.
 */
export const SCROLL_KEY = "schedule:timeline-scroll";

export const HISTORY_SCROLL_KEY = "scheduleTimelineScroll";

export const HISTORY_RETURN_KEY = "schedule:timeline-history-return";

export function isScheduleReload(): boolean {
  if (typeof performance === "undefined") return false;
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (entry?.type !== "reload") return false;
  try {
    return new URL(entry.name).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

// Zero is a position, not a missing value: the top of the timeline is where the
// archive floor lives, and treating it as "nothing stored" sent a reader who
// refreshed up there straight to today.
export function storedScroll(): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(SCROLL_KEY);
    if (stored === null) return null;
    const raw = Number(stored);
    return stored.trim() !== "" && Number.isFinite(raw) && raw >= 0 ? raw : null;
  } catch {
    return null;
  }
}

export function storedHistoryScroll(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.history.state?.[HISTORY_SCROLL_KEY];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

export function hasScheduleHistoryReturn(): boolean {
  try {
    return typeof sessionStorage !== "undefined"
      && sessionStorage.getItem(HISTORY_RETURN_KEY) === "1";
  } catch {
    return false;
  }
}

export function useDesktopScheduleList() {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(min-width: 1024px)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

function TimelineSentinel({
  label,
  disabled,
  onVisible,
}: {
  label: string;
  disabled: boolean;
  onVisible: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || disabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisible();
      },
      { rootMargin: "240px 0px 480px 0px", threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [disabled, onVisible]);
  return <div ref={ref} aria-hidden className="h-px" data-schedule-scroll-sentinel={label} />;
}

/**
 * The top edge of the timeline.
 *
 * Events older than four months are soft-archived, so scrolling up runs out
 * well before the beginning of records. Saying so -- and offering the way
 * through -- beats a list that just stops for no visible reason.
 */
export function TimelineStart({
  truncated,
  includeArchived,
  hasContentFilters,
  hasMorePast,
  loadingPast,
  loadPastError,
  allowOlderFetch,
  onLoadArchived,
  onLoadOlder,
}: {
  truncated: boolean;
  includeArchived: boolean;
  hasContentFilters: boolean;
  hasMorePast: boolean;
  loadingPast: boolean;
  loadPastError: boolean;
  allowOlderFetch: boolean;
  onLoadArchived: () => void;
  onLoadOlder: () => void;
}) {
  if (truncated && !hasMorePast) {
    return (
      <div className="flex flex-col items-center gap-1 border-b border-border/50 bg-muted/10 px-3 py-4 text-center">
        <span className="text-xs font-medium text-[var(--orange-text)]">
          Showing a limited stretch of the schedule
        </span>
        <span className="text-[11px] text-muted-foreground">
          Filter by sport to narrow the window, or scroll to load the next stretch.
        </span>
      </div>
    );
  }

  if (hasMorePast || loadingPast || loadPastError) {
    return (
      <div className="flex flex-col items-center gap-2 border-b border-border/50 bg-muted/10 px-3 py-3 text-center">
        <TimelineSentinel
          label="past"
          disabled={!allowOlderFetch || loadingPast || loadPastError}
          onVisible={onLoadOlder}
        />
        {loadPastError ? (
          <>
            <span className="text-[11px] text-muted-foreground">Could not load older events.</span>
            <Button variant="outline" className="h-10 text-xs" onClick={onLoadOlder}>
              Try again
            </Button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
            {loadingPast && <LoaderCircleIcon className="size-3 animate-spin" />}
            {loadingPast ? "Loading older events" : "Scroll for older events"}
          </span>
        )}
      </div>
    );
  }

  if (hasContentFilters) return null;

  return (
    <div className="flex flex-col items-center gap-2 border-b border-border/50 bg-muted/10 px-3 py-4 text-center">
      <span className="text-[11px] text-muted-foreground">
        {includeArchived ? "Beginning of records" : "Older records are archived"}
      </span>
      {!includeArchived && (
        <Button variant="outline" className="h-10 text-xs" onClick={onLoadArchived}>
          Load older records
        </Button>
      )}
    </div>
  );
}

export function TimelineEnd({
  hasMoreFuture,
  loadingFuture,
  loadFutureError,
  onLoadNewer,
}: {
  hasMoreFuture: boolean;
  loadingFuture: boolean;
  loadFutureError: boolean;
  onLoadNewer: () => void;
}) {
  if (!hasMoreFuture && !loadingFuture && !loadFutureError) {
    return (
      <div className="flex flex-col items-center gap-1 px-3 py-4 text-center">
        <span className="text-[11px] text-muted-foreground">End of scheduled events</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 px-3 py-3 text-center">
      <TimelineSentinel label="future" disabled={loadingFuture || loadFutureError} onVisible={onLoadNewer} />
      {loadFutureError ? (
        <>
          <span className="text-[11px] text-muted-foreground">Could not load later events.</span>
          <Button variant="outline" className="h-10 text-xs" onClick={onLoadNewer}>
            Try again
          </Button>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
          {loadingFuture && <LoaderCircleIcon className="size-3 animate-spin" />}
          {loadingFuture ? "Loading later events" : "Scroll for later events"}
        </span>
      )}
    </div>
  );
}
