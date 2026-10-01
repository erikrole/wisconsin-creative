import { ShiftWorkerType } from "@prisma/client";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
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

  const now = new Date();
  const currentStart = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const years = Array.from({ length: YEARS_AHEAD }, (_, i) => currentStart + i);

  const [users, applications] = await Promise.all([
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
  );

  return (
    <>
      <PageHeader
        title="Planning"
        description="Projected student headcount by area for the next academic years. Counts current students who have not graduated, plus hires who have not registered yet. Pipeline applicants are shown separately."
      />

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
                  {row.cells.map((cell, i) => (
                    <td key={cell.academicYearStart} className="min-w-44 border-b p-3">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold">{cell.projected}</span>
                        {i > 0 && cell.need > 0 && <Badge variant="orange">Need {cell.need}</Badge>}
                        {i > 0 && cell.need === 0 && row.baseline > 0 && <Badge variant="green">On track</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cell.continuing} continuing
                        {cell.hired > 0 ? ` · ${cell.hired} hired` : ""}
                        {cell.pipeline > 0 ? ` · +${cell.pipeline} in pipeline` : ""}
                      </p>
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
            Need compares each year with this year&apos;s headcount for the area and counts hires only, not pipeline. Full-time staff are not included.
          </p>
        </div>
      )}
    </>
  );
}
