"use client";

import { ListView } from "@/app/(app)/schedule/_components/ListView";
import type { CalendarEntry, Shift } from "@/app/(app)/schedule/_components/types";
import { TooltipProvider } from "@/components/ui/tooltip";

const noop = () => {};
const person = (id: string, name: string) => ({ id, name, avatarUrl: null });
const user = (id: string, name: string) => ({ ...person(id, name), role: "STUDENT", primaryArea: "VIDEO" });

function shift(id: string, area: string, startsAt: string, endsAt: string, assignee?: string): Shift {
  return {
    id, area, workerType: "ST", startsAt, endsAt, notes: null,
    assignments: assignee
      ? [{ id: `a-${id}`, status: "APPROVED", user: user(`u-${assignee}`, assignee), activeTrade: null }]
      : [],
  };
}

function event(id: string, summary: string, sportCode: string, opponent: string, day: number, overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  const startsAt = `2026-10-${day}T17:00:00-05:00`;
  const endsAt = `2026-10-${day}T20:00:00-05:00`;
  return {
    id, summary, startsAt, endsAt, allDay: false, status: "CONFIRMED", rawLocationText: null,
    sportCode, opponent, isHome: true, site: "HOME", subtitle: null, location: null, source: null,
    shiftGroupId: `g-${id}`, coverage: { total: 3, filled: 2, percentage: 67 },
    shifts: [
      shift(`${id}-1`, "VIDEO", startsAt, endsAt, "Maya Brandt"),
      shift(`${id}-2`, "PHOTO", startsAt, endsAt, "Sam Okafor"),
      shift(`${id}-3`, "GRAPHICS", startsAt, endsAt),
    ],
    ...overrides,
  };
}

const entries: CalendarEntry[] = [
  event("e1", "Men's Hockey vs Minnesota", "MHKY", "Minnesota", 30, {
    pendingReview: {
      trades: [{
        id: "t1", assignmentId: "a-e1-2", status: "CLAIMED", notes: "Class conflict, sorry!", area: "PHOTO",
        claimedBy: person("u-jordan", "Jordan Ellis"), postedBy: person("u-sam", "Sam Okafor"),
      }],
      claims: [{
        id: "r1", shiftId: "e1-3", hasConflict: false, conflictNote: null, area: "GRAPHICS",
        user: person("u-avery", "Avery Johnson"),
      }],
    },
  }),
  event("e2", "Volleyball vs Iowa", "WVB", "Iowa", 31, {
    pendingReview: {
      trades: [{
        id: "t2", assignmentId: "a-e2-1", status: "CLAIMED", notes: null, area: "VIDEO",
        claimedBy: person("u-taylor", "Taylor Kim"), postedBy: person("u-maya", "Maya Brandt"),
      }],
      claims: [],
    },
  }),
  event("e3", "Football vs Ohio State", "FB", "Ohio State", 31, { pendingReview: { trades: [], claims: [] } }),
];

const grouped: [string, CalendarEntry[]][] = [
  [new Date("2026-10-30T12:00:00-05:00").toDateString(), [entries[0]!]],
  [new Date("2026-10-31T12:00:00-05:00").toDateString(), [entries[1]!, entries[2]!]],
];

// Dev-only: real ListView with sample data; the review buttons call the real API and will fail here.
export default function ScheduleReviewLab() {
  return (
    <TooltipProvider>
      <div id="main-content" className="mx-auto max-w-5xl p-6">
        <ListView
          entries={entries}
          filteredEntries={entries}
          groupedEntries={grouped}
          loading={false}
          refreshing={false}
          loadError={false}
          loadData={noop}
          myShiftsOnly={false}
          setMyShiftsOnly={noop}
          clearFilters={noop}
          hasFilters={false}
          timelineTruncated={false}
          isTimeline
          hasMorePast={false}
          hasMoreFuture={false}
          loadingPast={false}
          loadingFuture={false}
          loadPastError={false}
          loadFutureError={false}
          onLoadOlder={noop}
          onLoadNewer={noop}
          fillingWindow={false}
          hasContentFilters={false}
          includeArchived={false}
          setIncludeArchived={noop}
          activeQueueMeta={null}
          clearQueue={noop}
          currentUserId="u-admin"
          isStaff
          canReviewClaims
          expandedRowId={null}
          setExpandedRowId={noop}
          onSelectGroup={noop}
        />
      </div>
    </TooltipProvider>
  );
}
