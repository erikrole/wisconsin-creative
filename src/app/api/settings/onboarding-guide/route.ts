import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { withSerializationRetry } from "@/lib/serialization";
import { ONBOARDING_MANUAL_STEPS, parseOnboardingGuide } from "@/lib/onboarding-checklist";

/** PUT /api/settings/onboarding-guide: who to reach out to, and notes, for the admin-ticked onboarding steps. Admin only. */
const entry = z.object({ contact: z.string().trim().max(120), note: z.string().trim().max(300) });
const bodySchema = z.object({ guide: z.record(z.enum(ONBOARDING_MANUAL_STEPS), entry) });

export const PUT = withAuth(async (req, { user }) => {
  requireRole(user.role, [Role.ADMIN]);
  await enforceRateLimit(`onboarding-guide:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const { guide } = bodySchema.parse(await req.json());
  const next = parseOnboardingGuide(guide);

  await withSerializationRetry(() => db.$transaction(async (tx) => {
    const row = await tx.systemConfig.findUnique({ where: { key: "onboarding_guide" } });
    await tx.systemConfig.upsert({
      where: { key: "onboarding_guide" },
      create: { key: "onboarding_guide", value: next as Prisma.InputJsonValue },
      update: { value: next as Prisma.InputJsonValue },
    });
    await createAuditEntryTx(tx, {
      actorId: user.id, actorRole: user.role, entityType: "system_config", entityId: "onboarding_guide",
      action: "onboarding_guide_updated", before: parseOnboardingGuide(row?.value), after: next,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  return ok({ data: next });
});
