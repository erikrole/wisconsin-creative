import { Prisma, Role, ShiftArea } from "@prisma/client";
import { z } from "zod";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { shiftWorkerTypeForProfile } from "@/lib/shift-display";
import { isBigSixSportCode, isSportCode, VARSITY_OWNERSHIP_AREAS } from "@/lib/sports";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const varsityOwnershipHandoffSchema = z.object({
  sportCode: z.string().trim().toUpperCase().refine(isSportCode, "Choose a recognized varsity sport."),
  area: z.enum(VARSITY_OWNERSHIP_AREAS),
  startsOn: daySchema,
  endsOn: daySchema,
  userIds: z.array(z.string().min(1)).min(1).max(12).transform((ids) => [...new Set(ids)]),
}).superRefine((value, ctx) => {
  if (value.endsOn < value.startsOn) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "End date must be on or after start date." });
  if (isBigSixSportCode(value.sportCode)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sportCode"], message: "Big Six sports use request-pool staffing, not varsity ownership." });
});

function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function previousDay(value: Date) {
  return new Date(value.getTime() - 86_400_000);
}

export async function getVarsityOwnership(sportCode: string) {
  if (!isSportCode(sportCode) || isBigSixSportCode(sportCode)) throw new HttpError(400, "Choose a non-Big-Six varsity sport.");
  const [owners, roster] = await Promise.all([
    db.varsitySeasonOwner.findMany({
      where: { sportCode },
      orderBy: [{ area: "asc" }, { startsOn: "desc" }, { user: { name: "asc" } }],
      select: { id: true, sportCode: true, area: true, startsOn: true, endsOn: true, createdAt: true, user: { select: { id: true, name: true } } },
    }),
    db.studentSportAssignment.findMany({
      where: { sportCode, user: visibleActiveUserWhere({ staffingType: "ST" }) },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true, staffingType: true, primaryArea: true, areaAssignments: { select: { area: true } } } } },
    }),
  ]);
  return {
    sportCode,
    owners,
    students: roster.filter(({ user }) => shiftWorkerTypeForProfile(user) === "ST").map(({ user }) => ({
      id: user.id,
      name: user.name,
      areas: [...new Set([user.primaryArea, ...user.areaAssignments.map((entry) => entry.area)].filter(Boolean))],
    })),
  };
}

export async function handoffVarsityOwnership(raw: z.input<typeof varsityOwnershipHandoffSchema>, actor: { id: string; role: Role }) {
  const input = varsityOwnershipHandoffSchema.parse(raw);
  const startsOn = day(input.startsOn);
  const endsOn = day(input.endsOn);
  return db.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { id: { in: input.userIds }, ...visibleActiveUserWhere({ staffingType: "ST" }) },
      select: { id: true, staffingType: true, primaryArea: true, areaAssignments: { select: { area: true } }, sportAssignments: { where: { sportCode: input.sportCode }, select: { id: true } } },
    });
    if (users.length !== input.userIds.length) throw new HttpError(409, "Every owner must be an active visible Student.");
    for (const user of users) {
      if (shiftWorkerTypeForProfile(user) !== "ST" || user.sportAssignments.length === 0) throw new HttpError(409, "Every owner must be on this sport roster as a Student.");
      const areas = new Set([user.primaryArea, ...user.areaAssignments.map((entry) => entry.area)]);
      if (!areas.has(input.area as ShiftArea)) throw new HttpError(409, "Every owner must be assigned to this coverage area.");
    }

    const overlapping = await tx.varsitySeasonOwner.findMany({
      where: { sportCode: input.sportCode, area: input.area, startsOn: { lte: endsOn }, endsOn: { gte: startsOn } },
      select: { id: true, userId: true, startsOn: true, endsOn: true },
    });
    if (overlapping.some((row) => row.startsOn >= startsOn)) {
      throw new HttpError(409, "This handoff overlaps another ownership period that starts on or after the selected date.");
    }
    const previous = overlapping.filter((row) => row.startsOn < startsOn && row.endsOn >= startsOn);
    const closeOn = previousDay(startsOn);
    for (const row of previous) {
      await tx.varsitySeasonOwner.update({ where: { id: row.id }, data: { endsOn: closeOn } });
    }
    await tx.varsitySeasonOwner.createMany({
      data: input.userIds.map((userId) => ({ sportCode: input.sportCode, area: input.area, userId, startsOn, endsOn, createdById: actor.id })),
    });
    await createAuditEntryTx(tx, {
      actorId: actor.id,
      actorRole: actor.role,
      entityType: "varsity_season_ownership",
      entityId: `${input.sportCode}:${input.area}:${input.startsOn}`,
      action: "varsity_season_ownership_handoff",
      before: { owners: previous },
      after: input,
    });
    return getVarsityOwnershipTx(tx, input.sportCode);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function getVarsityOwnershipTx(tx: Prisma.TransactionClient, sportCode: string) {
  return tx.varsitySeasonOwner.findMany({
    where: { sportCode },
    orderBy: [{ area: "asc" }, { startsOn: "desc" }],
    select: { id: true, sportCode: true, area: true, startsOn: true, endsOn: true, user: { select: { id: true, name: true } } },
  });
}
