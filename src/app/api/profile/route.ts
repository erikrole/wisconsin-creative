import { z } from "zod";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { changePasswordSchema, normalizeSlackHandle, normalizeSlackProfileUrl, normalizeWiscardNumber, updateProfileSchema } from "@/lib/validation";
import { createAuditEntry } from "@/lib/audit";
import { normalizeProfilePhone, phoneAuditValue } from "@/lib/profile-phone";
import { revokeCompanionUser } from "@/lib/companion-store";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";

const profilePatchSchema = z.union([
  changePasswordSchema.extend({ action: z.literal("change_password") }),
  updateProfileSchema,
]);
const PHONE_AUDIT_FIELDS = new Set(["phone", "personalPhone", "workPhone"]);
const PRESENCE_ONLY_AUDIT_FIELDS = new Set([
  "wiscardNumber", "wiscardCardNumber", "wiscardIssueCode",
  "birthdayMonth", "birthdayDay", "birthYear",
]);

export const GET = withAuth(async (_req, { user }) => {
  const profile = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: {
      location: { select: { id: true, name: true } }
    }
  });

  if (user.role === "COLLABORATOR") {
    return ok({
      data: {
        user: {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          role: profile.role,
          affiliation: profile.affiliation,
          collaboratorProfile: profile.collaboratorProfile,
          avatarUrl: profile.avatarUrl ?? null,
          title: profile.title ?? null,
        },
        locations: [],
      },
    });
  }

  const locations = await db.location.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true }
  });

  return ok({
    data: {
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        wiscardNumber: profile.wiscardNumber ?? null,
        wiscardCardNumber: profile.wiscardCardNumber ?? null,
        wiscardIssueCode: profile.wiscardIssueCode ?? null,
        slackHandle: profile.slackHandle ?? null,
        slackProfileUrl: profile.slackProfileUrl ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        location: profile.location
      },
      locations
    }
  });
});

