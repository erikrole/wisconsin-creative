"use client";

import { useEffect, useState } from "react";
import { BulkOnboardingDialog } from "@/app/(app)/staff/onboarding-status/BulkOnboardingDialog";
import { GuideDialog, OnboardingChecklistView } from "@/app/(app)/staff/[id]/OnboardingChecklistCard";
import { buildOnboardingChecklist, type OnboardingFacts } from "@/lib/onboarding-checklist";

const D = new Date("2026-10-27T20:00:00Z");

const base: OnboardingFacts = {
  profile: {
    id: "s", name: "Maya Chen", role: "STUDENT", email: "maya.chen@wisc.edu", athleticsEmail: null, phone: null,
    personalPhone: null, workPhone: null, workPhoneNotApplicable: false, wiscardCardNumber: null, wiscardIssueCode: null,
    studentYearOverride: null, gradYear: null, graduationTerm: null, topSizeFit: null, topSize: null, shoeSizeSystem: null,
    shoeSize: null, avatarUrl: null, profilePromptSnoozedUntil: null,
  },
  signedInAt: null, classScheduleAt: null, iosAppAt: null, pushAt: null, checkoutAt: null, adobeAt: null, readGuides: false, checks: {}, names: {},
  guide: {
    slack: { contact: "Erik", note: "Invite from the workspace admin page" },
    asana: { contact: "Erik", note: "" },
    computer_login: { contact: "IT desk", note: "Bring student ID" },
    adobe: { contact: "Maddy", note: "Needs the .wisc.edu email" },
    building_access: { contact: "Front office", note: "Badge ready in 2 days" },
  },
};

const filled: OnboardingFacts["profile"] = {
  ...base.profile, personalPhone: "(608) 555-0142", avatarUrl: "https://example.com/p.png",
  studentYearOverride: "SOPHOMORE", gradYear: 2029, graduationTerm: "SPRING", topSizeFit: "UNISEX", topSize: "M",
  shoeSizeSystem: "US_MENS", shoeSize: "10",
};
const tick = { at: "2026-10-28T20:00:00Z", by: "a" };

const STATES: Record<string, OnboardingFacts> = {
  "Just invited": base,
  "Mid-way": {
    ...base, profile: { ...filled, avatarUrl: null }, signedInAt: D, classScheduleAt: D, iosAppAt: D, readGuides: true,
    checks: { slack: tick, asana: { ...tick, note: "Joined the Creative project" }, orientation: tick }, names: { a: "Erik Role" },
  },
  "All done": {
    ...base, profile: { ...filled, wiscardCardNumber: "1", wiscardIssueCode: "1" }, signedInAt: D, classScheduleAt: D,
    iosAppAt: D, pushAt: D, checkoutAt: D, adobeAt: D, readGuides: true, checks: { slack: tick, asana: tick, computer_login: tick, adobe: tick, building_access: tick, orientation: tick, gear_training: tick }, names: { a: "Erik Role" },
  },
};

export default function OnboardingChecklistLab({ fontClass }: { fontClass: string }) {
  useEffect(() => {
    document.body.classList.add("wc-fresh", fontClass);
    return () => document.body.classList.remove("wc-fresh", fontClass);
  }, [fontClass]);
  const [facts, setFacts] = useState(STATES);
  const [view] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("view")));
  const [now] = useState(() => Date.now());
  const students = ["Maya Chen", "Jordan Ruiz", "Taylor Kim", "Sam Patel", "Riley Brooks", "Avery Nguyen"].map((name, i) => ({
    id: String(i), name, avatarUrl: null, createdAt: new Date(now - (i < 4 ? 3 : 90) * 86_400_000).toISOString(),
  }));
  return (
    <div className={`wc-fresh ${fontClass} min-h-dvh bg-background p-4 md:p-8`}>
      {view === "bulk" && <BulkOnboardingDialog students={students} onClose={() => {}} />}
      {view === "guide" && (
        <GuideDialog rows={buildOnboardingChecklist(STATES["Mid-way"]!).rows.filter((row) => row.manual)} busy={false} onClose={() => {}} onSave={() => {}} />
      )}
      <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
        {Object.entries(facts).map(([name, f]) => (
          <div key={name} id={name.toLowerCase().replace(/\W+/g, "-")} className="flex flex-col gap-2">
            <p className="m-0 text-xs font-bold text-muted-foreground">{name}</p>
            <OnboardingChecklistView
              checklist={buildOnboardingChecklist(f)}
              onSaveGuide={() => {}}
              onChange={({ step, done, note }) => setFacts({
                ...facts,
                [name]: {
                  ...f,
                  checks: done === false
                    ? Object.fromEntries(Object.entries(f.checks).filter(([k]) => k !== step))
                    : { ...f.checks, [step]: { ...tick, ...(f.checks as Record<string, object>)[step], ...(note !== undefined ? { note } : {}) } },
                  names: { a: "Erik Role" },
                },
              })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
