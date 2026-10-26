"use client";

import { Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { AutoAssignDialog } from "@/components/schedule/AutoAssignDialog";
import type {
  BulkAssignmentPreviewEvent,
  BulkAssignmentPreviewProposal,
  BulkAssignmentPreviewResponse,
} from "@/lib/bulk-schedule-assignment-types";

type Row = [area: BulkAssignmentPreviewProposal["area"], name: string, reasons: string[], warning?: string];

function event(id: string, summary: string, startsAt: string, rows: Row[], open = rows.length): BulkAssignmentPreviewEvent {
  return {
    shiftGroupId: `g-${id}`,
    eventId: id,
    summary,
    startsAt,
    sportCode: "FB",
    workingVersion: 1,
    publishedVersion: 1,
    status: "ready",
    openSlots: open,
    unfilledSlots: open - rows.length,
    fullyCrewed: open === rows.length,
    skipped: [],
    proposals: rows.map(([area, name, reasons, warning], index) => ({
      proposalId: `${id}-${index}`,
      shiftGroupId: `g-${id}`,
      shiftId: `s-${id}-${index}`,
      eventId: id,
      userId: name,
      eventSummary: summary,
      eventStartsAt: startsAt,
      eventSportCode: "FB",
      area,
      workerType: "ST",
      userName: name,
      userRole: "STUDENT",
      score: 90,
      bucket: warning ? "warning" : "recommended",
      reasons: [{ code: "role_fit", label: "Student", weight: 24 }, ...reasons.map((label, i) => ({ code: `r${i}`, label, weight: 20 - i }))],
      warnings: warning ? [{ code: "upcoming_load", label: warning, weight: -12 }] : [],
      advisoryConflict: false,
      advisoryConflictNote: null,
    })),
  };
}

const EVENTS = [
  event("e1", "Football vs. Iowa", "2026-10-24T16:00:00.000Z", [
    ["VIDEO", "Maya Brooks", ["Video is their main area", "On the Football roster"]],
    ["VIDEO", "Jonah Reyes", ["Video is their main area", "Has worked Football before"]],
    ["PHOTO", "Priya Nair", ["Photo is their main area", "Nothing else this week"]],
    ["SOCIAL", "Theo Marsh", ["Also works Social", "Fewer shifts than most this season"]],
  ]),
  event("e2", "Volleyball vs. Nebraska", "2026-10-25T23:00:00.000Z", [
    ["VIDEO", "Ana Lindqvist", ["Video is their main area", "Fewer shifts than most this season"]],
    ["PHOTO", "Cole Hendricks", ["Photo is their main area"], "5 shifts coming up"],
  ]),
  event("e3", "Men's Hockey vs. Minnesota", "2026-10-27T00:00:00.000Z", [
    ["VIDEO", "Jonah Reyes", ["Video is their main area", "On the Men's Hockey roster"]],
    ["GRAPHICS", "Sam Ortiz", ["Graphics is their main area", "Nothing else this week"]],
  ], 3),
];

const PREVIEW: BulkAssignmentPreviewResponse = {
  generatedAt: "2026-10-21T12:00:00.000Z",
  scope: {
    sportCodes: [],
    rangeStartsAt: "2026-10-21T05:00:00.000Z",
    rangeEndsAt: "2026-10-28T05:00:00.000Z",
    area: null,
    workerScope: "ALL",
    requireFullCrew: false,
    eventIds: [],
    period: "week",
  },
  fingerprint: "a".repeat(64),
  events: [
    ...EVENTS,
    { ...event("e4", "Women's Soccer at Purdue", "2026-10-26T18:00:00.000Z", []), status: "skipped", skipped: [{ shiftId: null, area: null, workerType: null, reasonCode: "no_travel_roster", reason: "Nobody travels", reasonDetails: [] }] },
  ],
  people: [],
  summary: { eventsMatched: 4, eventsReady: 3, openSlots: 9, proposed: 8, skipped: 1, warnings: 1, peopleAffected: 7, eventsFullyCrewed: 2, eventsPartiallyCrewed: 1, eventsPendingChanges: 0, eventsOnHold: 0 },
};

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } }));
}

const EVENT_PREVIEW: BulkAssignmentPreviewResponse = {
  ...PREVIEW,
  scope: { ...PREVIEW.scope, eventIds: ["e3"], period: "custom" },
  events: [EVENTS[2]!],
  summary: { ...PREVIEW.summary, eventsMatched: 1, eventsReady: 1, openSlots: 3, proposed: 2, skipped: 0, warnings: 0, peopleAffected: 2, eventsFullyCrewed: 0, eventsPartiallyCrewed: 1 },
};

const LAB_EVENT = {
  id: "e3",
  summary: "Men's Hockey vs. Minnesota",
  startsAt: "2026-10-27T00:00:00.000Z",
  endsAt: "2026-10-27T03:00:00.000Z",
};

const ROSTER = {
  sports: [
    { sportCode: "FB", label: "Football", policy: "FULL_CREW", total: 4, staff: [{ id: "s1", name: "Dana Reyes" }], students: [{ id: "u1", name: "Macy Farrell" }, { id: "u2", name: "Jon Lee" }, { id: "u3", name: "Ava Kim" }] },
    { sportCode: "MHOC", label: "Men's Hockey", policy: "STAFF_ONLY", total: 3, staff: [{ id: "s2", name: "Chris Park" }], students: [{ id: "u4", name: "Sam Ortiz" }, { id: "u5", name: "Lily Tran" }] },
  ],
  emptySportCodes: [],
  heldSportCodes: [],
};

function Lab() {
  const params = useSearchParams();
  const eventMode = params.get("mode") === "event";
  const [ready, setReady] = useState(false);
  const [client] = useState(() => new QueryClient());
  useEffect(() => {
    document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
    const original = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/bulk-assignment/batches")) return json({ batches: [] });
      if (url.includes("/bulk-assignment/preview")) return json(eventMode ? EVENT_PREVIEW : PREVIEW);
      if (url.includes("/sport-roster")) return json(ROSTER);
      return original(input, init);
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, [eventMode, params]);
  if (!ready) return null;
  return (
    <QueryClientProvider client={client}>
      <AutoAssignDialog open onOpenChange={() => {}} onApplied={() => {}} event={eventMode ? LAB_EVENT : null} initialSportCodes={eventMode ? undefined : ["FB", "MHOC"]} />
    </QueryClientProvider>
  );
}

export default function AutoAssignLab() {
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}
