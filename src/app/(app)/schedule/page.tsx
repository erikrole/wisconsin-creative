"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/sheet";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { toast } from "sonner";
import { useScheduleData } from "@/hooks/use-schedule-data";
import { ScheduleFilters } from "./_components/ScheduleFilters";
import { CalendarView } from "./_components/CalendarView";
import { WeekView } from "./_components/WeekView";
import { classifyError, handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { ListView } from "./_components/ListView";
import { NewEventSheet } from "./_components/NewEventSheet";
import { ScheduleReadiness } from "./_components/ScheduleReadiness";
import { useCurrentUser } from "@/hooks/use-current-user";
import { CollaboratorSchedule } from "./_components/CollaboratorSchedule";

const ShiftDetailPanel = dynamic(
  () => import("@/components/ShiftDetailPanel"),
  { ssr: false },
);
const TradeBoard = dynamic(() => import("@/components/TradeBoard"), {
  ssr: false,
});

const SCHEDULE_EXPORTS = [
  { type: "roster", label: "Weekly roster" },
  { type: "hours", label: "Hours by person" },
  { type: "open-slots", label: "Open slots" },
  { type: "conflicts", label: "Conflicts" },
  { type: "trades", label: "Trade Board activity" },
  { type: "gear-readiness", label: "Gear readiness" },
] as const;

type CrewTemplateSide = "HOME" | "AWAY" | "EMPTY";

export default function SchedulePage() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) {
    return null;
  }
  if (user?.role === "COLLABORATOR") {
    return <CollaboratorSchedule canFollow={!user.preview?.readOnly && user.capabilities?.includes("SCHEDULE_FOLLOW") === true} />;
  }
  return <InternalSchedulePage />;
}

