import { ApplicationStage, GraduationTerm, ShiftArea } from "@prisma/client";
import { compareTerms } from "@/lib/workforce/contract";

export const NO_AREA = "NONE" as const;
export type PlanningAreaKey = ShiftArea | typeof NO_AREA;

export type PlanningStudent = {
  id: string;
  name: string;
  area: ShiftArea | null;
  gradTerm: GraduationTerm | null;
  gradYear: number | null;
  /** When they start. Null means already here (no constraint). */
  startTerm?: GraduationTerm | null;
  startYear?: number | null;
};

export type PlanningApplicant = {
  id: string;
  name: string;
  area: ShiftArea | null;
  gradTerm: GraduationTerm | null;
  gradYear: number | null;
  /** The hiring cycle's term: when this person would start. */
  startTerm?: GraduationTerm | null;
  startYear?: number | null;
  stage: Extract<ApplicationStage, "APPLIED" | "ROUND_1" | "HIRE">;
};

export type PlanningCell = {
  academicYearStart: number;
  /** Current students still here at the start of this academic year. */
  continuing: number;
  /** Of those, how many have no graduation date and are assumed to stay. */
  unknownGrad: number;
  /** Hired applicants who have not registered yet and are here that year. */
  hired: number;
  /** Open-cycle applicants (applied or Round 1) who would be here that year. */
  pipeline: number;
  /** continuing + hired. */
  projected: number;
  /** Hires still needed to match the first column's headcount. */
  need: number;
  /** Explicit hiring goals, not a target for total staff headcount. */
  hiringTarget: number | null;
  hiresNeeded: number | null;
  leaving: string[];
  hiredNames: string[];
  pipelineNames: string[];
};

export type PlanningTarget = { area: ShiftArea; academicYearStart: number; target: number; hired: number };

export type PlanningRow = { area: PlanningAreaKey; baseline: number; cells: PlanningCell[] };

/**
 * A person is here for the academic year that starts in Fall `start` unless
 * they graduate before that Fall. Graduating in Fall `start` still counts.
 * An unknown graduation date is treated as staying (and flagged separately).
 */
export function presentInYear(
  person: {
    gradTerm: GraduationTerm | null;
    gradYear: number | null;
    startTerm?: GraduationTerm | null;
    startYear?: number | null;
  },
  start: number,
): boolean {
  // Someone who has not started by the end of that academic year (Summer of the next
  // calendar year) is not there yet; one starting during it counts for that year.
  if (person.startTerm && person.startYear != null) {
    if (compareTerms({ term: person.startTerm, year: person.startYear }, { term: "SUMMER", year: start + 1 }) > 0) return false;
  }
  if (person.gradTerm === null || person.gradYear === null) return true;
  return compareTerms({ term: person.gradTerm, year: person.gradYear }, { term: "FALL", year: start }) >= 0;
}

/**
 * Projected student headcount per area per academic year, from current
 * students plus unregistered hires, with open-cycle applicants shown as pipeline.
 * Full-time staff are not part of the projection. `need` compares each year with
 * the first column, so it answers "how many hires keep us at today's size".
 */
export function buildPlanning(
  students: PlanningStudent[],
  applicants: PlanningApplicant[],
  years: number[],
  targets: PlanningTarget[] = [],
): PlanningRow[] {
  const areas = new Set<PlanningAreaKey>();
  for (const s of students) areas.add(s.area ?? NO_AREA);
  for (const a of applicants) areas.add(a.area ?? NO_AREA);
  for (const target of targets) if (years.includes(target.academicYearStart)) areas.add(target.area);

  const order: PlanningAreaKey[] = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION", NO_AREA];
  return order
    .filter((area) => areas.has(area))
    .map((area) => {
      const inArea = students.filter((s) => (s.area ?? NO_AREA) === area);
      const applicantsInArea = applicants.filter((a) => (a.area ?? NO_AREA) === area);
      const baseline = inArea.filter((s) => presentInYear(s, years[0]!)).length;

      const cells = years.map((year, index): PlanningCell => {
        const here = inArea.filter((s) => presentInYear(s, year));
        const previous = index === 0 ? null : inArea.filter((s) => presentInYear(s, years[index - 1]!));
        const hired = applicantsInArea.filter((a) => a.stage === "HIRE" && presentInYear(a, year));
        const pipeline = applicantsInArea.filter((a) => a.stage !== "HIRE" && presentInYear(a, year));
        const projected = here.length + hired.length;
        const goals = targets.filter(target => target.area === area && target.academicYearStart === year);
        const hiringTarget = goals.length ? goals.reduce((total, goal) => total + goal.target, 0) : null;
        // Each cycle owns its goal; exceeding one cycle's target does not erase another's opening.
        const hiresNeeded = goals.length ? goals.reduce((total, goal) => total + Math.max(0, goal.target - goal.hired), 0) : null;
        return {
          academicYearStart: year,
          continuing: here.length,
          unknownGrad: here.filter((s) => s.gradTerm === null || s.gradYear === null).length,
          hired: hired.length,
          pipeline: pipeline.length,
          projected,
          need: Math.max(0, baseline - projected),
          hiringTarget,
          hiresNeeded,
          leaving: previous ? previous.filter((s) => !presentInYear(s, year)).map((s) => s.name) : [],
          hiredNames: hired.map((a) => a.name),
          pipelineNames: pipeline.map((a) => a.name),
        };
      });
      return { area, baseline, cells };
    });
}

export function academicYearLabel(start: number): string {
  return `${start}-${String(start + 1).slice(2)}`;
}

export type PlanningApplicationRow = PlanningApplicant & {
  applicantId: string;
  cycleTerm: GraduationTerm;
  cycleYear: number;
};

const STAGE_PRIORITY: Record<PlanningApplicant["stage"], number> = { HIRE: 3, ROUND_1: 2, APPLIED: 1 };

/**
 * One entry per person. A returning applicant can have several qualifying
 * applications (an old Hire plus a new open-cycle one); count them once, preferring
 * the strongest stage (Hire over Round 1 over Applied) and then the latest cycle.
 */
export function collapseApplicants(rows: PlanningApplicationRow[]): PlanningApplicant[] {
  const best = new Map<string, PlanningApplicationRow>();
  for (const row of rows) {
    const current = best.get(row.applicantId);
    if (
      !current ||
      STAGE_PRIORITY[row.stage] > STAGE_PRIORITY[current.stage] ||
      (STAGE_PRIORITY[row.stage] === STAGE_PRIORITY[current.stage] &&
        compareTerms({ term: row.cycleTerm, year: row.cycleYear }, { term: current.cycleTerm, year: current.cycleYear }) > 0)
    ) {
      best.set(row.applicantId, row);
    }
  }
  return [...best.values()].map(({ id, name, area, gradTerm, gradYear, stage, cycleTerm, cycleYear }) => ({
    id,
    name,
    area,
    gradTerm,
    gradYear,
    stage,
    startTerm: cycleTerm,
    startYear: cycleYear,
  }));
}
