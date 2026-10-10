import { withAuth } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { upsertPlacementSchema } from "@/lib/workforce/contract";

/** Create or replace the placement for one person and term. */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "workforce", "manage");
  await enforceRateLimit(`workforce:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = upsertPlacementSchema.parse(await req.json());

  const placement = await db.$transaction(async (tx) => {
    const person = await tx.user.findUnique({ where: { id: params.id }, select: { id: true, staffingType: true } });
    if (!person) throw new HttpError(404, "Person not found.");
    if (person.staffingType !== "ST") throw new HttpError(400, "Term placements are only for student workers.");

    const previous = await tx.studentTermPlacement.findUnique({
      where: { userId_term_year: { userId: params.id, term: body.term, year: body.year } },
      select: { area: true, sportCodes: true, notes: true },
    });
    const placement = await tx.studentTermPlacement.upsert({
      where: { userId_term_year: { userId: params.id, term: body.term, year: body.year } },
      create: {
        userId: params.id,
        term: body.term,
        year: body.year,
        area: body.area ?? null,
        sportCodes: body.sportCodes ?? [],
        notes: body.notes ?? null,
      },
      update: {
        area: body.area === undefined ? undefined : body.area,
        sportCodes: body.sportCodes,
        notes: body.notes === undefined ? undefined : body.notes,
      },
      select: { id: true, term: true, year: true, area: true, sportCodes: true, notes: true },
    });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "student_term_placement",
      entityId: placement.id,
      action: "upsert",
      before: previous ? { ...previous } : undefined,
      after: { userId: params.id, term: placement.term, year: placement.year, area: placement.area, sportCodes: placement.sportCodes, notes: placement.notes },
    });
    return placement;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: placement }, 201);
});

export const DELETE = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "workforce", "manage");
  await enforceRateLimit(`workforce:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const placementId = new URL(req.url).searchParams.get("placementId");
  if (!placementId) throw new HttpError(400, "placementId is required.");

  await db.$transaction(async (tx) => {
    const placement = await tx.studentTermPlacement.findUnique({
      where: { id: placementId },
      select: { id: true, userId: true, term: true, year: true, area: true, sportCodes: true, notes: true },
    });
    if (!placement || placement.userId !== params.id) throw new HttpError(404, "Placement not found.");

    await tx.studentTermPlacement.delete({ where: { id: placement.id } });
    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "student_term_placement",
      entityId: placement.id,
      action: "delete",
      before: { userId: params.id, term: placement.term, year: placement.year, area: placement.area, sportCodes: placement.sportCodes, notes: placement.notes },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ deleted: true });
});
