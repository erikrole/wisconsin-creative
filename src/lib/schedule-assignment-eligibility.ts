/**
 * Who auto assignment is allowed to propose.
 *
 * Auto assignment draws purely from a sport's roster: if an event has a sport,
 * only people assigned to that sport are candidates for it. Candidate scoring
 * still ranks them, but it cannot promote someone onto a sport they do not
 * cover. Events with no sport (non-game work) have no roster to check, so every
 * otherwise-eligible worker stays in the pool.
 *
 * The rule has two views and they must agree:
 *   - `isSportRosterEligible` reads the scoring signal, for the preview paths
 *     that already have scored candidates in hand.
 *   - `isOnSportRoster` reads the roster rows directly, for the apply
 *     transaction that re-validates against live data before it writes.
 */

import type { CandidateRecommendation } from "@/lib/candidate-scoring-types";

/** Scoring emits this reason only when the candidate covers the event's sport. */
export const SPORT_ROSTER_REASON_CODE = "sport_roster";

export function isSportRosterEligible(
  score: Pick<CandidateRecommendation, "reasons">,
  eventSportCode: string | null | undefined,
): boolean {
  if (!eventSportCode) return true;
  return score.reasons.some((reason) => reason.code === SPORT_ROSTER_REASON_CODE);
}

export function isOnSportRoster(
  sportAssignments: ReadonlyArray<{ sportCode: string }>,
  eventSportCode: string | null | undefined,
): boolean {
  if (!eventSportCode) return true;
  return sportAssignments.some((assignment) => assignment.sportCode === eventSportCode);
}

/**
 * Away games are crewed from the sport's travel roster.
 *
 * The rule is conditional on the roster existing: a sport that has marked who
 * travels gets away games drawn from exactly those people, and a sport that has
 * marked nobody falls back to its full roster. Gating unconditionally would
 * silently empty every away game for every sport that has not set travel yet,
 * which is a worse failure than the one it prevents. `sportHasTravelRoster`
 * makes which mode applied explicit to the caller rather than implied.
 */
export function isTravelEligible(
  sportAssignments: ReadonlyArray<{ sportCode: string; defaultTraveler: boolean }>,
  eventSportCode: string | null | undefined,
  isHome: boolean | null | undefined,
  sportHasTravelRoster: boolean,
): boolean {
  // Home games, non-sport events, and events with unknown venue are unaffected.
  if (isHome !== false) return true;
  if (!eventSportCode) return true;
  if (!sportHasTravelRoster) return true;
  return sportAssignments.some(
    (assignment) => assignment.sportCode === eventSportCode && assignment.defaultTraveler,
  );
}

/** Whether a sport has anybody marked as a default traveler. */
export function sportHasTravelRoster(
  travelRosterCounts: ReadonlyMap<string, number>,
  eventSportCode: string | null | undefined,
): boolean {
  if (!eventSportCode) return false;
  return (travelRosterCounts.get(eventSportCode) ?? 0) > 0;
}
