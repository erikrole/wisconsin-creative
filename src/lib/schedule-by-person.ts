import type { CalendarEntry, Shift, ShiftAssignment } from "@/app/(app)/schedule/_components/types";
import { ACTIVE_STATUSES } from "@/app/(app)/schedule/_components/types";
import { INSTITUTION_TZ, institutionDateKey } from "@/lib/format";
import { blocksOnDate, type TeamBlock } from "@/lib/team-availability";

export type PersonShift = {
  key: string;
  entry: CalendarEntry;
  shift: Shift;
  assignment: ShiftAssignment;
  /** Central calendar day the shift starts on. */
  dayKey: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  /** Requested but not yet approved. */
  pending: boolean;
  /** Overlaps a time the student marked as can't work. */
  conflictsAvailability: boolean;
};

export type PersonRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  shifts: PersonShift[];
  hours: number;
};

export type PersonRosterEntry = { id: string; name: string; avatarUrl: string | null; blocks: TeamBlock[] };

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: INSTITUTION_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `HH:MM` of an instant on the Central clock, comparable with availability block times. */
function centralClock(iso: string) {
  return timeFormatter.format(new Date(iso)).replace(/^24/, "00");
}

function overlapsBlock(startsAt: string, endsAt: string, dayKey: string, blocks: TeamBlock[]) {
  const start = centralClock(startsAt);
  const end = institutionDateKey(new Date(endsAt)) === dayKey ? centralClock(endsAt) : "24:00";
  return blocksOnDate(blocks, dayKey).some((b) => (
    b.status === "APPROVED"
    && b.intent !== "PREFER"
    && (b.allDay || (b.startsAt < end && b.endsAt > start))
  ));
}

function hoursBetween(startsAt: string, endsAt: string) {
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

/**
 * Pivots the loaded week from events-with-crew to people-with-shifts. Only the
 * days in `dayKeys` count, and a roster adds students who have nothing yet so
 * the grid answers "who is free" as well as "who is working".
 */
export function buildPersonWeek(
  entries: CalendarEntry[],
  dayKeys: string[],
  roster: PersonRosterEntry[] = [],
): PersonRow[] {
  const days = new Set(dayKeys);
  const blocksById = new Map(roster.map((r) => [r.id, r.blocks]));
  const rows = new Map<string, PersonRow>(
    roster.map((r) => [r.id, { id: r.id, name: r.name, avatarUrl: r.avatarUrl, shifts: [], hours: 0 }]),
  );

  for (const entry of entries) {
    for (const shift of entry.shifts) {
      for (const assignment of shift.assignments) {
        const pending = assignment.status === "REQUESTED";
        if (!pending && !ACTIVE_STATUSES.includes(assignment.status)) continue;
        const startsAt = assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt;
        const endsAt = assignment.callEndsAt ?? shift.callEndsAt ?? shift.endsAt;
        const dayKey = institutionDateKey(new Date(entry.allDay ? entry.startsAt : startsAt));
        if (!days.has(dayKey)) continue;

        const { user } = assignment;
        const row = rows.get(user.id) ?? { id: user.id, name: user.name, avatarUrl: user.avatarUrl ?? null, shifts: [], hours: 0 };
        const hours = entry.allDay ? 0 : hoursBetween(startsAt, endsAt);
        row.shifts.push({
          key: assignment.id,
          entry,
          shift,
          assignment,
          dayKey,
          startsAt,
          endsAt,
          hours,
          pending,
          conflictsAvailability: !entry.allDay && overlapsBlock(startsAt, endsAt, dayKey, blocksById.get(user.id) ?? []),
        });
        if (!pending) row.hours += hours;
        rows.set(user.id, row);
      }
    }
  }

  for (const row of rows.values()) {
    row.shifts.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    row.hours = Math.round(row.hours * 10) / 10;
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "6.5h" / "8h" */
export function formatHours(hours: number) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
