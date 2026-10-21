import { UserAvatar } from "@/components/UserAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GridAssignment, GridShift } from "@/hooks/use-assignment-grid";
import { effectiveCallWindow, formatCallTime } from "@/lib/shift-call-windows";
import { shiftWorkerSlotLabel } from "@/lib/shift-display";
import { cn } from "@/lib/utils";

type Props = {
  shifts: GridShift[];
  /** All-day events have no call time, so their rows state none. */
  allDay?: boolean;
  focusUserId?: string | null;
};

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

export function AssignmentCell({ shifts, allDay = false, focusUserId = null }: Props) {
  const assignedShifts = shifts
    .map((shift) => ({
      shift,
      assignment: shift.assignments[0] as GridAssignment | undefined,
    }))
    .filter((entry): entry is { shift: GridShift; assignment: GridAssignment } => Boolean(entry.assignment));
  const openShifts = shifts.filter((shift) => shift.assignments.length === 0);

  return (
    <td className="border-l border-[var(--border)] px-2.5 py-2 align-top">
      <div className="flex min-h-10 flex-col gap-1">
        {assignedShifts.map(({ shift, assignment }) => {
          const callWindow = allDay ? null : effectiveCallWindow(shift, assignment);
          return (
            <Tooltip key={assignment.id}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 transition-opacity",
                    assignment.hasConflict && "bg-[var(--orange-bg)]",
                    focusUserId && assignment.user.id !== focusUserId && "opacity-25",
                    focusUserId === assignment.user.id && "bg-[var(--bg-surface)] ring-1 ring-[var(--border)]",
                  )}
                >
                  <UserAvatar
                    name={assignment.user.name}
                    avatarUrl={assignment.user.avatarUrl}
                    size="xs"
                    className={cn(assignment.hasConflict && "ring-2 ring-[var(--orange)]")}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold leading-4">{firstName(assignment.user.name)}</span>
                    {assignment.hasConflict ? (
                      <span className="block truncate text-[11px] leading-4 text-[var(--orange-text)]">
                        {assignment.conflictNote ?? "Schedule conflict"}
                      </span>
                    ) : shift.workerType === "ST" && callWindow ? (
                      <span className="block truncate text-[11px] tabular-nums leading-4 text-[var(--text-muted)]">
                        Call {formatCallTime(callWindow)}
                      </span>
                    ) : null}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {assignment.user.name} · {shiftWorkerSlotLabel(shift.workerType)}
                {callWindow ? ` · Call ${formatCallTime(callWindow)}` : ""}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {openShifts.length > 0 ? (
          <span
            className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[12px] text-[var(--text-secondary)]"
            title={openShifts.map((shift) => shiftWorkerSlotLabel(shift.workerType)).join(", ")}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--text-muted)] text-[10px] font-bold tabular-nums">
              {openShifts.length}
            </span>
            <span className="truncate">
              open{openShifts.length === 1 ? ` ${shiftWorkerSlotLabel(openShifts[0]!.workerType).toLowerCase()}` : ""}
            </span>
          </span>
        ) : null}

        {shifts.length === 0 ? (
          <span className="px-1 text-xs text-[var(--text-muted)]/50" aria-label="No shift configured">—</span>
        ) : null}
      </div>
    </td>
  );
}
