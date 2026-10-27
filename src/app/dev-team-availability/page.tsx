import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import { TeamAvailabilityGrid } from "@/app/(app)/staff/availability/TeamAvailabilityGrid";
import { addDays, weekStartOf, type TeamBlock, type TeamStudent } from "@/lib/team-availability";
import { institutionDateKey } from "@/lib/format";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

const weekly = (id: string, dayOfWeek: number, startsAt: string, endsAt: string, label: string, status: TeamBlock["status"] = "APPROVED"): TeamBlock => ({
  id, kind: "WEEKLY", intent: "CANNOT_WORK", status, dayOfWeek, date: null, dateEndsOn: null, allDay: false,
  startsAt, endsAt, label, semesterStartsOn: null, semesterEndsOn: null,
});

// Dev-only: the Staff Availability grid with sample students, no database.
export default function DevTeamAvailabilityPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const monday = weekStartOf(institutionDateKey());
  const trip: TeamBlock = {
    ...weekly("t1", 0, "00:00", "23:59", "Away"), kind: "AD_HOC", dayOfWeek: null,
    date: addDays(monday, 3), dateEndsOn: addDays(monday, 4), allDay: true,
  };
  const students: TeamStudent[] = [
    { id: "1", name: "Avery Johnson", avatarUrl: null, blocks: [weekly("a", 1, "09:00", "11:00", "CHEM 101"), weekly("b", 3, "09:00", "11:00", "CHEM 101"), weekly("c", 2, "13:00", "17:00", "Work")] },
    { id: "2", name: "Jordan Lee", avatarUrl: null, blocks: [trip, weekly("d", 5, "14:30", "16:00", "Lab", "PENDING")] },
    { id: "3", name: "Sam Rivera", avatarUrl: null, blocks: [weekly("e", 1, "08:00", "09:15", "MATH 221"), weekly("f", 4, "08:00", "09:15", "MATH 221"), { ...weekly("g", 6, "18:00", "22:00", ""), intent: "PREFER", label: null }] },
    { id: "4", name: "Taylor Kim", avatarUrl: null, blocks: [] },
  ];
  return (
    <div className={`wc-fresh ${lato.variable} mx-auto max-w-6xl p-6`}>
      <TeamAvailabilityGrid students={students} />
    </div>
  );
}