export const PATCH = withAuth(async (req, { user }) => {
  let body: z.infer<typeof profilePatchSchema>;
  try {
    body = profilePatchSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new HttpError(400, err.issues.map((e) => e.message).join(", "));
    }
    throw err;
  }

  if ("action" in body && body.action === "change_password") {
    const payload = body;
    const existing = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const valid = await verifyPassword(existing.passwordHash, payload.currentPassword);

    if (!valid) {
      throw new HttpError(400, "Current password is incorrect");
    }

    const nextHash = await hashPassword(payload.newPassword);
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: nextHash, forcePasswordChange: false }
      }),
      db.session.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    try {
      await revokeCompanionUser(user.id);
    } catch (error) {
      console.error("[Companion] failed to revoke password-changed user", error);
      throw new HttpError(503, "The password changed, but companion access could not be revoked. Retry the password change.");
    }

    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: user.id,
      action: "password_change",
    });

    return ok({ message: "Password updated" });
  }

  if (user.forcePasswordChange) {
    throw new HttpError(403, "Password change required before profile updates");
  }

  const payload = body as z.infer<typeof updateProfileSchema>;
  if (user.role === "COLLABORATOR") {
    const disallowedFields = Object.keys(payload).filter((key) => key !== "name");
    if (disallowedFields.length > 0) {
      throw new HttpError(403, "This profile field is managed by an administrator");
    }
  }

  const current = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      name: true, phone: true, personalPhone: true, workPhone: true,
      workPhoneNotApplicable: true, wiscardNumber: true, locationId: true,
      wiscardCardNumber: true, wiscardIssueCode: true,
      slackHandle: true, slackProfileUrl: true,
      title: true, athleticsEmail: true, startDate: true,
      gradYear: true, graduationTerm: true, studentYearOverride: true,
      topSizeFit: true, topSize: true, bottomSize: true, shoeSizeSystem: true, shoeSize: true,
      birthdayMonth: true, birthdayDay: true, birthYear: true,
    },
  });

  const data: Record<string, unknown> = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (Object.prototype.hasOwnProperty.call(payload, "phone")) {
    const personalPhone = normalizeProfilePhone(payload.phone);
    data.phone = personalPhone;
    data.personalPhone = personalPhone;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "personalPhone")) {
    const personalPhone = normalizeProfilePhone(payload.personalPhone);
    data.personalPhone = personalPhone;
    data.phone = personalPhone;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "workPhone")) {
    const workPhone = normalizeProfilePhone(payload.workPhone);
    data.workPhone = workPhone;
    data.workPhoneNotApplicable = workPhone === null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "wiscardNumber")) {
    data.wiscardNumber = normalizeWiscardNumber(payload.wiscardNumber);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "wiscardCardNumber") || Object.prototype.hasOwnProperty.call(payload, "wiscardIssueCode")) {
    const cardNumber = Object.prototype.hasOwnProperty.call(payload, "wiscardCardNumber") ? payload.wiscardCardNumber : current.wiscardCardNumber;
    const issueCode = Object.prototype.hasOwnProperty.call(payload, "wiscardIssueCode") ? payload.wiscardIssueCode : current.wiscardIssueCode;
    data.wiscardCardNumber = cardNumber || null;
    data.wiscardIssueCode = issueCode || null;
    data.wiscardNumber = cardNumber && issueCode ? `${cardNumber}${issueCode}` : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "slackHandle")) data.slackHandle = normalizeSlackHandle(payload.slackHandle);
  if (Object.prototype.hasOwnProperty.call(payload, "slackProfileUrl")) data.slackProfileUrl = normalizeSlackProfileUrl(payload.slackProfileUrl);
  if (Object.prototype.hasOwnProperty.call(payload, "locationId")) data.locationId = payload.locationId ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "title")) data.title = payload.title ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "athleticsEmail")) {
    data.athleticsEmail = payload.athleticsEmail ? payload.athleticsEmail.toLowerCase() : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "startDate")) {
    data.startDate = payload.startDate ? new Date(payload.startDate) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "gradYear")) data.gradYear = payload.gradYear ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "graduationTerm")) data.graduationTerm = payload.graduationTerm ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "studentYearOverride")) data.studentYearOverride = payload.studentYearOverride ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "topSize")) data.topSize = payload.topSize ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "topSizeFit")) data.topSizeFit = payload.topSizeFit ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "bottomSize")) data.bottomSize = payload.bottomSize ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "shoeSize")) data.shoeSize = payload.shoeSize ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "shoeSizeSystem")) data.shoeSizeSystem = payload.shoeSizeSystem ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "birthdayMonth")) data.birthdayMonth = payload.birthdayMonth ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "birthdayDay")) data.birthdayDay = payload.birthdayDay ?? null;
  if (Object.prototype.hasOwnProperty.call(payload, "birthYear")) data.birthYear = payload.birthYear ?? null;

  let updated;
  try {
    updated = await db.user.update({
      where: { id: user.id },
      data,
      include: { location: { select: { id: true, name: true } } },
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      const target = ((err as { meta?: { target?: string[] | string } }).meta?.target) ?? [];
      const targetValues = Array.isArray(target) ? target : [String(target)];
      if (targetValues.some((t) => t.includes("wiscard_number") || t.includes("wiscardNumber") || t.includes("wiscard_card_number"))) {
        throw new HttpError(409, "That Wiscard value is already linked to another account");
      }
      throw new HttpError(409, "That athletics email is already in use");
    }
    throw err;
  }
  deferCompanionProjectionRefreshForCommittedMutation(req);

  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const before = (current as Record<string, unknown>)[key] ?? null;
    const after = (updated as Record<string, unknown>)[key] ?? null;
    let beforeKey = PHONE_AUDIT_FIELDS.has(key)
      ? phoneAuditValue(before)
      : PRESENCE_ONLY_AUDIT_FIELDS.has(key) ? (before == null ? null : "[set]")
      : before instanceof Date ? before.toISOString() : before;
    let afterKey = PHONE_AUDIT_FIELDS.has(key)
      ? phoneAuditValue(after)
      : PRESENCE_ONLY_AUDIT_FIELDS.has(key) ? (after == null ? null : "[set]")
      : after instanceof Date ? after.toISOString() : after;
    if (PRESENCE_ONLY_AUDIT_FIELDS.has(key) && before !== after && beforeKey === afterKey) {
      beforeKey = "[set]";
      afterKey = "[updated]";
    }
    if (beforeKey !== afterKey) {
      beforeDiff[key] = beforeKey;
      afterDiff[key] = afterKey;
    }
  }

  if (Object.keys(afterDiff).length > 0) {
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: user.id,
      action: "profile_update",
      before: beforeDiff,
      after: afterDiff,
    });
  }

  return ok({
    data: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      affiliation: updated.affiliation,
      collaboratorProfile: updated.collaboratorProfile,
      title: updated.title ?? null,
      avatarUrl: updated.avatarUrl ?? null,
      ...(user.role === "COLLABORATOR"
        ? {}
        : {
      personalPhone: updated.personalPhone ?? null,
      workPhone: updated.workPhone ?? null,
      workPhoneNotApplicable: updated.workPhoneNotApplicable,
      wiscardNumber: updated.wiscardNumber ?? null,
      wiscardCardNumber: updated.wiscardCardNumber ?? null,
      wiscardIssueCode: updated.wiscardIssueCode ?? null,
      slackHandle: updated.slackHandle ?? null,
      slackProfileUrl: updated.slackProfileUrl ?? null,
      location: updated.location
        }),
    }
  });
});
