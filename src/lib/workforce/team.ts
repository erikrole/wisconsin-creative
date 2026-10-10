import type { GraduationTerm, ShiftArea } from "@prisma/client";
import { compareTerms } from "./contract";

export type TeamTerm = { term: GraduationTerm; year: number };
export type TeamSelection = TeamTerm & { academicYear: number };
export type TeamUser = {
  id: string; name: string; avatarUrl: string | null; title: string | null;
  active: boolean; staffingType: "FT" | "ST"; primaryArea: ShiftArea | null;
  gradYear: number | null; graduationTerm: GraduationTerm | null;
  startTerm: GraduationTerm | null; startTermYear: number | null;
  directReport?: { name: string } | null; directReportName?: string | null;
  areaAssignments: { area: ShiftArea; isPrimary: boolean }[];
  sportAssignments: { sportCode: string }[];
  termPlacements: { term: GraduationTerm; year: number; area: ShiftArea | null; sportCodes: string[] }[];
};
export type TeamPerson = {
  id: string; name: string; avatarUrl: string | null; title: string | null;
  kind: "FULL_TIME" | "STUDENT"; area: ShiftArea | null;
  sports: string[]; graduation: string | null; graduatesThisYear: boolean;
  manager: string | null; basis: "profile" | "recorded" | "projected";
  unknownGraduation: boolean;
};
export type TeamViewData = {
  selection: TeamSelection; current: TeamSelection; mode: "past" | "current" | "future";
  people: TeamPerson[]; staffCount: number; studentCount: number; graduatingCount: number;
  recordedCount: number; uncertainCount: number;
};
const TERM_LABELS: Record<GraduationTerm, string> = { FALL: "Fall", WINTER: "Winter", SPRING: "Spring", SUMMER: "Summer" };

export function currentTeamTerm(now = new Date()): TeamSelection {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find(p => p.type === "year")!.value);
  const month = Number(parts.find(p => p.type === "month")!.value);
  const term: GraduationTerm = month >= 8 ? "FALL" : month >= 6 ? "SUMMER" : month >= 2 ? "SPRING" : "WINTER";
  return { term, year, academicYear: month >= 8 ? year : year - 1 };
}

export function selectTeamTerm(params: { year?: string; term?: string }, current: TeamSelection): TeamSelection {
  const academicYear = typeof params.year === "string" && /^\d{4}$/.test(params.year) && Number(params.year) >= 2000 && Number(params.year) <= 2099 ? Number(params.year) : current.academicYear;
  const term = typeof params.term === "string" && Object.hasOwn(TERM_LABELS, params.term) ? params.term as GraduationTerm : current.term;
  return { academicYear, term, year: academicYear + (term === "FALL" ? 0 : 1) };
}

export function buildTeamView(users: TeamUser[], selection: TeamSelection, current: TeamSelection): TeamViewData {
  const comparison = compareTerms(selection, current);
  const mode = comparison < 0 ? "past" : comparison > 0 ? "future" : "current";
  const people: TeamPerson[] = [];
  for (const user of users) {
    const recorded = user.termPlacements.find(p => p.term === selection.term && p.year === selection.year);
    const student = user.staffingType === "ST" || (mode === "past" && Boolean(recorded));
    const placement = student ? recorded : undefined;
    if (!student && (!user.active || mode === "past")) continue;
    if (student && !placement) {
      if (!user.active || mode === "past") continue;
      if (user.startTerm && user.startTermYear != null && compareTerms({ term: user.startTerm, year: user.startTermYear }, selection) > 0) continue;
      if (mode === "future" && user.gradYear != null) {
        // A known year alone only excludes a person after that calendar year.
        if (user.gradYear < selection.year || (user.graduationTerm && compareTerms({ term: user.graduationTerm, year: user.gradYear }, selection) < 0)) continue;
      }
    }
    const area = placement ? placement.area : user.primaryArea ?? user.areaAssignments.find(a => a.isPrimary)?.area ?? user.areaAssignments[0]?.area ?? null;
    people.push({
      id: user.id, name: user.name, avatarUrl: user.avatarUrl, title: user.title,
      kind: student ? "STUDENT" : "FULL_TIME", area,
      sports: placement ? placement.sportCodes : user.sportAssignments.map(s => s.sportCode),
      graduation: user.gradYear ? `${user.graduationTerm ? `${TERM_LABELS[user.graduationTerm]} ` : ""}${user.gradYear}` : null,
      graduatesThisYear: student && user.gradYear != null && user.gradYear >= selection.year && user.gradYear <= selection.academicYear + 1 && (!user.graduationTerm || compareTerms({ term: user.graduationTerm, year: user.gradYear }, selection) >= 0),
      // Reporting lines are current profile data, never historical claims.
      manager: mode === "past" ? null : user.directReport?.name ?? user.directReportName ?? null,
      basis: placement ? "recorded" : student && mode === "future" ? "projected" : "profile",
      unknownGraduation: student && (user.gradYear == null || user.graduationTerm == null),
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  const students = people.filter(p => p.kind === "STUDENT");
  return { selection, current, mode, people, staffCount: people.length - students.length, studentCount: students.length,
    graduatingCount: students.filter(p => p.graduatesThisYear).length,
    recordedCount: students.filter(p => p.basis === "recorded").length,
    uncertainCount: students.filter(p => p.basis === "projected" && p.unknownGraduation).length };
}
