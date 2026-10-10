import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildTeamView, currentTeamTerm, selectTeamTerm } from "@/lib/workforce/team";
import TeamView from "./TeamView";
import RosterImportButton from "./RosterImportButton";

export const metadata = { title: "Workforce" };

/** Read-only team view. Historical membership comes only from recorded placements. */
export default async function WorkforcePage({ searchParams }: { searchParams: Promise<{ year?: string; term?: string }> }) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");
  const current = currentTeamTerm();
  const selection = selectTeamTerm(await searchParams, current);
  const visibleUser = { hiddenFromRoster: false, role: { in: [Role.ADMIN, Role.STAFF, Role.STUDENT] } };
  const [users, recordedTerms, openings] = await Promise.all([
    db.user.findMany({
      where: { ...visibleUser, OR: [{ active: true }, { termPlacements: { some: { term: selection.term, year: selection.year } } }] },
      select: {
        id: true, name: true, avatarUrl: true, title: true, active: true, staffingType: true,
        primaryArea: true, gradYear: true, graduationTerm: true, startTerm: true, startTermYear: true,
        directReport: { select: { name: true } }, directReportName: true,
        areaAssignments: { select: { area: true, isPrimary: true } },
        sportAssignments: { select: { sportCode: true }, orderBy: { sportCode: "asc" } },
        termPlacements: { where: { term: selection.term, year: selection.year }, select: { term: true, year: true, area: true, sportCodes: true } },
      },
    }),
    db.studentTermPlacement.findMany({
      where: { user: visibleUser },
      distinct: ["year", "term"], select: { year: true, term: true },
    }),
    db.hiringCycle.findMany({ where: { status: { in: ["OPEN", "PLANNING"] } }, orderBy: [{ year: "desc" }, { createdAt: "desc" }], select: { id: true, label: true, status: true } }),
  ]);
  const years = [...new Set([
    ...recordedTerms.map(p => p.year - (p.term === "FALL" ? 0 : 1)),
    ...Array.from({ length: 6 }, (_, i) => current.academicYear - 3 + i), selection.academicYear,
  ])].filter(year => year >= 2000 && year <= 2099).sort((a, b) => a - b);
  return <TeamView view={buildTeamView(users, selection, current)} years={years} openings={openings} importAction={<RosterImportButton key={selection.academicYear} defaultYear={selection.academicYear} />} />;
}
