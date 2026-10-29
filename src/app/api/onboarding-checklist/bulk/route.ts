import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntriesTx } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { withSerializationRetry } from "@/lib/serialization";
import { applyOnboardingCheck, ONBOARDING_MANUAL_STEPS, parseOnboardingChecks } from "@/lib/onboarding-checklist";

/** POST /api/onboarding-checklist/bulk: tick or untick one step for a group of students at once. Admin only. */
const bodySchema = z.object({
  step: z.enum(ONBOARDING_MANUAL_STEPS),
  done: z.boolean(),
  userIds: z.array(z.string().min(1)).min(1).max(100),
});

export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, [Role.ADMIN]);
  await enforceRateLimit(`onboarding-checklist:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = bodySchema.parse(await req.json());

  const changed = await withSerializationRetry(() => db.$transaction(async (tx) => {
    const students = await tx.user.findMany({
      where: { id: { in: body.userIds }, role: Role.STUDENT },
      select: { id: true, onboardingChecks: true },
    });
    const audits = [];
    for (const student of students) {
      const before = parseOnboardingChecks(student.onboardingChecks);
      const after = applyOnboardingCheck(before, body.step, { done: body.done }, user.id);
      if (after === before) continue;
      await tx.user.update({ where: { id: student.id }, data: { onboardingChecks: after as Prisma.InputJsonValue } });
      audits.push({
        actorId: user.id, actorRole: user.role, entityType: "user", entityId: student.id,
        action: "onboarding_check_updated", before: { step: body.step, done: !body.done }, after: { step: body.step, done: body.done },
      });
    }
    await createAuditEntriesTx(tx, audits);
    return audits.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  return ok({ data: { changed } });
});
