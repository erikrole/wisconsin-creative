"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { ArchiveIcon, CalendarDaysIcon, ChevronDownIcon, ChevronRightIcon, EyeOffIcon, UserIcon, UsersRoundIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { SkeletonTable } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { formatDateShort, formatTimeShort } from "@/lib/format";
import { formatCalendarEventAllDayLabel, formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import { sportLabel } from "@/lib/sports";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserAvatarGroup } from "@/components/UserAvatarGroup";
import { ClaimShiftAction } from "@/components/ClaimShiftAction";
import { CallWindowEditor } from "@/components/shift-detail/CallWindowEditor";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import { shiftWorkerLabel, shiftWorkerLabelForProfile, shiftWorkerSlotLabel, type ShiftWorkerKind } from "@/lib/shift-display";
import { callWindowKey, effectiveCallWindow, formatCallWindowLabel, isInheritedFullDayCallWindow } from "@/lib/shift-call-windows";
import {
  CREW_ROW_GROUP,
  CrewAreaDot,
  CrewAreaLabel,
  CrewTypeLabel,
} from "@/components/shift-detail/crew-row";
import type { CalendarEntry, Shift } from "./types";
import { WorkingCrewEditor, type WorkingCrewEntry } from "./WorkingCrewEditor";
import type { ScheduleQueueMeta } from "@/lib/schedule-queues";

import {
  ACTIVE_STATUSES,
  AREA_LABELS,
  scheduleEventTitleParts,
  userHasShift,
  userShiftStatus,
} from "./types";
import { CoverageBadge } from "./Coverage";

type CrewTemplateSide = "HOME" | "AWAY" | "EMPTY";

type ListViewProps = {
  entries: CalendarEntry[];
  filteredEntries: CalendarEntry[];
  groupedEntries: [string, CalendarEntry[]][];
  loading: boolean;
  loadError: false | "network" | "server";
  loadData: () => void | Promise<void>;
  myShiftsOnly: boolean;
  setMyShiftsOnly: (v: boolean) => void;
  clearFilters: () => void;
  hasFilters: boolean;
  /** The window hit its page cap, so the oldest events were not loaded. */
  timelineTruncated: boolean;
  /** The list is the continuous today-anchored timeline. */
  isTimeline: boolean;
  /** A filter is narrowing which events appear, not how far back the window reaches. */
  hasContentFilters: boolean;
  includeArchived: boolean;
  setIncludeArchived: (v: boolean) => void;
  activeQueueMeta: ScheduleQueueMeta | null;
  clearQueue: () => void;
  currentUserId: string;
  isStaff: boolean;
  expandedRowId: string | null;
  setExpandedRowId: (id: string | null) => void;
  onSelectGroup: (groupId: string | null) => void;
  hidingEventIds?: Set<string>;
  onHideEvent?: (eventId: string) => void;
  onSetupCrew?: (eventId: string, templateSide: CrewTemplateSide) => void;
  onQuickManageCrew?: (eventId: string) => void;
  settingUpEventIds?: Set<string>;
};

const EVENT_GRID_CLASS = "grid-cols-[44px_72px_minmax(180px,1fr)_80px_minmax(100px,140px)_136px_40px]";

function shiftAssignee(shift: Shift) {
  const active = shift.assignments.find((a) => ACTIVE_STATUSES.includes(a.status));
  return active?.user ?? null;
}

function activeShiftAssignment(shift: Shift) {
  return shift.assignments.find((a) => ACTIVE_STATUSES.includes(a.status)) ?? null;
}

function openShiftCount(entry: CalendarEntry) {
  return entry.shifts.reduce((count, shift) => count + (shiftAssignee(shift) ? 0 : 1), 0);
}

