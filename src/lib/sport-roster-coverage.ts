export type SportRosterCoverageMember = {
  workerType: "FT" | "ST";
  primaryArea: string | null;
};

export type SportRosterCoverage = {
  area: string | null;
  staffCount: number;
  studentCount: number;
  total: number;
};

/** Summarize the saved full sport roster by primary area and scheduling class. */
export function summarizeSportRosterCoverage(
  members: SportRosterCoverageMember[],
): SportRosterCoverage[] {
  const byArea = new Map<string | null, SportRosterCoverage>();
  for (const member of members) {
    const current = byArea.get(member.primaryArea) ?? {
      area: member.primaryArea,
      staffCount: 0,
      studentCount: 0,
      total: 0,
    };
    if (member.workerType === "FT") current.staffCount += 1;
    else current.studentCount += 1;
    current.total += 1;
    byArea.set(member.primaryArea, current);
  }
  return [...byArea.values()];
}
