import { useMemo, useState, type ReactNode } from "react";
import { FilterIcon, ListIcon, CalendarIcon, CalendarDaysIcon, LoaderCircleIcon, XIcon, WorkflowIcon } from "lucide-react";
import { SportPicker } from "@/components/SportPicker";
import { Button } from "@/components/ui/button";
import {
  OperationalActiveFilterChips,
  type OperationalActiveFilter,
  OperationalToolbar,
} from "@/components/OperationalToolbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VENUE_FILTER_OPTIONS, venueFilterActiveClass } from "@/lib/venue-tone";
import {
  AREAS,
  AREA_LABELS,
  type CalendarEntry,
} from "./types";
import type { ScheduleFilters as ScheduleFiltersType, ViewMode, HomeAwayFilter } from "@/hooks/use-schedule-data";
import type { ScheduleSourceSignal as ScheduleSourceSignalData } from "@/lib/calendar-source-freshness";
import { ScheduleSourceSignal } from "./ScheduleSourceSignal";

type ScheduleFiltersProps = {
  filters: ScheduleFiltersType;
  entries: CalendarEntry[];
  /** Rows surviving every active filter, used to size the queue banner. */
  filteredEntries: CalendarEntry[];
  fillingWindow?: boolean;
  sourceSignal?: ScheduleSourceSignalData | null;
};

const VIEW_MODES: { value: ViewMode; label: string; icon: ReactNode }[] = [
  { value: "list", label: "List", icon: <ListIcon className="size-3.5" /> },
  { value: "week", label: "Week", icon: <CalendarDaysIcon className="size-3.5" /> },
  { value: "calendar", label: "Calendar", icon: <CalendarIcon className="size-3.5" /> },
];

const HOME_AWAY_OPTIONS = VENUE_FILTER_OPTIONS as Array<{ value: HomeAwayFilter; label: string }>;
const COVERAGE_OPTIONS = [
  { value: "any", label: "Any" },
  { value: "unfilled", label: "Needs crew" },
  { value: "filled", label: "Fully covered" },
] as const;

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="px-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

