import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AlertTriangle, XIcon } from "lucide-react";
import { CallWindowEditor } from "./CallWindowEditor";
import { UserAvatarPicker, type PickerUser } from "./UserAvatarPicker";
import { effectiveCallWindow, isInheritedFullDayCallWindow } from "@/lib/shift-call-windows";
import { shiftWorkerLabelForProfile, shiftWorkerSlotLabel } from "@/lib/shift-display";
import { cn } from "@/lib/utils";
import {
  AssignSlotButton,
  CREW_ROW_GROUP,
  CREW_ROW_REVEAL,
  CrewSlotStatus,
  CrewTypeLabel,
  crewSlotState,
} from "./crew-row";

type ShiftUser = {
  id: string;
  name: string;
  role?: string;
  staffingType?: string | null;
  avatarUrl?: string | null;
};

type ShiftAssignment = {
  id: string;
  status: string;
  hasConflict?: boolean;
  conflictNote?: string | null;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  callNote?: string | null;
  user: ShiftUser;
};

type Props = {
  shiftId: string;
  workerType: string;
  startsAt: string;
  endsAt: string;
  callStartsAt?: string | null;
  callEndsAt?: string | null;
  eventAllDay?: boolean;
  activeAssignment: ShiftAssignment | null;
  pendingRequests: ShiftAssignment[];
  isStaff: boolean;
  canEdit?: boolean;
  currentUserId?: string;
  acting: string | null;
  // Picker state
  pickerOpen: boolean;
  pickerUsers: PickerUser[];
  pickerLoading: boolean;
  pickerSearch: string;
  onPickerSearchChange: (value: string) => void;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  // Actions
  onAssign: (userId: string) => void;
  onRemove: (assignmentId: string) => void;
  onApprove: (assignmentId: string) => void;
  onDecline: (assignmentId: string) => void;
  onRequest: () => void;
  onDeleteShift: () => void;
  // Trade
  onPostTrade?: (assignmentId: string) => void;
  onCallWindowSaved?: () => void;
};

