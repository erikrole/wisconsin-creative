import { cn } from "@/lib/utils";
import { coverageVariant } from "./types";

/**
 * Shared coverage vocabulary for the Schedule browse views. Calendar, Week,
 * and List all express the same thing — filled/total shifts with a green
 * (covered) / orange (partial) / red (uncovered) accent — so the indicator is
 * unified here and only the container density differs per view:
 *   - `CoverageTag`  : dot + fraction, for tight chips (Calendar).
 *   - `CoverageMeter`: fill bar + fraction, for cards (Week).
 *   - `CoverageBadge`: dot + plain "Covered" or "N open", for scannable table rows (List).
 */

type CoverageProps = {
  percentage: number;
  filled: number;
  total: number;
  className?: string;
};

function accentClass(percentage: number): string {
  const variant = coverageVariant(percentage);
  if (variant === "green") return "bg-[var(--green)]";
  if (variant === "orange") return "bg-[var(--orange)]";
  return "bg-[var(--red)]";
}

/** Compact dot + fraction for narrow surfaces (calendar cells). */
export function CoverageTag({ percentage, filled, total, className }: CoverageProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 flex-shrink-0 tabular-nums", className)}
      aria-label={`${filled} of ${total} shifts filled`}
    >
      <span className={cn("size-1.5 rounded-full", accentClass(percentage))} />
      <span className="text-[9px] font-semibold leading-none text-muted-foreground">
        {filled}/{total}
      </span>
    </span>
  );
}

/** Fill bar + fraction for roomier cards and rows. */
export function CoverageMeter({ percentage, filled, total, className }: CoverageProps) {
  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      aria-label={`${filled} of ${total} shifts filled`}
    >
      <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-muted/70">
        <div
          className={cn("h-full rounded-full transition-[width]", accentClass(percentage))}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-[9px] font-medium tabular-nums text-muted-foreground">
        {filled}/{total}
      </span>
    </div>
  );
}

/** Dot + "Covered" or "N open", for scannable operational table rows (List view). */
export function CoverageBadge({ percentage, filled, total, className }: CoverageProps) {
  const open = Math.max(0, total - filled);
  return (
    <span
      className={cn("flex items-center gap-1.5 text-xs font-medium tabular-nums", className)}
      aria-label={`${filled} of ${total} shifts filled`}
    >
      <span className={cn("inline-flex size-[7px] flex-shrink-0 rounded-full", accentClass(percentage))} />
      <span className={open === 0 ? "text-muted-foreground" : "text-foreground"}>
        {open === 0 ? "Covered" : `${open} open`}
      </span>
    </span>
  );
}
