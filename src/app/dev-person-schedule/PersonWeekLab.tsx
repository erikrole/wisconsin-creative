"use client";

import { useState } from "react";
import { PersonWeek } from "@/app/(app)/schedule/_components/PersonWeekView";
import type { CalendarEntry } from "@/app/(app)/schedule/_components/types";
import { addDays, weekStartOf, type TeamBlock, type TeamStudent } from "@/lib/team-availability";
import { institutionDateKey } from "@/lib/format";

const monday = weekStartOf(institutionDateKey());
const at = (offset: number, hhmm: string) => new Date(`${addDays(monday, offset)}T${hhmm}:00-05:00`).toISOString();

type Crew = Array<[id: string, name: string, status: string, crewLabel?: string]>;

function entry(id: string, summary: string, sportCode: string, opponent: string, isHome: boolean, day: number, from: string, to: string, crew: Crew, area = "PHOTO"): CalendarEntry {
  return {
    id, summary, startsAt: at(day, from), endsAt: at(day, to), allDay: false, status: "CONFIRMED", rawLocationText: null,
    sportCode, opponent, isHome, site: isHome ? "HOME" : "AWAY", subtitle: null, location: null, source: null,
    shiftGroupId: `g-${id}`, coverage: { total: crew.length + 1, filled: crew.length, percentage: 80 },
    shifts: [{
      id: `s-${id}`, area, workerType: "ST", startsAt: at(day, from), endsAt: at(day, to), notes: null,
      assignments: crew.map(([uid, name, status, crewLabel]) => ({
        id: `${id}-${uid}`, status, crewLabel: crewLabel ?? null,
        user: { id: uid, name, role: "STUDENT", primaryArea: area },
        activeTrade: uid === "3" && id === "e2" ? { id: "t1", status: "OPEN" } : null,
      })),
    }],
  };
}

const entries: CalendarEntry[] = [
  entry("e1", "Men's Hockey vs Minnesota", "MHOCKEY", "Minnesota", true, 1, "18:00", "22:00", [["1", "Avery Johnson", "APPROVED", "Camera 1"], ["2", "Jordan Lee", "APPROVED", "Camera 2"]]),
  entry("e2", "Volleyball vs Iowa", "VB", "Iowa", true, 2, "18:30", "21:30", [["3", "Sam Rivera", "APPROVED", "Graphics"], ["1", "Avery Johnson", "APPROVED", "Camera 1"]]),
  entry("e3", "Football vs Ohio State", "FB", "Ohio State", true, 5, "11:00", "19:00", [["1", "Avery Johnson", "APPROVED", "Sideline"], ["2", "Jordan Lee", "APPROVED", "Replay"], ["3", "Sam Rivera", "REQUESTED"]]),
  entry("e4", "Women's Basketball at Purdue", "WBB", "Purdue", false, 6, "14:00", "17:00", [["2", "Jordan Lee", "APPROVED", "Camera 3"]]),
];

const block = (id: string, dayOfWeek: number, startsAt: string, endsAt: string, label: string): TeamBlock => ({
  id, kind: "WEEKLY", intent: "CANNOT_WORK", status: "APPROVED", dayOfWeek, date: null, dateEndsOn: null, allDay: false,
  startsAt, endsAt, label, semesterStartsOn: null, semesterEndsOn: null,
});

const students: TeamStudent[] = [
  { id: "1", name: "Avery Johnson", avatarUrl: null, blocks: [block("a", 2, "09:00", "11:00", "CHEM 101"), block("a2", 3, "17:00", "20:00", "Lab")] },
  { id: "2", name: "Jordan Lee", avatarUrl: null, blocks: [{ ...block("b", 0, "00:00", "23:59", "Away"), kind: "AD_HOC", dayOfWeek: null, date: addDays(monday, 3), dateEndsOn: addDays(monday, 3), allDay: true }] },
  { id: "3", name: "Sam Rivera", avatarUrl: null, blocks: [] },
  { id: "4", name: "Taylor Kim", avatarUrl: null, blocks: [block("c", 4, "13:00", "15:00", "MATH 221")] },
  { id: "5", name: "Morgan Diaz", avatarUrl: null, blocks: [] },
];

export function PersonWeekLab() {
  const [weekStart, setWeekStart] = useState(() => new Date(`${monday}T12:00:00`));
  return (
    <PersonWeek
      students={students}
      entries={entries}
      weekStart={weekStart}
      setWeekStart={setWeekStart}
      loading={false}
      onOpenCrew={() => {}}
    />
  );
}
