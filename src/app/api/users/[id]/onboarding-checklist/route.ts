import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { withSerializationRetry } from "@/lib/serialization";
import { readinessProfileSelect } from "@/lib/services/onboarding-readiness";
import {
  buildOnboardingChecklist,
  ONBOARDING_MANUAL_STEPS,
  parseOnboardingChecks,
} from "@/lib/onboarding-checklist";

/**
 * GET/PATCH /api/users/[id]/onboarding-checklist
 *
 * Admin-only view of how far a student is through onboarding. Most rows are
 * read from data the student already produced; the in-person steps are ticked
 * by hand. Nothing here emails the student.
 */

const patchSchema = z.object({
  step: z.enum(ONBOARDING_MANUAL_STEPS),
  done: z.boolean(),
});

async function loadChecklist(userId: string) {
  const student = await db.user.findUnique({
    where: { id: userId },
    select: { ...readinessProfileSelect, role: true, lastActiveAt: true, onboardingChecks: true },
  });
  if (!student || student.role !== Role.STUDENT) throw new HttpError(404, "Student not found");

  const [availability, iosApp, deviceToken, webPush, checkout] = await Promise.all([
    db.studentAvailabilityBlock.findFirst({ where: { userId }, select: { id: true } }),
    db.userAppInstallation.findFirst({ where: { userId, platform: "ios" }, select: { id: true } }),
    db.deviceToken.findFirst({ where: { userId, revokedAt: null }, select: { id: true } }),
    db.webPushSubscription.findFirst({ where: { userId, revokedAt: null }, select: { id: true } }),
    db.booking.findFirst({
      where: { requesterUserId: userId, kind: "CHECKOUT", status: { in: ["OPEN", "COMPLETED"] } },
      select: { id: true },
    }),
  ]);

  const checks = parseOnboardingChecks(student.onboardingChecks);
  const by = [...new Set(Object.values(checks).map((check) => check.by))];
  const people = by.length ? await db.user.findMany({ where: { id: { in: by } }, select: { id: true, name: true } }) : [];

  return buildOnboardingChecklist({
    profile: student,
    signedIn: student.lastActiveAt !== null,
    hasAvailability: availability !== null,
    hasIosApp: iosApp !== null,
    hasPush: deviceToken !== null || webPush !== null,
    hasCheckout: checkout !== null,
    checks,
    names: Object.fromEntries(people.map((person) => [person.id, person.name])),
  });
}

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, [Role.ADMIN]);
  return ok({ data: await loadChecklist(params.id) });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requireRole(user.role, [Role.ADMIN]);
  await enforceRateLimit(`onboarding-checklist:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = patchSchema.parse(await req.json());

  await withSerializationRetry(() => db.$transaction(async (tx) => {
    const row = await tx.user.findUnique({ where: { id: params.id }, select: { role: true, onboardingChecks: true } });
    if (!row || row.role !== Role.STUDENT) throw new HttpError(404, "Student not found");
    const before = parseOnboardingChecks(row.onboardingChecks);
    if (Boolean(before[body.step]) === body.done) return;
    const after = { ...before };
    if (body.done) after[body.step] = { at: new Date().toISOString(), by: user.id };
    else delete after[body.step];
    await tx.user.update({ where: { id: params.id }, data: { onboardingChecks: after as Prisma.InputJsonValue } });
    await createAuditEntryTx(tx, {
      actorId: user.id, actorRole: user.role, entityType: "user", entityId: params.id,
      action: "onboarding_check_updated", before: { step: body.step, done: !body.done }, after: { step: body.step, done: body.done },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  return ok({ data: await loadChecklist(params.id) });
});
