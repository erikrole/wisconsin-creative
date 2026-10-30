"use client";

import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";
import { EventTravelCard } from "@/app/(app)/events/[id]/_components/EventTravelCard";

const person = (id: string, name: string, role = "STUDENT") => ({ id, name, role, primaryArea: null, avatarUrl: null });
const member = (id: string, name: string, fromCrew: boolean, gearOut: number, role?: string) => ({
  id: fromCrew ? `crew:${id}` : `m-${id}`,
  eventId: "e1",
  userId: id,
  notes: null,
  createdAt: "2026-10-24T15:00:00Z",
  fromCrew,
  gearOut,
  user: person(id, name, role),
});

const roster = [
  member("u1", "Ava Lindqvist", true, 0),
  member("u2", "Ben Okafor", true, 3),
  member("u3", "Erik Role", false, 0, "STAFF"),
  member("u4", "Maddy Pehler", true, 1),
  member("u5", "Sam Patel", true, 0),
];

const route: LabRoute = (url) => {
  if (url.pathname.endsWith("/travel")) return { data: roster };
  if (url.pathname.includes("/roster")) return { data: [] };
  return undefined;
};

export default function TravelLab({ fontClass }: { fontClass: string }) {
  return (
    <LabShell fontClass={fontClass} route={route}>
      <div className="max-w-xl">
        <EventTravelCard eventId="e1" sportCode="FB" isStaff />
      </div>
    </LabShell>
  );
}
