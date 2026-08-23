"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { BulkAssignmentDialog } from "./BulkAssignmentDialog";
import type { PickerUser } from "@/components/shift-detail/UserAvatarPicker";
import { SPORT_CODES } from "@/lib/sports";
import { AREAS, AREA_LABELS, type Area } from "@/types/areas";
import type { BulkAssignmentScope } from "@/lib/bulk-schedule-assignment-types";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, FilterIcon } from "lucide-react";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import {
  filterEventsByAssignmentReview,
  summarizeAssignmentReview,
  type ReviewFilter,
} from "@/lib/assignment-conflict-review";

async function fetchUsers(): Promise<PickerUser[]> {
  const res = await fetch("/api/users?limit=200&active=true");
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load users"));
  const j = await parseJsonSafely<{ data?: PickerUser[] }>(res);
  if (!j?.data) throw new Error("Users response was malformed");
  return j.data;
}

export function AssignPageClient() {
  const router = useRouter();
  const grid = useAssignmentGrid();
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [bulkAssignmentOpen, setBulkAssignmentOpen] = useState(false);

  const {
    data: allUsers = [],
    isLoading: usersLoading,
    isError: usersLoadFailed,
    error: usersError,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ["users-picker"],
    queryFn: fetchUsers,
    staleTime: 5 * 60_000,
  });
  const usersLoadError: false | "network" | "server" = usersLoadFailed
    ? usersError instanceof TypeError
      ? "network"
      : "server"
    : false;

  const reviewSummary = useMemo(() => summarizeAssignmentReview(grid.events), [grid.events]);
  const reviewEvents = useMemo(
    () => filterEventsByAssignmentReview(grid.events, reviewFilter),
    [grid.events, reviewFilter],
  );
  const monthLabel = grid.month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const bulkScope = useMemo<BulkAssignmentScope>(() => {
    const monthStart = new Date(grid.month.getFullYear(), grid.month.getMonth(), 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = monthStart < today ? today : monthStart;
    const end = new Date(grid.month.getFullYear(), grid.month.getMonth() + 1, 0, 23, 59, 59, 999);
    const area = AREAS.includes(grid.areaFilter as Area) ? grid.areaFilter as Area : null;
    return {
      sportCode: grid.sportFilter || null,
      rangeStartsAt: start.toISOString(),
      rangeEndsAt: end.toISOString(),
      area,
    };
  }, [grid.areaFilter, grid.month, grid.sportFilter]);
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

  return (
    <FadeUp>
      <PageHeader title="Assign shifts">
        <Button className="h-10" onClick={() => setBulkAssignmentOpen(true)} disabled={grid.loading}>
          Bulk assign
        </Button>
        <Button variant="outline" className="h-10" onClick={() => router.push("/schedule")}>
          <ChevronLeft className="size-4" />
          Schedule
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/80 p-2 shadow-sm">
        <div className="flex min-h-10 items-center overflow-hidden rounded-md border border-border bg-muted/30">
          <Button
            variant="outline"
            className="size-10"
            onClick={prevMonth}
            disabled={previousMonthDisabled}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-10 min-w-[9rem] rounded-none border-x border-border bg-background/70 font-medium hover:bg-background"
            onClick={thisMonth}
          >
            {monthLabel}
          </Button>
          <Button variant="outline" className="size-10" onClick={nextMonth} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="mx-0.5 h-6 w-px bg-border/80 max-sm:hidden" />

        <Select value={grid.sportFilter || "_all"} onValueChange={(v) => grid.setSportFilter(v === "_all" ? "" : v)}>
          <SelectTrigger
            id="assignment-sport-filter"
            name="assignmentSportFilter"
            size="sm"
            className="h-10 w-44 bg-muted/30"
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
            className="h-10 w-36 bg-muted/30"
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
            className="h-10 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              grid.setSportFilter("");
              grid.setAreaFilter("");
            }}
          >
            <FilterIcon className="size-3.5" />
            Clear
          </Button>
        ) : null}

        {grid.loading ? (
          <Badge variant="outline" className="ml-auto text-muted-foreground">Loading...</Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              "ml-auto text-muted-foreground",
              grid.events.length > 0 && "tabular-nums",
            )}
          >
            {grid.events.length} event{grid.events.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/80 p-2 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="px-1 text-xs font-medium text-muted-foreground">Review</span>
          <ToggleGroup
            type="single"
            value={reviewFilter}
            onValueChange={(value) => {
              if (value) setReviewFilter(value as ReviewFilter);
            }}
            className="gap-1"
            aria-label="Filter assignment review state"
          >
            <ToggleGroupItem value="all" className="h-10 px-2.5 text-xs">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="conflicts" className="h-10 px-2.5 text-xs">
              Conflicts
            </ToggleGroupItem>
            <ToggleGroupItem value="open" className="h-10 px-2.5 text-xs">
              Open
            </ToggleGroupItem>
            <ToggleGroupItem value="clean" className="h-10 px-2.5 text-xs">
              Clean
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
          <Badge variant={reviewSummary.conflicts > 0 ? "orange" : "outline"} size="sm">
            {reviewSummary.conflicts} conflict{reviewSummary.conflicts === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline" size="sm">
            {reviewSummary.open} open
          </Badge>
          <Badge variant="outline" size="sm">
            {reviewSummary.cleanAssignments} clean
          </Badge>
        </div>
      </div>

      {grid.error && (
        <div className="text-sm text-destructive mb-4">
          {grid.error === "network"
            ? "You're offline - schedule data unavailable."
            : "Failed to load schedule. Try refreshing."}
        </div>
      )}

      <AssignmentGrid
        events={reviewEvents}
        columns={grid.columns}
        allUsers={allUsers}
        usersLoading={usersLoading}
        usersLoadError={usersLoadError}
        onRetryUsers={() => void refetchUsers()}
        isStaff
        onRefetch={grid.refetch}
        hasFilters={Boolean(grid.sportFilter || grid.areaFilter || reviewFilter !== "all")}
        onClearFilters={() => {
          grid.setSportFilter("");
          grid.setAreaFilter("");
          setReviewFilter("all");
        }}
        monthLabel={monthLabel}
        onViewSchedule={() => router.push("/schedule")}
      />

      <BulkAssignmentDialog
        open={bulkAssignmentOpen}
        onOpenChange={setBulkAssignmentOpen}
        scope={bulkScope}
        onApplied={() => grid.refetch()}
      />
    </FadeUp>
  );
}
