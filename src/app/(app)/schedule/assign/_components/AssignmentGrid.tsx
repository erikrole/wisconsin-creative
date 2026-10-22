"use client";

import Link from "next/link";
import type { GridEvent, GridColumn } from "@/hooks/use-assignment-grid";
import EmptyState from "@/components/EmptyState";
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
  /** Workload panel focus: this person's cells stay bright, the rest dim. */
  focusUserId?: string | null;
};

export function AssignmentGrid({
  events,
  columns,
  hasFilters,
  onClearFilters,
  monthLabel,
  onViewSchedule,
  focusUserId = null,
}: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
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
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
            <th className="sticky left-0 z-10 w-72 min-w-[11rem] bg-[var(--bg-surface)] sm:min-w-[18rem] px-4 py-2.5 text-left text-xs font-bold text-[var(--text-secondary)]">
              Event
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className="border-l border-[var(--border)] px-2.5 py-2.5 text-left text-xs font-bold text-[var(--text-secondary)]"
              >
                {AREA_LABELS[col.area] ?? col.area}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {events.map((ev) => {
            const date = new Date(ev.startsAt);
            const titleParts = scheduleEventTitleParts(ev);
            const venueTone = VENUE_TONES[venueToneFromEvent(ev)];
            const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
            const day = date.getDate();
            const timeStr = ev.allDay
              ? "All day"
              : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            const activeAssignments = ev.shifts.reduce((sum, shift) => sum + shift.assignments.length, 0);
            const openSlots = ev.shifts.filter((shift) => shift.assignments.length === 0).length;
            const filledShare = ev.shifts.length > 0 ? activeAssignments / ev.shifts.length : 0;

            return (
              <tr key={ev.id} className="group/assign-row transition-colors hover:bg-[var(--bg-surface)]/60">
                <td className="sticky left-0 z-10 min-w-[11rem] max-w-[20rem] bg-[var(--background)] px-3 sm:min-w-[18rem] sm:px-4 py-2.5 align-top transition-colors group-hover/assign-row:bg-[var(--bg-surface)]">
                  <Link
                    href={`/events/${ev.id}`}
                    className="flex min-w-0 gap-3 rounded-md text-[var(--text)] no-underline hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <span className="flex w-9 shrink-0 flex-col items-center pt-0.5">
                      <span className="text-[11px] font-bold uppercase text-[var(--text-muted)]">{weekday}</span>
                      <span className="text-lg font-black leading-6 tabular-nums">{day}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn("size-2 shrink-0 rounded-full", venueTone.solidClass)} aria-label={venueTone.label} />
                        <span className="truncate text-sm font-bold leading-5">{titleParts.title}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--text-secondary)]">
                        {timeStr}
                        {titleParts.detail ? ` · ${titleParts.detail}` : ""}
                      </span>
                      {ev.shifts.length > 0 && (
                        <span className="mt-1.5 flex items-center gap-2">
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-[var(--bg-surface)]" aria-hidden="true">
                            <span
                              className={cn("block h-full rounded-full", openSlots === 0 ? "bg-[#30a46c]" : "bg-[var(--accent)]")}
                              style={{ width: `${Math.round(filledShare * 100)}%` }}
                            />
                          </span>
                          <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                            {activeAssignments}/{ev.shifts.length}
                            {openSlots > 0 ? ` · ${openSlots} open` : " · full"}
                          </span>
                          <span className="text-[11px] font-bold text-[var(--accent)] opacity-0 transition-opacity group-hover/assign-row:opacity-100 group-focus-within/assign-row:opacity-100">
                            Manage crew
                          </span>
                        </span>
                      )}
                    </span>
                  </Link>
                </td>

                {columns.map((col) => {
                  const matchingShifts = ev.shifts.filter(
                    (s) => s.area === col.area,
                  );
                  return (
                    <AssignmentCell
                      key={col.key}
                      shifts={matchingShifts}
                      allDay={ev.allDay}
                      focusUserId={focusUserId}
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
