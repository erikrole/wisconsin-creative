"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { useAssignmentGrid } from "@/hooks/use-assignment-grid";
import { AssignmentGrid } from "./AssignmentGrid";
import { WorkloadPanel } from "./WorkloadPanel";
import { AutoAssignDialog, type AutoAssignCustomWindow } from "@/components/schedule/AutoAssignDialog";
import { SPORT_CODES } from "@/lib/sports";
import { AREAS, AREA_LABELS, type Area } from "@/types/areas";
import { cn } from "@/lib/utils";
import { CalendarOffIcon, ChevronLeft, ChevronRight, FilterIcon, SparklesIcon } from "lucide-react";
import { FRESH_SCOPE_CLASS } from "@/lib/fonts/fresh";
import {
  filterEventsByAssignmentReview,
  summarizeAssignmentReview,
  type ReviewFilter,
} from "@/lib/assignment-conflict-review";
import { useSyncedDraft } from "@/hooks/use-synced-draft";

export function AssignPageClient() {
  const router = useRouter();
  const grid = useAssignmentGrid();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  // A focused person may not work the next month; start each month unfocused.
  const [focusUserId, setFocusUserId] = useSyncedDraft(grid.month, (): string | null => null);

  const reviewSummary = useMemo(() => summarizeAssignmentReview(grid.events), [grid.events]);
  const reviewEvents = useMemo(
    () => filterEventsByAssignmentReview(grid.events, reviewFilter),
    [grid.events, reviewFilter],
  );
  const monthLabel = grid.month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  // The grid is a month view, so auto assignment offers that month as its own
  // period option alongside the standard presets.
  const monthWindow = useMemo<AutoAssignCustomWindow>(() => {
    const monthStart = new Date(grid.month.getFullYear(), grid.month.getMonth(), 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = monthStart < today ? today : monthStart;
    const end = new Date(grid.month.getFullYear(), grid.month.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      rangeStartsAt: start.toISOString(),
      rangeEndsAt: end.toISOString(),
      label: grid.month.toLocaleDateString("en-US", { month: "long" }),
    };
  }, [grid.month]);
  const scopeArea = AREAS.includes(grid.areaFilter as Area) ? grid.areaFilter as Area : null;
  const scopeSportCodes = useMemo(
    () => (grid.sportFilter ? [grid.sportFilter] : []),
    [grid.sportFilter],
  );
  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);
  const previousMonthDisabled = grid.month <= currentMonthStart;

  function prevMonth() {
    if (previousMonthDisabled) return;
    const d = grid.month;
    grid.setMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  function nextMonth() {
    const d = grid.month;
    grid.setMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function thisMonth() {
    const d = new Date();
    grid.setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  const reviewOptions: Array<{ value: ReviewFilter; label: string; count: number | null; tone?: "warning" }> = [
    { value: "all", label: "All", count: null },
    { value: "open", label: "Open", count: reviewSummary.open },
    { value: "conflicts", label: "Conflicts", count: reviewSummary.conflicts, tone: "warning" },
    { value: "clean", label: "Clean", count: reviewSummary.cleanAssignments },
  ];

  return (
    <FadeUp className={FRESH_SCOPE_CLASS}>
      <PageHeader
        title="Assign shifts"
        description="Review coverage and conflicts here. Open an event to manage its crew in the private working schedule; changes release together after review."
      >
        <Button variant="outline" className="h-10" onClick={() => router.push("/schedule")}>
          <ChevronLeft className="size-4" />
          Schedule
        </Button>
        <Button variant="outline" className="h-10" onClick={() => router.push("/staff/availability")}>
          <CalendarOffIcon className="size-4" />
          Availability
        </Button>
        <Button className="h-10" onClick={() => setAutoAssignOpen(true)} disabled={grid.loading}>
          <SparklesIcon className="size-4" />
          Auto assign
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-10 items-center rounded-lg border border-[var(--border)] bg-[var(--background)]">
          <Button
            variant="ghost"
            className="size-10 rounded-r-none"
            onClick={prevMonth}
            disabled={previousMonthDisabled}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-10 min-w-[9rem] rounded-none px-3 text-sm font-bold"
            onClick={thisMonth}
          >
            {monthLabel}
          </Button>
          <Button variant="ghost" className="size-10 rounded-l-none" onClick={nextMonth} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <Select value={grid.sportFilter || "_all"} onValueChange={(v) => grid.setSportFilter(v === "_all" ? "" : v)}>
          <SelectTrigger
            id="assignment-sport-filter"
            name="assignmentSportFilter"
            size="sm"
            className="h-10 w-44"
            aria-label="Assignment sport filter"
          >
            <SelectValue placeholder="All sports" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All sports</SelectItem>
            {SPORT_CODES.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={grid.areaFilter || "_all"} onValueChange={(v) => grid.setAreaFilter(v === "_all" ? "" : v)}>
          <SelectTrigger
            id="assignment-area-filter"
            name="assignmentAreaFilter"
            size="sm"
            className="h-10 w-36"
            aria-label="Assignment area filter"
          >
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All areas</SelectItem>
            {AREAS.map((a) => (
              <SelectItem key={a} value={a}>
                {AREA_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {grid.sportFilter || grid.areaFilter ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text)]"
            onClick={() => {
              grid.setSportFilter("");
              grid.setAreaFilter("");
            }}
          >
            <FilterIcon className="size-3.5" />
            Clear
          </Button>
        ) : null}

        <ToggleGroup
          type="single"
          value={reviewFilter}
          onValueChange={(value) => {
            if (value) setReviewFilter(value as ReviewFilter);
          }}
          className="ml-auto h-10 rounded-lg bg-[var(--bg-surface)] p-1"
          aria-label="Filter assignment review state"
        >
          {reviewOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-8 gap-1.5 rounded-md px-3 text-xs font-bold data-[state=on]:bg-[var(--background)] data-[state=on]:shadow-sm"
            >
              {option.label}
              {option.count !== null ? (
                <span
                  className={cn(
                    "tabular-nums",
                    option.tone === "warning" && option.count > 0 ? "text-[var(--orange-text)]" : "text-[var(--text-muted)]",
                  )}
                >
                  {grid.loading ? "–" : option.count}
                </span>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {grid.error && (
        <div className="mb-4 text-sm text-destructive">
          {grid.error === "network"
            ? "You're offline - schedule data unavailable."
            : "Failed to load schedule. Try refreshing."}
        </div>
      )}

      <WorkloadPanel
        events={grid.events}
        loading={grid.loading}
        monthLabel={grid.month.toLocaleDateString("en-US", { month: "long" })}
        focusUserId={focusUserId}
        onFocusUser={setFocusUserId}
      />

      <AssignmentGrid
        events={reviewEvents}
        focusUserId={focusUserId}
        columns={grid.columns}
        hasFilters={Boolean(grid.sportFilter || grid.areaFilter || reviewFilter !== "all")}
        onClearFilters={() => {
          grid.setSportFilter("");
          grid.setAreaFilter("");
          setReviewFilter("all");
        }}
        monthLabel={monthLabel}
        onViewSchedule={() => router.push("/schedule")}
      />

      <AutoAssignDialog
        open={autoAssignOpen}
        onOpenChange={setAutoAssignOpen}
        initialSportCodes={scopeSportCodes}
        initialArea={scopeArea}
        initialPeriod="custom"
        customWindow={monthWindow}
        onApplied={() => grid.refetch()}
      />
    </FadeUp>
  );
}
