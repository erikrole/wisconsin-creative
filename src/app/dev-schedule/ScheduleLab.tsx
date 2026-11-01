"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CurrentUser } from "@/hooks/use-current-user";
import SchedulePage from "@/app/(app)/schedule/page";
import type { CalendarEvent, Shift, ShiftGroup } from "@/app/(app)/schedule/_components/types";

const PEOPLE = [
  ["u-maddy", "Maddy Pehler", "VIDEO"],
  ["u-jordan", "Jordan Ruiz", "VIDEO"],
  ["u-tess", "Tess Olson", "PHOTO"],
  ["u-sam", "Sam Becker", "PHOTO"],
  ["u-ava", "Ava Lindqvist", "GRAPHICS"],
  ["u-noah", "Noah Klein", "SOCIAL"],
] as const;

/** A time `days` from today at `hour` Central time, wherever the lab runs. */
const at = (days: number, hour: number) => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date()).split("-").map(Number);
  const noon = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  const offset = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
    .formatToParts(noon).find((part) => part.type === "timeZoneName")!.value.replace("GMT", ""));
  return new Date(Date.UTC(y!, m! - 1, d! + days, hour - offset)).toISOString();
};

type Plan = [days: number, hour: number, summary: string, sport: string, opponent: string, site: "HOME" | "AWAY", location: string, crew: Array<[area: string, person: number | null]>];

const PLAN: Plan[] = [
  [-2, 19, "Men's hockey vs Minnesota", "MHKY", "Minnesota", "HOME", "Kohl Center", [["VIDEO", 0], ["PHOTO", 2], ["SOCIAL", 5]]],
  [0, 18, "Volleyball vs Nebraska", "WVB", "Nebraska", "HOME", "UW Field House", [["VIDEO", 1], ["VIDEO", null], ["PHOTO", 3], ["SOCIAL", 5]]],
  [1, 11, "Football vs Iowa", "FB", "Iowa", "HOME", "Camp Randall", [["VIDEO", 0], ["VIDEO", 1], ["PHOTO", 2], ["PHOTO", 3], ["GRAPHICS", 4], ["SOCIAL", null]]],
  [1, 19, "Women's basketball vs Marquette", "WBB", "Marquette", "HOME", "Kohl Center", [["VIDEO", null], ["PHOTO", 3]]],
  [2, 13, "Women's soccer at Michigan", "WSOC", "Michigan", "AWAY", "Ann Arbor, MI", []],
  [3, 18, "Men's basketball vs UW-Milwaukee", "MBB", "UW-Milwaukee", "HOME", "Kohl Center", [["VIDEO", 1], ["PHOTO", null], ["GRAPHICS", 4]]],
  [5, 14, "Wrestling vs Purdue", "WRES", "Purdue", "HOME", "UW Field House", [["VIDEO", null], ["PHOTO", null]]],
  [8, 18, "Volleyball vs Penn State", "WVB", "Penn State", "HOME", "UW Field House", [["VIDEO", 0], ["PHOTO", 2], ["SOCIAL", null]]],
];

const EVENTS: CalendarEvent[] = PLAN.map(([days, hour, summary, sportCode, opponent, site, location], index) => ({
  id: `ev-${index}`,
  summary,
  startsAt: at(days, hour),
  endsAt: at(days, hour + 3),
  allDay: false,
  status: "CONFIRMED",
  rawLocationText: location,
  sportCode,
  opponent,
  isHome: site === "HOME",
  site,
  subtitle: null,
  location: { id: `loc-${index}`, name: location },
  source: { id: "src-uw", name: "UW Athletics" },
}));

const GROUPS: ShiftGroup[] = PLAN.flatMap(([days, hour, , , , , , crew], index) => {
  if (crew.length === 0) return [];
  const shifts: Shift[] = crew.map(([area, person], s) => ({
    id: `sh-${index}-${s}`,
    area,
    workerType: "ST",
    startsAt: at(days, hour - 2),
    endsAt: at(days, hour + 3),
    notes: null,
    assignments: person === null ? [] : [{
      id: `as-${index}-${s}`,
      status: "APPROVED",
      user: { id: PEOPLE[person]![0], name: PEOPLE[person]![1], role: "STUDENT", staffingType: "ST", primaryArea: PEOPLE[person]![2] },
    }],
  }));
  const filled = shifts.filter((shift) => shift.assignments.length > 0).length;
  return [{
    id: `g-${index}`,
    eventId: `ev-${index}`,
    notes: null,
    publication: { status: "published", publishedAt: at(-3, 9), publishedById: "dev", changedAfterPublish: false, activeAssignmentCount: filled, acknowledgedCount: filled, unacknowledgedCount: 0 },
    event: { id: `ev-${index}`, startsAt: at(days, hour) },
    shifts,
    coverage: { total: shifts.length, filled, percentage: Math.round((filled / shifts.length) * 100) },
  }];
});

