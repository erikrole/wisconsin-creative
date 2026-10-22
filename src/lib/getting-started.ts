/**
 * The Getting started checklist's saved progress, shared by web and iOS. Rows
 * that the server can see for itself (profile, "can't work" entries) are not
 * stored; these are the ones only a tap can tell us about.
 */

export const GETTING_STARTED_ROWS = [
  "profile",
  "availability",
  "schedule",
  "guides",
  "app",
  "notifications",
  "crew",
  "onboarding-status",
] as const;

export type GettingStartedRow = (typeof GETTING_STARTED_ROWS)[number];
export type GettingStartedState = { done: GettingStartedRow[]; dismissed: boolean };

/** How long after an account is created the card offers itself. */
export const GETTING_STARTED_WINDOW_DAYS = 14;

export const EMPTY_GETTING_STARTED: GettingStartedState = { done: [], dismissed: false };

export function isGettingStartedRow(value: unknown): value is GettingStartedRow {
  return typeof value === "string" && (GETTING_STARTED_ROWS as readonly string[]).includes(value);
}

/** Whatever is stored (or nothing), as a clean state. Unknown row ids are dropped. */
export function normalizeGettingStarted(raw: unknown): GettingStartedState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_GETTING_STARTED, done: [] };
  const value = raw as { done?: unknown; dismissed?: unknown };
  const done = Array.isArray(value.done) ? [...new Set(value.done.filter(isGettingStartedRow))] : [];
  return { done, dismissed: value.dismissed === true };
}

/** Progress only moves forward: rows stay done and a hidden card stays hidden. */
export function mergeGettingStarted(a: GettingStartedState, b: Partial<GettingStartedState>): GettingStartedState {
  return {
    done: [...new Set([...a.done, ...(b.done ?? []).filter(isGettingStartedRow)])],
    dismissed: a.dismissed || b.dismissed === true,
  };
}

export function sameGettingStarted(a: GettingStartedState, b: GettingStartedState): boolean {
  return a.dismissed === b.dismissed && a.done.length === b.done.length && a.done.every((row) => b.done.includes(row));
}

export function withinGettingStartedWindow(accountCreatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!accountCreatedAt) return false;
  const ageDays = (now - new Date(accountCreatedAt).getTime()) / 86_400_000;
  return ageDays >= 0 && ageDays <= GETTING_STARTED_WINDOW_DAYS;
}
