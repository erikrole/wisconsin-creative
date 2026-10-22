import type { GridEvent } from "@/hooks/use-assignment-grid";

export type WorkloadPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  shifts: number;
  hours: number;
  heavy: boolean;
};

export type WorkloadSummary = {
  /** Students with at least one shift, busiest first. */
  working: WorkloadPerson[];
  /** Active students with nothing in the window, by name. */
  idle: Array<{ userId: string; name: string; avatarUrl: string | null }>;
  average: number;
};

export type WorkloadRosterEntry = { id: string; name: string; avatarUrl?: string | null };

/** At least this many shifts, and well above the average, reads as a heavy month. */
const HEAVY_MIN_SHIFTS = 3;
const HEAVY_OVER_AVERAGE = 1.75;

function hoursBetween(startsAt: string | null | undefined, endsAt: string | null | undefined) {
  if (!startsAt || !endsAt) return 0;
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0;
}

/**
 * Student shift load across the grid's window. Counts Student slots only:
 * the panel answers "who is carrying the month, and who has nothing yet".
 * With a roster, active students with no shifts are listed as idle; without
 * one (the roster failed to load) only people seen on the grid appear.
 */
export function summarizeStudentWorkload(events: GridEvent[], roster: WorkloadRosterEntry[] | null): WorkloadSummary {
  const byUser = new Map<string, WorkloadPerson>();
  for (const event of events) {
    for (const shift of event.shifts) {
      if (shift.workerType !== "ST") continue;
      for (const assignment of shift.assignments) {
        const user = assignment.user;
        const hours = event.allDay
          ? 0
          : hoursBetween(
            assignment.callStartsAt ?? shift.callStartsAt ?? shift.startsAt,
            assignment.callEndsAt ?? shift.callEndsAt ?? shift.endsAt,
          );
        const current = byUser.get(user.id) ?? {
          userId: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl ?? null,
          shifts: 0,
          hours: 0,
          heavy: false,
        };
        current.shifts += 1;
        current.hours += hours;
        byUser.set(user.id, current);
      }
    }
  }

  const idle = (roster ?? [])
    .filter((entry) => !byUser.has(entry.id))
    .map((entry) => ({ userId: entry.id, name: entry.name, avatarUrl: entry.avatarUrl ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const working = [...byUser.values()];
  const pool = working.length + idle.length;
  const total = working.reduce((sum, person) => sum + person.shifts, 0);
  const average = pool > 0 ? total / pool : 0;
  for (const person of working) {
    person.hours = Math.round(person.hours * 10) / 10;
    person.heavy = person.shifts >= HEAVY_MIN_SHIFTS && person.shifts >= average * HEAVY_OVER_AVERAGE;
  }
  working.sort((a, b) => b.shifts - a.shifts || b.hours - a.hours || a.name.localeCompare(b.name));

  return { working, idle, average: Math.round(average * 10) / 10 };
}
