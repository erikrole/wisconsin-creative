import { AlertTriangleIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GridAssignment, GridShift } from "@/hooks/use-assignment-grid";
import { effectiveCallWindow, formatCallTime } from "@/lib/shift-call-windows";
import { shiftWorkerSlotLabel } from "@/lib/shift-display";

type Props = {
  shifts: GridShift[];
  /** All-day events have no call time, so their rows state none. */
  allDay?: boolean;
};

export function AssignmentCell({ shifts, allDay = false }: Props) {
  const assignedShifts = shifts
    .map((shift) => ({
      shift,
      assignment: shift.assignments[0] as GridAssignment | undefined,
    }))
    .filter((entry): entry is { shift: GridShift; assignment: GridAssignment } => Boolean(entry.assignment));
  const openShifts = shifts.filter((shift) => shift.assignments.length === 0);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {assignedShifts.map(({ shift, assignment }) => {
        const callWindow = allDay ? null : effectiveCallWindow(shift, assignment);
        return (
          <div key={assignment.id} className="flex min-w-0 flex-col gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex min-w-0 items-center gap-2">
                  <UserAvatar
                    name={assignment.user.name}
                    avatarUrl={assignment.user.avatarUrl}
                    size="sm"
                    className="ring-2 ring-background"
                    fallbackClassName={assignment.hasConflict ? "bg-[var(--orange-bg)] text-[var(--orange-text)]" : undefined}
                  />
                  <span className="max-w-36 truncate text-sm font-medium">{assignment.user.name}</span>
                  {shift.workerType === "ST" && callWindow ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatCallTime(callWindow)}
                    </span>
                  ) : null}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {shiftWorkerSlotLabel(shift.workerType)}
                {callWindow ? ` · Call ${formatCallTime(callWindow)}` : ""}
              </TooltipContent>
            </Tooltip>
            {assignment.hasConflict ? (
              <Badge variant="orange" size="sm" className="max-w-56 gap-1 self-start text-[10px]">
                <AlertTriangleIcon className="size-3 shrink-0" />
                <span className="truncate">{assignment.conflictNote ?? "Schedule conflict"}</span>
              </Badge>
            ) : null}
          </div>
        );
      })}

      {openShifts.length > 0 ? (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground">
          {openShifts.length} open · {openShifts.map((shift) => shiftWorkerSlotLabel(shift.workerType)).join(", ")}
        </span>
      ) : null}

      {shifts.length === 0 ? (
        <span className="text-xs text-muted-foreground/35" aria-label="No shift configured">—</span>
      ) : null}
    </div>
  );
}
