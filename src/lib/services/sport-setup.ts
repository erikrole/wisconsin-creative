/**
 * Data behind the sport setup wizard.
 *
 * Setting a sport up for auto assignment is two decisions that belong together:
 * how far automation may go (the policy) and who it may draw from (the roster).
 * Splitting them across the settings page and each person's profile made a
 * sport-by-sport pass tedious, which is how rosters end up empty and auto
 * assign ends up looking broken. This loads every sport in one request so the
 * wizard can step through them without a round trip per sport.
 */

import { Prisma, Role, type SportAutoAssignPolicy } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import { db } from "@/lib/db";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { SPORT_CODES, sportLabel } from "@/lib/sports";
import { DEFAULT_SPORT_AUTO_ASSIGN_POLICY } from "@/lib/sport-auto-assign-policy";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

/** Big 6 first: they carry the schedule, so they are the pass that matters. */
const PRIORITY_SPORT_CODES = ["FB", "MBB", "WBB", "MHKY", "WHKY", "VB"];

export type SportSetupPerson = {
  id: string;
  name: string;
  role: string;
  workerType: "FT" | "ST";
  primaryArea: string | null;
};

export type SportSetupMember = SportSetupPerson & {
  assignmentId: string;
  defaultTraveler: boolean;
};

export type SportSetupEntry = {
  sportCode: string;
  label: string;
  policy: SportAutoAssignPolicy;
  staff: SportSetupMember[];
  students: SportSetupMember[];
};

export type SportSetupResponse = {
  sports: SportSetupEntry[];
  /** Everyone who can hold a slot, for the roster picker. */
  people: SportSetupPerson[];
};

function sportOrder(a: string, b: string) {
  const rank = (code: string) => {
    const index = PRIORITY_SPORT_CODES.indexOf(code);
    return index === -1 ? PRIORITY_SPORT_CODES.length : index;
  };
  return rank(a) - rank(b) || sportLabel(a).localeCompare(sportLabel(b));
}

export async function getSportSetup(): Promise<SportSetupResponse> {
  const [configs, assignments, users] = await Promise.all([
    db.sportConfig.findMany({ select: { sportCode: true, autoAssignPolicy: true } }),
    db.studentSportAssignment.findMany({
      where: { user: visibleActiveUserWhere({ role: { not: Role.COLLABORATOR } }) },
      orderBy: [{ sportCode: "asc" }, { user: { name: "asc" } }],
      select: {
        id: true,
        sportCode: true,
        defaultTraveler: true,
        user: { select: { id: true, name: true, role: true, staffingType: true, primaryArea: true } },
      },
    }),
    db.user.findMany({
      where: visibleActiveUserWhere({ role: { not: Role.COLLABORATOR } }),
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, staffingType: true, primaryArea: true },
    }),
  ]);

  const policyByCode = new Map(configs.map((config) => [config.sportCode, config.autoAssignPolicy]));
  const membersByCode = new Map<string, SportSetupMember[]>();
  for (const assignment of assignments) {
    const workerType = shiftWorkerTypeForProfile(assignment.user);
    // No scheduling class means the person cannot hold either slot type, so
    // they are not part of any pool auto assignment draws from.
    if (!workerType) continue;
    const list = membersByCode.get(assignment.sportCode) ?? [];
    list.push({
      assignmentId: assignment.id,
      defaultTraveler: assignment.defaultTraveler,
      id: assignment.user.id,
      name: assignment.user.name,
      role: assignment.user.role,
      workerType,
      primaryArea: assignment.user.primaryArea,
    });
    membersByCode.set(assignment.sportCode, list);
  }

  const sports = [...SPORT_CODES]
    .map((sport) => sport.code as string)
    .sort(sportOrder)
    .map((sportCode) => {
      const members = membersByCode.get(sportCode) ?? [];
      return {
        sportCode,
        label: sportLabel(sportCode),
        policy: policyByCode.get(sportCode) ?? DEFAULT_SPORT_AUTO_ASSIGN_POLICY,
        staff: members.filter((member) => member.workerType === "FT"),
        students: members.filter((member) => member.workerType === "ST"),
      };
    });

  const people = users.flatMap((user) => {
    const workerType = shiftWorkerTypeForProfile(user);
    return workerType
      ? [{ id: user.id, name: user.name, role: user.role, workerType, primaryArea: user.primaryArea }]
      : [];
  });

  return { sports, people };
}

export type MatchSportSetupResult = {
  sourceSportCode: string;
  targetSportCode: string;
  policy: SportAutoAssignPolicy;
  /** People copied across who were not already on the target roster. */
  peopleAdded: number;
  /** Copied people carried over as default travelers. */
  travelersAdded: number;
};

/**
 * Copy one sport's setup onto another.
 *
 * Sports are commonly run the same way as each other -- "hockey, same as
 * basketball" -- and retyping that per sport is how they drift apart. The
 * policy always copies; the roster copies only when asked.
 *
 * The roster copy is deliberately additive: it adds the source's people who are
 * missing and carries their travel flag, but never removes anyone already on
 * the target. Matching a sport should not be able to silently delete a roster
 * somebody built by hand.
 */
export async function matchSportSetup(args: {
  sourceSportCode: string;
  targetSportCode: string;
  includeRoster: boolean;
  actor: { id: string; role: Role };
}): Promise<MatchSportSetupResult> {
  const { sourceSportCode, targetSportCode, includeRoster, actor } = args;
  if (sourceSportCode === targetSportCode) {
    throw new HttpError(400, "Pick a different sport to match.");
  }

  return db.$transaction(async (tx) => {
    const sourceConfig = await tx.sportConfig.findUnique({
      where: { sportCode: sourceSportCode },
      select: { autoAssignPolicy: true },
    });
    const policy = sourceConfig?.autoAssignPolicy ?? DEFAULT_SPORT_AUTO_ASSIGN_POLICY;

    await tx.sportConfig.upsert({
      where: { sportCode: targetSportCode },
      create: { sportCode: targetSportCode, active: true, autoAssignPolicy: policy },
      update: { autoAssignPolicy: policy },
    });

    let peopleAdded = 0;
    let travelersAdded = 0;
    if (includeRoster) {
      const [sourceMembers, targetMembers] = await Promise.all([
        tx.studentSportAssignment.findMany({
          where: { sportCode: sourceSportCode },
          select: { userId: true, defaultTraveler: true },
        }),
        tx.studentSportAssignment.findMany({
          where: { sportCode: targetSportCode },
          select: { userId: true },
        }),
      ]);
      const existing = new Set(targetMembers.map((member) => member.userId));
      const missing = sourceMembers.filter((member) => !existing.has(member.userId));
      if (missing.length > 0) {
        await tx.studentSportAssignment.createMany({
          data: missing.map((member) => ({
            userId: member.userId,
            sportCode: targetSportCode,
            defaultTraveler: member.defaultTraveler,
          })),
          skipDuplicates: true,
        });
        peopleAdded = missing.length;
        travelersAdded = missing.filter((member) => member.defaultTraveler).length;
      }
    }

    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "sport_config",
      entityId: targetSportCode,
      action: "sport_setup_matched",
      after: { sourceSportCode, targetSportCode, policy, includeRoster, peopleAdded, travelersAdded },
    });

    return { sourceSportCode, targetSportCode, policy, peopleAdded, travelersAdded };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
