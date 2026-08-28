import { useMemo, type ReactNode } from "react";
import { FilterIcon, ListIcon, CalendarIcon, CalendarDaysIcon, XIcon, WorkflowIcon } from "lucide-react";
import { FilterChip } from "@/components/FilterChip";
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
import { SPORT_CODES, sportLabel } from "@/lib/sports";
import { cn } from "@/lib/utils";
import { VENUE_FILTER_OPTIONS, venueFilterActiveClass } from "@/lib/venue-tone";
import {
  AREAS,
  AREA_LABELS,
  type CalendarEntry,
} from "./types";
import type { ScheduleFilters as ScheduleFiltersType, ViewMode, HomeAwayFilter } from "@/hooks/use-schedule-data";

type ScheduleFiltersProps = {
  filters: ScheduleFiltersType;
  entries: CalendarEntry[];
  /** Rows surviving every active filter, used to size the queue banner. */
  filteredEntries: CalendarEntry[];
};

const VIEW_MODES: { value: ViewMode; label: string; icon: ReactNode }[] = [
  { value: "list", label: "List", icon: <ListIcon className="size-3.5" /> },
  { value: "week", label: "Week", icon: <CalendarDaysIcon className="size-3.5" /> },
  { value: "calendar", label: "Calendar", icon: <CalendarIcon className="size-3.5" /> },
];

const HOME_AWAY_OPTIONS = VENUE_FILTER_OPTIONS as Array<{ value: HomeAwayFilter; label: string }>;

function ToolbarGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 max-sm:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}

export function ScheduleFilters({ filters, entries, filteredEntries }: ScheduleFiltersProps) {
  /**
   * Sport is the one filter the server applies, so a selected sport narrows the
   * loaded window to itself. Deriving the options from those rows offered the
   * reader only the sport they were already on, leaving no way to switch
   * without clearing first -- so while a sport is selected the full list stands
   * in for a window that can no longer answer which other sports have events.
   */
  const sportOptions = useMemo(() => {
    if (filters.sportFilter) {
      return SPORT_CODES.map((s) => ({ value: s.code, label: s.label }));
    }
    const codes = new Set(
      entries.map((e) => e.sportCode).filter(Boolean) as string[],
    );
    return SPORT_CODES.filter((s) => codes.has(s.code)).map((s) => ({
      value: s.code,
      label: s.label,
    }));
  }, [entries, filters.sportFilter]);

  const isListView = filters.viewMode === "list";
  const menuFilterCount = [
    filters.areaFilter,
    filters.coverageFilter,
    isListView && filters.includeArchived ? "archived" : "",
  ].filter(Boolean).length;
  const activeFilters: OperationalActiveFilter[] = [
    ...(filters.homeAwayFilter !== "all"
      ? [{
          key: "venue",
          label: `Venue: ${HOME_AWAY_OPTIONS.find((option) => option.value === filters.homeAwayFilter)?.label ?? filters.homeAwayFilter}`,
          onRemove: () => filters.setHomeAwayFilter("all"),
        }]
      : []),
    ...(filters.myShiftsOnly
      ? [{
          key: "my-shifts",
          label: "My shifts",
          onRemove: () => filters.setMyShiftsOnly(false),
        }]
      : []),
    ...(filters.sportFilter
      ? [{
          key: "sport",
          label: `Sport: ${sportLabel(filters.sportFilter)}`,
          onRemove: () => filters.setSportFilter(""),
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
          label: "Showing archived events",
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
      <div className="flex flex-row items-center gap-2 flex-wrap">
        {/* View mode toggle */}
        <ToolbarGroup label="View">
          <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 p-0.5">
            <ToggleGroup
              type="single"
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
        </ToolbarGroup>

        {/* Divider */}
        <div className="mx-0.5 h-6 w-px bg-border/80 max-sm:hidden" />

        {/* Venue filter */}
        <ToolbarGroup label="Venue">
          <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 p-0.5">
            <ToggleGroup
              type="single"
              value={filters.homeAwayFilter}
              onValueChange={(value) => {
                if (value) filters.setHomeAwayFilter(value as HomeAwayFilter);
              }}
              className="bg-transparent p-0"
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
        </ToolbarGroup>

        {/* Divider */}
        <div className="mx-0.5 h-6 w-px bg-border/80 max-sm:hidden" />

        <FilterChip
          label="Sport"
          value={filters.sportFilter}
          displayValue={filters.sportFilter ? sportLabel(filters.sportFilter) : ""}
          options={sportOptions}
          onSelect={(value) => filters.setSportFilter(value)}
          onClear={() => filters.setSportFilter("")}
        />

        <div className="mx-0.5 h-6 w-px bg-border/80 max-sm:hidden" />

        {/* My Shifts toggle */}
        <Label
          htmlFor="my-shifts-toggle"
          className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5"
        >
          <Switch
            id="my-shifts-toggle"
            checked={filters.myShiftsOnly}
            onCheckedChange={filters.setMyShiftsOnly}
          />
          <span className="whitespace-nowrap text-[13px] font-medium">
            My Shifts
          </span>
        </Label>

        {/* Data filters popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={menuFilterCount > 0 ? "secondary" : "outline"}
              size="sm"
              className="h-10 gap-1.5 text-[13px] transition-[background-color,scale] active:scale-[0.96]"
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
          <PopoverContent align="start" className="w-72 p-3">
            <div className="flex flex-col gap-3">
              {isListView && (
                <div className="flex flex-col gap-2 border-b border-border/50 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="archived-events-toggle" className="text-[13px] font-medium cursor-pointer">
                      Archived events
                    </Label>
                    <Switch
                      id="archived-events-toggle"
                      checked={filters.includeArchived}
                      onCheckedChange={filters.setIncludeArchived}
                    />
                  </div>
                </div>
              )}
              <FilterChip
                label="Area"
                value={filters.areaFilter}
                displayValue={
                  filters.areaFilter
                    ? (AREA_LABELS[filters.areaFilter] ?? filters.areaFilter)
                    : ""
                }
                options={AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] ?? a }))}
                onSelect={(v) => filters.setAreaFilter(v)}
                onClear={() => filters.setAreaFilter("")}
              />
              <FilterChip
                label="Coverage"
                value={filters.coverageFilter}
                displayValue={
                  filters.coverageFilter === "unfilled"
                    ? "Needs crew"
                    : filters.coverageFilter === "filled"
                      ? "Fully covered"
                      : ""
                }
                options={[
                  { value: "unfilled", label: "Needs crew" },
                  { value: "filled", label: "Fully covered" },
                ]}
                onSelect={(v) => filters.setCoverageFilter(v)}
                onClear={() => filters.setCoverageFilter("")}
              />
              {filters.hasFilters && (
                <div className="pt-1 border-t border-border/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-full text-xs font-medium"
                    onClick={filters.clearAll}
                  >
                    <XIcon className="size-3 mr-1" />
                    Clear all
                  </Button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

      </div>
      <OperationalActiveFilterChips filters={activeFilters} />
    </OperationalToolbar>
  );
}
