import { Prisma, ShiftArea } from "@prisma/client";
import { db } from "@/lib/db";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

type SportShiftConfigInput = {
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

/**
 * Get the active, visible roster (students/staff) assigned to a sport.
 * Inactive and hidden people are left out because every consumer uses this
 * list to pick someone, and the pick would be rejected server-side anyway.
 */
export async function getSportRoster(sportCode: string) {
  const assignments = await db.studentSportAssignment.findMany({
    where: { sportCode, user: visibleActiveUserWhere() },
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
