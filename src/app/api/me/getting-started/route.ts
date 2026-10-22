import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import {
  GETTING_STARTED_ROWS,
  mergeGettingStarted,
  normalizeGettingStarted,
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
});

export const GET = withAuth(async (_req, { user }) => {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { gettingStarted: true } });
  return ok({ data: normalizeGettingStarted(row?.gettingStarted) });
});

export const PATCH = withAuth(async (req, { user }) => {
  await enforceRateLimit(`getting-started:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = patchSchema.parse(await req.json());
  const next = await db.$transaction(async (tx) => {
    const row = await tx.user.findUnique({ where: { id: user.id }, select: { gettingStarted: true } });
    const merged = mergeGettingStarted(normalizeGettingStarted(row?.gettingStarted), body);
    await tx.user.update({
      where: { id: user.id },
      data: { gettingStarted: merged as unknown as Prisma.InputJsonValue },
    });
    return merged;
  });
  return ok({ data: next });
});
