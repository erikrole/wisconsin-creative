import Link from "next/link";
import { ShiftWorkerType } from "@prisma/client";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentTeamTerm } from "@/lib/workforce/team";
import EmptyState from "@/components/EmptyState";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { academicYearLabel, buildPlanning, collapseApplicants, type PlanningApplicant } from "@/lib/workforce/planning";
import { AREA_LABEL } from "../hiring/types";

export const metadata = { title: "Workforce planning" };

const YEARS_AHEAD = 3;

export default async function WorkforcePlanningPage() {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");

  const currentStart = currentTeamTerm().academicYear;
  const years = Array.from({ length: YEARS_AHEAD }, (_, i) => currentStart + i);

  const [users, applications, cycles] = await Promise.all([
    db.user.findMany({
      where: { active: true, hiddenFromRoster: false, role: { in: [Role.ADMIN, Role.STAFF, Role.STUDENT] }, staffingType: ShiftWorkerType.ST },
      select: {
        id: true,
        name: true,
        primaryArea: true,
        gradYear: true,
        graduationTerm: true,
        startTerm: true,
        startTermYear: true,
        areaAssignments: { select: { area: true, isPrimary: true } },
      },
    }),
    db.application.findMany({
      where: {
        applicant: { hiredUserId: null, purgedAt: null },
        OR: [
          { stage: "HIRE", cycle: { status: { in: ["PLANNING", "OPEN", "CLOSED"] } } },
          { stage: { in: ["APPLIED", "ROUND_1"] }, cycle: { status: { in: ["PLANNING", "OPEN"] } } },
        ],
      },
      select: {
        id: true,
        stage: true,
        primaryArea: true,
        applicantId: true,
        cycle: { select: { term: true, year: true } },
        applicant: { select: { name: true, gradTerm: true, gradYear: true } },
      },
    }),
    db.hiringCycle.findMany({
      where: { year: { gte: currentStart, lte: currentStart + YEARS_AHEAD }, status: { in: ["PLANNING", "OPEN", "CLOSED"] } },
      select: { term: true, year: true, slots: { select: { area: true, targetCount: true } }, applications: { where: { stage: "HIRE" }, select: { primaryArea: true } } },
    }),
  ]);

  const rows = buildPlanning(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      area: u.primaryArea ?? u.areaAssignments.find((a) => a.isPrimary)?.area ?? u.areaAssignments[0]?.area ?? null,
      gradTerm: u.graduationTerm,
      gradYear: u.gradYear,
      startTerm: u.startTerm,
      startYear: u.startTermYear,
    })),
    collapseApplicants(
      applications.map((a) => ({
        id: a.id,
        applicantId: a.applicantId,
        name: a.applicant.name,
        area: a.primaryArea,
        gradTerm: a.applicant.gradTerm,
        gradYear: a.applicant.gradYear,
        stage: a.stage as PlanningApplicant["stage"],
        cycleTerm: a.cycle.term,
        cycleYear: a.cycle.year,
      })),
    ),
    years,
    cycles.flatMap(cycle => cycle.slots.map(slot => ({
      area: slot.area,
      academicYearStart: cycle.year - (cycle.term === "FALL" ? 0 : 1),
      target: slot.targetCount,
      hired: cycle.applications.filter(application => application.primaryArea === slot.area).length,
    }))),
  );

  return (
    <>
      <PageHeader
        title="Looking ahead"
        description="See returning interns, graduation changes, and hiring goals over the next three academic years. Candidates stay separate from expected staffing."
      ><Button asChild variant="outline"><Link href="/workforce">View team by term</Link></Button><Button asChild><Link href="/workforce/hiring">Manage openings</Link></Button></PageHeader>

      {rows.length === 0 ? (
        <EmptyState icon="chart" title="Nothing to project yet" description="Active students and hired or open-cycle applicants appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Projected student headcount by area and academic year</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 border-b bg-background p-3 text-left font-semibold">
                  Area
                </th>
                {years.map((year, i) => (
                  <th key={year} scope="col" className="border-b p-3 text-left font-semibold">
                    {academicYearLabel(year)}
                    {i === 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">this year</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.area} className="align-top">
                  <th scope="row" className="sticky left-0 border-b bg-background p-3 text-left font-medium">
                    {row.area === "NONE" ? "No area set" : AREA_LABEL[row.area]}
                  </th>
                  {row.cells.map((cell) => (
                    <td key={cell.academicYearStart} className="min-w-44 border-b p-3">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold">{cell.projected}</span>
                        {cell.hiresNeeded != null && cell.hiresNeeded > 0 && <Badge variant="orange">{cell.hiresNeeded} {cell.hiresNeeded === 1 ? "hire" : "hires"} to make</Badge>}
                        {cell.hiresNeeded === 0 && cell.hiringTarget != null && cell.hiringTarget > 0 && <Badge variant="green">Hiring goal met</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cell.continuing} continuing
                        {cell.hired > 0 ? ` · ${cell.hired} hired` : ""}
                        {cell.pipeline > 0 ? ` · +${cell.pipeline} in pipeline` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{cell.hiringTarget == null ? "No hiring goal set" : `${cell.hiringTarget} planned hires across this year’s cycles`}</p>
                      {cell.unknownGrad > 0 && (
                        <p className="text-xs text-muted-foreground">{cell.unknownGrad} with no graduation date (assumed staying)</p>
                      )}
                      {(cell.leaving.length > 0 || cell.hiredNames.length > 0 || cell.pipelineNames.length > 0) && (
                        <details className="mt-2 text-xs">
                          <summary className="min-h-6 cursor-pointer text-muted-foreground">Who</summary>
                          {cell.leaving.length > 0 && (
                            <p className="mt-1">
                              <span className="font-medium">Leaving:</span> {cell.leaving.join(", ")}
                            </p>
                          )}
                          {cell.hiredNames.length > 0 && (
                            <p className="mt-1">
                              <span className="font-medium">Hired:</span> {cell.hiredNames.join(", ")}
                            </p>
                          )}
                          {cell.pipelineNames.length > 0 && (
                            <p className="mt-1">
                              <span className="font-medium">Pipeline:</span> {cell.pipelineNames.join(", ")}
                            </p>
                          )}
                        </details>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Hiring goals come from each cycle’s area targets. Hires to make counts remaining decisions against those goals, including hires who already joined the team. Headcount projects current profile assignments and graduation dates; it does not carry future term placements across a full year. Full-time staff are shown in Team.
          </p>
        </div>
      )}
    </>
  );
}
