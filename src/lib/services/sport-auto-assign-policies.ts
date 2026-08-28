import { Role, SportAutoAssignPolicy } from "@prisma/client";
import { db } from "@/lib/db";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

/**
 * Every sport's auto-assign policy, keyed by sport code. Sports with no config
 * row are absent, and callers resolve those through the documented default.
 */
export async function loadSportAutoAssignPolicies(
  sportCodes?: string[],
): Promise<Map<string, SportAutoAssignPolicy>> {
  const configs = await db.sportConfig.findMany({
    where: sportCodes && sportCodes.length > 0 ? { sportCode: { in: sportCodes } } : undefined,
    select: { sportCode: true, autoAssignPolicy: true },
  });
  return new Map(configs.map((config) => [config.sportCode, config.autoAssignPolicy]));
}

export async function setSportAutoAssignPolicy(sportCode: string, policy: SportAutoAssignPolicy) {
  return db.sportConfig.upsert({
    where: { sportCode },
    create: { sportCode, active: true, autoAssignPolicy: policy },
    update: { autoAssignPolicy: policy },
    select: { sportCode: true, autoAssignPolicy: true },
  });
}

/**
 * How many people each sport has marked as default travelers. Away-game
 * eligibility only narrows to the travel roster when the sport actually has
 * one, so the count is the input to that decision.
 */
export async function loadTravelRosterCounts(sportCodes: string[]): Promise<Map<string, number>> {
  if (sportCodes.length === 0) return new Map();
  const grouped = await db.studentSportAssignment.groupBy({
    by: ["sportCode"],
    where: {
      sportCode: { in: sportCodes },
      defaultTraveler: true,
      user: visibleActiveUserWhere({ role: { not: Role.COLLABORATOR } }),
    },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.sportCode, row._count._all]));
}
