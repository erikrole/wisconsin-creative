"use client";

import Link from "next/link";
import { EyeOffIcon, UserIcon, UsersRoundIcon, XIcon } from "lucide-react";
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
import { UserAvatarGroup } from "@/components/UserAvatarGroup";
import { ClaimShiftAction, ClaimsPausedNotice } from "@/components/ClaimShiftAction";
import { CallWindowEditor } from "@/components/shift-detail/CallWindowEditor";
import { CrewTag } from "@/components/shift-detail/CrewTag";
import { cn } from "@/lib/utils";
import { shiftWorkerLabel, shiftWorkerLabelForProfile } from "@/lib/shift-display";
import {
  callWindowKey,
  effectiveCallWindow,
  formatCallWindowLabel,
  isInheritedFullDayCallWindow,
  studentCallTimeAppliesToEvent,
} from "@/lib/shift-call-windows";
import { CREW_ROW_GROUP, CrewAreaDot, CrewAreaLabel, CrewTypeLabel } from "@/components/shift-detail/crew-row";
import type { CalendarEntry } from "./types";
import { ACTIVE_STATUSES, AREA_LABELS, scheduleEventTitleParts } from "./types";
import { useNow } from "@/hooks/use-now";
import { type CrewTemplateSide } from "./ListView";
import {
  activeShiftAssignment,
  commonCallWindow,
  openShiftCount,
  roleSlotLabel,
  shiftAssignee,
  workerKindForShift,
} from "./list-view-helpers";

export function CrewRowActions({
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

export function DateGroupHeader({ date, eventCount, isToday }: { date: Date; eventCount: number; isToday: boolean }) {
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
      {isToday && (
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          Past above · upcoming below
        </span>
      )}
      <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
        {eventCount === 0 ? "No events" : `${eventCount} event${eventCount === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

export function CrewSummary({
  entry,
  compact = false,
}: {
  entry: CalendarEntry;
  compact?: boolean;
}) {
  const assignedUsers = entry.shifts
    .map(shiftAssignee)
    .filter((user): user is NonNullable<ReturnType<typeof shiftAssignee>> => Boolean(user));
  // Open seats are already in the coverage cell beside it; the crew cell only shows who is on.
  if (assignedUsers.length === 0) return null;

  return (
    <div className={cn("flex min-w-0 items-center", compact ? "justify-start" : "justify-end")}>
      <UserAvatarGroup users={assignedUsers} max={compact ? 3 : 4} />
    </div>
  );
}

export function ShiftRowList({
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
  const now = useNow();
  const commonCall = commonCallWindow(entry);

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-1.5")}>
      {entry.claimsPaused && canClaim && (
        <ClaimsPausedNotice
          className={cn(
            "rounded-md px-2 py-1.5",
            compact ? "bg-muted/30" : "bg-muted/20",
          )}
        />
      )}
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
          && new Date(effectiveStart).getTime() > now,
        );
        const areaLabel = AREA_LABELS[shift.area] ?? shift.area;
        const workerType = workerKindForShift(shift);
        const slotLabel = roleSlotLabel(workerType);
        const assignedClassLabel = user ? shiftWorkerLabelForProfile(user) : null;
        const assignedClassDiffersFromSlot = Boolean(assignedClassLabel && `${assignedClassLabel} slot` !== slotLabel);
        const slotWindow = effectiveCallWindow(shift);
        const assignmentWindow = activeAssignment ? effectiveCallWindow(shift, activeAssignment) : null;
        const visibleWindow = assignmentWindow ?? slotWindow;
        const showCallWindows = !entry.allDay && workerType === "ST" && studentCallTimeAppliesToEvent(entry);
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
                    <CrewTag label={activeAssignment?.crewLabel} half={activeAssignment?.crewHalf} />
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
                    claimsPaused={Boolean(entry.claimsPaused)}
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
