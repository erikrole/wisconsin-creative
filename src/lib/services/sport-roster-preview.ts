/**
 * Who is on the roster for a set of sports.
 *
 * Auto assignment only proposes people whose sport roster matches the event, so
 * an empty or stale roster is the single most common reason a batch comes back
 * with nothing to assign. Showing the roster next to the sport picker turns
 * that from a mystery into a one-click fix.
 */

import { Role, type SportAutoAssignPolicy } from "@prisma/client";
import { db } from "@/lib/db";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { normalizeSportCode, sportLabel } from "@/lib/sports";
import { visibleActiveUserWhere } from "@/lib/user-visibility";
import { DEFAULT_SPORT_AUTO_ASSIGN_POLICY } from "@/lib/sport-auto-assign-policy";
import { loadSportAutoAssignPolicies } from "@/lib/services/sport-auto-assign-policies";

export type SportRosterMember = {
  id: string;
  name: string;
  role: string;
  workerType: "FT" | "ST";
  primaryArea: string | null;
  defaultTraveler: boolean;
};

export type SportRosterPreviewEntry = {
  sportCode: string;
  label: string;
  policy: SportAutoAssignPolicy;
  total: number;
  staff: SportRosterMember[];
  students: SportRosterMember[];
};

export type SportRosterPreviewResponse = {
  sports: SportRosterPreviewEntry[];
  /** Selected sports with nobody assigned -- these will produce no proposals. */
  emptySportCodes: string[];
  /** Selected sports held back from auto assignment entirely. */
  heldSportCodes: string[];
};

export async function getSportRosterPreview(rawCodes: string[]): Promise<SportRosterPreviewResponse> {
  const codes = [...new Set(rawCodes.map(normalizeSportCode).filter(Boolean))].sort();
  if (codes.length === 0) return { sports: [], emptySportCodes: [], heldSportCodes: [] };

  const policies = await loadSportAutoAssignPolicies(codes);
  const assignments = await db.studentSportAssignment.findMany({
    where: {
      sportCode: { in: codes },
      user: visibleActiveUserWhere({ role: { not: Role.COLLABORATOR } }),
    },
    orderBy: [{ sportCode: "asc" }, { user: { name: "asc" } }],
    select: {
      sportCode: true,
      defaultTraveler: true,
      user: {
        select: { id: true, name: true, role: true, staffingType: true, primaryArea: true },
      },
    },
  });

  const byCode = new Map<string, SportRosterPreviewEntry>(
    codes.map((sportCode) => [
      sportCode,
      {
        sportCode,
        label: sportLabel(sportCode),
        policy: policies.get(sportCode) ?? DEFAULT_SPORT_AUTO_ASSIGN_POLICY,
        total: 0,
        staff: [],
        students: [],
      },
    ]),
  );

  for (const assignment of assignments) {
    const entry = byCode.get(assignment.sportCode);
    if (!entry) continue;
    // A profile with no scheduling class cannot hold either slot type, so it is
    // not part of the pool auto assignment can draw from.
    const workerType = shiftWorkerTypeForProfile(assignment.user);
    if (!workerType) continue;
    const member: SportRosterMember = {
      id: assignment.user.id,
      name: assignment.user.name,
      role: assignment.user.role,
      workerType,
      primaryArea: assignment.user.primaryArea,
      defaultTraveler: assignment.defaultTraveler,
    };
    if (workerType === "FT") entry.staff.push(member);
    else entry.students.push(member);
    entry.total += 1;
  }

  const sports = codes.map((code) => byCode.get(code)!);
  return {
    sports,
    // A held sport produces nothing regardless of how full its roster is, so
    // the two states are reported separately.
    emptySportCodes: sports.filter((entry) => entry.total === 0).map((entry) => entry.sportCode),
    heldSportCodes: sports.filter((entry) => entry.policy === "HOLD").map((entry) => entry.sportCode),
  };
}
