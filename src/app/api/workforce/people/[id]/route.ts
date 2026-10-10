import { withAuth } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { compareTerms, startTermSchema } from "@/lib/workforce/contract";

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "workforce", "view");
  const person = await db.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      title: true,
      staffingType: true,
      gradYear: true,
      graduationTerm: true,
      startTerm: true,
      startTermYear: true,
      termPlacements: {
        select: { id: true, term: true, year: true, area: true, sportCodes: true, notes: true },
      },
    },
  });
  if (!person) throw new HttpError(404, "Person not found.");

  return ok({
    data: {
      ...person,
      termPlacements: [...person.termPlacements].sort(compareTerms),
    },
  });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "workforce", "manage");
  await enforceRateLimit(`workforce:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = startTermSchema.parse(await req.json());

  await db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: params.id },
      select: { id: true, staffingType: true, startTerm: true, startTermYear: true },
    });
    if (!existing) throw new HttpError(404, "Person not found.");
    if (existing.staffingType !== "ST") throw new HttpError(400, "Start terms are only for student workers.");

    await tx.user.update({
      where: { id: params.id },
      data: { startTerm: body.startTerm, startTermYear: body.startTermYear },
    });

    await createAuditEntryTx(tx, {
      actorId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: params.id,
      action: "start_term_update",
      before: { startTerm: existing.startTerm, startTermYear: existing.startTermYear },
      after: { startTerm: body.startTerm, startTermYear: body.startTermYear },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return ok({ data: { id: params.id } });
});
