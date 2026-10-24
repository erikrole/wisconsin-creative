"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import WelcomePage from "@/app/(app)/welcome/page";
import { WelcomeDone } from "@/app/(app)/welcome/WelcomeDone";
import { AvailabilitySetup } from "@/app/(app)/welcome/availability/AvailabilitySetup";
import { PROFILE_COMPLETION_QUERY_KEY, type ProfileCompletionResponse } from "@/hooks/use-profile-completion";
import { getProfileCompletion } from "@/lib/profile-completion";

type Role = ProfileCompletionResponse["profile"]["role"];
const ROLES: Role[] = ["STUDENT", "STAFF", "COLLABORATOR"];

function sample(role: Role, filled: number): ProfileCompletionResponse {
  const profile: ProfileCompletionResponse["profile"] = {
    id: "dev-welcome",
    name: role === "STUDENT" ? "Maya Chen" : role === "STAFF" ? "Jordan Ruiz" : "Taylor Kim",
    role,
    email: "maya.chen@wisc.edu",
    athleticsEmail: null,
    phone: null,
    personalPhone: null,
    workPhone: null,
    workPhoneNotApplicable: false,
    wiscardCardNumber: null,
    wiscardIssueCode: null,
    studentYearOverride: null,
    gradYear: null,
    graduationTerm: null,
    topSizeFit: null,
    topSize: null,
    shoeSizeSystem: null,
    shoeSize: null,
    avatarUrl: null,
    profilePromptSnoozedUntil: null,
  };
  if (filled >= 1) profile.personalPhone = "(608) 555-0142";
  if (filled >= 2) {
    profile.wiscardCardNumber = "1234567890";
    profile.wiscardIssueCode = "1";
  }
  if (filled >= 3) {
    profile.studentYearOverride = "SOPHOMORE";
    profile.gradYear = 2029;
    profile.graduationTerm = "SPRING";
  }
  if (filled >= 4) {
    profile.topSizeFit = "UNISEX";
    profile.topSize = "M";
    profile.shoeSizeSystem = "US_MENS";
    profile.shoeSize = "10";
  }
  return { profile, completion: getProfileCompletion(profile) as ProfileCompletionResponse["completion"] };
}

/** `?role=STUDENT&view=setup&filled=0|1|2|3|4`, `?view=done|later`, or `?view=availability` (availability API mocked by the caller). */
function Lab() {
  const params = useSearchParams();
  const role = (ROLES.find((r) => r === params.get("role")) ?? "STUDENT") as Role;
  const view = params.get("view") ?? "setup";
  const filled = Number(params.get("filled") ?? 0);
  const theme = params.get("theme");
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } }));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }, [theme]);

  client.setQueryData(PROFILE_COMPLETION_QUERY_KEY, sample(role, filled));
  const first = sample(role, 0).profile.name.split(" ")[0]!;

  return (
    <QueryClientProvider client={client}>
      {view === "setup" ? (
        <WelcomePage />
      ) : view === "availability" ? (
        <AvailabilitySetup userId="dev-welcome" onDone={() => {}} />
      ) : (
        <WelcomeDone firstName={first} role={role} outcome={view === "later" ? "later" : "complete"} onContinue={() => {}} />
      )}
      <Toaster />
    </QueryClientProvider>
  );
}

export default function WelcomeLab({ fontClass }: { fontClass: string }) {
  useEffect(() => {
    document.body.classList.add("wc-fresh", fontClass);
    return () => document.body.classList.remove("wc-fresh", fontClass);
  }, [fontClass]);
  return (
    <div className={`wc-fresh ${fontClass} min-h-dvh bg-background`}>
      <Suspense>
        <Lab />
      </Suspense>
    </div>
  );
}
