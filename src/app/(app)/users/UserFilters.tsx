import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { OperationalActiveFilterChips, type OperationalActiveFilter, OperationalToolbar } from "@/components/OperationalToolbar";
import { Loader2, SearchIcon, SlidersHorizontal, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Location } from "./types";
import { AREA_LABELS, ROLE_OPTIONS, STUDENT_YEAR_OPTIONS } from "./types";
import { SPORT_CODES, sportLabel } from "@/lib/sports";

export default function UserFilters({
  search,
  onSearchChange,
  roleFilter,
  onRoleChange,
  locationFilter,
  onLocationChange,
  locations,
  locationsLoading = false,
  locationsError = false,
  yearFilter,
  onYearChange,
  sportFilter,
  onSportChange,
  areaFilter,
  onAreaChange,
  showInactive,
  onShowInactiveChange,
  showInactiveFilter = true,
  canShowHiddenUsers = false,
  showHiddenUsers,
  onShowHiddenUsersChange,
  onClearAll,
  searching = false,
  directoryMode = false,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  roleFilter: string;
  onRoleChange: (v: string) => void;
  locationFilter: string;
  onLocationChange: (v: string) => void;
  locations: Location[];
  locationsLoading?: boolean;
  locationsError?: boolean;
  yearFilter: string;
  onYearChange: (v: string) => void;
  sportFilter: string;
  onSportChange: (v: string) => void;
  areaFilter: string;
  onAreaChange: (v: string) => void;
  showInactive: boolean;
  onShowInactiveChange: (v: boolean) => void;
  showInactiveFilter?: boolean;
  canShowHiddenUsers?: boolean;
  showHiddenUsers: boolean;
  onShowHiddenUsersChange: (v: boolean) => void;
  onClearAll: () => void;
  searching?: boolean;
  directoryMode?: boolean;
}) {
  const [draftSearch, setDraftSearch] = useState(search);
  const [filtersOpen, setFiltersOpen] = useState(
    !!roleFilter ||
      !!locationFilter ||
      !!yearFilter ||
      !!sportFilter ||
      !!areaFilter ||
      (showInactiveFilter && showInactive) ||
      (canShowHiddenUsers && showHiddenUsers),
  );
  const previousFilterCountRef = useRef(0);
  const activeFilterCount =
    (roleFilter ? 1 : 0) +
    (locationFilter ? 1 : 0) +
    (areaFilter ? 1 : 0) +
    (yearFilter ? 1 : 0) +
    (sportFilter ? 1 : 0) +
    (showInactiveFilter && showInactive ? 1 : 0) +
    (canShowHiddenUsers && showHiddenUsers ? 1 : 0);
  const hasFilters = activeFilterCount > 0;
  const locationFilterUnavailable = locationsLoading || locationsError;
  const activeFilters: OperationalActiveFilter[] = [
    ...(roleFilter
      ? [{
        key: "role",
        label: `Role: ${ROLE_OPTIONS.find((o) => o.value === roleFilter)?.label ?? roleFilter}`,
        onRemove: () => onRoleChange(""),
      }]
      : []),
    ...(locationFilter
      ? [{
        key: "location",
        label: `Location: ${locations.find((l) => l.id === locationFilter)?.name ?? locationFilter}`,
        onRemove: () => onLocationChange(""),
      }]
      : []),
    ...(areaFilter
      ? [{
        key: "area",
        label: `Area: ${AREA_LABELS[areaFilter] ?? areaFilter}`,
        onRemove: () => onAreaChange(""),
      }]
      : []),
    ...(yearFilter
      ? [{
        key: "year",
        label: `Year: ${STUDENT_YEAR_OPTIONS.find((o) => o.value === yearFilter)?.label ?? yearFilter}`,
        onRemove: () => onYearChange(""),
      }]
      : []),
    ...(sportFilter
      ? [{
        key: "sport",
        label: `Sport: ${sportLabel(sportFilter)}`,
        onRemove: () => onSportChange(""),
      }]
      : []),
    ...(showInactiveFilter && showInactive
      ? [{
        key: "inactive",
        label: "Showing inactive",
        onRemove: () => onShowInactiveChange(false),
      }]
      : []),
    ...(canShowHiddenUsers && showHiddenUsers
      ? [{
        key: "hidden",
        label: "Showing hidden test users",
        onRemove: () => onShowHiddenUsersChange(false),
      }]
      : []),
  ];

  useEffect(() => {
    if (previousFilterCountRef.current > 0 && activeFilterCount === 0) {
      setFiltersOpen(false);
    }
    previousFilterCountRef.current = activeFilterCount;
  }, [activeFilterCount]);

  useEffect(() => {
    setDraftSearch(search);
  }, [search]);

  useEffect(() => {
    if (draftSearch === search) return;
    const timer = window.setTimeout(() => {
      onSearchChange(draftSearch);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draftSearch, onSearchChange, search]);

  return (
    <OperationalToolbar>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Input
            id="users-search"
            name="users-search"
            className="peer h-10 pl-9 pr-9 text-base md:text-sm"
            type="text"
            placeholder={directoryMode ? "Search by name" : "Search name or email"}
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            aria-label="Search users"
          />
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 text-muted-foreground/80 peer-disabled:opacity-50">
            <SearchIcon size={16} />
          </div>
          {searching ? (
            <div className="pointer-events-none absolute inset-y-0 right-2.5 my-auto flex items-center text-muted-foreground/80">
              <Loader2 className="size-3.5 animate-spin" />
            </div>
          ) : draftSearch ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute inset-y-0 right-0 my-auto size-10 text-muted-foreground/80 hover:text-foreground"
              onClick={() => {
                setDraftSearch("");
                onSearchChange("");
              }}
              aria-label="Clear search"
            >
              <X size={14} />
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={filtersOpen || activeFilterCount > 0 ? "secondary" : "outline"}
            size="sm"
            className="h-10 gap-1.5 active:scale-[0.96] transition-transform"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="size-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-sm bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-10 gap-1.5 active:scale-[0.96] transition-transform" onClick={onClearAll}>
              Clear
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
          <Select value={roleFilter || "__all__"} onValueChange={(v) => onRoleChange(v === "__all__" ? "" : v)}>
            <SelectTrigger size="sm" className="h-10 w-[130px]">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All roles</SelectItem>
              {ROLE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!directoryMode && <Select
            value={locationFilter || "__all__"}
            onValueChange={(v) => onLocationChange(v === "__all__" ? "" : v)}
            disabled={locationFilterUnavailable}
          >
            <SelectTrigger size="sm" className="h-10 w-[150px]" aria-label={locationsError ? "Location filter unavailable" : "Location filter"}>
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                {locationsError ? "Locations unavailable" : locationsLoading ? "Loading locations" : "All locations"}
              </SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>}
          {!directoryMode && <Select value={areaFilter || "__all__"} onValueChange={(v) => onAreaChange(v === "__all__" ? "" : v)}>
            <SelectTrigger size="sm" className="h-10 w-[130px]">
              <SelectValue placeholder="All areas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All areas</SelectItem>
              {Object.entries(AREA_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>}
          {!directoryMode && <Select value={yearFilter || "__all__"} onValueChange={(v) => onYearChange(v === "__all__" ? "" : v)}>
            <SelectTrigger size="sm" className="h-10 w-[130px]">
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All years</SelectItem>
              {STUDENT_YEAR_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>}
          {!directoryMode && <Select value={sportFilter || "__all__"} onValueChange={(v) => onSportChange(v === "__all__" ? "" : v)}>
            <SelectTrigger size="sm" className="h-10 w-[150px]">
              <SelectValue placeholder="All sports" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="__all__">All sports</SelectItem>
              {SPORT_CODES.map((s) => (
                <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>}
          {!directoryMode && showInactiveFilter && <Label htmlFor="show-inactive" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-background px-3">
            <Checkbox
              id="show-inactive"
              checked={showInactive}
              onCheckedChange={(v) => onShowInactiveChange(!!v)}
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              Show inactive
            </span>
          </Label>}
          {canShowHiddenUsers && (
            <Label htmlFor="show-hidden-users" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-background px-3">
              <Checkbox
                id="show-hidden-users"
                checked={showHiddenUsers}
                onCheckedChange={(v) => onShowHiddenUsersChange(!!v)}
              />
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                Show hidden test users
              </span>
            </Label>
          )}
        </div>
      )}
      <OperationalActiveFilterChips filters={activeFilters} />
    </OperationalToolbar>
  );
}
