"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";
import { SharedCaseChecklistCard, type TripChecklist } from "@/components/booking-details/SharedCaseChecklistCard";
import SharedCaseChecklistPage from "@/app/(app)/settings/shared-case-checklist/page";
import { groupChecklist, type ChecklistItem } from "@/lib/shared-case-checklist";

const items: ChecklistItem[] = [
  { id: "1", label: "XLR cables (4)", section: "Audio" },
  { id: "2", label: "Wireless lav kit batteries", section: "Audio" },
  { id: "3", label: "Gaffer tape", section: "Grip" },
  { id: "4", label: "Sandbags (2)", section: "Grip" },
  { id: "5", label: "Rain covers", section: "Weather" },
  { id: "6", label: "Towels", section: "Weather" },
  { id: "7", label: "Sensor cleaning kit", section: "Care" },
  { id: "8", label: "Lens cloths", section: "Care" },
];
const trip: TripChecklist = {
  tripId: "r1",
  groups: groupChecklist(items),
  checks: {
    "1": { at: "2026-11-06T21:12:00Z", by: "u1" },
    "3": { at: "2026-11-06T21:14:00Z", by: "u2" },
    "4": { at: "2026-11-06T21:14:00Z", by: "u2" },
    "6": { at: "2026-11-06T21:20:00Z", by: "u1" },
  },
  names: { u1: "Maddy Pehler", u2: "Ben Okafor" },
  total: items.length,
  checked: 4,
};

const route: LabRoute = (url) => {
  if (url.pathname.endsWith("/checklist")) return { data: trip };
  if (url.pathname === "/api/settings/shared-case-checklist") return { data: { items } };
  if (url.pathname === "/api/resources") return { data: [{ id: "g1", title: "Football Travel Case Check List" }] };
  return undefined;
};

function View() {
  return useSearchParams().get("view") === "settings" ? (
    <SharedCaseChecklistPage />
  ) : (
    <div className="max-w-2xl">
      <SharedCaseChecklistCard bookingId="c1" />
    </div>
  );
}

export default function CaseChecklistLab({ fontClass }: { fontClass: string }) {
  return (
    <LabShell fontClass={fontClass} route={route}>
      <Suspense>
        <View />
      </Suspense>
    </LabShell>
  );
}
