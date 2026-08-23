import { AlertTriangleIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GridAssignment, GridShift } from "@/hooks/use-assignment-grid";
import { effectiveCallWindow, formatCallTime } from "@/lib/shift-call-windows";
import { shiftWorkerSlotLabel } from "@/lib/shift-display";

type Props = {
  shifts: GridShift[];
};

export function AssignmentCell({ shifts }: Props) {
  const assignedShifts = shifts
    .map((shift) => ({
      shift,
      assignment: shift.assignments[0] as GridAssignment | undefined,
    }))
    .filter((entry): entry is { shift: GridShift; assignment: GridAssignment } => Boolean(entry.assignment));
  const openShifts = shifts.filter((shift) => shift.assignments.length === 0);

  return (
    <td className="border-l border-border/40 px-2 py-2 align-middle transition-colors hover:bg-muted/15">
      <div className="flex min-h-10 flex-col items-center justify-center gap-1.5">
        {assignedShifts.map(({ shift, assignment }) => {
          const callWindow = effectiveCallWindow(shift, assignment);
          return (
            <div key={assignment.id} className="flex min-w-0 flex-col items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <UserAvatar
                      name={assignment.user.name}
                      avatarUrl={assignment.user.avatarUrl}
                      size="sm"
                      className="ring-2 ring-background"
                      fallbackClassName={assignment.hasConflict ? "bg-[var(--orange-bg)] text-[var(--orange-text)]" : undefined}
                    />
                    <span className="max-w-24 truncate text-xs font-medium">{assignment.user.name}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {shiftWorkerSlotLabel(shift.workerType)} · Call {formatCallTime(callWindow)}
                </TooltipContent>
              </Tooltip>
              {shift.workerType === "ST" ? (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  Call {formatCallTime(callWindow)}
                </span>
              ) : null}
              {assignment.hasConflict ? (
                <Badge variant="orange" size="sm" className="max-w-40 gap-1 text-[10px]">
                  <AlertTriangleIcon className="size-3 shrink-0" />
                  <span className="truncate">{assignment.conflictNote ?? "Schedule conflict"}</span>
                </Badge>
              ) : null}
            </div>
          );
        })}

        {openShifts.length > 0 ? (
          <Badge variant="outline" size="sm" className="text-[10px] text-muted-foreground">
            {openShifts.length} open · {openShifts.map((shift) => shiftWorkerSlotLabel(shift.workerType)).join(", ")}
          </Badge>
        ) : null}

        {shifts.length === 0 ? (
          <span className="text-xs text-muted-foreground/35" aria-label="No shift configured">—</span>
        ) : null}
      </div>
    </td>
  );
}
