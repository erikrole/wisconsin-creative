import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { groupValues, ONBOARDING_GROUP_FIELDS, type OnboardingGroup } from "@/lib/onboarding-save";

export function onboardingVersions(profile: { id: string; role: string; phone?: string | null; wiscardNumber?: string | null }) {
  return Object.fromEntries((Object.keys(ONBOARDING_GROUP_FIELDS) as OnboardingGroup[]).map((group) => {
    const aliases = group === "WISCARD" ? profile.wiscardNumber : group === "PERSONAL_PHONE" ? profile.phone : null;
    const value = JSON.stringify([profile.id, profile.role, group, groupValues(profile, group), aliases]);
    return [group, createHmac("sha256", env.sessionSecret).update(value).digest("hex")];
  })) as Record<OnboardingGroup, string>;
}