const queue = (count = 0) => ({ count, eventCount: count, eventIds: [] });

const HEALTH = {
  window: { startsAt: null, endsAt: null, includePast: false, includeArchived: false, sportCode: null },
  nextCall: { eventId: "ev-1", summary: "Volleyball vs Nebraska", startsAt: at(0, 16), label: "Volleyball vs Nebraska" },
  queues: {
    openSlots: queue(7), eventsWithoutCrew: queue(1), unpublishedDrafts: queue(), coveredEvents: { ...queue(2), totalVisibleEvents: 8 },
    myShifts: queue(), pendingRequests: queue(2), conflicts: queue(), openTrades: queue(1), tradeApprovals: queue(),
    gearGaps: queue(), dataQuality: { ...queue(), issues: [] }, hiddenEvents: queue(), archivedEvents: queue(),
  },
  gearReadiness: { events: {}, assignments: {}, queues: { missingGear: queue(), unlinkedAssignmentGear: queue() } },
  changeHistory: { events: {} },
  partialFailures: [],
};

const AUTOMATION = {
  generatedAt: new Date().toISOString(),
  window: HEALTH.window,
  metrics: {
    openSlots: 7, eventsWithoutCrew: 1, pendingRequests: 2, conflicts: 0, gearGaps: 0, readyToPublish: 0, autoFillCandidates: 3,
    staleSources: 0, sourceErrors: 0, staleTrades: 0, syncEventsAdded: 0, syncEventsUpdated: 0, syncGroupsCreated: 0, syncShiftsCreated: 0,
    shiftGroupsArchived: null, eventsArchived: null, tradesExpired: null, pendingPickupsExpired: null,
  },
  cards: [],
  partialFailures: [],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const inWindow = (startsAt: string, url: URL) => {
  const time = new Date(startsAt).getTime();
  const after = url.searchParams.get("afterStartsAt") ?? url.searchParams.get("startDate");
  const before = url.searchParams.get("beforeStartsAt") ?? url.searchParams.get("endDate");
  if (url.searchParams.has("afterStartsAt") && after && time <= new Date(after).getTime()) return false;
  if (url.searchParams.has("beforeStartsAt") && before && time >= new Date(before).getTime()) return false;
  return true;
};

/** Answers the Schedule page's API calls with sample data so the page renders without a database. */
function installFetchShim(user: CurrentUser) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const sport = url.searchParams.get("sportCode");
    if (url.pathname === "/api/me") return json({ data: user });
    if (url.pathname === "/api/calendar-events") {
      const data = EVENTS.filter((event) => (!sport || event.sportCode === sport) && inWindow(event.startsAt, url));
      const ordered = url.searchParams.has("beforeStartsAt") ? [...data].reverse() : data;
      return json({ data: ordered, total: ordered.length });
    }
    if (url.pathname === "/api/shift-groups") {
      const data = GROUPS.filter((group) => !sport || EVENTS.find((event) => event.id === group.eventId)?.sportCode === sport);
      return json({ data, total: data.length });
    }
    if (url.pathname === "/api/shift-trades") return json({ data: [], total: 1 });
    if (url.pathname === "/api/calendar-sources") return json({ data: [] });
    if (url.pathname.startsWith("/api/schedule/health")) return json({ data: HEALTH });
    if (url.pathname.startsWith("/api/schedule/automation")) return json({ data: AUTOMATION });
    if (url.pathname === "/api/users") return json({ data: PEOPLE.map(([id, name, primaryArea]) => ({ id, name, role: "STUDENT", primaryArea })) });
    if (url.pathname === "/api/locations") return json({ data: [] });
    return realFetch(input, init);
  };
}

function Lab({ fontClass }: { fontClass: string }) {
  const params = useSearchParams();
  const role = params.get("role") === "student" ? "STUDENT" : "ADMIN";
  const [user] = useState(() => ({ id: role === "STUDENT" ? "u-maddy" : "dev", name: role === "STUDENT" ? "Maddy Pehler" : "Erik Role", email: "dev@example.com", role, staffingType: "ST" }) as CurrentUser);
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined") installFetchShim(user);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], user);
    return client;
  });

  useEffect(() => {
    const theme = params.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
    const list = ["wc-fresh", fontClass];
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [params, fontClass]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <SidebarProvider>
            <AppSidebar user={user} overdueBadgeCount={1} />
            <BreadcrumbProvider>
              <div className="min-w-0 flex-1 bg-background">
                <AppTopBar isCollaborator={false} onSearch={() => {}} unreadNotifications={0} user={user} />
                <main id="main-content" className={`wc-fresh ${fontClass} px-8 py-5 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))]`}>
                  <SchedulePage />
                </main>
              </div>
            </BreadcrumbProvider>
          </SidebarProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function ScheduleLab({ fontClass }: { fontClass: string }) {
  return (
    <Suspense>
      <Lab fontClass={fontClass} />
    </Suspense>
  );
}
