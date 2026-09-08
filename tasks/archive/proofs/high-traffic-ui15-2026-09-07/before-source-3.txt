"use client";

import { SPORT_CODES } from "@/lib/sports";
import { FilterChip } from "@/components/FilterChip";
import { OperationalActiveFilterChips, OperationalToolbar, type OperationalActiveFilter } from "@/components/OperationalToolbar";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import type { BookingListConfig, Location, FormUser } from "./types";

export type BookingFiltersProps = {
  config: BookingListConfig;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  specialFilter: string;
  onSpecialFilterChange: (v: string) => void;
  sportFilter: string;
  onSportFilterChange: (v: string) => void;
  sportCodesInUse: string[];
  locationFilter: string;
  onLocationFilterChange: (v: string) => void;
  locations: Location[];
  userFilter: string;
  onUserFilterChange: (v: string) => void;
  users: FormUser[];
  onClearAll: () => void;
};

export function BookingFilters({
  config,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  specialFilter,
  onSpecialFilterChange,
  sportFilter,
  onSportFilterChange,
  sportCodesInUse,
  locationFilter,
  onLocationFilterChange,
  locations,
  userFilter,
  onUserFilterChange,
  users,
  onClearAll,
}: BookingFiltersProps) {
  const title = statusFilter
    ? config.statusOptions.find((s) => s.value === statusFilter)?.label ?? "Filtered"
    : specialFilter
      ? specialFilter === "overdue" ? "Overdue" : "Due today"
      : config.scopeLabel ?? "All";
  const activeFilters: OperationalActiveFilter[] = [
    ...(specialFilter
      ? [{
        key: "special",
        label: `View: ${specialFilter === "overdue" ? "Overdue" : "Due today"}`,
        onRemove: () => onSpecialFilterChange(""),
      }]
      : []),
    ...(!specialFilter && statusFilter
      ? [{
        key: "status",
        label: `Status: ${config.statusOptions.find((s) => s.value === statusFilter)?.label ?? statusFilter}`,
        onRemove: () => onStatusFilterChange(""),
      }]
      : []),
    ...(config.hasSportFilter && sportFilter
      ? [{
        key: "sport",
        label: `Sport: ${sportFilter}`,
        onRemove: () => onSportFilterChange(""),
      }]
      : []),
    ...(locationFilter
      ? [{
        key: "location",
        label: `Location: ${locations.find((l) => l.id === locationFilter)?.name ?? locationFilter}`,
        onRemove: () => onLocationFilterChange(""),
      }]
      : []),
    ...(userFilter
      ? [{
        key: "user",
        label: `User: ${users.find((u) => u.id === userFilter)?.name ?? userFilter}`,
        onRemove: () => onUserFilterChange(""),
      }]
      : []),
  ];

  return (
    <div className="p-4">
      <OperationalToolbar>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="min-w-0 shrink-0 text-sm font-semibold text-foreground lg:w-[170px]">
            {title} {config.labelPlural.toLowerCase()}
          </div>
          <div className="relative min-w-0 flex-1">
            <DebouncedSearchInput
              id={`${config.kind.toLowerCase()}-booking-search`}
              name={`${config.kind.toLowerCase()}-booking-search`}
              className="text-base md:text-sm"
              placeholder="Search by title or requester"
              value={search}
              onValueChange={onSearchChange}
              aria-label="Search bookings by title or requester"
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {config.kind === "RESERVATION" && !specialFilter && (
              <>
                <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => onSpecialFilterChange("due-today")}>
                  Event day
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => onSpecialFilterChange("overdue")}>
                  Past due
                </Button>
              </>
            )}
            {specialFilter ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="relative h-10 gap-1.5 rounded-md border border-primary/20 bg-primary/[0.06] px-3 text-xs text-foreground shadow-[0_1px_0_rgba(15,23,42,0.05)] transition-[background-color,border-color,color,scale] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-primary/60 hover:bg-primary/[0.08] active:scale-[0.96]"
                onClick={() => onSpecialFilterChange("")}
                aria-label={`Clear ${specialFilter === "overdue" ? "overdue" : "due today"} filter`}
              >
                <span className="font-medium">Showing:</span>
                <span className="font-semibold">{specialFilter === "overdue" ? "Overdue" : "Due today"}</span>
                <XIcon className="size-3 text-muted-foreground" aria-hidden="true" />
              </Button>
            ) : (
              <FilterChip
                label="Status"
                value={statusFilter}
                displayValue={config.statusOptions.find((s) => s.value === statusFilter)?.label}
                options={config.statusOptions}
                onSelect={(v) => onStatusFilterChange(v)}
                onClear={() => onStatusFilterChange("")}
              />
            )}
            {config.hasSportFilter && sportCodesInUse.length > 0 && (
              <FilterChip
                label="Sport"
                value={sportFilter}
                options={SPORT_CODES.map((s) => ({ value: s.code, label: s.code }))}
                onSelect={(v) => onSportFilterChange(v)}
                onClear={() => onSportFilterChange("")}
              />
            )}
            {locations.length > 1 && (
              <FilterChip
                label="Location"
                value={locationFilter}
                displayValue={locations.find((l) => l.id === locationFilter)?.name}
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
                onSelect={(v) => onLocationFilterChange(v)}
                onClear={() => onLocationFilterChange("")}
              />
            )}
            {users.length > 0 && (
              <FilterChip
                label="User"
                value={userFilter}
                displayValue={users.find((u) => u.id === userFilter)?.name}
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                onSelect={(v) => onUserFilterChange(v)}
                onClear={() => onUserFilterChange("")}
              />
            )}
            {(search || statusFilter || sportFilter || locationFilter || userFilter || specialFilter) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={onClearAll}
              >
                Clear all
              </Button>
            )}
          </div>
        </div>
        <OperationalActiveFilterChips filters={activeFilters} />
      </OperationalToolbar>
    </div>
  );
}
