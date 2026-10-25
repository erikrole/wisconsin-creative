import type { CalendarEntry, Shift, ShiftAssignment } from "@/app/(app)/schedule/_components/types";

// Schedule list fixtures shared by the render tests and the browser harness.
// Day 0 is Thursday, October 22, 2026 in Central time.

const DAY = 86_400_000;

export function assignment(name: string, overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
  return {
    id: `a-${name}`,
    status: "APPROVED",
    user: { id: `u-${name}`, name, role: "STUDENT", primaryArea: "VIDEO" },
    ...overrides,
  };
}

export function shift(id: string, startsAt: string, endsAt: string, overrides: Partial<Shift> = {}): Shift {
  return { id, area: "VIDEO", workerType: "ST", startsAt, endsAt, notes: null, assignments: [], ...overrides };
}

export function event(offset: number, index = 0, overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  const base = Date.UTC(2026, 9, 22) + offset * DAY;
  const hour = index ? 23 : 17;
  const startsAt = new Date(base + hour * 3_600_000).toISOString();
  const endsAt = new Date(base + (hour + 3) * 3_600_000).toISOString();
  const id = `ev-${offset}-${index}`;
  return {
    id,
    summary: index ? `Volleyball vs Iowa ${offset}` : `Football vs Ohio State ${offset}`,
    startsAt, endsAt, allDay: false, status: "CONFIRMED", rawLocationText: null,
    sportCode: index ? "WVB" : "FB", opponent: index ? "Iowa" : "Ohio State", isHome: true, site: "HOME",
    subtitle: null, location: null, source: null, shiftGroupId: `g-${id}`,
    coverage: { total: 2, filled: 1, percentage: 50 },
    shifts: [
      shift(`${id}-s1`, startsAt, endsAt, { assignments: [assignment(`Alex-${id}`, { user: { id: "u-alex", name: "Alex Rivera", role: "STUDENT", primaryArea: "VIDEO" } })] }),
      shift(`${id}-s2`, startsAt, endsAt),
    ],
    ...overrides,
  };
}

/** Two events a day from `from` to `to` days around today. */
export function scheduleRange(from: number, to: number): CalendarEntry[] {
  return Array.from({ length: to - from + 1 }, (_, i) => [event(from + i, 0), event(from + i, 1)]).flat();
}

/** Day groups as the schedule hook builds them, with today present even when empty. */
export function groupByDay(entries: CalendarEntry[], today = new Date()): [string, CalendarEntry[]][] {
  const groups: [string, CalendarEntry[]][] = [];
  for (const entry of entries) {
    const key = new Date(entry.startsAt).toDateString();
    if (groups.at(-1)?.[0] !== key) groups.push([key, []]);
    groups.at(-1)![1].push(entry);
  }
  const midnight = new Date(today);
  midnight.setHours(0, 0, 0, 0);
  const todayKey = midnight.toDateString();
  if (!groups.some(([key]) => key === todayKey)) {
    const index = groups.findIndex(([key]) => new Date(key).getTime() > midnight.getTime());
    groups.splice(index === -1 ? groups.length : index, 0, [todayKey, []]);
  }
  return groups;
}
