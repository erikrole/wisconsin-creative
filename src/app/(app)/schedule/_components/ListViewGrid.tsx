"use client";

import { type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const EVENT_GRID_CLASS = "grid-cols-[44px_72px_minmax(180px,1fr)_80px_minmax(100px,140px)_136px_40px]";

/**
 * The seven columns of a desktop event row, in track order.
 *
 * Header, body rows, and the loading skeleton all render through `EventGrid`,
 * which emits exactly one cell per column. A grid places children by position,
 * so a row that omitted a cell (an event with no shifts has no crew summary)
 * silently slid every later cell one track left -- status landed in the crew
 * column and the actions menu in the status column. Requiring a value for every
 * column makes that shape unrepresentable.
 */
const EVENT_COLUMNS = ["toggle", "time", "event", "coverage", "crew", "status", "actions"] as const;

type EventColumn = (typeof EVENT_COLUMNS)[number];

export function EventGrid({
  cells,
  className,
}: {
  cells: Record<EventColumn, ReactNode>;
  className?: string;
}) {
  return (
    <div className={cn("grid items-center gap-2", EVENT_GRID_CLASS, className)}>
      {EVENT_COLUMNS.map((column) => (
        <div key={column} data-event-column={column} className="min-w-0">
          {cells[column]}
        </div>
      ))}
    </div>
  );
}

/** Row-shaped placeholder: same tracks as real rows, so loading never reflows into place. */
export function EventListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading schedule" className="schedule-enter">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="border-b border-l-[3px] border-border/20 border-l-transparent px-2 py-1.5">
          <EventGrid
            className="min-h-12"
            cells={{
              toggle: null,
              time: <Skeleton className="h-3 w-10" />,
              event: (
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5" style={{ width: `${55 + ((row * 17) % 35)}%` }} />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              ),
              coverage: <Skeleton className="h-5 w-14 rounded-full" />,
              crew: <Skeleton className="ml-auto h-6 w-16 rounded-full" />,
              status: null,
              actions: null,
            }}
          />
        </div>
      ))}
    </div>
  );
}
