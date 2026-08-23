"use client";

import { forwardRef, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shiftWorkerLabel } from "@/lib/shift-display";
import { cn } from "@/lib/utils";
import { AREA_LABELS } from "@/types/areas";

/**
 * Shared vocabulary for every crew surface: the Event detail Crew table, the
 * Schedule expanded-row editors, and the shift detail panel.
 *
 * A crew row carries one signal. State is a small coloured dot plus a neutral
 * label, crew type is plain muted text, and destructive controls stay hidden
 * until the row is hovered or focused. Anything that would add a second
 * coloured pill to a row belongs somewhere else on the surface.
 */

/* ───── Row chrome ───── */

/** Put this on the row element so {@link CREW_ROW_REVEAL} has a group to watch. */
export const CREW_ROW_GROUP = "group/crew-row";

/**
 * Reveal-on-hover for row-level actions. The group name is fixed because
 * Tailwind only emits classes it can read literally in source.
 */
export const CREW_ROW_REVEAL =
  "transition-opacity sm:opacity-0 sm:group-hover/crew-row:opacity-100 sm:group-focus-within/crew-row:opacity-100 sm:focus-visible:opacity-100";

/** Quiet call-time trigger, optically aligned to the left edge of its column. */
export const CREW_CALL_TRIGGER_CLASS = "-ml-2 font-normal text-muted-foreground hover:text-foreground";

/* ───── Slot state ───── */

export type CrewSlotState = "filled" | "open" | "requested";

const STATE_TONE: Record<CrewSlotState, string> = {
  filled: "bg-[var(--green-text)]",
  open: "bg-[var(--red-text)]",
  requested: "bg-[var(--orange-text)]",
};

export function crewSlotState(hasAssignment: boolean, requestCount = 0): CrewSlotState {
  if (hasAssignment) return "filled";
  return requestCount > 0 ? "requested" : "open";
}

export function crewSlotStateLabel(state: CrewSlotState, requestCount = 0): string {
  if (state === "filled") return "Filled";
  if (state === "requested") return `${requestCount} request${requestCount === 1 ? "" : "s"} waiting`;
  return "Open";
}

export function CrewStateDot({ state, className }: { state: CrewSlotState; className?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", STATE_TONE[state], className)}
      aria-hidden="true"
    />
  );
}

/** Read-only state cell: coloured dot, neutral label. */
export function CrewSlotStatus({
  state,
  requestCount = 0,
  className,
}: {
  state: CrewSlotState;
  requestCount?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <CrewStateDot state={state} />
      {crewSlotStateLabel(state, requestCount)}
    </span>
  );
}

/* ───── Area ───── */

const AREA_TONE: Record<string, string> = {
  VIDEO: "bg-[var(--green-text)]",
  PHOTO: "bg-[var(--purple-text)]",
  GRAPHICS: "bg-[var(--blue-text)]",
  SOCIAL: "bg-[var(--red-text)]",
  COMMS: "bg-[var(--orange-text)]",
  LIVE_PRODUCTION: "bg-muted-foreground",
};

export function areaLabel(area: string): string {
  return AREA_LABELS[area] ?? area;
}

/**
 * Area colour survives as a dot for flat lists that cannot group by area.
 * Grouped surfaces use {@link CrewAreaHeading} and need no colour at all.
 */
export function CrewAreaDot({ area, className }: { area: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", AREA_TONE[area] ?? "bg-muted-foreground", className)}
      aria-hidden="true"
    />
  );
}

export function CrewAreaLabel({ area, className }: { area: string; className?: string }) {
  return (
    <span className={cn("min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-foreground/70", className)}>
      {areaLabel(area)}
    </span>
  );
}

/** Group header for an area: name, filled count, and the area's own actions. */
export function CrewAreaHeading({
  area,
  filled,
  total,
  action,
  className,
}: {
  area: string;
  filled: number;
  total: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="flex min-w-0 items-baseline gap-2">
        <CrewAreaLabel area={area} />
        {total > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {filled}/{total}
          </span>
        )}
      </span>
      {action}
    </div>
  );
}

/* ───── Crew type ───── */

/** Staff/Student as plain text. Emphasised when it differs from the slot. */
export function CrewTypeLabel({
  workerType,
  label,
  emphasis = false,
  className,
}: {
  workerType?: string | null;
  label?: string | null;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 truncate text-xs",
        emphasis ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {label ?? shiftWorkerLabel(workerType)}
    </span>
  );
}

/* ───── Assign ───── */

/**
 * The one open-slot affordance: a dashed avatar ring that fills in on hover.
 * Forwards its ref so it can be a Popover/Dropdown trigger via `asChild`.
 */
export const AssignSlotButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { busy?: boolean }
>(function AssignSlotButton({ busy = false, className, children, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      className={cn(
        "group/assign -ml-1.5 h-10 w-fit justify-start gap-2 px-1.5 font-normal text-muted-foreground/70 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {busy ? (
        <span className="text-xs">Assigning...</span>
      ) : (
        <>
          <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/30 transition-colors group-hover/assign:border-primary/50">
            <PlusIcon className="size-3 text-muted-foreground/50 transition-colors group-hover/assign:text-primary" />
          </span>
          {children ?? "Assign"}
        </>
      )}
    </Button>
  );
});

/* ───── Add slot ───── */

/** Staff/Student slot creation, worded and placed the same on every surface. */
export function AddSlotMenu({
  area,
  disabled,
  onAdd,
}: {
  area: string;
  disabled?: boolean;
  onAdd: (workerType: "FT" | "ST") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
          disabled={disabled}
          aria-label={`Add ${areaLabel(area)} staff or student slot`}
        >
          <PlusIcon className="size-3" />
          Add slot
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => onAdd("FT")}>Add Staff slot</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAdd("ST")}>Add Student slot</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
