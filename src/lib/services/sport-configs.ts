import { Prisma, Role, ShiftArea } from "@prisma/client";
import { createAuditEntriesTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

export type SportShiftConfigInput = {
  area: ShiftArea;
  homeCount?: number;
  awayCount?: number;
  homeStaffCount?: number;
  homeStudentCount?: number;
  awayStaffCount?: number;
  awayStudentCount?: number;
};

function normalizeShiftConfigInput(sc: SportShiftConfigInput) {
  const homeStaffCount = sc.homeStaffCount ?? 0;
  const homeStudentCount = sc.homeStudentCount ?? sc.homeCount ?? 0;
  const awayStaffCount = sc.awayStaffCount ?? 0;
  const awayStudentCount = sc.awayStudentCount ?? sc.awayCount ?? 0;
  return {
    area: sc.area,
    homeCount: homeStaffCount + homeStudentCount,
    awayCount: awayStaffCount + awayStudentCount,
    homeStaffCount,
    homeStudentCount,
    awayStaffCount,
    awayStudentCount,
  };
}

function configInputFromExisting(sc: {
  area: ShiftArea;
  homeCount: number;
  awayCount: number;
  homeStaffCount?: number | null;
  homeStudentCount?: number | null;
  awayStaffCount?: number | null;
  awayStudentCount?: number | null;
}): SportShiftConfigInput {
  return {
    area: sc.area,
    homeCount: sc.homeCount,
    awayCount: sc.awayCount,
    homeStaffCount: sc.homeStaffCount ?? 0,
    homeStudentCount: sc.homeStudentCount ?? sc.homeCount,
    awayStaffCount: sc.awayStaffCount ?? 0,
    awayStudentCount: sc.awayStudentCount ?? sc.awayCount,
  };
}

/** Get all sport configs with their shift config rows */
export async function getAllSportConfigs() {
  return db.sportConfig.findMany({
    include: { shiftConfigs: true },
    orderBy: { sportCode: "asc" },
  });
}

/** Get a single sport config by sportCode */
export async function getSportConfig(sportCode: string) {
  return db.sportConfig.findUnique({
    where: { sportCode },
    include: { shiftConfigs: true },
  });
}

/** Create or update a sport config with shift configs */
export async function upsertSportConfig(
  sportCode: string,
  active: boolean,
  shiftConfigs: SportShiftConfigInput[],
  shiftStartOffset?: number,
  shiftEndOffset?: number,
) {
  return db.$transaction(async (tx) => {
    // Upsert the sport config
    const config = await tx.sportConfig.upsert({
      where: { sportCode },
      create: { sportCode, active, ...(shiftStartOffset !== undefined && { shiftStartOffset }), ...(shiftEndOffset !== undefined && { shiftEndOffset }) },
      update: { active, ...(shiftStartOffset !== undefined && { shiftStartOffset }), ...(shiftEndOffset !== undefined && { shiftEndOffset }) },
    });

    // Upsert each shift config row
    for (const rawSc of shiftConfigs) {
      const sc = normalizeShiftConfigInput(rawSc);
      await tx.sportShiftConfig.upsert({
        where: {
          sportConfigId_area: {
            sportConfigId: config.id,
            area: sc.area,
          },
        },
        create: {
          sportConfigId: config.id,
          area: sc.area,
          homeCount: sc.homeCount,
          awayCount: sc.awayCount,
          homeStaffCount: sc.homeStaffCount,
          homeStudentCount: sc.homeStudentCount,
          awayStaffCount: sc.awayStaffCount,
          awayStudentCount: sc.awayStudentCount,
        },
        update: {
          homeCount: sc.homeCount,
          awayCount: sc.awayCount,
          homeStaffCount: sc.homeStaffCount,
          homeStudentCount: sc.homeStudentCount,
          awayStaffCount: sc.awayStaffCount,
          awayStudentCount: sc.awayStudentCount,
        },
      });
    }

    return tx.sportConfig.findUnique({
      where: { id: config.id },
      include: { shiftConfigs: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Apply the same patch atomically to many sport codes in a single transaction.
 * Either all codes update or none do — replaces the previous client-side loop
 * of N sequential PATCHes (which could half-apply on partial failure).
 *
 * For each code, missing rows are created on-demand (mirrors upsertSportConfig).
 * `shiftConfigs` / call-time fields fall back to the existing row's values when
 * not provided in the patch.
 */
export async function upsertSportConfigsForGroup(
  codes: string[],
  patch: {
    active?: boolean;
    shiftConfigs?: SportShiftConfigInput[];
    shiftStartOffset?: number;
    shiftEndOffset?: number;
  },
) {
  return db.$transaction(async (tx) => {
    const results = [];
    for (const sportCode of codes) {
      const existing = await tx.sportConfig.findUnique({
        where: { sportCode },
        include: { shiftConfigs: true },
      });
      const nextActive = patch.active ?? existing?.active ?? true;
      const nextShifts = patch.shiftConfigs
        ?? existing?.shiftConfigs.map(configInputFromExisting)
        ?? [];

      const config = await tx.sportConfig.upsert({
        where: { sportCode },
        create: {
          sportCode,
          active: nextActive,
          ...(patch.shiftStartOffset !== undefined && { shiftStartOffset: patch.shiftStartOffset }),
          ...(patch.shiftEndOffset !== undefined && { shiftEndOffset: patch.shiftEndOffset }),
        },
        update: {
          active: nextActive,
          ...(patch.shiftStartOffset !== undefined && { shiftStartOffset: patch.shiftStartOffset }),
          ...(patch.shiftEndOffset !== undefined && { shiftEndOffset: patch.shiftEndOffset }),
        },
      });

      for (const rawSc of nextShifts) {
        const sc = normalizeShiftConfigInput(rawSc);
        await tx.sportShiftConfig.upsert({
          where: { sportConfigId_area: { sportConfigId: config.id, area: sc.area } },
          create: {
            sportConfigId: config.id,
            area: sc.area,
            homeCount: sc.homeCount,
            awayCount: sc.awayCount,
            homeStaffCount: sc.homeStaffCount,
            homeStudentCount: sc.homeStudentCount,
            awayStaffCount: sc.awayStaffCount,
            awayStudentCount: sc.awayStudentCount,
          },
          update: {
            homeCount: sc.homeCount,
            awayCount: sc.awayCount,
            homeStaffCount: sc.homeStaffCount,
            homeStudentCount: sc.homeStudentCount,
            awayStaffCount: sc.awayStaffCount,
            awayStudentCount: sc.awayStudentCount,
          },
        });
      }

      const fresh = await tx.sportConfig.findUnique({
        where: { id: config.id },
        include: { shiftConfigs: true },
      });
      if (fresh) results.push(fresh);
    }
    return results;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Toggle a sport config active/inactive */
export async function toggleSportConfig(sportCode: string, active: boolean) {
  return db.sportConfig.update({
    where: { sportCode },
    data: { active },
    include: { shiftConfigs: true },
  });
}

/** Get roster (students/staff) assigned to a sport */
export async function getSportRoster(sportCode: string) {
  const assignments = await db.studentSportAssignment.findMany({
    where: { sportCode },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true, primaryArea: true },
      },
    },
    orderBy: { user: { name: "asc" } },
  });
  return assignments.map((a) => ({
    id: a.id,
    userId: a.userId,
    sportCode: a.sportCode,
    defaultTraveler: a.defaultTraveler,
    user: a.user,
    createdAt: a.createdAt,
  }));
}

/** Add a user to a sport roster */
export async function addToRoster(userId: string, sportCode: string) {
  return db.studentSportAssignment.create({
    data: { userId, sportCode },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true, primaryArea: true },
      },
    },
  });
}

/** Remove a user from a sport roster */
export async function removeFromRoster(assignmentId: string) {
  return db.studentSportAssignment.delete({
    where: { id: assignmentId },
  });
}

/** Bulk add users to a sport roster */
export async function bulkAddToRoster(userIds: string[], sportCode: string) {
  // Use createMany with skipDuplicates to handle existing assignments
  await db.studentSportAssignment.createMany({
    data: userIds.map((userId) => ({ userId, sportCode })),
    skipDuplicates: true,
  });
  return getSportRoster(sportCode);
}

/**
 * Set travel status for one or more members as one audited roster mutation.
 * The route uses this for both the existing single-person toggle and the bulk
 * toolbar so the client can never leave a partially updated travel roster.
 */
export async function setRosterTravelStatus(args: {
  assignmentIds: string[];
  sportCode: string;
  defaultTraveler: boolean;
  actor: { id: string; role: Role };
}) {
  const assignmentIds = [...new Set(args.assignmentIds)];

  return db.$transaction(async (tx) => {
    const assignments = await tx.studentSportAssignment.findMany({
      where: { id: { in: assignmentIds }, sportCode: args.sportCode },
      select: { id: true, userId: true, defaultTraveler: true },
    });
    if (assignments.length !== assignmentIds.length) {
      throw new HttpError(404, "One or more roster members were not found");
    }

    await tx.studentSportAssignment.updateMany({
      where: { id: { in: assignmentIds }, sportCode: args.sportCode },
      data: { defaultTraveler: args.defaultTraveler },
    });

    await createAuditEntriesTx(tx, assignments.map((assignment) => ({
      actorId: args.actor.id,
      actorRole: args.actor.role,
      entityType: "student_sport_assignment",
      entityId: assignment.id,
      action: "roster_travel_set",
      before: { defaultTraveler: assignment.defaultTraveler },
      after: {
        sportCode: args.sportCode,
        userId: assignment.userId,
        defaultTraveler: args.defaultTraveler,
      },
    })));

    return tx.studentSportAssignment.findMany({
      where: { id: { in: assignmentIds }, sportCode: args.sportCode },
      include: { user: { select: { id: true, name: true, role: true, primaryArea: true } } },
      orderBy: { user: { name: "asc" } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