export function ShiftSlotCard({
  shiftId,
  workerType,
  startsAt,
  endsAt,
  callStartsAt,
  callEndsAt,
  eventAllDay = false,
  activeAssignment,
  pendingRequests,
  isStaff,
  canEdit = isStaff,
  currentUserId,
  acting,
  pickerOpen,
  pickerUsers,
  pickerLoading,
  pickerSearch,
  onPickerSearchChange,
  onOpenPicker,
  onClosePicker,
  onAssign,
  onRemove,
  onApprove,
  onDecline,
  onRequest,
  onDeleteShift,
  onPostTrade,
  onCallWindowSaved,
}: Props) {
  const isAssigned = !!activeAssignment;
  const userHasRequested = pendingRequests.some((a) => a.user.id === currentUserId);
  const isMyAssignment = activeAssignment?.user.id === currentUserId;
  const shiftWindow = { startsAt, endsAt, callStartsAt, callEndsAt };
  const slotWindow = effectiveCallWindow(shiftWindow);
  const assignmentWindow = activeAssignment ? effectiveCallWindow(shiftWindow, activeAssignment) : null;
  const isStudentSlot = workerType === "ST";
  const showSlotWindow = isStudentSlot && !isAssigned && !eventAllDay && !isInheritedFullDayCallWindow(slotWindow);
  const showAssignmentWindow = Boolean(
    isStudentSlot && assignmentWindow && !eventAllDay && !isInheritedFullDayCallWindow(assignmentWindow),
  );
  const roleBadgeLabel = activeAssignment
    ? shiftWorkerLabelForProfile(activeAssignment.user) ?? "Assigned"
    : shiftWorkerSlotLabel(workerType);

  const contextItems = (
    <ContextMenuContent className="w-48">
      {canEdit && isAssigned && (
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onRemove(activeAssignment!.id)}
          disabled={acting !== null}
        >
          Remove assignment
        </ContextMenuItem>
      )}
      {canEdit && (
        <>
          {isAssigned && <ContextMenuSeparator />}
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDeleteShift}
            disabled={acting !== null}
          >
            Remove shift
          </ContextMenuItem>
        </>
      )}
      {!isStaff && isMyAssignment && onPostTrade && (
        <ContextMenuItem onClick={() => onPostTrade(activeAssignment!.id)} disabled={acting !== null}>
          Post for trade
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card elevation="flat" className={cn(CREW_ROW_GROUP, "mb-2 p-3")}>
          {/* Header: status badge + assigned role or open planned slot */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <CrewSlotStatus
                state={crewSlotState(isAssigned, pendingRequests.length)}
                requestCount={pendingRequests.length}
              />
              <CrewTypeLabel label={roleBadgeLabel} />
            </div>
            {showSlotWindow && (
              <CallWindowEditor
                target={canEdit ? { type: "slot", id: shiftId } : undefined}
                effectiveWindow={slotWindow}
                overrideWindow={{ startsAt: callStartsAt ?? null, endsAt: callEndsAt ?? null }}
                onSaved={onCallWindowSaved}
                disabled={acting !== null}
                compact
              />
            )}
            {canEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(CREW_ROW_REVEAL, "size-10 text-muted-foreground hover:text-destructive")}
                    onClick={onDeleteShift}
                    disabled={acting !== null}
                    aria-label="Remove shift"
                  >
                    <XIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove shift</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Active assignment */}
          {activeAssignment && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-2">
                  <UserAvatar
                    name={activeAssignment.user.name}
                    avatarUrl={activeAssignment.user.avatarUrl}
                    size="default"
                  />
                  {activeAssignment.user.name}
                  {activeAssignment.hasConflict && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertTriangle className="size-3.5 text-[var(--orange-text)] shrink-0" aria-label="Schedule conflict" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {activeAssignment.conflictNote ?? "Schedule conflict"}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    className={cn(CREW_ROW_REVEAL, "h-10 px-2 text-xs text-destructive")}
                    onClick={() => onRemove(activeAssignment.id)}
                    disabled={acting !== null}
                  >
                    {acting === activeAssignment.id ? "..." : "Remove"}
                  </Button>
                )}
              </div>
              {showAssignmentWindow && assignmentWindow && (
                <div className="mt-1.5 pl-9">
                  <CallWindowEditor
                    target={canEdit ? { type: "assignment", id: activeAssignment.id } : undefined}
                    effectiveWindow={assignmentWindow}
                    overrideWindow={{ startsAt: activeAssignment.callStartsAt ?? null, endsAt: activeAssignment.callEndsAt ?? null }}
                    onSaved={onCallWindowSaved}
                    disabled={acting !== null}
                    compact
                  />
                </div>
              )}

              {/* Post for trade (own shift, student only) */}
              {!isStaff && onPostTrade && isMyAssignment && (
                <div className="mt-1.5 pl-9">
                  <Button
                    variant="outline"
                    className="h-10 px-3 text-xs"
                    onClick={() => onPostTrade(activeAssignment.id)}
                    disabled={acting !== null}
                  >
                    Post for trade
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Students claim open slots into this queue; staff approve or decline. */}
          {pendingRequests.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {pendingRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-2">
                    <UserAvatar
                      name={req.user.name}
                      avatarUrl={req.user.avatarUrl}
                      size="sm"
                    />
                    {req.user.name}
                  </span>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="h-10 px-3 text-xs"
                        onClick={() => onApprove(req.id)}
                        disabled={acting !== null}
                      >
                        {acting === req.id ? "..." : "Approve"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 px-3 text-xs text-destructive"
                        onClick={() => onDecline(req.id)}
                        disabled={acting !== null}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Empty slot - assign staff-side or let Students claim published Student slots. */}
          {!isAssigned && (
            <div className="mt-1">
              {canEdit && (
                <Popover
                  open={pickerOpen}
                  onOpenChange={(open) => {
                    if (open) onOpenPicker();
                    else onClosePicker();
                  }}
                >
                  <PopoverTrigger asChild>
                    <AssignSlotButton
                      disabled={acting !== null}
                      aria-label={`Assign ${shiftWorkerSlotLabel(workerType).toLowerCase()}`}
                    />
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <UserAvatarPicker
                      users={pickerUsers}
                      loading={pickerLoading}
                      search={pickerSearch}
                      onSearchChange={onPickerSearchChange}
                      onSelect={(userId) => onAssign(userId)}
                      disabled={acting !== null}
                      slotWorkerType={workerType}
                    />
                  </PopoverContent>
                </Popover>
              )}
              {!isStaff && workerType === "ST" && !userHasRequested && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-10 text-xs"
                  onClick={onRequest}
                  disabled={acting !== null}
                >
                  {acting === shiftId ? "Claiming..." : "Claim this shift"}
                </Button>
              )}
              {userHasRequested && (
                <span className="text-xs text-muted-foreground pl-1">Your request is waiting for staff approval</span>
              )}
            </div>
          )}
        </Card>
      </ContextMenuTrigger>
      {contextItems}
    </ContextMenu>
  );
}
