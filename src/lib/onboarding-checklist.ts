import { getProfileCompletion } from "@/lib/profile-completion";

/** Steps only an admin can tell happened. Ticked by hand on the student's profile. */
export const ONBOARDING_MANUAL_STEPS = ["orientation", "gear_training"] as const;
export type OnboardingManualStep = (typeof ONBOARDING_MANUAL_STEPS)[number];

/** What gets stored in `users.onboarding_checks`: when a step was ticked and by whom. */
export type OnboardingChecks = Partial<Record<OnboardingManualStep, { at: string; by: string }>>;

export type OnboardingRow = {
  key: string;
  label: string;
  done: boolean;
  /** Manual rows can be ticked by an admin; the rest follow the student's own data. */
  manual: boolean;
  /** Optional rows never count toward the total. */
  optional: boolean;
  /** When a manual row was ticked, so the page can say who and when. */
  doneAt: string | null;
  doneBy: string | null;
};

export type OnboardingChecklist = { rows: OnboardingRow[]; done: number; total: number };

/** Everything the server looks up for one student; the checklist is a pure function of it. */
export type OnboardingFacts = {
  profile: Parameters<typeof getProfileCompletion>[0];
  signedIn: boolean;
  hasAvailability: boolean;
  hasIosApp: boolean;
  hasPush: boolean;
  hasCheckout: boolean;
  checks: OnboardingChecks;
  /** Who ticked each manual step, by user id. */
  names: Record<string, string>;
};

const MANUAL_LABELS: Record<OnboardingManualStep, string> = {
  orientation: "Orientation",
  gear_training: "Gear training",
};

export function parseOnboardingChecks(raw: unknown): OnboardingChecks {
  if (!raw || typeof raw !== "object") return {};
  const checks: OnboardingChecks = {};
  for (const step of ONBOARDING_MANUAL_STEPS) {
    const entry = (raw as Record<string, { at?: unknown; by?: unknown } | undefined>)[step];
    if (entry && typeof entry.at === "string" && typeof entry.by === "string") checks[step] = { at: entry.at, by: entry.by };
  }
  return checks;
}

export function buildOnboardingChecklist(facts: OnboardingFacts): OnboardingChecklist {
  const { completeByField: field } = getProfileCompletion(facts.profile);
  const auto = (key: string, label: string, done: boolean, optional = false): OnboardingRow =>
    ({ key, label, done, manual: false, optional, doneAt: null, doneBy: null });
  const rows: OnboardingRow[] = [
    auto("signed_in", "Signed in", facts.signedIn),
    auto("photo", "Profile photo", field.photo),
    auto("phone", "Phone number", field.personalPhone),
    auto("student", "Year and graduation", field.studentYear && field.anticipatedGraduation),
    auto("sizes", "Apparel sizes", field.clothingSize && field.shoeSize),
    auto("wiscard", "Wiscard", field.wiscard, true),
    auto("availability", "Availability set", facts.hasAvailability),
    auto("app", "iPhone app installed", facts.hasIosApp),
    auto("notifications", "Notifications on", facts.hasPush),
    auto("checkout", "First checkout", facts.hasCheckout),
    ...ONBOARDING_MANUAL_STEPS.map((step): OnboardingRow => {
      const check = facts.checks[step];
      return {
        key: step, label: MANUAL_LABELS[step], done: Boolean(check), manual: true, optional: false,
        doneAt: check?.at ?? null, doneBy: check ? (facts.names[check.by] ?? null) : null,
      };
    }),
  ];
  const counted = rows.filter((row) => !row.optional);
  return { rows, done: counted.filter((row) => row.done).length, total: counted.length };
}
