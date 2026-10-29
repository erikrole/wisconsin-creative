import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntryTx } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { withSerializationRetry } from "@/lib/serialization";
import { normalizeGettingStarted } from "@/lib/getting-started";
import { readinessProfileSelect } from "@/lib/services/onboarding-readiness";
import {
  applyOnboardingCheck,
  buildOnboardingChecklist,
  ONBOARDING_MANUAL_STEPS,
  ONBOARDING_NOTE_MAX,
  parseOnboardingChecks,
  parseOnboardingGuide,
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
  done: z.boolean().optional(),
  note: z.string().max(ONBOARDING_NOTE_MAX).optional(),
}).refine((body) => body.done !== undefined || body.note !== undefined);

async function loadChecklist(userId: string) {
  const student = await db.user.findUnique({
    where: { id: userId },
    select: { ...readinessProfileSelect, role: true, lastActiveAt: true, onboardingChecks: true, gettingStarted: true },
  });
  if (!student || student.role !== Role.STUDENT) throw new HttpError(404, "Student not found");

  const [classBlock, iosApp, deviceToken, webPush, checkout, adobeClaim, guideRow] = await Promise.all([
    db.studentAvailabilityBlock.findFirst({ where: { userId, kind: "WEEKLY" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.userAppInstallation.findFirst({ where: { userId, platform: "ios" }, orderBy: { firstSeenAt: "asc" }, select: { firstSeenAt: true } }),
    db.deviceToken.findFirst({ where: { userId, revokedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.webPushSubscription.findFirst({ where: { userId, revokedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.booking.findFirst({
      where: { requesterUserId: userId, kind: "CHECKOUT", status: { in: ["OPEN", "COMPLETED"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.licenseCodeClaim.findFirst({
      where: { userId, releasedAt: null, licenseCode: { label: { contains: "adobe", mode: "insensitive" } } },
      orderBy: { claimedAt: "asc" },
      select: { claimedAt: true },
    }),
    db.systemConfig.findUnique({ where: { key: "onboarding_guide" } }),
  ]);

  const checks = parseOnboardingChecks(student.onboardingChecks);
  const by = [...new Set(Object.values(checks).map((check) => check.by))];
  const people = by.length ? await db.user.findMany({ where: { id: { in: by } }, select: { id: true, name: true } }) : [];

  return buildOnboardingChecklist({
    profile: student,
    signedInAt: student.lastActiveAt,
    classScheduleAt: classBlock?.createdAt ?? null,
    iosAppAt: iosApp?.firstSeenAt ?? null,
    pushAt: deviceToken?.createdAt ?? webPush?.createdAt ?? null,
    checkoutAt: checkout?.createdAt ?? null,
    adobeAt: adobeClaim?.claimedAt ?? null,
    readGuides: normalizeGettingStarted(student.gettingStarted).done.includes("guides"),
    checks,
    guide: parseOnboardingGuide(guideRow?.value),
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
    const after = applyOnboardingCheck(before, body.step, body, user.id);
    if (after === before) return;
    await tx.user.update({ where: { id: params.id }, data: { onboardingChecks: after as Prisma.InputJsonValue } });
    await createAuditEntryTx(tx, {
      actorId: user.id, actorRole: user.role, entityType: "user", entityId: params.id,
      action: "onboarding_check_updated", before: { step: body.step, ...before[body.step] }, after: { step: body.step, done: Boolean(after[body.step]), note: after[body.step]?.note },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  return ok({ data: await loadChecklist(params.id) });
});
