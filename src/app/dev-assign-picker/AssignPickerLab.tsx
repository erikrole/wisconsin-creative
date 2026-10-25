"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UserAvatarPicker, type PickerUser } from "@/components/shift-detail/UserAvatarPicker";
import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";

const PEOPLE: PickerUser[] = [
  { id: "1", name: "Maya Brooks", role: "STUDENT", staffingType: "ST", primaryArea: "VIDEO" },
  { id: "2", name: "Jonah Reyes", role: "STUDENT", staffingType: "ST", primaryArea: "VIDEO" },
  { id: "3", name: "Priya Nair", role: "STUDENT", staffingType: "ST", primaryArea: "PHOTO" },
  { id: "4", name: "Cole Hendricks", role: "STUDENT", staffingType: "ST", primaryArea: "VIDEO" },
  { id: "5", name: "Ana Lindqvist", role: "STUDENT", staffingType: "ST", primaryArea: "VIDEO" },
  { id: "6", name: "Theo Marsh", role: "STUDENT", staffingType: "ST", primaryArea: "GRAPHICS" },
];

function rec(userId: string, over: Partial<CandidateRecommendation>): CandidateRecommendation {
  return {
    userId,
    bucket: "good_fit",
    score: 70,
    reasons: [],
    warnings: [],
    blockingConflict: false,
    advisoryConflict: false,
    advisoryConflictNote: null,
    workload: { weekAssignments: 1, weekHours: 6, monthAssignments: 4, monthHours: 24, upcomingAssignments: 3 },
    ...over,
  };
}

const SCORES: Record<string, CandidateRecommendation> = {
  "1": rec("1", { bucket: "recommended", score: 92, reasons: [{ code: "area", label: "Video primary · on the football roster" }], workload: { weekAssignments: 0, weekHours: 0, monthAssignments: 3, monthHours: 18, upcomingAssignments: 2 } }),
  "2": rec("2", { bucket: "recommended", score: 86, reasons: [{ code: "area", label: "Video primary · worked this sport 4 times" }] }),
  "3": rec("3", { bucket: "good_fit", score: 64, reasons: [{ code: "cross", label: "Photo covering Video" }] }),
  "4": rec("4", { bucket: "overloaded", score: 31, warnings: [{ code: "load", label: "Already has 5 shifts this week" }], workload: { weekAssignments: 5, weekHours: 31, monthAssignments: 14, monthHours: 80, upcomingAssignments: 6 } }),
  "5": rec("5", { bucket: "warning", score: 20, advisoryConflict: true, advisoryConflictNote: "Class until 2:15 PM", warnings: [{ code: "class", label: "Class until 2:15 PM" }] }),
  "6": rec("6", { bucket: "warning", score: 0, blockingConflict: true, advisoryConflictNote: "Time off approved" }),
};

function Lab() {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const params = useSearchParams();
  const theme = params.get("theme");
  const state = params.get("state");
  const multi = params.get("mode") === "multi";
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  }, [theme]);
  return (
    <div className="flex min-h-screen justify-center bg-background p-6 text-foreground">
      <div className="w-[25rem] max-w-full self-start overflow-hidden rounded-xl border bg-popover shadow-lg">
        <UserAvatarPicker
          heading={multi ? "3 open Student slots · Video" : "Student slot · Video"}
          users={PEOPLE}
          loading={state === "loading"}
          search={search}
          onSearchChange={setSearch}
          onSelect={setPicked}
          disabled={false}
          candidateScores={SCORES}
          slotWorkerType="ST"
          multiple={multi ? {
            max: 3,
            selected: picks,
            onToggle: (id) => setPicks((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]),
            onConfirm: () => {},
          } : undefined}
        />
      </div>
      {picked && <p className="sr-only">Picked {PEOPLE.find((p) => p.id === picked)?.name}</p>}
    </div>
  );
}

export default function AssignPickerLab() {
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}
