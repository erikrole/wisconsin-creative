"use client";

import Link from "next/link";
import type { GridEvent, GridColumn } from "@/hooks/use-assignment-grid";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AssignmentCell } from "./AssignmentCell";
import { scheduleEventTitleParts } from "../../_components/types";
import { VENUE_TONES, venueToneFromEvent } from "@/lib/venue-tone";
import { cn } from "@/lib/utils";
import { AREA_LABELS } from "@/types/areas";

type Props = {
  events: GridEvent[];
  columns: GridColumn[];
  hasFilters: boolean;
  onClearFilters: () => void;
  monthLabel: string;
  onViewSchedule: () => void;
};

export function AssignmentGrid({
  events,
  columns,
  hasFilters,
  onClearFilters,
  monthLabel,
  onViewSchedule,
}: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          icon="calendar"
          title={hasFilters ? "No matching active events" : `No active future events in ${monthLabel}`}
          description={
            hasFilters
              ? "Clear the assignment filters or choose another future month."
              : "Assign only shows active events from today forward. The full Schedule may still include synced, archived, or later events."
          }
          actionLabel={hasFilters ? "Clear filters" : "View schedule"}
          onAction={hasFilters ? onClearFilters : onViewSchedule}
          compact
        />
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          icon="users"
          title="No shifts generated"
          description="These events do not have shift slots for the selected month yet."
          compact
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card shadow-sm">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60">
            <th className="sticky left-0 z-10 w-64 min-w-[16rem] bg-card px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Event
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-l border-border/60 px-2 py-2 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                {AREA_LABELS[col.area] ?? col.area}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev, i) => {
            const date = new Date(ev.startsAt);
            const titleParts = scheduleEventTitleParts(ev);
            const venueTone = VENUE_TONES[venueToneFromEvent(ev)];
            const dateStr = date.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeStr = ev.allDay
              ? "All day"
              : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            const activeAssignments = ev.shifts.reduce((sum, shift) => sum + shift.assignments.length, 0);
            const openSlots = ev.shifts.filter((shift) => shift.assignments.length === 0).length;

            return (
              <tr
                key={ev.id}
                className={cn(
                  "group/assign-row border-b border-border/40 transition-colors hover:bg-muted/20",
                  i % 2 !== 0 && "bg-muted/10",
                )}
              >
                {/* Event name cell */}
                <td
                  className={cn(
                    "sticky left-0 z-10 min-w-[16rem] max-w-[18rem] border-l-[3px] bg-card px-3 py-2 transition-colors group-hover/assign-row:bg-muted/20",
                    i % 2 !== 0 && "bg-muted/10",
                    venueTone.railClass,
                  )}
                >
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start px-0 py-1 text-left hover:bg-transparent"
                    asChild
                  >
                    <Link href={`/events/${ev.id}`}>
                      <span className="block min-w-0">
                        <span className="block truncate text-sm font-semibold leading-tight">{titleParts.title}</span>
                        {titleParts.detail && (
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {titleParts.detail}
                          </span>
                        )}
                        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="tabular-nums">{dateStr} · {timeStr}</span>
                          <Badge variant={venueTone.badgeVariant} size="sm">
                            {venueTone.label}
                          </Badge>
                          {ev.shifts.length > 0 && (
                            <span className="tabular-nums text-muted-foreground/75">
                              {activeAssignments}/{ev.shifts.length}
                              {openSlots > 0 ? ` · ${openSlots} open` : ""}
                            </span>
                          )}
                          <span className="font-medium text-primary">Manage crew</span>
                        </span>
                      </span>
                    </Link>
                  </Button>
                </td>

                {/* Shift assignment cells */}
                {columns.map((col) => {
                  const matchingShifts = ev.shifts.filter(
                    (s) => s.area === col.area,
                  );
                  return (
                    <AssignmentCell
                      key={col.key}
                      shifts={matchingShifts}
                      allDay={ev.allDay}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
