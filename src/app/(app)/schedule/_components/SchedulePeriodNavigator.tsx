import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type SchedulePeriodNavigatorProps = {
  title: string;
  summary: string;
  isCurrent: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  previousLabel: string;
  nextLabel: string;
};

export function SchedulePeriodNavigator({
  title,
  summary,
  isCurrent,
  onPrevious,
  onNext,
  onToday,
  previousLabel,
  nextLabel,
}: SchedulePeriodNavigatorProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3" data-schedule-period-nav>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="size-10 text-muted-foreground"
            onClick={onPrevious}
            aria-label={previousLabel}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="size-10 text-muted-foreground"
            onClick={onNext}
            aria-label={nextLabel}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
        <div className="min-w-0">
          <h2
            className="truncate text-base! font-bold! uppercase tracking-tight text-foreground sm:text-lg!"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {title}
          </h2>
          <p className="truncate text-[11px] text-muted-foreground" aria-live="polite">
            {summary}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        className="h-10"
        onClick={onToday}
        disabled={isCurrent}
        aria-current={isCurrent ? "date" : undefined}
      >
        {isCurrent ? "Current" : "Today"}
      </Button>
    </div>
  );
}
