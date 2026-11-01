"use client";

import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { toast } from "@/lib/toast";
import EmptyState from "@/components/EmptyState";
import { formatDateShort, formatTimeShort } from "@/lib/format";
import { formatCalendarEventDateRange, eventSpansMultipleDays } from "@/lib/calendar-event-dates";
import { sportDotColor } from "@/lib/sport-color";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ConfirmDialog";
import { PostTradeDialog, type PostTradeShiftSummary } from "@/components/trade-board/PostTradeDialog";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import type { CalendarEntry } from "./types";
import { WorkingCrewEditor, type WorkingCrewEntry } from "./WorkingCrewEditor";
import type { ScheduleQueueMeta } from "@/lib/schedule-queues";
import {
  discardScheduleTimelinePosition,
  discardScheduleTimelineReadingPosition,
  readScheduleTimelinePosition,
  rememberScheduleTimelineReadingPosition,
  restoreScheduleTimelinePosition,
  type ScheduleTimelineSnapshot,
} from "@/lib/schedule-timeline-position";
import { AREA_LABELS, scheduleEventTitleParts, userHasShift, userShiftStatus } from "./types";
import { CoverageBadge } from "./Coverage";
import { CrewRowActions, CrewSummary, DateGroupHeader, ShiftRowList } from "./ListViewCrewRows";
import { EventGrid, EventListSkeleton } from "./ListViewGrid";
import {
  HISTORY_RETURN_KEY,
  HISTORY_SCROLL_KEY,
  SCROLL_KEY,
  TimelineEnd,
  TimelineStart,
  hasScheduleHistoryReturn,
  isScheduleReload,
  storedHistoryScroll,
  storedScroll,
  useDesktopScheduleList,
} from "./ListViewTimeline";
import { eventStartLabel } from "./list-view-helpers";
import { EntryPendingReview } from "./EntryPendingReview";
import { EventRows } from "./ListViewEventRows";

export type CrewTemplateSide = "HOME" | "AWAY" | "EMPTY";

type ListViewProps = {
  entries: CalendarEntry[];
  filteredEntries: CalendarEntry[];
  groupedEntries: [string, CalendarEntry[]][];
  loading: boolean;
  refreshing: boolean;
  loadError: false | "network" | "server";
  loadData: () => void | Promise<void>;
  myShiftsOnly: boolean;
  setMyShiftsOnly: (v: boolean) => void;
  clearFilters: () => void;
  hasFilters: boolean;
  /** The window hit its page cap, so some events were not loaded. */
  timelineTruncated: boolean;
  /** The list is the continuous today-anchored timeline. */
  isTimeline: boolean;
  hasMorePast: boolean;
  hasMoreFuture: boolean;
  loadingPast: boolean;
  loadingFuture: boolean;
  loadPastError: boolean;
  loadFutureError: boolean;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  fillingWindow: boolean;
  /** A filter is narrowing which events appear, not how far back the window reaches. */
  hasContentFilters: boolean;
  includeArchived: boolean;
  setIncludeArchived: (v: boolean) => void;
  activeQueueMeta: ScheduleQueueMeta | null;
  clearQueue: () => void;
  currentUserId: string;
  isStaff: boolean;
  canReviewClaims?: boolean;
  expandedRowId: string | null;
  setExpandedRowId: (id: string | null) => void;
  onSelectGroup: (groupId: string | null) => void;
  hidingEventIds?: Set<string>;
  onHideEvent?: (eventId: string) => void;
  onSetupCrew?: (eventId: string, templateSide: CrewTemplateSide) => void;
  onQuickManageCrew?: (eventId: string) => void;
  settingUpEventIds?: Set<string>;
};

/**
 * Whether the reader arrived here by going back.
 *
 * Module scope on purpose: a back navigation remounts the list, so a flag held
 * in component state would be gone by the time the anchor runs. The async
 * timeline restores the offset saved on its history entry; opening an event
 * from last April and returning to today would otherwise lose the reader's
 * place in exactly the review workflow this list exists for.
 */
let arrivedByHistory = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (window.location.pathname !== "/schedule") return;
    arrivedByHistory = true;
    try { sessionStorage.setItem(HISTORY_RETURN_KEY, "1"); } catch { /* Storage is optional. */ }
  });
}

