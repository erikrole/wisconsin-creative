import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { withSerializationRetry } from "@/lib/serialization";
import {
  GETTING_STARTED_ROWS,
  mergeGettingStarted,
  normalizeGettingStarted,
  sameGettingStarted,
} from "@/lib/getting-started";

/**
 * GET/PATCH /api/me/getting-started
 *
 * The caller's Getting started checklist progress, shared by web and iOS.
 * PATCH only adds: listed rows become done, and `dismissed: true` hides the
 * card. Nothing un-does a row, so two devices saving at once can't lose work.
 */

const patchSchema = z.object({
  done: z.array(z.enum(GETTING_STARTED_ROWS)).max(GETTING_STARTED_ROWS.length).optional(),
  dismissed: z.literal(true).optional(),
  expectedUserId: z.string().min(1).optional(),
});

export const GET = withAuth(async (_req, { user }) => {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { gettingStarted: true } });
  return ok({ data: normalizeGettingStarted(row?.gettingStarted), userId: user.id });
});

export const PATCH = withAuth(async (req, { user }) => {
  requirePermission(user.role, "user", "edit_self");
  await enforceRateLimit(`getting-started:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = patchSchema.parse(await req.json());
  if (body.expectedUserId && body.expectedUserId !== user.id) throw new HttpError(409, "Your sign-in changed. Reload to continue.");
  const next = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const row = await tx.user.findUnique({ where: { id: user.id }, select: { gettingStarted: true } });
    const merged = mergeGettingStarted(normalizeGettingStarted(row?.gettingStarted), body);
    if (sameGettingStarted(normalizeGettingStarted(row?.gettingStarted), merged)) return merged;
    await tx.user.update({
      where: { id: user.id },
      data: { gettingStarted: merged as unknown as Prisma.InputJsonValue },
    });
    await createAuditEntryTx(tx, {
      actorId: user.id, actorRole: user.role, entityType: "user", entityId: user.id,
      action: "getting_started_updated", before: normalizeGettingStarted(row?.gettingStarted), after: merged,
    });
    return merged;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  return ok({ data: next, userId: user.id });
});
