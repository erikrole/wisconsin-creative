"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AssignPageClient } from "@/app/(app)/schedule/assign/_components/AssignPageClient";

const now = new Date();
function at(daysAhead: number, hour: number) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, hour, 0, 0);
  return d.toISOString();
}

type Seat = [area: string, workerType: "ST" | "FT", name: string | null, conflict?: string];

const EVENTS: Array<{ id: string; summary: string; sport: string; opponent: string; isHome: boolean; day: number; hour: number; seats: Seat[] }> = [
  { id: "e1", summary: "Football vs. Iowa", sport: "FB", opponent: "Iowa", isHome: true, day: 1, hour: 14, seats: [
    ["VIDEO", "FT", "Erik Role"], ["VIDEO", "ST", "Maya Brooks"], ["VIDEO", "ST", "Jonah Reyes"], ["PHOTO", "ST", "Priya Nair"], ["PHOTO", "ST", null], ["SOCIAL", "ST", "Theo Marsh"], ["GRAPHICS", "FT", "Sam Ortiz"],
  ] },
  { id: "e2", summary: "Volleyball vs. Nebraska", sport: "VB", opponent: "Nebraska", isHome: true, day: 2, hour: 18, seats: [
    ["VIDEO", "ST", "Ana Lindqvist", "Class until 6:15 PM"], ["PHOTO", "ST", "Cole Hendricks"], ["SOCIAL", "ST", null],
  ] },
  { id: "e3", summary: "Men's Hockey at Minnesota", sport: "MHKY", opponent: "Minnesota", isHome: false, day: 3, hour: 19, seats: [
    ["VIDEO", "ST", "Jonah Reyes"], ["PHOTO", "ST", null], ["GRAPHICS", "FT", null],
  ] },
  { id: "e4", summary: "Women's Soccer vs. Purdue", sport: "WSOC", opponent: "Purdue", isHome: true, day: 5, hour: 13, seats: [
    ["VIDEO", "ST", "Maya Brooks"], ["PHOTO", "ST", "Priya Nair"], ["SOCIAL", "ST", "Theo Marsh"],
  ] },
];

const calendarEvents = EVENTS.map((e) => ({
  id: e.id, summary: e.summary, startsAt: at(e.day, e.hour), endsAt: at(e.day, e.hour + 3), allDay: false, status: "CONFIRMED",
  rawLocationText: null, sportCode: e.sport, opponent: e.opponent, isHome: e.isHome, site: e.isHome ? "HOME" : "AWAY", subtitle: null,
  location: null, source: null,
}));

const shiftGroups = EVENTS.map((e) => ({
  id: `g-${e.id}`, eventId: e.id, archivedAt: null,
  shifts: e.seats.map(([area, workerType, name, conflict], i) => ({
    id: `s-${e.id}-${i}`, area, workerType, startsAt: at(e.day, e.hour), endsAt: at(e.day, e.hour + 3),
    callStartsAt: workerType === "ST" ? at(e.day, e.hour - 2) : null, callEndsAt: workerType === "ST" ? at(e.day, e.hour + 3) : null,
    assignments: name ? [{ id: `a-${e.id}-${i}`, status: "DIRECT_ASSIGNED", hasConflict: Boolean(conflict), conflictNote: conflict ?? null, user: { id: name, name, primaryArea: area, avatarUrl: null } }] : [],
  })),
}));

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } }));
}

function Lab() {
  const params = useSearchParams();
  const [client] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("/api/calendar-events")) return json(calendarEvents);
      if (url.startsWith("/api/shift-groups")) return json(shiftGroups);
      if (url.includes("/bulk-assignment/batches")) return json({ batches: [] });
      return original(input, init);
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, [params]);
  if (!ready) return null;
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <div className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-8">
          <AssignPageClient />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function AssignGridLab() {
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}