function CrewRowActions({
  entry,
  isHiding,
  onHide,
  onSetupCrew,
  onQuickManageCrew,
  isSettingUp,
}: {
  entry: CalendarEntry;
  isHiding: boolean;
  onHide?: () => void;
  onSetupCrew?: (eventId: string, templateSide: CrewTemplateSide) => void;
  onQuickManageCrew?: (eventId: string) => void;
  isSettingUp: boolean;
}) {
  const hasCrew = Boolean(entry.shiftGroupId);
  const openCount = openShiftCount(entry);

  if (!hasCrew && !onSetupCrew && !onHide) return null;

  return (
    <OperationalRowActions
      label={`Actions for ${scheduleEventTitleParts(entry).title}`}
      triggerClassName={isHiding || isSettingUp ? "opacity-100" : undefined}
    >
      {hasCrew ? (
        <>
          <DropdownMenuItem onSelect={() => onQuickManageCrew?.(entry.id)}>
            <UsersRoundIcon className="size-4" />
            Manage crew{openCount > 0 ? ` · ${openCount} open` : ""}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/events/${entry.id}`}>
              <UsersRoundIcon className="size-4" />
              Open Event detail
            </Link>
          </DropdownMenuItem>
        </>
      ) : onSetupCrew ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={isSettingUp}>
            <UsersRoundIcon className="size-4" />
            {isSettingUp ? "Setting up..." : "Set up crew"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => onSetupCrew(entry.id, "HOME")}>
              Use Home defaults
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSetupCrew(entry.id, "AWAY")}>
              Use Away defaults
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSetupCrew(entry.id, "EMPTY")}>
              Start empty
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {onHide && (hasCrew || onSetupCrew) && <DropdownMenuSeparator />}
      {onHide && (
        <DropdownMenuItem disabled={isHiding} onSelect={onHide}>
          <EyeOffIcon className="size-4" />
          Hide event
        </DropdownMenuItem>
      )}
    </OperationalRowActions>
  );
}

function workerKindForShift(shift: Shift): ShiftWorkerKind {
  return shift.workerType === "FT" ? "FT" : "ST";
}

function roleSlotLabel(kind: ShiftWorkerKind) {
  return shiftWorkerSlotLabel(kind);
}

function eventStartLabel(entry: CalendarEntry) {
  return entry.allDay ? formatCalendarEventAllDayLabel(entry) : formatTimeShort(entry.startsAt);
}

function DateGroupHeader({ date, eventCount, isToday }: { date: Date; eventCount: number; isToday: boolean }) {
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="sticky z-10 flex min-h-10 items-center gap-2 border-b border-border/50 bg-background/95 px-3 backdrop-blur"
      style={{ top: "var(--schedule-sticky-bottom, 0px)" }}
    >
      <span className={cn("text-xs font-semibold", isToday ? "text-[var(--wi-red)]" : "text-foreground")}>
        {dateLabel}
      </span>
      {isToday && <Badge variant="red" size="sm">Today</Badge>}
      <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
        {eventCount === 0 ? "No events" : `${eventCount} event${eventCount === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

function commonCallWindow(entry: CalendarEntry) {
  if (entry.allDay) return null;

  const counts = new Map<string, { count: number; window: ReturnType<typeof effectiveCallWindow> }>();
  for (const shift of entry.shifts) {
    if (workerKindForShift(shift) !== "ST") continue;
    const window = effectiveCallWindow(shift, activeShiftAssignment(shift));
    if (isInheritedFullDayCallWindow(window)) continue;
    const key = callWindowKey(window);
    const current = counts.get(key);
    counts.set(key, { count: (current?.count ?? 0) + 1, window });
  }

  const [mostCommon] = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  if (!mostCommon || mostCommon[1].count < 2) return null;
  return { key: mostCommon[0], count: mostCommon[1].count, window: mostCommon[1].window };
}

function CrewSummary({
  entry,
  compact = false,
}: {
  entry: CalendarEntry;
  compact?: boolean;
}) {
  const assignedUsers = entry.shifts
    .map(shiftAssignee)
    .filter((user): user is NonNullable<ReturnType<typeof shiftAssignee>> => Boolean(user));
  const openCount = openShiftCount(entry);

  if (entry.shifts.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", compact ? "justify-start" : "justify-end")}>
      {assignedUsers.length > 0 && <UserAvatarGroup users={assignedUsers} max={compact ? 3 : 4} />}
      {openCount > 0 ? (
        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {openCount} open
        </span>
      ) : assignedUsers.length === 0 ? (
        <span className="text-xs font-medium text-muted-foreground">No crew</span>
      ) : null}
    </div>
  );
}

function ShiftRowList({
  entry,
  currentUserId,
  postingTradeId,
  cancelingTradeId,
  onPostTrade,
  onCancelTrade,
  onSelectGroup,
  canClaim,
  onClaimed,
  compact = false,
}: {
  entry: CalendarEntry;
  currentUserId: string;
  postingTradeId: string | null;
  cancelingTradeId: string | null;
  onPostTrade?: (assignmentId: string) => void;
  onCancelTrade?: (tradeId: string) => void;
  onSelectGroup: () => void;
  canClaim: boolean;
  onClaimed?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const commonCall = commonCallWindow(entry);

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-1.5")}>
      {commonCall && (
        <div className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground",
          compact ? "bg-muted/30" : "bg-muted/20",
        )}>
          <span className="font-medium text-foreground/70">Most rows</span>
          <span className="tabular-nums">{formatCallWindowLabel(commonCall.window)}</span>
        </div>
      )}
      {entry.shifts.map((shift) => {
        const activeAssignment = activeShiftAssignment(shift);
        const user = activeAssignment?.user ?? null;
        const myAssignment = shift.assignments.find(
          (assignment) => assignment.user.id === currentUserId && ACTIVE_STATUSES.includes(assignment.status),
        );
        const activeTrade = myAssignment?.activeTrade ?? null;
        const viewerRequest = shift.viewerRequest;
        const effectiveStart = myAssignment?.callStartsAt ?? shift.callStartsAt ?? shift.startsAt;
        const canPostTrade = Boolean(
          onPostTrade
          && myAssignment
          && !activeTrade
          && !entry.archivedAt
          && Number.isFinite(new Date(effectiveStart).getTime())
          && new Date(effectiveStart).getTime() > Date.now(),
        );
        const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
        const workerType = workerKindForShift(shift);
        const slotLabel = roleSlotLabel(workerType);
        const assignedClassLabel = user ? shiftWorkerLabelForProfile(user) : null;
        const assignedClassDiffersFromSlot = Boolean(assignedClassLabel && `${assignedClassLabel} slot` !== slotLabel);
        const slotWindow = effectiveCallWindow(shift);
        const assignmentWindow = activeAssignment ? effectiveCallWindow(shift, activeAssignment) : null;
        const visibleWindow = assignmentWindow ?? slotWindow;
        const showCallWindows = !entry.allDay && workerType === "ST";
        const callMatchesCommon = Boolean(commonCall && callWindowKey(visibleWindow) === commonCall.key);
        const callCell = showCallWindows && !isInheritedFullDayCallWindow(visibleWindow) && !callMatchesCommon ? (
          <CallWindowEditor effectiveWindow={visibleWindow} compact variant="bare" />
        ) : null;

        return (
          <div
            key={shift.id}
            className={cn(
              "min-h-11 border-border/45 px-2 py-1.5 transition-colors hover:bg-background/70",
              compact ? "flex flex-col gap-2 rounded-md border bg-background/50" : "grid grid-cols-[104px_72px_72px_minmax(0,1fr)_auto] items-center gap-3 border-t first:border-t-0",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <CrewAreaDot area={shift.area} />
              <CrewAreaLabel area={shift.area} />
            </div>

            {!compact && (
              <div className="flex min-h-10 min-w-0 flex-col items-start justify-center">
                {callCell}
              </div>
            )}

            {!compact && (
              <CrewTypeLabel
                label={assignedClassLabel ?? shiftWorkerLabel(workerType)}
                emphasis={assignedClassDiffersFromSlot}
              />
            )}

            <div className="min-w-0 flex-1">
              {user ? (
                <div className={cn(CREW_ROW_GROUP, "flex min-h-10 w-full items-center rounded-md px-2 transition-[background-color] hover:bg-muted/45 focus-within:bg-muted/45")}>
                  <button
                    type="button"
                    className="inline-flex min-w-0 flex-1 self-stretch items-center gap-2 rounded-md text-left transition-[scale] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                    aria-label={`Open ${areaLabel} shift assigned to ${user.name}`}
                    onClick={onSelectGroup}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium">{user.name}</span>
                    {compact && assignedClassDiffersFromSlot && (
                      <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">
                        {assignedClassLabel}
                      </span>
                    )}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-1 text-left shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--border)_55%,transparent)] transition-[background-color,scale] hover:bg-muted/45 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  aria-label={`Open unassigned ${areaLabel} shift`}
                  onClick={onSelectGroup}
                >
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-muted-foreground/30 text-muted-foreground">
                    <UserIcon className="size-3 opacity-65" />
                  </div>
                  <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">{slotLabel}</span>
                </button>
              )}
            </div>

            {compact && <div className="flex min-w-0 flex-col items-start gap-1">{callCell}</div>}

            <div className={cn("flex min-h-10", compact ? "justify-start" : "shrink-0 justify-end")}>
              <div className={cn("flex min-w-0 items-center gap-1.5", compact && "flex-wrap")}>
                {!user && (
                  <ClaimShiftAction
                    shiftId={shift.id}
                    workerType={shift.workerType}
                    startsAt={shift.startsAt}
                    isAssigned={Boolean(activeAssignment)}
                    viewerRequest={viewerRequest}
                    canClaim={canClaim}
                    isPublished={Boolean(entry.publication?.publishedAt)}
                    compact={compact}
                    onChanged={onClaimed}
                  />
                )}
                {canPostTrade && myAssignment && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 shrink-0 px-2 text-xs text-muted-foreground transition-[background-color,color,scale] hover:text-foreground active:scale-[0.96]"
                    disabled={postingTradeId === myAssignment.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPostTrade?.(myAssignment.id);
                    }}
                  >
                    {postingTradeId === myAssignment.id ? "Posting..." : "Trade"}
                  </Button>
                )}
                {activeTrade && (
                  <>
                    <Badge
                      variant={activeTrade.status === "CLAIMED" ? "orange" : "green"}
                      size="sm"
                    >
                      {activeTrade.status === "CLAIMED" ? "Trade claimed" : "On Trade Board"}
                    </Badge>
                    {onCancelTrade && (
                      <OperationalRowActions label={`Trade Board actions for ${areaLabel} shift`}>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={Boolean(cancelingTradeId)}
                          onSelect={() => onCancelTrade(activeTrade.id)}
                        >
                          <XIcon className="size-4" />
                          {cancelingTradeId === activeTrade.id ? "Removing..." : "Remove post"}
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
    sessionStorage.setItem(HISTORY_RETURN_KEY, "1");
  });
}

/**
 * A reload is the same promise as a back navigation: the reader was somewhere,
 * and pressing refresh should not move them.
 *
 * The browser's own restoration cannot be leaned on here. The list renders
 * asynchronously, so at the moment the anchor runs the document is still short
 * and the scroll position is still 0 -- the restore lands later, and the anchor
 * had already snapped the page up to today. Recording the position ourselves
 * makes the restore independent of that race.
 */
const SCROLL_KEY = "schedule:timeline-scroll";
const HISTORY_SCROLL_KEY = "scheduleTimelineScroll";
const HISTORY_RETURN_KEY = "schedule:timeline-history-return";

function isScheduleReload(): boolean {
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
function storedScroll(): number | null {
  if (typeof sessionStorage === "undefined") return null;
  const stored = sessionStorage.getItem(SCROLL_KEY);
  if (stored === null) return null;
  const raw = Number.parseInt(stored, 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}

function storedHistoryScroll(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.history.state?.[HISTORY_SCROLL_KEY];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

function hasScheduleHistoryReturn(): boolean {
  return typeof sessionStorage !== "undefined"
    && sessionStorage.getItem(HISTORY_RETURN_KEY) === "1";
}

/**
 * The top edge of the timeline.
 *
 * Events older than four months are soft-archived, so scrolling up runs out
 * well before the beginning of records. Saying so -- and offering the way
 * through -- beats a list that just stops for no visible reason.
 */
function TimelineStart({
  truncated,
  includeArchived,
  hasContentFilters,
  onLoadArchived,
}: {
  truncated: boolean;
  includeArchived: boolean;
  hasContentFilters: boolean;
  onLoadArchived: () => void;
}) {
  // Truncation is about missing data, so it is reported whatever else is on.
  if (truncated) {
    return (
      <div className="flex flex-col items-center gap-1 border-b border-border/50 bg-muted/10 px-3 py-4 text-center">
        <span className="text-xs font-medium text-[var(--orange-text)]">
          Showing the most recent events only
        </span>
        <span className="text-[11px] text-muted-foreground">
          This window is larger than the list loads at once. Filter by sport to reach older events.
        </span>
      </div>
    );
  }

  // A filtered list is a search result, not the top of the timeline; claiming
  // the season starts here would be a lie about why the rows ran out.
  if (hasContentFilters) return null;

  return (
    <div className="flex flex-col items-center gap-2 border-b border-border/50 bg-muted/10 px-3 py-4 text-center">
      <span className="text-[11px] text-muted-foreground">
        {includeArchived ? "Beginning of records" : "Earlier events are archived"}
      </span>
      {!includeArchived && (
        <Button variant="outline" className="h-10 text-xs" onClick={onLoadArchived}>
          Load archived events
        </Button>
      )}
    </div>
  );
}

export function ListView({
  entries,
  filteredEntries,
  groupedEntries,
  loading,
  loadError,
  loadData,
  myShiftsOnly,
  setMyShiftsOnly,
  clearFilters,
  hasFilters,
  timelineTruncated,
  isTimeline,
  hasContentFilters,
  includeArchived,
  setIncludeArchived,
  activeQueueMeta,
  clearQueue,
  currentUserId,
  isStaff,
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
  useEffect(() => {
    if (!expandedRowId) return;
    setExpandedRowIds((current) => new Set(current).add(expandedRowId));
  }, [expandedRowId]);

  const toggleExpandedRow = useCallback((entryId: string) => {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
    setExpandedRowId(expandedRowIds.has(entryId) ? null : entryId);
  }, [expandedRowIds, setExpandedRowId]);

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
  const [todayOffscreen, setTodayOffscreen] = useState(false);

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
    return Number.parseInt(raw, 10) || 0;
  }, []);

  const todayGroupEl = useCallback(() => (
    window.matchMedia("(max-width: 1023px)").matches
      ? mobileTodayGroupRef.current
      : desktopTodayGroupRef.current
  ), []);

  useEffect(() => {
    if (!isTimeline) return;
    const claim = () => { readerOwnsScrollRef.current = true; };
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

  /** Set while archived events are loading; see the restore effect below. */
  const pendingArchiveScrollRef = useRef<number | null>(null);
  /** Where a reload should land, held until the list is tall enough to get there. */
  const pendingRestoreRef = useRef<number | null>(null);

  const anchorToday = useCallback(() => {
    const el = todayGroupEl();
    if (!el) return false;
    el.scrollIntoView({ block: "start", behavior: "instant" });
    return true;
  }, [todayGroupEl]);

  useLayoutEffect(() => {
    if (!isTimeline || didAnchorRef.current || loading) return;
    const reload = isScheduleReload();
    const fromHistory = !reload && (arrivedByHistory || hasScheduleHistoryReturn());
    const historyRestore = fromHistory ? storedHistoryScroll() : null;
    arrivedByHistory = false;
    sessionStorage.removeItem(HISTORY_RETURN_KEY);
    const restore = reload
      ? storedScroll()
      : fromHistory
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
  }, [isTimeline, loading, anchorToday]);

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
      if (readerOwnsScrollRef.current || pendingArchiveScrollRef.current !== null) return;
      const el = todayGroupEl();
      if (!el) return;
      if (Math.abs(el.getBoundingClientRect().top - stickyBottom()) > 2) anchorToday();
    };

    const observed = document.getElementById("main-content") ?? document.body;
    const observer = new ResizeObserver(keepAnchored);
    observer.observe(observed);
    const frame = requestAnimationFrame(keepAnchored);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [isTimeline, groupedEntries, todayGroupEl, anchorToday, stickyBottom]);

  const previousTimelineMetricsRef = useRef<{ height: number; scrollY: number } | null>(null);
  const previousIncludeArchivedRef = useRef(includeArchived);

  useLayoutEffect(() => {
    if (includeArchived && !previousIncludeArchivedRef.current) {
      const previous = previousTimelineMetricsRef.current;
      pendingArchiveScrollRef.current = previous
        ? previous.height - previous.scrollY
        : document.documentElement.scrollHeight - window.scrollY;
      readerOwnsScrollRef.current = true;
    } else if (!includeArchived) {
      pendingArchiveScrollRef.current = null;
    }

    previousIncludeArchivedRef.current = includeArchived;
    previousTimelineMetricsRef.current = {
      height: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
    };
  }, [includeArchived]);

  useEffect(() => {
    const capture = () => {
      previousTimelineMetricsRef.current = {
        height: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
      };
    };
    capture();
    const observer = new ResizeObserver(capture);
    observer.observe(document.getElementById("main-content") ?? document.body);
    window.addEventListener("scroll", capture, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", capture);
    };
  }, []);

  useLayoutEffect(() => {
    const anchorFromBottom = pendingArchiveScrollRef.current;
    if (anchorFromBottom === null || loading) return;
    const height = document.documentElement.scrollHeight;
    // Until the document actually grows, the older events have not rendered.
    // Clearing the anchor on that render would spend it on a no-op and let the
    // real prepend jump the page.
    if (height - window.scrollY <= anchorFromBottom) return;
    pendingArchiveScrollRef.current = null;
    window.scrollTo({ top: height - anchorFromBottom, behavior: "instant" });
  }, [groupedEntries, loading]);

  // Drives the jump-back control. Both breakpoints' anchors are observed rather
  // than whichever one matched at effect time, so a resize across the layout
  // breakpoint cannot leave the button watching a detached element.
  useEffect(() => {
    if (!isTimeline || typeof IntersectionObserver === "undefined") return;
    const targets = [desktopTodayGroupRef.current, mobileTodayGroupRef.current]
      .filter((el): el is HTMLDivElement => el !== null);
    if (targets.length === 0) return;

    const visible = new Set<Element>();
    const observer = new IntersectionObserver((observed) => {
      for (const entry of observed) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setTodayOffscreen(visible.size === 0);
    }, { rootMargin: `-${stickyBottom()}px 0px 0px 0px` });

    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [isTimeline, groupedEntries, stickyBottom]);

  /**
   * Reaching for older history is the reader taking the wheel: from here the
   * position is theirs, and today must not pull them back.
   */
  const onLoadArchived = useCallback(() => {
    readerOwnsScrollRef.current = true;
    setIncludeArchived(true);
  }, [setIncludeArchived]);

  // Throttled to one write per frame: this runs on every scroll event.
  useEffect(() => {
    if (!isTimeline || typeof sessionStorage === "undefined") return;
    let queued = false;
    let navigatingToEvent = false;
    const write = () => {
      sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY)));
    };
    const record = () => {
      if (queued || navigatingToEvent) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (navigatingToEvent) return;
        write();
      });
    };
    const captureEventNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('a[href^="/events/"]')) return;
      // Next replaces the route before this component unmounts and can emit an
      // outgoing scroll while the Schedule DOM collapses. Freeze the reader's
      // click position on both storage and this history entry before that
      // transition can overwrite it.
      write();
      window.history.replaceState(
        { ...(window.history.state ?? {}), [HISTORY_SCROLL_KEY]: Math.round(window.scrollY) },
        "",
      );
      navigatingToEvent = true;
    };
    window.addEventListener("scroll", record, { passive: true });
    document.addEventListener("click", captureEventNavigation, true);
    // A reload can begin before the last animation-frame write runs. pagehide
    // is the last reliable synchronous chance to persist the visible offset.
    window.addEventListener("pagehide", write);
    return () => {
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
    todayGroupEl()?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [todayGroupEl]);

  const [postingTradeId, setPostingTradeId] = useState<string | null>(null);
  const postingTradeRef = useRef<string | null>(null);
  const [cancelingTradeId, setCancelingTradeId] = useState<string | null>(null);
  const cancelingTradeRef = useRef<string | null>(null);
  const [tradeDialogAssignmentId, setTradeDialogAssignmentId] = useState<string | null>(null);
  const [tradeNotes, setTradeNotes] = useState("");
  const [tradeError, setTradeError] = useState<string | null>(null);

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
      <div className="overflow-hidden rounded-md border border-border/60 bg-card">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/15 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm! font-semibold! text-foreground">
              {myShiftsOnly ? "My Shifts" : "Schedule"}
            </h3>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {filteredEntries.length !== entries.length
                ? `${filteredEntries.length} of ${entries.length}`
                : filteredEntries.length}
            </span>
          </div>
        </div>

        <div className={cn("hidden min-h-9 items-center gap-2 border-b border-border/50 bg-muted/10 px-2 text-[11px] font-medium text-muted-foreground lg:grid", EVENT_GRID_CLASS)}>
          <span aria-hidden="true" />
          <span>Time</span>
          <span>Event</span>
          <span>Coverage</span>
          <span className="text-right">Crew</span>
          <span>Status</span>
          <span className="sr-only">Actions</span>
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={3} />
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
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={activeQueueMeta ? activeQueueMeta.emptyTitle : myShiftsOnly ? "No shifts assigned" : "No events found"}
            description={
              activeQueueMeta
                ? activeQueueMeta.emptyDescription
                : myShiftsOnly
                ? "You don't have any upcoming shift assignments."
                : hasFilters
                  ? "Try adjusting your filters."
                  : "No upcoming events. Check Settings > Calendar Sources to add an ICS feed."
            }
            actionLabel={
              activeQueueMeta
                ? "Show full schedule"
                : myShiftsOnly
                ? "Show all events"
                : hasFilters
                  ? "Clear filters"
                  : "Calendar Sources"
            }
            actionHref={
              activeQueueMeta || myShiftsOnly
                ? undefined
                : hasFilters
                  ? undefined
                  : "/settings/calendar-sources"
            }
            onAction={
              activeQueueMeta
                ? clearQueue
                : myShiftsOnly ? () => setMyShiftsOnly(false) : hasFilters ? clearFilters : undefined
            }
          />
        ) : (
          <>
            {/* ── Desktop: timeline table ── */}
            <div className="max-lg:hidden">
              {isTimeline && (
                <TimelineStart
                  truncated={timelineTruncated}
                  includeArchived={includeArchived}
                  hasContentFilters={hasContentFilters}
                  onLoadArchived={onLoadArchived}
                />
              )}
              {groupedEntries.map(([dateKey, groupEntries], groupIdx) => {
                const groupDate = new Date(dateKey);
                const isGroupToday =
                  groupDate.toDateString() === new Date().toDateString();

              return (
                <div
                  key={`${dateKey}-${groupIdx}`}
                  ref={isGroupToday ? desktopTodayGroupRef : undefined}
                  data-today={isGroupToday || undefined}
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
          </div>

          {/* ── Mobile: card list ── */}
          <div className="hidden max-lg:flex flex-col">
            {isTimeline && (
              <TimelineStart
                truncated={timelineTruncated}
                includeArchived={includeArchived}
                hasContentFilters={hasContentFilters}
                onLoadArchived={onLoadArchived}
              />
            )}
            {groupedEntries.map(([dateKey, groupEntries], groupIdx) => {
              const groupDate = new Date(dateKey);
              const isGroupToday = groupDate.toDateString() === new Date().toDateString();

              return (
                <div
                  key={`${dateKey}-${groupIdx}`}
                  ref={isGroupToday ? mobileTodayGroupRef : undefined}
                  data-today={isGroupToday || undefined}
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
              const isAssignedToMe = currentUserId ? userHasShift(entry, currentUserId) : false;
              const shiftStatus = currentUserId
                ? userShiftStatus(entry, currentUserId)
                : null;
              const titleParts = scheduleEventTitleParts(entry);

              const venueTone = VENUE_TONES[venueToneFromEvent(entry)];
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "relative border-b border-l-[3px] border-border/50 last:border-b-0",
                    venueTone.railClass,
                    isAssignedToMe && "bg-primary/5",
                  )}
                >
                  <button
                    className="w-full px-4 py-3 pr-14 text-left"
                    onClick={() =>
                      canExpand
                        ? toggleExpandedRow(entry.id)
                        : undefined
                    }
                    aria-expanded={canExpand ? isExpanded : undefined}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-semibold text-sm flex items-center gap-1.5 leading-tight">
                        {canExpand && (
                          isExpanded ? (
                            <ChevronDownIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          ) : (
                            <ChevronRightIcon className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          )
                        )}
                        <span
                          className="text-[10px] text-muted-foreground/60 tabular-nums font-normal shrink-0"
                          style={{ fontFamily: entry.allDay ? "var(--font-heading)" : "var(--font-mono)" }}
                        >
                          {eventStartLabel(entry)}
                        </span>
                        {titleParts.title}
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
                    <div className="text-xs text-muted-foreground flex gap-2 flex-wrap pl-5">
                      <span>
                        {entry.allDay
                          ? formatCalendarEventDateRange(entry)
                          : formatDateShort(entry.startsAt, entry.allDay)}
                      </span>
                      {entry.sportCode && (
                        <span>{sportLabel(entry.sportCode)}</span>
                      )}
                      {titleParts.detail && (
                        <span>{titleParts.detail}</span>
                      )}
                      <span>{venueTone.label}</span>
                      {entry.subtitle && (
                        <span className="font-medium text-primary/70">{entry.subtitle}</span>
                      )}
                      {entry.archivedAt && (
                        <span className="inline-flex items-center gap-0.5 text-muted-foreground/50">
                          <ArchiveIcon className="size-3" />
                          Archived
                        </span>
                      )}
                      <CrewSummary entry={entry} compact />
                    </div>
                  </button>

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

                  {isExpanded && canExpand && (
                    <div className="border-t border-border/40 px-4 py-3 pl-8">
                      {isStaff && entry.shiftGroupId ? (
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
                      )}
                    </div>
                  )}
                </div>
              );
                  })}
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      <Dialog
        open={Boolean(tradeDialogAssignmentId)}
        onOpenChange={(open) => {
          if (!open) closeTradeDialog();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="flex flex-col gap-1">
              <DialogTitle>Post shift for trade</DialogTitle>
              <DialogDescription>
                Eligible teammates can claim it. You stay scheduled until an admin approves a claim.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-6 py-1">
            {tradeError && (
              <Alert variant="destructive" className="py-2.5">
                <AlertDescription>{tradeError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="schedule-trade-notes" className="text-xs font-medium">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="schedule-trade-notes"
                placeholder="e.g. Conflict with class, available all week"
                value={tradeNotes}
                onChange={(event) => {
                  setTradeNotes(event.target.value);
                  if (tradeError) setTradeError(null);
                }}
                className="min-h-24 resize-none text-sm"
                maxLength={5000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeTradeDialog} disabled={Boolean(postingTradeId)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (tradeDialogAssignmentId) void handlePostTrade(tradeDialogAssignmentId, tradeNotes);
              }}
              disabled={Boolean(postingTradeId)}
            >
              {postingTradeId ? "Posting..." : "Post trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Today is the timeline's home position, so there is always a way back to
        it. Only rendered once the reader has actually left today behind.
      */}
      {isTimeline && todayOffscreen && !loading && filteredEntries.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
          <Button
            variant="secondary"
            onClick={scrollToToday}
            className="pointer-events-auto h-10 gap-1.5 rounded-full border border-border/60 px-4 shadow-lg"
          >
            <CalendarDaysIcon className="size-3.5" />
            Jump to today
          </Button>
        </div>
      )}
    </>
  );
}

/* ── Event parent + shift child rows (desktop) ── */

function EventRows({
  entry,
  isExpanded,
  hasShifts,
  isAssignedToMe,
  shiftStatus,
  isStaff,
  isHiding,
  onToggle,
  onSelectGroup,
  onHide,
  currentUserId,
  showShiftStatus,
  postingTradeId,
  cancelingTradeId,
  onPostTrade,
  onCancelTrade,
  canClaim,
  onClaimed,
  onSetupCrew,
  onQuickManageCrew,
  onPublished,
  isSettingUp,
}: {
  entry: CalendarEntry;
  isExpanded: boolean;
  hasShifts: boolean;
  isAssignedToMe: boolean;
  shiftStatus: string | null;
  isStaff: boolean;
  isHiding: boolean;
  onToggle: () => void;
  onSelectGroup: () => void;
  onHide?: () => void;
  currentUserId: string;
  showShiftStatus: boolean;
  postingTradeId: string | null;
  cancelingTradeId: string | null;
  onPostTrade?: (assignmentId: string) => void;
  onCancelTrade?: (tradeId: string) => void;
  canClaim: boolean;
  onClaimed?: () => void | Promise<void>;
  onSetupCrew?: (eventId: string, templateSide: CrewTemplateSide) => void;
  onQuickManageCrew?: (eventId: string) => void;
  onPublished: () => void;
  isSettingUp: boolean;
}) {
  const titleParts = scheduleEventTitleParts(entry);

  const venueTone = VENUE_TONES[venueToneFromEvent(entry)];

  return (
    <>
      {/* Parent event row */}
      <tr
        className={cn(
          "group/row border-l-[3px] transition-colors",
          venueTone.railClass,
          hasShifts ? "cursor-pointer" : "",
          isExpanded
            ? "bg-muted/20"
            : isAssignedToMe
              ? "bg-primary/5 hover:bg-primary/10"
              : "hover:bg-muted/10",
        )}
        onClick={hasShifts ? onToggle : undefined}
      >
        <td className="border-b border-border/20 px-2 py-1.5">
          <div className={cn("grid min-h-12 items-center gap-2", EVENT_GRID_CLASS)}>
            <div>
              {hasShifts && (
                <button
                  type="button"
                  aria-label={isExpanded ? "Collapse shifts" : "Expand shifts"}
                  aria-expanded={isExpanded}
                  className="relative flex size-10 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] hover:bg-muted hover:text-foreground active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle();
                  }}
                >
                  {isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
                </button>
              )}
            </div>
            <span
              className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
              style={{ fontFamily: entry.allDay ? "var(--font-heading)" : "var(--font-mono)" }}
            >
              {eventStartLabel(entry)}
            </span>
            <div className="min-w-0">
              <Link
                href={`/events/${entry.id}`}
                className="flex min-h-10 items-center truncate rounded-sm text-sm font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => e.stopPropagation()}
              >
                {titleParts.title}
              </Link>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="shrink-0">{venueTone.label}</span>
                {titleParts.detail && <span className="truncate">{titleParts.detail}</span>}
                {entry.subtitle && <span className="truncate font-medium text-primary/70">{entry.subtitle}</span>}
              </div>
            </div>
            <div>{entry.coverage && <CoverageBadge percentage={entry.coverage.percentage} filled={entry.coverage.filled} total={entry.coverage.total} />}</div>
            <CrewSummary entry={entry} />
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {showShiftStatus && shiftStatus === "Pending" && <Badge variant="orange" size="sm">{shiftStatus}</Badge>}
              {entry.archivedAt && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                  <ArchiveIcon className="size-3" />
                  Archived
                </span>
              )}
            </div>
            {isStaff && (Boolean(entry.shiftGroupId) || onSetupCrew || onHide) ? (
              <CrewRowActions
                entry={entry}
                isHiding={isHiding}
                onHide={onHide}
                onSetupCrew={onSetupCrew}
                onQuickManageCrew={onQuickManageCrew}
                isSettingUp={isSettingUp}
              />
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        </td>
      </tr>

      {/* Expanded assignment detail */}
      {isExpanded && (
        <tr className="bg-muted/10">
          <td className="border-b border-border/15 px-4 py-2">
            <div className="pl-[116px] pr-10">
              {isStaff && entry.shiftGroupId ? (
                <WorkingCrewEditor
                  entry={{
                    shiftGroupId: entry.shiftGroupId,
                    allDay: entry.allDay,
                    shifts: entry.shifts,
                  } satisfies WorkingCrewEntry}
                  onPublished={onPublished}
                  compact
                  eventDetailHref={`/events/${entry.id}`}
                />
              ) : (
                <ShiftRowList
                  entry={entry}
                  currentUserId={currentUserId}
                  postingTradeId={postingTradeId}
                  cancelingTradeId={cancelingTradeId}
                  onPostTrade={onPostTrade}
                  onCancelTrade={onCancelTrade}
                  canClaim={canClaim}
                  onClaimed={onClaimed}
                  onSelectGroup={onSelectGroup}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
