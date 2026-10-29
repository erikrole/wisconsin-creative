import { getProfileCompletion } from "@/lib/profile-completion";

/** Steps only an admin can tell happened. Ticked by hand on the student's profile. */
export const ONBOARDING_MANUAL_STEPS = ["slack", "asana", "computer_login", "adobe", "building_access", "orientation", "gear_training"] as const;
export type OnboardingManualStep = (typeof ONBOARDING_MANUAL_STEPS)[number];

/** What gets stored in `users.onboarding_checks`: when a step was ticked and by whom. */
export type OnboardingChecks = Partial<Record<OnboardingManualStep, { at: string; by: string; note?: string }>>;

/** Where to send a student for a step, and anything worth knowing. Shared by every student; edited by admins. */
export type OnboardingGuide = Partial<Record<OnboardingManualStep, { contact: string; note: string }>>;

export const ONBOARDING_NOTE_MAX = 200;

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
  /** This student's note on the step. */
  note: string | null;
  /** Who to reach out to for the step, and general notes (manual rows only). */
  contact: string | null;
  hint: string | null;
};

export type OnboardingChecklist = { rows: OnboardingRow[]; done: number; total: number };

/** Everything the server looks up for one student; the checklist is a pure function of it. */
export type OnboardingFacts = {
  profile: Parameters<typeof getProfileCompletion>[0];
  signedIn: boolean;
  hasClassSchedule: boolean;
  hasIosApp: boolean;
  hasPush: boolean;
  hasCheckout: boolean;
  checks: OnboardingChecks;
  guide: OnboardingGuide;
  /** Who ticked each manual step, by user id. */
  names: Record<string, string>;
};

export const ONBOARDING_STEP_LABELS: Record<OnboardingManualStep, string> = {
  slack: "Slack",
  asana: "Asana",
  computer_login: "Computer login",
  adobe: "Adobe access",
  building_access: "Building access",
  orientation: "Orientation",
  gear_training: "Gear training",
};

export function parseOnboardingChecks(raw: unknown): OnboardingChecks {
  if (!raw || typeof raw !== "object") return {};
  const checks: OnboardingChecks = {};
  for (const step of ONBOARDING_MANUAL_STEPS) {
    const entry = (raw as Record<string, { at?: unknown; by?: unknown } | undefined>)[step];
    const note = (entry as { note?: unknown } | undefined)?.note;
    if (entry && typeof entry.at === "string" && typeof entry.by === "string") {
      checks[step] = { at: entry.at, by: entry.by, ...(typeof note === "string" && note ? { note } : {}) };
    }
  }
  return checks;
}

export function parseOnboardingGuide(raw: unknown): OnboardingGuide {
  if (!raw || typeof raw !== "object") return {};
  const guide: OnboardingGuide = {};
  for (const step of ONBOARDING_MANUAL_STEPS) {
    const entry = (raw as Record<string, { contact?: unknown; note?: unknown } | undefined>)[step];
    const contact = typeof entry?.contact === "string" ? entry.contact : "";
    const note = typeof entry?.note === "string" ? entry.note : "";
    if (contact || note) guide[step] = { contact, note };
  }
  return guide;
}

/**
 * Ticks, unticks or re-notes one step. Ticking a step that is already ticked keeps who and when;
 * a note on an unticked step is dropped. Returns the same object when nothing changes.
 */
export function applyOnboardingCheck(
  checks: OnboardingChecks,
  step: OnboardingManualStep,
  change: { done?: boolean; note?: string },
  by: string,
  now = new Date(),
): OnboardingChecks {
  const current = checks[step];
  if (change.done === false) {
    if (!current) return checks;
    const { [step]: _removed, ...rest } = checks;
    return rest;
  }
  if (!current && change.done !== true) return checks;
  const note = change.note === undefined ? current?.note : change.note.trim() || undefined;
  if (current && note === current.note) return checks;
  return { ...checks, [step]: { at: current?.at ?? now.toISOString(), by: current?.by ?? by, ...(note ? { note } : {}) } };
}

export function buildOnboardingChecklist(facts: OnboardingFacts): OnboardingChecklist {
  const { completeByField: field } = getProfileCompletion(facts.profile);
  const auto = (key: string, label: string, done: boolean, optional = false): OnboardingRow =>
    ({ key, label, done, manual: false, optional, doneAt: null, doneBy: null, note: null, contact: null, hint: null });
  const rows: OnboardingRow[] = [
    auto("signed_in", "Signed in", facts.signedIn),
    auto("photo", "Profile photo", field.photo),
    auto("phone", "Phone number", field.personalPhone),
    auto("student", "Year and graduation", field.studentYear && field.anticipatedGraduation),
    auto("sizes", "Apparel sizes", field.clothingSize && field.shoeSize),
    auto("wiscard", "Wiscard", field.wiscard, true),
    auto("class_schedule", "Class schedule", facts.hasClassSchedule),
    auto("app", "iPhone app installed", facts.hasIosApp),
    auto("notifications", "Notifications on", facts.hasPush),
    auto("checkout", "First checkout", facts.hasCheckout),
    ...ONBOARDING_MANUAL_STEPS.map((step): OnboardingRow => {
      const check = facts.checks[step];
      return {
        key: step, label: ONBOARDING_STEP_LABELS[step], done: Boolean(check), manual: true, optional: false,
        doneAt: check?.at ?? null, doneBy: check ? (facts.names[check.by] ?? null) : null,
        note: check?.note ?? null, contact: facts.guide[step]?.contact || null, hint: facts.guide[step]?.note || null,
      };
    }),
  ];
  const counted = rows.filter((row) => !row.optional);
  return { rows, done: counted.filter((row) => row.done).length, total: counted.length };
}
