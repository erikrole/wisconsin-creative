import { Role, ShiftWorkerType } from "@prisma/client";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/EmptyState";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { STANDING_LABELS, TERM_LABELS } from "@/lib/hiring/contract";
import { deriveStudentYear } from "../users/types";
import { PersonCard } from "./PersonCard";
import RosterImportButton from "./RosterImportButton";
import { AREA_LABEL, AREA_OPTIONS } from "./hiring/types";

export const metadata = { title: "Workforce" };

const STUDENT_YEAR_LABEL: Record<string, string> = {
  FRESHMAN: "Freshman",
  SOPHOMORE: "Sophomore",
  JUNIOR: "Junior",
  SENIOR: "Senior",
  GRAD: "Grad",
};

type Person = {
  id: string;
  name: string;
  avatarUrl: string | null;
  title: string | null;
  area: string | null;
  kind: "FULL_TIME" | "STUDENT";
  standing: string | null;
  graduation: string | null;
  graduatesThisYear: boolean;
  sports: string[];
};

/** Admin-only workforce overview: full-time staff and students, grouped by area (D-065). */
export default async function WorkforcePage() {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");

  const users = await db.user.findMany({
    where: { active: true, hiddenFromRoster: false, role: { in: [Role.ADMIN, Role.STAFF, Role.STUDENT] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      title: true,
      staffingType: true,
      primaryArea: true,
      gradYear: true,
      graduationTerm: true,
      studentYearOverride: true,
      areaAssignments: { select: { area: true, isPrimary: true } },
      sportAssignments: { select: { sportCode: true }, orderBy: { sportCode: "asc" } },
    },
  });

  const now = new Date();
  const academicYearEnd = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();

  const people: Person[] = users.map((u) => {
    const kind = u.staffingType === ShiftWorkerType.FT ? "FULL_TIME" : "STUDENT";
    const derived = kind === "STUDENT" ? deriveStudentYear(u.gradYear, u.studentYearOverride) : null;
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      title: u.title,
      area: u.primaryArea ?? u.areaAssignments.find((a) => a.isPrimary)?.area ?? u.areaAssignments[0]?.area ?? null,
      kind,
      standing: derived ? (STUDENT_YEAR_LABEL[derived] ?? STANDING_LABELS[derived as keyof typeof STANDING_LABELS] ?? null) : null,
      graduation: u.gradYear ? `${u.graduationTerm ? TERM_LABELS[u.graduationTerm] : "Spring"} ${u.gradYear}` : null,
      graduatesThisYear: kind === "STUDENT" && u.gradYear != null && u.gradYear <= academicYearEnd,
      sports: u.sportAssignments.map((s) => s.sportCode),
    };
  });

  const fullTime = people.filter((p) => p.kind === "FULL_TIME");
  const students = people.filter((p) => p.kind === "STUDENT");
  const graduating = students.filter((s) => s.graduatesThisYear);

  const areaOrder = [...AREA_OPTIONS.map((a) => a.value as string), "NONE"];
  const byArea = new Map<string, Person[]>();
  for (const p of people) {
    const key = p.area ?? "NONE";
    byArea.set(key, [...(byArea.get(key) ?? []), p]);
  }

  return (
    <>
      <PageHeader title="Workforce" description="Full-time staff and students across every area, with who graduates and where the gaps will be.">
        <RosterImportButton defaultYear={academicYearEnd - 1} />
      </PageHeader>

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Full-time", fullTime.length],
          ["Students", students.length],
          [`Graduating by ${academicYearEnd}`, graduating.length],
          ["Areas covered", [...byArea.keys()].filter((k) => k !== "NONE").length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      {people.length === 0 ? (
        <EmptyState icon="users" title="No active workforce yet" description="Active staff and students appear here." />
      ) : (
        <div className="grid gap-6">
          {areaOrder
            .filter((key) => byArea.has(key))
            .map((key) => {
              const members = byArea.get(key) ?? [];
              const staff = members.filter((m) => m.kind === "FULL_TIME");
              const studs = members.filter((m) => m.kind === "STUDENT");
              const leaving = studs.filter((m) => m.graduatesThisYear).length;
              return (
                <section key={key} aria-label={key === "NONE" ? "No area" : AREA_LABEL[key]}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{key === "NONE" ? "No area set" : AREA_LABEL[key]}</h2>
                    <Badge variant="gray">{staff.length} full-time</Badge>
                    <Badge variant="gray">{studs.length} students</Badge>
                    {leaving > 0 && <Badge variant="orange">{leaving} graduating by {academicYearEnd}</Badge>}
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {[...staff, ...studs].map((p) => (
                      <li key={p.id}>
                        <PersonCard person={{ ...p, academicYearEnd }} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
        </div>
      )}
    </>
  );
}