export function ScheduleFilters({
  filters,
  entries,
  filteredEntries,
  fillingWindow = false,
  sourceSignal = null,
}: ScheduleFiltersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  /**
   * Sport is the one filter the server applies, so a selected sport narrows the
   * loaded window to itself. Deriving the menu from those rows offered only the
   * sport already selected -- while a sport is on, or the first paint is empty,
   * the full catalog stands in.
   */
  const sportCodesInWindow = useMemo(() => {
    if (filters.sportFilter || entries.length === 0) return undefined;
    const codes = new Set(
      entries.map((e) => e.sportCode).filter(Boolean) as string[],
    );
    return codes.size === 0 ? undefined : codes;
  }, [entries, filters.sportFilter]);

  const isListView = filters.viewMode === "list";
  const menuFilterCount = [
    filters.homeAwayFilter !== "all" ? "venue" : "",
    filters.areaFilter,
    filters.coverageFilter,
    isListView && filters.includeArchived ? "archived" : "",
  ].filter(Boolean).length;
  const activeFilters: OperationalActiveFilter[] = [
    ...(filters.dateRange
      ? [{
          key: "dates",
          label: `Dates: ${formatDateRange(filters.dateRange.startDate, filters.dateRange.endDate)}`,
          onRemove: filters.clearDateRange,
        }]
      : []),
    ...(filters.homeAwayFilter !== "all"
      ? [{
          key: "venue",
          label: `Venue: ${HOME_AWAY_OPTIONS.find((option) => option.value === filters.homeAwayFilter)?.label ?? filters.homeAwayFilter}`,
          onRemove: () => filters.setHomeAwayFilter("all"),
        }]
      : []),
    ...(filters.areaFilter
      ? [{
          key: "area",
          label: `Area: ${AREA_LABELS[filters.areaFilter] ?? filters.areaFilter}`,
          onRemove: () => filters.setAreaFilter(""),
        }]
      : []),
    ...(filters.coverageFilter
      ? [{
          key: "coverage",
          label: filters.coverageFilter === "unfilled" ? "Coverage: Needs crew" : "Coverage: Fully covered",
          onRemove: () => filters.setCoverageFilter(""),
        }]
      : []),
    ...(isListView && filters.includeArchived
      ? [{
          key: "archived",
          label: "Showing older records",
          onRemove: () => filters.setIncludeArchived(false),
        }]
      : []),
  ];

  return (
    <OperationalToolbar className="mb-3">
      {filters.queueMeta && (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-md bg-primary/5 px-3 py-2 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_14%,transparent)]">
          <div className="flex min-w-0 items-center gap-2">
            <WorkflowIcon className="size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {filters.queueMeta.label}
              </div>
              <div className="text-pretty text-xs text-muted-foreground">
                {filteredEntries.length === 1
                  ? "1 event in this shareable queue."
                  : `${filteredEntries.length} events in this shareable queue.`}
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 px-2.5 text-xs"
            onClick={() => filters.setQueue(null)}
          >
            <XIcon className="size-3.5" />
            Clear queue
          </Button>
        </div>
      )}
      <div className="flex flex-row flex-wrap items-center gap-2">
        <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 p-0.5">
          <ToggleGroup
            type="single"
            data-schedule-view-controls
            value={filters.viewMode}
            onValueChange={(value) => {
              if (value) filters.setViewMode(value as ViewMode);
            }}
            className="bg-transparent p-0"
            aria-label="Schedule view"
          >
            {VIEW_MODES.map((mode) => (
              <ToggleGroupItem
                key={mode.value}
                value={mode.value}
                aria-label={`${mode.label} view`}
                className="h-10 gap-1.5 px-3 text-[13px]"
              >
                {mode.icon}
                <span className="max-sm:hidden">{mode.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <Button
          type="button"
          variant={filters.myShiftsOnly ? "default" : "outline"}
          size="sm"
          className="h-10 gap-1.5 text-[13px] transition-[background-color,scale] active:scale-[0.96]"
          onClick={() => filters.setMyShiftsOnly(!filters.myShiftsOnly)}
          aria-pressed={filters.myShiftsOnly}
        >
          My shifts
        </Button>

        <SportPicker
          variant="filter"
          value={filters.sportFilter}
          onValueChange={filters.setSportFilter}
          allowedCodes={sportCodesInWindow}
        />

        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={menuFilterCount > 0 ? "secondary" : "outline"}
              size="sm"
              className="h-10 gap-1.5 text-[13px] transition-[background-color,scale] active:scale-[0.96]"
              aria-expanded={filtersOpen}
            >
              <FilterIcon className="size-3.5" />
              Filters
              {menuFilterCount > 0 && (
                <span className="ml-0.5 rounded-sm bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                  {menuFilterCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
            <div className="flex flex-col gap-3">
              <FilterField label="Venue">
                <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 p-0.5">
                  <ToggleGroup
                    type="single"
                    value={filters.homeAwayFilter}
                    onValueChange={(value) => {
                      if (value) filters.setHomeAwayFilter(value as HomeAwayFilter);
                    }}
                    className="flex flex-wrap bg-transparent p-0"
                    aria-label="Venue filter"
                  >
                    {HOME_AWAY_OPTIONS.map((opt) => {
                      const isActive = filters.homeAwayFilter === opt.value;
                      return (
                        <ToggleGroupItem
                          key={opt.value}
                          value={opt.value}
                          aria-label={`${opt.label} events`}
                          className={cn(
                            "h-10 px-2.5 text-[13px]",
                            isActive
                              ? cn(venueFilterActiveClass(opt.value), "shadow-sm")
                              : "hover:bg-background/50",
                          )}
                        >
                          {opt.label}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                </div>
              </FilterField>
              <FilterField label="Area">
                <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 p-0.5">
                  <ToggleGroup
                    type="single"
                    value={filters.areaFilter || "any"}
                    onValueChange={(value) => {
                      if (!value) return;
                      filters.setAreaFilter(value === "any" ? "" : value);
                    }}
                    className="flex flex-wrap bg-transparent p-0"
                    aria-label="Area filter"
                  >
                    <ToggleGroupItem value="any" aria-label="Any area" className="h-10 px-2.5 text-[13px]">
                      Any
                    </ToggleGroupItem>
                    {AREAS.map((area) => (
                      <ToggleGroupItem
                        key={area}
                        value={area}
                        aria-label={`${AREA_LABELS[area] ?? area} area`}
                        className="h-10 px-2.5 text-[13px]"
                      >
                        {AREA_LABELS[area] ?? area}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </FilterField>
              <FilterField label="Coverage">
                <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 p-0.5">
                  <ToggleGroup
                    type="single"
                    value={filters.coverageFilter || "any"}
                    onValueChange={(value) => {
                      if (!value) return;
                      filters.setCoverageFilter(value === "any" ? "" : value);
                    }}
                    className="bg-transparent p-0"
                    aria-label="Coverage filter"
                  >
                    {COVERAGE_OPTIONS.map((opt) => (
                      <ToggleGroupItem
                        key={opt.value}
                        value={opt.value}
                        aria-label={opt.value === "any" ? "Any coverage" : opt.label}
                        className="h-10 px-2.5 text-[13px]"
                      >
                        {opt.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </FilterField>
              {isListView && (
                <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="archived-events-toggle" className="cursor-pointer text-[13px] font-medium">
                      Older records
                    </Label>
                    <Switch
                      id="archived-events-toggle"
                      checked={filters.includeArchived}
                      onCheckedChange={filters.setIncludeArchived}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Past events are already in List view. This adds records beyond the normal timeline.
                  </p>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {filters.hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={filters.clearAll}
          >
            Clear
            <XIcon className="size-4" />
          </Button>
        )}

        {fillingWindow && (
          <span className="inline-flex min-h-10 items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-3 animate-spin" />
            Searching remaining events
          </span>
        )}

        {sourceSignal && (
          <div className="ml-auto">
            <ScheduleSourceSignal signal={sourceSignal} />
          </div>
        )}
      </div>
      <OperationalActiveFilterChips filters={activeFilters} />
    </OperationalToolbar>
  );
}
