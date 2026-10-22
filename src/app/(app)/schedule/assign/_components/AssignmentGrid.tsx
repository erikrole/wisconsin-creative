"use client";

import Link from "next/link";
import type { GridEvent, GridColumn } from "@/hooks/use-assignment-grid";
import EmptyState from "@/components/EmptyState";
import { sportDotColor } from "@/lib/sport-color";
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

  const days: { key: string; label: string; events: GridEvent[] }[] = [];
  for (const ev of events) {
    const date = new Date(ev.startsAt);
    const key = date.toDateString();
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = {
        key,
        label: date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        events: [],
      };
      days.push(day);
    }
    day.events.push(ev);
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="mb-2 px-1 text-sm font-semibold text-foreground">{day.label}</h2>
          <div className="divide-y divide-border/50 rounded-xl border border-border/60 bg-card shadow-xs">
            {day.events.map((ev) => {
              const date = new Date(ev.startsAt);
              const titleParts = scheduleEventTitleParts(ev);
              const venueTone = VENUE_TONES[venueToneFromEvent(ev)];
              const timeStr = ev.allDay
                ? "All day"
                : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
              const openSlots = ev.shifts.filter((shift) => shift.assignments.length === 0).length;
              const sportColor = sportDotColor(ev.sportCode);

              return (
                <div
                  key={ev.id}
                  className={cn("flex flex-col gap-3 border-l-[3px] px-4 py-3 lg:flex-row lg:items-start lg:gap-6", venueTone.railClass)}
                >
                  <div className="min-w-0 lg:w-72 lg:shrink-0">
                    <Link
                      href={`/events/${ev.id}`}
                      className="block truncate text-sm font-semibold leading-tight hover:underline"
                    >
                      {titleParts.title}
                    </Link>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      {sportColor ? (
                        <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: sportColor }} />
                      ) : null}
                      <span className="tabular-nums">{timeStr}</span>
                      <span>{venueTone.label}</span>
                      {ev.shifts.length > 0 ? (
                        <span className={cn("tabular-nums", openSlots > 0 ? "font-medium text-foreground" : "")}>
                          {openSlots > 0 ? `${openSlots} open` : "Covered"}
                        </span>
                      ) : null}
                    </div>
                    <Link href={`/events/${ev.id}`} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                      Manage crew
                    </Link>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-wrap gap-x-8 gap-y-3">
                    {columns.map((col) => {
                      const matchingShifts = ev.shifts.filter((s) => s.area === col.area);
                      if (matchingShifts.length === 0) return null;
                      return (
                        <div key={col.key} className="min-w-[10rem]">
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            {AREA_LABELS[col.area] ?? col.area}
                          </div>
                          <AssignmentCell shifts={matchingShifts} allDay={ev.allDay} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