export function ListView({
  entries,
  filteredEntries,
  groupedEntries,
  loading,
  refreshing,
  loadError,
  loadData,
  myShiftsOnly,
  setMyShiftsOnly,
  clearFilters,
  hasFilters,
  timelineTruncated,
  isTimeline,
  hasMorePast,
  hasMoreFuture,
  loadingPast,
  loadingFuture,
  loadPastError,
  loadFutureError,
  onLoadOlder,
  onLoadNewer,
  fillingWindow,
  hasContentFilters,
  includeArchived,
  setIncludeArchived,
  activeQueueMeta,
  clearQueue,
  currentUserId,
  isStaff,
  canReviewClaims = false,
  expandedRowId,
  setExpandedRowId,
  onSelectGroup,
  hidingEventIds,
  onHideEvent,
  onSetupCrew,
  onQuickManageCrew,
  settingUpEventIds,
}: ListViewProps) {
  const confirm = useConfirm();
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() =>
    expandedRowId ? new Set([expandedRowId]) : new Set(),
  );
  // A newly requested row opens alongside whatever is already expanded.
  const [seenExpandedRowId, setSeenExpandedRowId] = useState(expandedRowId);
  if (seenExpandedRowId !== expandedRowId) {
    setSeenExpandedRowId(expandedRowId);
    if (expandedRowId) setExpandedRowIds((current) => new Set(current).add(expandedRowId));
  }

  const toggleExpandedRow = useCallback((entryId: string) => {
    setExpandedRowIds((current) => {
      const isOpen = current.has(entryId);
      const next = new Set(current);
      if (isOpen) next.delete(entryId);
      else next.add(entryId);
      if (isOpen) {
        if (expandedRowId === entryId) setExpandedRowId(null);
      } else {
        setExpandedRowId(entryId);
      }
      return next;
    });
  }, [expandedRowId, setExpandedRowId]);

  /**
   * Open on today.
   *
   * The list is one continuous timeline with the past above today, so without
   * this it would open at its oldest row. Positioning runs in a layout effect --
   * before paint -- so the page appears already at today instead of visibly
   * scrolling there.
   */
  const desktopTodayGroupRef = useRef<HTMLDivElement>(null);
  const mobileTodayGroupRef = useRef<HTMLDivElement>(null);
  const didAnchorRef = useRef(false);
  /**
   * Set the moment the reader moves the page themselves, and never cleared.
   *
   * Every automatic scroll is gated on it. Without it the schedule's own
   * background refetch -- or applying a filter -- would re-run the anchor and
   * yank someone back to today mid-read.
   */
  const readerOwnsScrollRef = useRef(false);
  const transitionAnchorRef = useRef<ScheduleTimelineSnapshot | null>(null);
  const [todayOffscreen, setTodayOffscreen] = useState(false);
  const [todayDirection, setTodayDirection] = useState<"up" | "down">("up");
  const [allowOlderFetch, setAllowOlderFetch] = useState(false);

  /**
   * A filter or List -> other view -> List round trip is not a fresh visit.
   * Restore the visible event (or nearest surviving day) before the ordinary
   * Today anchor gets a chance to claim this render.
   */
  useLayoutEffect(() => {
    if (!isTimeline || loading) return;
    // A refresh is a new visit to the timeline home. Stale filter-transition
    // snapshots must not claim the list before Today can.
    if (isScheduleReload()) {
      discardScheduleTimelinePosition();
      discardScheduleTimelineReadingPosition();
      return;
    }
    // Keep the snapshot in session storage while the matching URL update
    // settles. App Router can remount this list after the first restoration;
    // a one-shot read lets that second mount fall through to the ordinary
    // Today anchor. The next real reader input clears the transition.
    const pending = readScheduleTimelinePosition();
    if (!pending) return;
    transitionAnchorRef.current = pending;
    didAnchorRef.current = true;
    readerOwnsScrollRef.current = true;
  }, [groupedEntries, isTimeline, loading]);

  useLayoutEffect(() => {
    if (!isTimeline || (!arrivedByHistory && !hasScheduleHistoryReturn() && !isScheduleReload())) return;
    const previous = window.history.scrollRestoration;
    // The timeline owns reload and history restoration because its
    // asynchronous height makes the browser's delayed native restore race our
    // stored offset. Other Schedule arrivals keep normal browser behavior.
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, [isTimeline]);

  /** The measured bottom edge of the app-shell and Schedule sticky frames. */
  const stickyBottom = useCallback(() => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--schedule-sticky-bottom")
      .trim();
    const publishedBottom = Number.parseInt(raw, 10) || 0;
    const liveBottom = document
      .querySelector<HTMLElement>("[data-schedule-sticky-frame]")
      ?.getBoundingClientRect().bottom ?? 0;
    return Math.max(publishedBottom, liveBottom);
  }, []);

  const todayGroupEl = useCallback(() => (
    window.matchMedia("(max-width: 1023px)").matches
      ? mobileTodayGroupRef.current
      : desktopTodayGroupRef.current
  ), []);
  const anchorToday = useCallback(() => {
    const el = todayGroupEl();
    if (!el) return false;
    el.scrollIntoView({ block: "start", behavior: "instant" });
    return true;
  }, [todayGroupEl]);
  const desktopList = useDesktopScheduleList();
  const firstEventId = filteredEntries[0]?.id ?? null;
  const prependSnapshotRef = useRef<{ firstId: string | null; height: number; y: number }>({
    firstId: null,
    height: 0,
    y: 0,
  });
  const prependRestore = (() => {
    if (typeof window === "undefined") return null;
    const snapshot = prependSnapshotRef.current;
    if (!snapshot.firstId || !firstEventId || snapshot.firstId === firstEventId) return null;
    if (!filteredEntries.some((entry) => entry.id === snapshot.firstId)) return null;
    return { height: snapshot.height, y: snapshot.y };
  })();

  useLayoutEffect(() => {
    if (prependRestore) {
      const delta = document.documentElement.scrollHeight - prependRestore.height;
      if (delta) window.scrollTo({ top: prependRestore.y + delta, behavior: "instant" });
    }
    prependSnapshotRef.current = {
      firstId: firstEventId,
      height: document.documentElement.scrollHeight,
      y: window.scrollY,
    };
    if (!readerOwnsScrollRef.current && didAnchorRef.current) {
      anchorToday();
    }
  }, [anchorToday, firstEventId, groupedEntries, prependRestore]);

  // The snapshot above is only taken when the rows change, so without this it
  // still held the offset from before the reader scrolled, and the next prepend
  // threw them to `stale offset + added height` instead of keeping their place.
  useEffect(() => {
    const track = () => {
      prependSnapshotRef.current = {
        ...prependSnapshotRef.current,
        height: document.documentElement.scrollHeight,
        y: window.scrollY,
      };
    };
    window.addEventListener("scroll", track, { passive: true });
    const observer = new ResizeObserver(track);
    observer.observe(document.getElementById("main-content") ?? document.body);
    return () => {
      window.removeEventListener("scroll", track);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isTimeline) return;
    const claim = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element
        && target.closest("input, textarea, select, [contenteditable='true']")
      ) return;
      readerOwnsScrollRef.current = true;
      didAnchorRef.current = true;
      setAllowOlderFetch(true);
      pendingRestoreRef.current = null;
      transitionAnchorRef.current = null;
      if (
        event.type === "mousedown"
        && target instanceof Element
        && target.closest("[data-schedule-view-controls]")
      ) return;
      discardScheduleTimelinePosition();
    };
    // Input events only. A plain `scroll` listener also fires for the anchor's
    // own programmatic scroll, which raced the settle pass below and left today
    // sitting wherever late-rendering content had pushed it.
    const events: Array<keyof WindowEventMap> = ["wheel", "touchstart", "keydown", "mousedown"];
    for (const name of events) {
      window.addEventListener(name, claim, { passive: true });
    }
    return () => {
      for (const name of events) window.removeEventListener(name, claim);
    };
  }, [isTimeline]);

  useEffect(() => {
    if (!isTimeline || loading) return;
    let timeoutId: number | null = null;
    const remember = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      // Focus management for the sticky view control can move the document a
      // moment before its change event. Keep the last settled reading position
      // separately so that movement cannot replace the date the reader chose.
      timeoutId = window.setTimeout(rememberScheduleTimelineReadingPosition, 160);
    };
    const frameId = window.requestAnimationFrame(remember);
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", remember);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [groupedEntries, isTimeline, loading]);

  /** Where a reload should land, held until the list is tall enough to get there. */
  const pendingRestoreRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    // Loading can settle before the filtered rows commit their today ref. Keep
    // the anchor retryable when the grouped timeline changes so the list cannot
    // remain parked at the archive floor after its data arrives.
    if (!isTimeline || didAnchorRef.current || loading || groupedEntries.length === 0) return;
    if (readerOwnsScrollRef.current) return;
    const reload = isScheduleReload();
    const fromHistory = !reload && (arrivedByHistory || hasScheduleHistoryReturn());
    const historyRestore = fromHistory ? storedHistoryScroll() : null;
    arrivedByHistory = false;
    try { sessionStorage.removeItem(HISTORY_RETURN_KEY); } catch { /* Storage is optional. */ }
    if (reload) {
      // Refresh is the timeline home, not a scroll restore. Restoring the
      // topmost visible event from the previous viewport put Sep 11 under the
      // frame, then older rows prepended and the reader landed in the prior week.
      if (anchorToday()) didAnchorRef.current = true;
      return;
    }
    const restore = fromHistory
      ? historyRestore ?? storedScroll()
      : null;
    if (restore !== null) {
      didAnchorRef.current = true;
      readerOwnsScrollRef.current = true;
      pendingRestoreRef.current = restore;
      return;
    }
    if (fromHistory) {
      // No stored offset is available, so leave this history entry to the
      // browser and keep the today settle pass from competing with it.
      didAnchorRef.current = true;
      readerOwnsScrollRef.current = true;
      return;
    }
    if (anchorToday()) didAnchorRef.current = true;
  }, [groupedEntries, isTimeline, loading, anchorToday]);

  /**
   * Hold the anchor while the page settles.
   *
   * The readiness cards, avatars, and coverage badges above and inside the list
   * all render after the first paint and push today down. This watches for the
   * layout actually changing rather than re-checking for a fixed stretch of
   * time -- a deadline was expiring before the readiness row arrived, leaving
   * today ~38px below the frame.
   *
   * There is no time limit because there does not need to be: the moment the
   * reader touches the page the anchor stands down for good, so the only thing
   * this can correct is content moving under a reader who has not moved.
   */
  useEffect(() => {
    if (!isTimeline || !didAnchorRef.current) return;

    const keepAnchored = () => {
      if (readerOwnsScrollRef.current) return;
      const el = todayGroupEl();
      if (!el) return;
      if (Math.abs(el.getBoundingClientRect().top - stickyBottom()) > 2) anchorToday();
    };

    const observed = document.getElementById("main-content") ?? document.body;
    const observer = new ResizeObserver(keepAnchored);
    observer.observe(observed);
    const stickyFrame = document.querySelector<HTMLElement>("[data-schedule-sticky-frame]");
    if (stickyFrame) observer.observe(stickyFrame);
    const frame = requestAnimationFrame(keepAnchored);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [isTimeline, groupedEntries, todayGroupEl, anchorToday, stickyBottom]);

  // Keep a logical transition anchor active while asynchronous rows, readiness,
  // avatars, and the sticky frame settle. The next user input releases it.
  useEffect(() => {
    if (!isTimeline || loading || !transitionAnchorRef.current) return;
    const apply = () => {
      const snapshot = transitionAnchorRef.current;
      if (snapshot) restoreScheduleTimelinePosition(snapshot);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(document.getElementById("main-content") ?? document.body);
    const stickyFrame = document.querySelector<HTMLElement>("[data-schedule-sticky-frame]");
    if (stickyFrame) observer.observe(stickyFrame);
    const frame = requestAnimationFrame(apply);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [groupedEntries, isTimeline, loading]);

  // Drives the jump-back control from the live measured sticky boundary. A
  // fixed IntersectionObserver root margin went stale when active chips wrapped
  // the Schedule frame onto another row.
  useEffect(() => {
    if (!isTimeline) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = todayGroupEl();
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const boundary = stickyBottom();
      const offscreen = rect.bottom <= boundary || rect.top >= window.innerHeight;
      setTodayOffscreen(offscreen);
      if (offscreen) setTodayDirection(rect.top < boundary ? "up" : "down");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.getElementById("main-content") ?? document.body);
    const stickyFrame = document.querySelector<HTMLElement>("[data-schedule-sticky-frame]");
    if (stickyFrame) observer.observe(stickyFrame);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [groupedEntries, isTimeline, stickyBottom, todayGroupEl]);

  /**
   * Reaching for older history is the reader taking the wheel: from here the
   * position is theirs, and today must not pull them back.
   */
  const onLoadArchived = useCallback(() => {
    readerOwnsScrollRef.current = true;
    setIncludeArchived(true);
  }, [setIncludeArchived]);

  const keepTimelineWhileLoadingMore = Boolean(
    isTimeline && (
      fillingWindow
      || hasMorePast
      || hasMoreFuture
      || loadingPast
      || loadingFuture
      || (!hasContentFilters && entries.length > 0)
    ),
  );
  const showEmptyState = filteredEntries.length === 0 && !keepTimelineWhileLoadingMore;

  // Throttled to one write per frame: this runs on every scroll event.
  useEffect(() => {
    if (!isTimeline || typeof sessionStorage === "undefined") return;
    let frame: number | null = null;
    let navigatingToEvent = false;
    const write = () => {
      if (navigatingToEvent) return;
      try {
        sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY)));
      } catch { /* A blocked/full store must not break scrolling. */ }
    };
    const record = () => {
      if (frame !== null || navigatingToEvent) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (navigatingToEvent) return;
        write();
      });
    };
    const captureEventNavigation = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>('a[href^="/events/"]');
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      // Next replaces the route before this component unmounts and can emit an
      // outgoing scroll while the Schedule DOM collapses. Freeze the reader's
      // click position on both storage and this history entry before that
      // transition can overwrite it.
      write();
      try {
        window.history.replaceState(
          { ...(window.history.state ?? {}), [HISTORY_SCROLL_KEY]: Math.round(window.scrollY) },
          "",
        );
      } catch { /* Session storage remains the fallback if history is unavailable. */ }
      navigatingToEvent = true;
    };
    window.addEventListener("scroll", record, { passive: true });
    document.addEventListener("click", captureEventNavigation, true);
    // A reload can begin before the last animation-frame write runs. pagehide
    // is the last reliable synchronous chance to persist the visible offset.
    window.addEventListener("pagehide", write);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", record);
      document.removeEventListener("click", captureEventNavigation, true);
      window.removeEventListener("pagehide", write);
    };
  }, [isTimeline]);

  /**
   * Apply a pending reload restore, and keep applying it as the list grows.
   *
   * A single pass was not enough: the list renders in stages, so on the pass
   * where the restore was requested the document was often still too short to
   * reach the old offset. Bailing out then dropped the restore entirely and left
   * the reader sitting at the top of the timeline -- the "refresh snaps back up"
   * report. This re-applies on every layout change and only considers itself
   * finished once the target is reachable without being clamped.
   */
  useEffect(() => {
    const apply = () => {
      const target = pendingRestoreRef.current;
      if (target === null) return;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (max === 0) return;
      const top = Math.min(target, max);
      if (Math.abs(window.scrollY - top) > 2) {
        window.scrollTo({ top, behavior: "instant" });
      }
      if (target <= max) pendingRestoreRef.current = null;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(document.getElementById("main-content") ?? document.body);
    return () => observer.disconnect();
  }, [groupedEntries, loading]);

  const scrollToToday = useCallback(() => {
    readerOwnsScrollRef.current = true;
    didAnchorRef.current = true;
    pendingRestoreRef.current = null;
    transitionAnchorRef.current = null;
    discardScheduleTimelinePosition();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    todayGroupEl()?.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
  }, [todayGroupEl]);

  const [postingTradeId, setPostingTradeId] = useState<string | null>(null);
  const postingTradeRef = useRef<string | null>(null);
  const [cancelingTradeId, setCancelingTradeId] = useState<string | null>(null);
  const cancelingTradeRef = useRef<string | null>(null);
  const [tradeDialogAssignmentId, setTradeDialogAssignmentId] = useState<string | null>(null);
  const [tradeNotes, setTradeNotes] = useState("");
  const [tradeError, setTradeError] = useState<string | null>(null);

  const tradeDialogShift = useMemo<PostTradeShiftSummary | null>(() => {
    if (!tradeDialogAssignmentId) return null;
    for (const entry of entries) {
      for (const shift of entry.shifts) {
        const assignment = shift.assignments.find((item) => item.id === tradeDialogAssignmentId);
        if (!assignment) continue;
        const start = assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt;
        const parts = scheduleEventTitleParts(entry);
        return {
          title: parts.detail ? `${parts.title} · ${parts.detail}` : parts.title,
          when: `${formatDateShort(start)}, ${formatTimeShort(start)}`,
          area: AREA_LABELS[shift.area] ?? shift.area,
        };
      }
    }
    return null;
  }, [entries, tradeDialogAssignmentId]);

  const openTradeDialog = useCallback((assignmentId: string) => {
    if (postingTradeRef.current) return;
    setTradeDialogAssignmentId(assignmentId);
    setTradeNotes("");
    setTradeError(null);
  }, []);

  const closeTradeDialog = useCallback(() => {
    if (postingTradeRef.current) return;
    setTradeDialogAssignmentId(null);
    setTradeNotes("");
    setTradeError(null);
  }, []);

  const handlePostTrade = useCallback(async (assignmentId: string, notes: string) => {
    if (postingTradeRef.current) return;
    postingTradeRef.current = assignmentId;
    setPostingTradeId(assignmentId);
    setTradeError(null);
    try {
      const trimmedNotes = notes.trim();
      const res = await fetch("/api/shift-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftAssignmentId: assignmentId,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Shift posted to trade board");
        setTradeDialogAssignmentId(null);
        setTradeNotes("");
        loadData();
      } else {
        const msg = await parseErrorMessage(res, "Failed to post trade");
        setTradeError(msg);
        toast.error(msg);
        if (res.status === 404 || res.status === 409 || res.status === 410) loadData();
      }
    } catch {
      const msg = "Network error - could not post trade";
      setTradeError(msg);
      toast.error(msg);
    } finally {
      postingTradeRef.current = null;
      setPostingTradeId(null);
    }
  }, [loadData]);

  const handleCancelTrade = useCallback(async (tradeId: string) => {
    if (cancelingTradeRef.current) return;
    const ok = await confirm({
      title: "Remove trade post",
      message: "Remove this post from the Trade Board? The shift stays assigned to you.",
      confirmLabel: "Remove post",
      variant: "danger",
    });
    if (!ok || cancelingTradeRef.current) return;

    cancelingTradeRef.current = tradeId;
    setCancelingTradeId(tradeId);
    try {
      const res = await fetch(`/api/shift-trades/${tradeId}/cancel`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        toast.success("Trade post removed");
        loadData();
      } else {
        const msg = await parseErrorMessage(res, "Could not remove the trade post");
        toast.error(msg);
        if (res.status === 404 || res.status === 409 || res.status === 410) loadData();
      }
    } catch {
      toast.error("Network error — the trade post was not removed");
    } finally {
      cancelingTradeRef.current = null;
      setCancelingTradeId(null);
    }
  }, [confirm, loadData]);

  return (
    <>
      <div className={cn("schedule-enter overflow-clip rounded-md border border-border/60 bg-card transition-opacity duration-200", fillingWindow && "opacity-80")} aria-busy={fillingWindow || undefined} data-schedule-view="list">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/15 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm! font-semibold! text-foreground">
              {myShiftsOnly ? "My shifts timeline" : "Timeline"}
            </h2>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {filteredEntries.length !== entries.length
                ? `${filteredEntries.length} of ${entries.length}`
                : filteredEntries.length}
            </span>
            {myShiftsOnly && !fillingWindow && (hasMorePast || hasMoreFuture) && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Scroll for more of your shifts
              </span>
            )}
            {!myShiftsOnly && isTimeline && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Past to future
              </span>
            )}
            {refreshing && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" role="status">
                <LoaderCircleIcon className="size-3 animate-spin" />
                Refreshing
              </span>
            )}
          </div>
        </div>

        {/*
          The 3px left border matches the venue rail every body row carries.
          Without it the header labels sit 3px left of the columns they name.
        */}
        <div className="hidden min-h-9 items-center border-b border-l-[3px] border-border/50 border-l-transparent bg-muted/10 px-2 text-[11px] font-medium text-muted-foreground lg:flex">
          <EventGrid
            className="w-full"
            cells={{
              toggle: <span aria-hidden="true" />,
              time: <span>Time</span>,
              event: <span>Event</span>,
              coverage: <span>Coverage</span>,
              crew: <span className="block text-right">Crew</span>,
              status: <span>Status</span>,
              actions: <span className="sr-only">Actions</span>,
            }}
          />
        </div>

        {loading ? (
          <EventListSkeleton />
        ) : loadError ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {loadError === "network"
                ? "You appear to be offline. Check your connection and try again."
                : "Something went wrong loading schedule data."}
            </p>
            <Button variant="outline" size="sm" className="h-10" onClick={loadData}>
              Retry
            </Button>
          </div>
        ) : showEmptyState ? (
          <EmptyState
            icon="calendar"
            title={
              activeQueueMeta
                ? activeQueueMeta.emptyTitle
                : hasFilters
                  ? "No events match these filters"
                  : myShiftsOnly
                    ? "No shifts yet"
                    : "Nothing on the schedule yet"
            }
            description={
              activeQueueMeta
                ? activeQueueMeta.emptyDescription
                : hasFilters
                  ? "Try adjusting or clearing filters to see more of the schedule."
                  : myShiftsOnly
                    ? "Shifts you\u2019re scheduled on show up here. Until then, the full schedule shows what\u2019s coming up."
                    : isStaff
                      ? "No schedule events are available. Check Settings > Calendar Sources to add an ICS feed."
                      : "Events show up here once the team adds them."
            }
            actionLabel={
              activeQueueMeta
                ? "Show full schedule"
                : hasFilters
                  ? "Clear filters"
                  : myShiftsOnly
                    ? "Show all events"
                    : isStaff ? "Calendar Sources" : undefined
            }
            actionHref={
              activeQueueMeta || hasFilters || myShiftsOnly || !isStaff
                ? undefined
                : "/settings/calendar-sources"
            }
            onAction={
              activeQueueMeta
                ? clearQueue
                : hasFilters
                  ? clearFilters
                  : myShiftsOnly
                    ? () => setMyShiftsOnly(false)
                    : undefined
            }
          />
        ) : (
          <>
            {/* ── Desktop: timeline table ── */}
            {desktopList && <div>
              {isTimeline && (
                <TimelineStart
                  truncated={timelineTruncated}
                  includeArchived={includeArchived}
                  hasContentFilters={hasContentFilters}
                  hasMorePast={hasMorePast}
                  loadingPast={loadingPast}
                  loadPastError={loadPastError}
                  allowOlderFetch={allowOlderFetch}
                  onLoadArchived={onLoadArchived}
                  onLoadOlder={onLoadOlder}
                />
              )}
              {groupedEntries.map(([dateKey, groupEntries]) => {
                const groupDate = new Date(dateKey);
                const isGroupToday =
                  groupDate.toDateString() === new Date().toDateString();

              return (
                <div
                  key={dateKey}
                  ref={isGroupToday ? desktopTodayGroupRef : undefined}
                  data-today={isGroupToday || undefined}
                  data-schedule-day={groupDate.getTime()}
                  style={{ scrollMarginTop: "var(--schedule-sticky-bottom, 0px)" }}
                >
                  <DateGroupHeader date={groupDate} eventCount={groupEntries.length} isToday={isGroupToday} />

                  {groupEntries.length === 0 && (
                    <p className="border-b border-border/40 px-3 py-3 text-xs text-muted-foreground">
                      Nothing scheduled today.
                    </p>
                  )}

                  <table className="w-full border-collapse">
                    <tbody>
                      {groupEntries.map((entry) => {
                        const isExpanded = expandedRowIds.has(entry.id);
                        const hasShifts = entry.shifts.length > 0 || (isStaff && Boolean(entry.shiftGroupId));
                        const isAssignedToMe = currentUserId ? userHasShift(entry, currentUserId) : false;
                        const shiftStatus = currentUserId
                          ? userShiftStatus(entry, currentUserId)
                          : null;

                        return (
                          <EventRows
                            key={entry.id}
                            entry={entry}
                            isExpanded={isExpanded}
                            hasShifts={hasShifts}
                            isAssignedToMe={isAssignedToMe}
                            shiftStatus={shiftStatus}
                            isStaff={isStaff}
                            onToggle={() => toggleExpandedRow(entry.id)}
                            onSelectGroup={() =>
                              onSelectGroup(entry.shiftGroupId)
                            }
                            isHiding={hidingEventIds?.has(entry.id) ?? false}
                            onHide={
                              onHideEvent ? () => onHideEvent(entry.id) : undefined
                            }
                            currentUserId={currentUserId}
                            showShiftStatus={myShiftsOnly}
                            postingTradeId={postingTradeId}
                            cancelingTradeId={cancelingTradeId}
                            onPostTrade={isStaff ? undefined : openTradeDialog}
                            onCancelTrade={isStaff ? undefined : handleCancelTrade}
                            canClaim={!isStaff}
                            canReview={canReviewClaims}
                            onClaimed={loadData}
                            onSetupCrew={isStaff ? onSetupCrew : undefined}
                            onQuickManageCrew={isStaff ? onQuickManageCrew : undefined}
                            onPublished={loadData}
                            isSettingUp={settingUpEventIds?.has(entry.id) ?? false}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {isTimeline && (
              <TimelineEnd
                hasMoreFuture={hasMoreFuture}
                loadingFuture={loadingFuture}
                loadFutureError={loadFutureError}
                onLoadNewer={onLoadNewer}
              />
            )}
          </div>}

          {/* ── Mobile: card list ── */}
          {!desktopList && <div className="flex flex-col">
            {isTimeline && (
              <TimelineStart
                truncated={timelineTruncated}
                includeArchived={includeArchived}
                hasContentFilters={hasContentFilters}
                hasMorePast={hasMorePast}
                loadingPast={loadingPast}
                loadPastError={loadPastError}
                allowOlderFetch={allowOlderFetch}
                onLoadArchived={onLoadArchived}
                onLoadOlder={onLoadOlder}
              />
            )}
            {groupedEntries.map(([dateKey, groupEntries]) => {
              const groupDate = new Date(dateKey);
              const isGroupToday = groupDate.toDateString() === new Date().toDateString();

              return (
                <div
                  key={dateKey}
                  ref={isGroupToday ? mobileTodayGroupRef : undefined}
                  data-today={isGroupToday || undefined}
                  data-schedule-day={groupDate.getTime()}
                  style={{ scrollMarginTop: "var(--schedule-sticky-bottom, 0px)" }}
                >
                  <DateGroupHeader date={groupDate} eventCount={groupEntries.length} isToday={isGroupToday} />
                  {groupEntries.length === 0 && (
                    <p className="border-b border-border/40 px-3 py-3 text-xs text-muted-foreground">
                      Nothing scheduled today.
                    </p>
                  )}
                  {groupEntries.map((entry) => {
              const isExpanded = expandedRowIds.has(entry.id);
              const canExpand = entry.shifts.length > 0 || (isStaff && Boolean(entry.shiftGroupId));
              const detailId = `schedule-event-${entry.id}-details`;
              const isAssignedToMe = currentUserId ? userHasShift(entry, currentUserId) : false;
              const shiftStatus = currentUserId
                ? userShiftStatus(entry, currentUserId)
                : null;
              const titleParts = scheduleEventTitleParts(entry);

              const venueTone = VENUE_TONES[venueToneFromEvent(entry)];
              /*
                Shared by both card shells below: an event with crew to reveal
                is a disclosure button, one without is plain text.
              */
              const cardSummary = (
                <>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-semibold text-sm flex min-w-0 items-center gap-1.5 leading-tight">
                      {canExpand && (
                        isExpanded ? (
                          <ChevronDownIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        ) : (
                          <ChevronRightIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        )
                      )}
                      <span
                        className="text-[12px] text-muted-foreground tabular-nums font-medium shrink-0"
                      >
                        {eventStartLabel(entry)}
                      </span>
                      <span className="min-w-0 truncate">{titleParts.title}</span>
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {myShiftsOnly && shiftStatus === "Pending" && (
                        <Badge
                          variant="orange"
                          size="sm"
                        >
                          {shiftStatus}
                        </Badge>
                      )}
                      {entry.coverage && (
                        <CoverageBadge
                          percentage={entry.coverage.percentage}
                          filled={entry.coverage.filled}
                          total={entry.coverage.total}
                        />
                      )}
                    </div>
                  </div>
                  {/* The day header above already carries the date, and the title the sport. */}
                  <div className="text-xs text-muted-foreground flex items-center gap-x-2 gap-y-1 flex-wrap pl-5">
                    {entry.allDay && (
                      <span>{formatCalendarEventDateRange(entry)}</span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      {entry.sportCode && (
                        <span
                          aria-hidden="true"
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: sportDotColor(entry.sportCode) ?? undefined }}
                        />
                      )}
                      {venueTone.label}
                    </span>
                    {titleParts.detail && (
                      <span>{titleParts.detail}</span>
                    )}
                    {(entry.combinedEventCount ?? 0) > 1 && (
                      <span>{entry.combinedEventCount} events · shared crew</span>
                    )}
                    {!entry.allDay && eventSpansMultipleDays(entry) && (
                      <span>{formatCalendarEventDateRange(entry)}</span>
                    )}
                    {entry.claimsPaused && !isStaff && (
                      <span>Updating</span>
                    )}
                    {entry.subtitle && (
                      <span className="font-medium text-muted-foreground">{entry.subtitle}</span>
                    )}
                    {entry.eventArchivedAt && (
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground/50">
                        <ArchiveIcon className="size-3" />
                        Older record
                      </span>
                    )}
                    <CrewSummary entry={entry} compact />
                  </div>
                </>
              );
              return (
                <div
                  key={entry.id}
                  data-schedule-event-id={entry.id}
                  className={cn(
                    "schedule-enter relative border-b border-l-[3px] border-border/50 last:border-b-0",
                    venueTone.railClass,
                    isAssignedToMe && "bg-primary/5",
                  )}
                >
                  {/*
                    A card with no crew to reveal is a label, not a control.
                    Rendering it as a button anyway left an inert stop in the
                    mobile tab order on every event without a crew.
                  */}
                  {canExpand ? (
                    <button
                      type="button"
                      className="w-full px-4 py-3 pr-14 text-left"
                      onClick={() => toggleExpandedRow(entry.id)}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                    >
                      {cardSummary}
                    </button>
                  ) : (
                    <div className="w-full px-4 py-3 pr-14 text-left">
                      {cardSummary}
                    </div>
                  )}

                  <div className="px-4 empty:hidden">
                    <EntryPendingReview entry={entry} canReview={canReviewClaims} onReviewed={loadData} />
                  </div>

                  {isStaff && (Boolean(entry.shiftGroupId) || onSetupCrew || onHideEvent) && (
                    <div className="absolute right-2 top-2">
                      <CrewRowActions
                        entry={entry}
                        isHiding={hidingEventIds?.has(entry.id) ?? false}
                        onHide={onHideEvent ? () => onHideEvent(entry.id) : undefined}
                        onSetupCrew={onSetupCrew}
                        onQuickManageCrew={onQuickManageCrew}
                        isSettingUp={settingUpEventIds?.has(entry.id) ?? false}
                      />
                    </div>
                  )}

                  {canExpand && (
                    <div
                      id={detailId}
                      hidden={!isExpanded}
                      className="border-t border-border/40 px-4 py-3 pl-8"
                    >
                      {isExpanded && (isStaff && entry.shiftGroupId ? (
                        <WorkingCrewEditor
                          entry={{
                            shiftGroupId: entry.shiftGroupId,
                            allDay: entry.allDay,
                            shifts: entry.shifts,
                          } satisfies WorkingCrewEntry}
                          onPublished={loadData}
                          compact
                          eventDetailHref={`/events/${entry.id}`}
                        />
                      ) : (
                        <ShiftRowList
                          entry={entry}
                          currentUserId={currentUserId}
                          postingTradeId={postingTradeId}
                          cancelingTradeId={cancelingTradeId}
                          onPostTrade={isStaff ? undefined : openTradeDialog}
                          onCancelTrade={isStaff ? undefined : handleCancelTrade}
                          canClaim={!isStaff}
                          onClaimed={loadData}
                          onSelectGroup={() => onSelectGroup(entry.shiftGroupId)}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
                  })}
                </div>
              );
            })}
            {isTimeline && (
              <TimelineEnd
                hasMoreFuture={hasMoreFuture}
                loadingFuture={loadingFuture}
                loadFutureError={loadFutureError}
                onLoadNewer={onLoadNewer}
              />
            )}
          </div>}
          </>
        )}
      </div>

      <PostTradeDialog
        open={Boolean(tradeDialogAssignmentId)}
        shift={tradeDialogShift}
        notes={tradeNotes}
        error={tradeError}
        posting={Boolean(postingTradeId)}
        onNotes={(value) => {
          setTradeNotes(value);
          if (tradeError) setTradeError(null);
        }}
        onClose={closeTradeDialog}
        onPost={() => {
          if (tradeDialogAssignmentId) void handlePostTrade(tradeDialogAssignmentId, tradeNotes);
        }}
      />

      {/*
        Today is the timeline's home position, so there is always a way back to
        it. Only rendered once the reader has actually left today behind.
      */}
      {isTimeline && todayOffscreen && !loading && filteredEntries.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4 max-md:bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))]">
          <Button
            variant="secondary"
            onClick={scrollToToday}
            className="pointer-events-auto h-10 gap-1.5 rounded-full border border-white/20 bg-white px-4 text-black shadow-lg hover:bg-white/90 hover:text-black"
          >
            {todayDirection === "up" ? (
              <ArrowUpIcon className="size-3.5" />
            ) : (
              <ArrowDownIcon className="size-3.5" />
            )}
            Jump to today
          </Button>
        </div>
      )}
    </>
  );
}
