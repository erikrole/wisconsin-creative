/**
 * How far auto assignment may go for each sport.
 *
 * Sports are run differently and the difference is a scheduling policy, not a
 * per-run choice:
 *
 *   - `FULL_CREW`  fill every open slot, staff and student alike.
 *   - `STAFF_ONLY` fill the staff positions and deliberately leave student
 *                  slots open, so students request them through Open Work.
 *   - `HOLD`       propose nothing; the sport is scheduled by hand for now.
 *
 * `STAFF_ONLY` leaves student slots *open on purpose*, so they are not counted
 * as an unfilled crew: an event whose only remaining gaps are student slots the
 * policy meant to leave open is fully crewed as far as this run is concerned.
 */

import { SportAutoAssignPolicy } from "@prisma/client";

export { SportAutoAssignPolicy };

export const SPORT_AUTO_ASSIGN_POLICIES = [
  SportAutoAssignPolicy.FULL_CREW,
  SportAutoAssignPolicy.STAFF_ONLY,
  SportAutoAssignPolicy.HOLD,
] as const;

/** A sport with no configured policy is auto-assigned exactly as before. */
export const DEFAULT_SPORT_AUTO_ASSIGN_POLICY = SportAutoAssignPolicy.FULL_CREW;

export const SPORT_AUTO_ASSIGN_POLICY_LABELS: Record<SportAutoAssignPolicy, string> = {
  FULL_CREW: "Full crew",
  STAFF_ONLY: "Staff only",
  HOLD: "Hold",
};

export const SPORT_AUTO_ASSIGN_POLICY_DESCRIPTIONS: Record<SportAutoAssignPolicy, string> = {
  FULL_CREW: "Auto assign fills both staff and student slots.",
  STAFF_ONLY: "Auto assign fills staff slots. Student slots stay open for students to request.",
  HOLD: "Auto assign proposes nothing for this sport.",
};

export function resolveSportAutoAssignPolicy(
  policies: ReadonlyMap<string, SportAutoAssignPolicy>,
  sportCode: string | null | undefined,
): SportAutoAssignPolicy {
  // Non-sport events have no policy to look up and stay fully automatable.
  if (!sportCode) return DEFAULT_SPORT_AUTO_ASSIGN_POLICY;
  return policies.get(sportCode) ?? DEFAULT_SPORT_AUTO_ASSIGN_POLICY;
}

/** Whether a slot of this scheduling class may be auto-filled under `policy`. */
export function policyAllowsWorkerType(
  policy: SportAutoAssignPolicy,
  workerType: "FT" | "ST",
): boolean {
  if (policy === SportAutoAssignPolicy.HOLD) return false;
  if (policy === SportAutoAssignPolicy.STAFF_ONLY) return workerType === "FT";
  return true;
}
