"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { CrewSizeDialog } from "@/app/(app)/schedule/_components/CrewSizeDialog";
import type { WorkingSchedulePayload, WorkingScheduleSportTemplate } from "@/lib/schedule-working-copy";

type Slot = WorkingSchedulePayload["slots"][number];

function slot(key: string, area: Slot["area"], workerType: Slot["workerType"], filled = false): Slot {
  return {
    key,
    sourceShiftId: key,
    area,
    workerType,
    startsAt: "2026-10-24T18:00:00.000Z",
    endsAt: "2026-10-24T21:00:00.000Z",
    callStartsAt: null,
    callEndsAt: null,
    notes: null,
    assignmentHistoryCount: filled ? 1 : 0,
    assignment: null,
  };
}

const SLOTS: Slot[] = [
  slot("v1", "VIDEO", "FT", true),
  slot("v2", "VIDEO", "ST", true),
  slot("v3", "VIDEO", "ST", true),
  slot("v4", "VIDEO", "ST"),
  slot("p1", "PHOTO", "ST", true),
  slot("p2", "PHOTO", "ST"),
  slot("s1", "SOCIAL", "ST"),
  slot("g1", "GRAPHICS", "FT"),
];

const TEMPLATE: WorkingScheduleSportTemplate = {
  sportCode: "FB",
  venue: "home",
  rows: [
    { area: "VIDEO", home: { FT: 1, ST: 4 }, away: { FT: 1, ST: 1 } },
    { area: "PHOTO", home: { FT: 0, ST: 3 }, away: { FT: 0, ST: 1 } },
    { area: "SOCIAL", home: { FT: 0, ST: 1 }, away: { FT: 0, ST: 0 } },
  ],
};

function Lab() {
  const params = useSearchParams();
  useEffect(() => {
    document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
  }, [params]);
  return (
    <CrewSizeDialog
      open
      onOpenChange={() => {}}
      slots={SLOTS}
      saving={false}
      onSave={async () => true}
      template={params.get("template") === "none" ? null : TEMPLATE}
      canSaveTemplate
    />
  );
}

export default function CrewSizeLab() {
  return (
    <Suspense fallback={null}>
      <Lab />
    </Suspense>
  );
}
