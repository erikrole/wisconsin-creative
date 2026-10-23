"use client";

import { CancelledError, useQuery, useQueryClient } from "@tanstack/react-query";
import { profileCompletionReadEpoch } from "@/lib/profile-completion-cache";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import type { ProfileCompletionField, ProfileCompletionStep } from "@/lib/profile-completion";
import type { GraduationTermValue, StudentYearValue } from "@/lib/student-profile";
import type { OnboardingGroup } from "@/lib/onboarding-save";

export type ProfileCompletionResponse = {
  profile: {
    id: string;
    name: string;
    role: "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
    email: string;
    athleticsEmail: string | null;
    phone: string | null;
    personalPhone: string | null;
    workPhone: string | null;
    workPhoneNotApplicable: boolean;
    wiscardCardNumber: string | null;
    wiscardIssueCode: string | null;
    studentYearOverride: StudentYearValue | null;
    gradYear: number | null;
    graduationTerm: GraduationTermValue | null;
    topSizeFit: "UNISEX" | "WOMENS" | "MENS" | null;
    topSize: string | null;
    shoeSizeSystem: "US_WOMENS" | "US_MENS" | null;
    shoeSize: string | null;
    avatarUrl: string | null;
    profilePromptSnoozedUntil: string | null;
    onboardingRequired?: boolean;
    onboardingCompletedAt?: string | null;
  };
  completion: {
    operationalReady: boolean;
    requiredComplete: boolean;
    requiresSetup: boolean;
    onboardingComplete: boolean;
    profileComplete: boolean;
    isComplete: boolean;
    isSnoozed: boolean;
    shouldPrompt: boolean;
    snoozedUntil: string | null;
    completedCount: number;
    totalCount: number;
    missingFields: ProfileCompletionField[];
    firstIncompleteStep: ProfileCompletionStep | null;
    completeByField: Record<ProfileCompletionField, boolean>;
  };
  versions?: Partial<Record<OnboardingGroup, string>>;
};

type ApiEnvelope = { data?: ProfileCompletionResponse };

export const PROFILE_COMPLETION_QUERY_KEY = ["profile-completion"] as const;

export async function fetchProfileCompletion(signal?: AbortSignal): Promise<ProfileCompletionResponse | null> {
  const response = await fetch("/api/me/profile-completion", { signal });
  if (handleAuthRedirect(response)) return null;
  if (!response.ok) throw new Error("Could not load profile completion");
  const json = await parseJsonSafely<ApiEnvelope>(response);
  if (!json?.data) throw new Error("Profile completion response was incomplete");
  return json.data;
}

export function useProfileCompletion(enabled = true) {
  const client = useQueryClient();
  return useQuery<ProfileCompletionResponse | null>({
    queryKey: PROFILE_COMPLETION_QUERY_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const epoch = profileCompletionReadEpoch(client);
      const data = await fetchProfileCompletion(signal);
      if (epoch !== profileCompletionReadEpoch(client)) throw new CancelledError({ revert: true, silent: true });
      return data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: true,
  });
}