function InternalSchedulePage() {
  const data = useScheduleData();
  const isStaff = data.currentUserRole === "STAFF" || data.currentUserRole === "ADMIN";
  const { loadData, setExpandedRowId, setTradeSheetOpen } = data;
  const { queue, setQueue } = data.filters;
  const hidingRef = useRef<Set<string>>(new Set());
  const [hidingEventIds, setHidingEventIds] = useState<Set<string>>(() => new Set());
  const [newEventOpen, setNewEventOpen] = useState(false);
  const settingUpRef = useRef<Set<string>>(new Set());
  const [settingUpEventIds, setSettingUpEventIds] = useState<Set<string>>(() => new Set());

  const handleSetEventVisibility = useCallback(async (eventId: string, isHidden: boolean) => {
    if (hidingRef.current.has(eventId)) return;
    hidingRef.current.add(eventId);
    setHidingEventIds((prev) => new Set(prev).add(eventId));
    try {
      const res = await fetch(`/api/calendar-events/${eventId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        if (isHidden) {
          toast.success("Event hidden", {
            action: {
              label: "Undo",
              onClick: () => {
                void handleSetEventVisibility(eventId, false);
              },
            },
          });
        } else {
          toast.success("Event restored");
        }
        loadData();
      } else {
        const msg = await parseErrorMessage(res, isHidden ? "Failed to hide event" : "Failed to restore event");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(
        kind === "network"
          ? `You're offline - could not ${isHidden ? "hide" : "restore"} event`
          : `Something went wrong - could not ${isHidden ? "hide" : "restore"} event`,
      );
    } finally {
      hidingRef.current.delete(eventId);
      setHidingEventIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  }, [loadData]);

  const handleHideEvent = useCallback((eventId: string) => {
    void handleSetEventVisibility(eventId, true);
  }, [handleSetEventVisibility]);

  const handleQuickManageCrew = useCallback((eventId: string) => {
    setExpandedRowId(eventId);
  }, [setExpandedRowId]);

  const handleSetupCrew = useCallback(async (eventId: string, templateSide: CrewTemplateSide) => {
    if (settingUpRef.current.has(eventId)) return;
    settingUpRef.current.add(eventId);
    setSettingUpEventIds((current) => new Set(current).add(eventId));
    try {
      const res = await fetch("/api/shift-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, templateSide }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const templateLabel = templateSide === "EMPTY" ? "Empty" : templateSide === "HOME" ? "Home" : "Away";
        setExpandedRowId(eventId);
        toast.success(`${templateLabel} crew setup created. Manage crew is open below.`);
        loadData();
      } else {
        toast.error(await parseErrorMessage(res, "Failed to set up crew"));
      }
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error(error instanceof TypeError ? "You're offline - crew setup was not created" : "Failed to set up crew");
    } finally {
      settingUpRef.current.delete(eventId);
      setSettingUpEventIds((current) => {
        const next = new Set(current);
        next.delete(eventId);
        return next;
      });
    }
  }, [loadData, setExpandedRowId]);

  const openTradeBoard = useCallback(() => {
    setTradeSheetOpen(true);
  }, [setTradeSheetOpen]);

  const showQueue = useCallback((nextQueue: NonNullable<typeof queue>) => {
    setQueue(nextQueue);
    if (nextQueue === "trade-approval") setTradeSheetOpen(true);
  }, [setQueue, setTradeSheetOpen]);

  const buildExportHref = useCallback((type: (typeof SCHEDULE_EXPORTS)[number]["type"]) => {
    const params = new URLSearchParams({ type });
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    if (data.filters.viewMode === "calendar") {
      startDate = data.calMonth;
      endDate = new Date(data.calMonth.getFullYear(), data.calMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (data.filters.viewMode === "week") {
      startDate = data.weekStart;
      endDate = new Date(data.weekStart);
      endDate.setDate(data.weekStart.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // The list is a timeline that runs from the archive floor forwards, so an
      // export of it covers the same span rather than the next seven days.
      startDate = new Date(now);
      startDate.setFullYear(now.getFullYear() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setFullYear(now.getFullYear() + 1);
      endDate.setHours(23, 59, 59, 999);
      params.set("includePast", "true");
    }

    params.set("startDate", startDate.toISOString());
    params.set("endDate", endDate.toISOString());
    if (data.filters.sportFilter) params.set("sportCode", data.filters.sportFilter);
    if (data.filters.includeArchived) {
      params.set("includeArchived", "true");
      params.set("includePast", "true");
    }
    return `/api/schedule/export?${params.toString()}`;
  }, [data.calMonth, data.filters.includeArchived, data.filters.sportFilter, data.filters.viewMode, data.weekStart]);

  useEffect(() => {
    if (queue === "trade-approval") setTradeSheetOpen(true);
  }, [queue, setTradeSheetOpen]);

  /**
   * Publish the sticky frame's height so the list can position against it.
   *
   * Measured rather than hard-coded because the bar wraps to two rows on narrow
   * screens and grows when filter chips appear; a fixed number would leave day
   * headers overlapping it or floating below it.
   */
  const stickyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);

  const appShellStickyTop = useCallback(() => {
    const header = document.querySelector<HTMLElement>("[data-app-shell-header]");
    const breadcrumb = document.querySelector<HTMLElement>("[data-app-shell-breadcrumb-frame]");
    return Math.round(header?.getBoundingClientRect().height ?? 0)
      + Math.round(breadcrumb?.getBoundingClientRect().height ?? 0);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setPinned(!entry?.isIntersecting),
      { threshold: 0, rootMargin: `-${appShellStickyTop()}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [appShellStickyTop]);

  useLayoutEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const appShellHeader = document.querySelector<HTMLElement>("[data-app-shell-header]");
    const appShellBreadcrumb = document.querySelector<HTMLElement>("[data-app-shell-breadcrumb-frame]");
    const publish = () => {
      const top = Math.round(appShellHeader?.getBoundingClientRect().height ?? 0)
        + Math.round(appShellBreadcrumb?.getBoundingClientRect().height ?? 0);
      const bottom = top + Math.round(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--schedule-sticky-top", `${top}px`);
      document.documentElement.style.setProperty("--schedule-sticky-bottom", `${bottom}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    if (appShellHeader) observer.observe(appShellHeader);
    if (appShellBreadcrumb) observer.observe(appShellBreadcrumb);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--schedule-sticky-top");
      document.documentElement.style.removeProperty("--schedule-sticky-bottom");
    };
  }, [pinned]);

  return (
    <FadeUp>
      {/*
        The title and filters stay put while the timeline runs beneath them, so
        scrolling back through the season always has a frame of reference. Its
        measured bottom edge feeds `--schedule-sticky-bottom`, which the day
        headers stick below and the today anchor scrolls to -- otherwise both
        would land underneath this bar or the app-shell header above it.
      */}
      {/*
        Sentinel: once this scrolls out of view the bar is pinned, which CSS
        alone cannot detect. Pinned it needs its own top padding -- flush
        against the viewport edge the title reads as clipped -- and a shadow to
        lift it off the timeline running underneath.
      */}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      <div
        ref={stickyRef}
        className={cn(
          "sticky z-30 -mx-8 border-b bg-background px-8 max-md:-mx-4 max-md:px-4",
          pinned
            ? "border-border/60 pt-4 shadow-[0_6px_16px_-12px_rgba(0,0,0,0.6)] max-md:pt-3"
            : "border-transparent pt-1",
        )}
        style={{ top: "var(--schedule-sticky-top, 0px)" }}
      >
        <PageHeader title="Schedule">
          {isStaff ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10" aria-label="More schedule actions">
                    <MoreHorizontalIcon data-icon="inline-start" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setNewEventOpen(true)}>
                    New event
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => data.setTradeSheetOpen(true)}>
                    Trade Board
                    {data.openTradeCount > 0 && (
                      <Badge variant="orange" size="sm" className="ml-auto">
                        {data.openTradeCount}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Export CSV</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {SCHEDULE_EXPORTS.map((item) => (
                      <DropdownMenuItem key={item.type} asChild>
                        <a href={buildExportHref(item.type)}>{item.label}</a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => data.setTradeSheetOpen(true)}
            >
              Trade Board
              {data.openTradeCount > 0 && (
                <Badge variant="orange" size="sm" className="ml-1.5">
                  {data.openTradeCount}
                </Badge>
              )}
            </Button>
          )}
        </PageHeader>

        {/* View toggle + filters */}
        <ScheduleFilters
          filters={data.filters}
          entries={data.entries}
        />
      </div>

      <ScheduleReadiness
        entries={data.entries}
        filteredEntries={data.filteredEntries}
        currentUserId={data.currentUserId}
        openTradeCount={data.openTradeCount}
        health={data.scheduleHealth}
        sourceSignal={data.sourceSignal}
        digest={data.scheduleAutomation}
        isStaff={isStaff}
        onShowQueue={showQueue}
        onOpenTradeBoard={openTradeBoard}
      />

      {/* Calendar View */}
      {data.filters.viewMode === "calendar" && (
        <CalendarView
          entries={data.filteredEntries}
          calMonth={data.calMonth}
          setCalMonth={data.setCalMonth}
          expandedDay={data.expandedDay}
          setExpandedDay={data.setExpandedDay}
          onSelectGroup={data.setSelectedGroupId}
          onSwitchToList={() => data.filters.setViewMode("list")}
        />
      )}

      {/* Week View */}
      {data.filters.viewMode === "week" && (
        <WeekView
          entries={data.filteredEntries}
          weekStart={data.weekStart}
          setWeekStart={data.setWeekStart}
          loading={data.loading}
          currentUserId={data.currentUserId}
          currentUserRole={data.currentUserRole}
          myShiftsOnly={data.filters.myShiftsOnly}
          onSelectGroup={data.setSelectedGroupId}
        />
      )}

      {/* List View */}
      {data.filters.viewMode === "list" && (
        <ListView
          entries={data.entries}
          filteredEntries={data.filteredEntries}
          groupedEntries={data.groupedEntries}
          loading={data.loading}
          loadError={data.loadError}
          loadData={data.loadData}
          myShiftsOnly={data.filters.myShiftsOnly}
          setMyShiftsOnly={data.filters.setMyShiftsOnly}
          clearFilters={data.filters.clearAll}
          timelineTruncated={data.timelineTruncated}
          isTimeline={data.isTimeline}
          hasContentFilters={data.hasContentFilters}
          includeArchived={data.filters.includeArchived}
          setIncludeArchived={data.filters.setIncludeArchived}
          hasFilters={data.filters.hasFilters}
          activeQueueMeta={data.filters.queueMeta}
          clearQueue={() => data.filters.setQueue(null)}
          currentUserId={data.currentUserId}
          isStaff={isStaff}
          expandedRowId={data.expandedRowId}
          setExpandedRowId={data.setExpandedRowId}
          onSelectGroup={data.setSelectedGroupId}
          hidingEventIds={hidingEventIds}
          onHideEvent={isStaff ? handleHideEvent : undefined}
          onSetupCrew={isStaff ? handleSetupCrew : undefined}
          onQuickManageCrew={isStaff ? handleQuickManageCrew : undefined}
          settingUpEventIds={settingUpEventIds}
        />
      )}

      {/* Shift detail panel */}
      {data.selectedGroupId && (
        <ShiftDetailPanel
          groupId={data.selectedGroupId}
          onClose={() => data.setSelectedGroupId(null)}
          onUpdated={data.loadData}
          currentUserId={data.currentUserId}
          currentUserRole={data.currentUserRole}
        />
      )}

      {/* New Event sheet (staff/admin only) */}
      {isStaff && (
        <NewEventSheet
          open={newEventOpen}
          onOpenChange={setNewEventOpen}
          onCreated={data.loadData}
        />
      )}

      {/* Trade Board sheet */}
      <Sheet
        open={data.tradeSheetOpen}
        onOpenChange={(open) => {
          data.setTradeSheetOpen(open);
          if (!open && data.filters.queue === "trade-approval") data.filters.setQueue(null);
          if (!open) data.loadTradeCount();
        }}
      >
        <SheetContent side="right" className="sm:max-w-xl w-full">
          <SheetHeader>
            <SheetTitle>Trade Board</SheetTitle>
            <SheetDescription>
              Review, claim, approve, decline, or cancel posted shift trades.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {data.tradeSheetOpen && (
              <TradeBoard
                currentUserId={data.currentUserId}
                currentUserRole={data.currentUserRole}
                initialStatusFilter={data.filters.queue === "trade-approval" ? "CLAIMED" : undefined}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </FadeUp>
  );
}
