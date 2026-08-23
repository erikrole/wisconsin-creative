"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, EyeOffIcon, UserIcon, UsersRoundIcon } from "lucide-react";
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
  loadData: () => void;
  myShiftsOnly: boolean;
  setMyShiftsOnly: (v: boolean) => void;
  clearFilters: () => void;
  includePast: boolean;
  hasFilters: boolean;
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
    <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-border/50 bg-background/95 px-3 backdrop-blur">
      <span className={cn("text-xs font-semibold", isToday ? "text-[var(--wi-red)]" : "text-foreground")}>
        {dateLabel}
      </span>
      {isToday && <Badge variant="red" size="sm">Today</Badge>}
      <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
        {eventCount} event{eventCount === 1 ? "" : "s"}
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
  onPostTrade,
  onSelectGroup,
  compact = false,
}: {
  entry: CalendarEntry;
  currentUserId: string;
  postingTradeId: string | null;
  onPostTrade?: (assignmentId: string) => void;
  onSelectGroup: () => void;
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
                {onPostTrade && myAssignment && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 shrink-0 px-2 text-xs text-muted-foreground transition-[background-color,color,scale] hover:text-foreground active:scale-[0.96]"
                    disabled={postingTradeId === myAssignment.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPostTrade(myAssignment.id);
                    }}
                  >
                    {postingTradeId === myAssignment.id ? "Posting..." : "Trade"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
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
  includePast,
  hasFilters,
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

  // Scroll to today when includePast is toggled on and data has loaded
  const desktopTodayGroupRef = useRef<HTMLDivElement>(null);
  const mobileTodayGroupRef = useRef<HTMLDivElement>(null);
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (!includePast) { didScrollRef.current = false; return; }
    const todayGroupRef = window.matchMedia("(max-width: 1023px)").matches
      ? mobileTodayGroupRef
      : desktopTodayGroupRef;
    if (didScrollRef.current || !todayGroupRef.current) return;
    didScrollRef.current = true;
    todayGroupRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [includePast, groupedEntries]);

  const [postingTradeId, setPostingTradeId] = useState<string | null>(null);
  const postingTradeRef = useRef<string | null>(null);
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

  return (
    <>
      <div className="overflow-hidden rounded-md border border-border/60 bg-card">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/15 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm! font-semibold! text-foreground">
              {myShiftsOnly ? "My Shifts" : includePast ? "All Events" : "Upcoming Events"}
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
              {groupedEntries.map(([dateKey, groupEntries], groupIdx) => {
                const groupDate = new Date(dateKey);
                const isGroupToday =
                  groupDate.toDateString() === new Date().toDateString();

              return (
                <div key={`${dateKey}-${groupIdx}`} ref={isGroupToday ? desktopTodayGroupRef : undefined}>
                  <DateGroupHeader date={groupDate} eventCount={groupEntries.length} isToday={isGroupToday} />

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
                            onPostTrade={isStaff ? undefined : openTradeDialog}
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
            {groupedEntries.map(([dateKey, groupEntries], groupIdx) => {
              const groupDate = new Date(dateKey);
              const isGroupToday = groupDate.toDateString() === new Date().toDateString();

              return (
                <div key={`${dateKey}-${groupIdx}`} ref={isGroupToday ? mobileTodayGroupRef : undefined}>
                  <DateGroupHeader date={groupDate} eventCount={groupEntries.length} isToday={isGroupToday} />
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
                          onPostTrade={isStaff ? undefined : openTradeDialog}
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
                Add a short note so teammates understand the swap.
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
  onPostTrade,
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
  onPostTrade?: (assignmentId: string) => void;
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
                  onPostTrade={onPostTrade}
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
