import type { WorkingScheduleSportTemplate } from "@/lib/schedule-working-copy";

export const AREA_ORDER = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;
export const WORKER_TYPES = ["FT", "ST"] as const;

export type Area = (typeof AREA_ORDER)[number];
export type WorkerType = (typeof WORKER_TYPES)[number];
export type CountKey = `${Area}:${WorkerType}`;

export function crewCountKey(area: Area, workerType: WorkerType): CountKey {
  return `${area}:${workerType}`;
}

/** Counts the template asks for at this event's venue. */
export function templateCountsFor(template: WorkingScheduleSportTemplate): Map<CountKey, number> {
  const counts = new Map<CountKey, number>();
  for (const row of template.rows) {
    const venueCounts = template.venue === "home" ? row.home : row.away;
    for (const workerType of WORKER_TYPES) {
      const value = venueCounts[workerType] ?? 0;
      if (value > 0) counts.set(crewCountKey(row.area as Area, workerType), value);
    }
  }
  return counts;
}

/**
 * The PATCH body that saves `draft` as the template for this venue. Every area
 * is sent so areas dropped to zero are saved too; the other venue keeps its
 * current counts.
 */
export function templateSaveRows(template: WorkingScheduleSportTemplate, draft: Map<CountKey, number>) {
  const existing = new Map(template.rows.map((row) => [row.area, row]));
  return AREA_ORDER.map((area) => {
    const row = existing.get(area);
    const staff = draft.get(crewCountKey(area, "FT")) ?? 0;
    const students = draft.get(crewCountKey(area, "ST")) ?? 0;
    const other = template.venue === "home" ? row?.away : row?.home;
    return template.venue === "home"
      ? { area, homeStaffCount: staff, homeStudentCount: students, awayStaffCount: other?.FT ?? 0, awayStudentCount: other?.ST ?? 0 }
      : { area, awayStaffCount: staff, awayStudentCount: students, homeStaffCount: other?.FT ?? 0, homeStudentCount: other?.ST ?? 0 };
  });
}

export function sameCrewCounts(a: Map<CountKey, number>, b: Map<CountKey, number>) {
  for (const area of AREA_ORDER) {
    for (const workerType of WORKER_TYPES) {
      const k = crewCountKey(area, workerType);
      if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) return false;
    }
  }
  return true;
}

