"use client";

import { useEffect, useState } from "react";
import { OnboardingChecklistView } from "@/app/(app)/staff/[id]/OnboardingChecklistCard";
import { buildOnboardingChecklist, type OnboardingFacts } from "@/lib/onboarding-checklist";

const base: OnboardingFacts = {
  profile: {
    id: "s", name: "Maya Chen", role: "STUDENT", email: "maya.chen@wisc.edu", athleticsEmail: null, phone: null,
    personalPhone: null, workPhone: null, workPhoneNotApplicable: false, wiscardCardNumber: null, wiscardIssueCode: null,
    studentYearOverride: null, gradYear: null, graduationTerm: null, topSizeFit: null, topSize: null, shoeSizeSystem: null,
    shoeSize: null, avatarUrl: null, profilePromptSnoozedUntil: null,
  },
  signedIn: false, hasAvailability: false, hasIosApp: false, hasPush: false, hasCheckout: false, checks: {}, names: {},
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
    ...base, profile: { ...filled, avatarUrl: null }, signedIn: true, hasAvailability: true, hasIosApp: true,
    checks: { orientation: tick }, names: { a: "Erik Role" },
  },
  "All done": {
    ...base, profile: { ...filled, wiscardCardNumber: "1", wiscardIssueCode: "1" }, signedIn: true, hasAvailability: true,
    hasIosApp: true, hasPush: true, hasCheckout: true, checks: { orientation: tick, gear_training: tick }, names: { a: "Erik Role" },
  },
};

export default function OnboardingChecklistLab({ fontClass }: { fontClass: string }) {
  useEffect(() => {
    document.body.classList.add("wc-fresh", fontClass);
    return () => document.body.classList.remove("wc-fresh", fontClass);
  }, [fontClass]);
  const [facts, setFacts] = useState(STATES);
  return (
    <div className={`wc-fresh ${fontClass} min-h-dvh bg-background p-4 md:p-8`}>
      <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
        {Object.entries(facts).map(([name, f]) => (
          <div key={name} id={name.toLowerCase().replace(/\W+/g, "-")} className="flex flex-col gap-2">
            <p className="m-0 text-xs font-bold text-muted-foreground">{name}</p>
            <OnboardingChecklistView
              checklist={buildOnboardingChecklist(f)}
              onToggle={(step, done) => setFacts({
                ...facts,
                [name]: { ...f, checks: done ? { ...f.checks, [step]: tick } : Object.fromEntries(Object.entries(f.checks).filter(([k]) => k !== step)), names: { a: "Erik Role" } },
              })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
