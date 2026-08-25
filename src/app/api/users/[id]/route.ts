import { withAuth } from "@/lib/api";
import { GraduationTerm, Prisma, ShiftArea, ShiftWorkerType, StudentYear } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { deactivateUserWithCleanup } from "@/lib/services/user-deactivation";
import { normalizeSlackHandle, normalizeSlackProfileUrl, normalizeWiscardNumber, slackHandleSchema, slackProfileUrlSchema, validateBirthdayParts, wiscardCardNumberSchema, wiscardIssueCodeSchema, wiscardNumberSchema } from "@/lib/validation";
import { canReadUserProfile } from "@/lib/user-visibility";
import { getGameRecordForUser } from "@/lib/services/game-record";
import { normalizeProfilePhone, nullableProfilePhoneSchema, phoneAuditValue } from "@/lib/profile-phone";
import { requireCollaboratorCapability } from "@/lib/collaborator-access";
import { revokeCompanionUser } from "@/lib/companion-store";
import { deferCompanionProjectionRefreshForCommittedMutation } from "@/lib/services/companion-projection-publisher";
import { z } from "zod";

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().email().optional(),
  locationId: z.string().cuid().nullable().optional(),
  phone: nullableProfilePhoneSchema,
  personalPhone: nullableProfilePhoneSchema,
  workPhone: nullableProfilePhoneSchema,
  wiscardNumber: wiscardNumberSchema,
  wiscardCardNumber: wiscardCardNumberSchema,
  wiscardIssueCode: wiscardIssueCodeSchema,
  slackHandle: slackHandleSchema,
  slackProfileUrl: slackProfileUrlSchema,
  primaryArea: z.nativeEnum(ShiftArea).nullable().optional(),
  staffingType: z.nativeEnum(ShiftWorkerType).optional(),
  active: z.boolean().optional(),
  // Profile fields migrated from the Sheet.
  title: z.string().max(120).nullable().optional(),
  athleticsEmail: z.string().email().max(255).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  gradYear: z.number().int().min(1900).max(2100).nullable().optional(),
  graduationTerm: z.nativeEnum(GraduationTerm).nullable().optional(),
  studentYearOverride: z.nativeEnum(StudentYear).nullable().optional(),
  topSize: z.string().max(40).nullable().optional(),
  topSizeFit: z.enum(["UNISEX", "WOMENS", "MENS"]).nullable().optional(),
  bottomSize: z.string().max(40).nullable().optional(),
  shoeSize: z.string().max(40).nullable().optional(),
  shoeSizeSystem: z.enum(["US_WOMENS", "US_MENS"]).nullable().optional(),
  birthdayMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthdayDay: z.number().int().min(1).max(31).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  // Staff/admin only — direct report (FK + free-text fallback).
  directReportId: z.string().cuid().nullable().optional(),
  directReportName: z.string().trim().max(120).nullable().optional(),
}).superRefine(validateBirthdayParts);

const MAX_DIRECT_REPORT_CHAIN_DEPTH = 50;
const PHONE_AUDIT_FIELDS = new Set(["phone", "personalPhone", "workPhone"]);
const PRESENCE_ONLY_AUDIT_FIELDS = new Set([
  "wiscardNumber", "wiscardCardNumber", "wiscardIssueCode",
  "birthdayMonth", "birthdayDay", "birthYear",
]);

function auditProfileValue(key: string, value: unknown): unknown {
  if (PHONE_AUDIT_FIELDS.has(key)) return phoneAuditValue(value);
  if (PRESENCE_ONLY_AUDIT_FIELDS.has(key)) return value == null ? null : "[set]";
  return value;
}

async function assertDirectReportAssignment(targetUserId: string, directReportId: string) {
  if (directReportId === targetUserId) {
    throw new HttpError(400, "A user cannot report to themselves");
  }

  const seen = new Set<string>([targetUserId]);
  let cursor: string | null = directReportId;

  for (let depth = 0; cursor && depth < MAX_DIRECT_REPORT_CHAIN_DEPTH; depth += 1) {
    if (seen.has(cursor)) {
      throw new HttpError(400, "Direct report assignment would create a reporting cycle");
    }
    seen.add(cursor);

    const manager: { id: string; directReportId: string | null } | null = await db.user.findUnique({
      where: { id: cursor },
      select: { id: true, directReportId: true },
    });

    if (!manager) {
      throw new HttpError(400, "Direct report user not found");
    }

    cursor = manager.directReportId;
  }

  if (cursor) {
    throw new HttpError(400, "Direct report chain is too deep");
  }
}

export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"]);
  const { id } = params;

  if (user.role === "COLLABORATOR" && user.id !== id) {
    requireCollaboratorCapability(user, "PEOPLE_DIRECTORY_VIEW");
    const publicTarget = await db.user.findFirst({
      where: { id, active: true, hiddenFromRoster: false },
      select: {
        id: true,
        name: true,
        role: true,
        affiliation: true,
        collaboratorProfile: true,
        staffingType: true,
        title: true,
        primaryArea: true,
        locationId: true,
        location: { select: { name: true } },
        avatarUrl: true,
        active: true,
        gradYear: true,
        studentYearOverride: true,
        collaboratorPolicy: {
          select: {
            id: true,
            status: true,
            version: true,
            affiliation: { select: { key: true, displayName: true, badgeLabel: true } },
          },
        },
      },
    });
    if (!publicTarget) throw new HttpError(404, "User not found");

    return ok({
      data: {
        id: publicTarget.id,
        name: publicTarget.name,
        email: "",
        role: publicTarget.role,
        affiliation: publicTarget.affiliation,
        collaboratorProfile: publicTarget.collaboratorProfile,
        collaboratorPolicy: publicTarget.collaboratorPolicy,
        staffingType: publicTarget.staffingType,
        locationId: publicTarget.locationId,
        location: publicTarget.location?.name ?? null,
        phone: null,
        personalPhone: null,
        workPhone: null,
        workPhoneNotApplicable: false,
        wiscardNumber: null,
        wiscardCardNumber: null,
        wiscardIssueCode: null,
        slackHandle: null,
        slackProfileUrl: null,
        primaryArea: publicTarget.primaryArea,
        avatarUrl: publicTarget.avatarUrl ?? null,
        active: true,
        hiddenFromRoster: false,
        createdAt: null,
        sportAssignments: [],
        areaAssignments: [],
        title: publicTarget.title ?? null,
        athleticsEmail: null,
        startDate: null,
        directReportId: null,
        directReportName: null,
        directReport: null,
        gradYear: publicTarget.gradYear ?? null,
        graduationTerm: null,
        studentYearOverride: publicTarget.studentYearOverride ?? null,
        topSize: null,
        topSizeFit: null,
        bottomSize: null,
        shoeSize: null,
        shoeSizeSystem: null,
        birthdayMonth: null,
        birthdayDay: null,
      },
    });
  }

  const target = await db.user.findUnique({
    where: { id },
    include: {
      location: { select: { name: true } },
      sportAssignments: true,
      areaAssignments: true,
      directReport: { select: { id: true, name: true } },
      collaboratorPolicy: {
        select: {
          id: true,
          status: true,
          version: true,
          affiliation: { select: { key: true, displayName: true, badgeLabel: true } },
          grants: { select: { capabilityKey: true } },
        },
      },
    },
  });
  if (!target) throw new HttpError(404, "User not found");
  if (!canReadUserProfile(user, target)) throw new HttpError(404, "User not found");

  const targetIsCollaborator = target.role === "COLLABORATOR";
  const isSelfOrAdmin = user.id === id || user.role === "ADMIN";
  if (targetIsCollaborator && !isSelfOrAdmin) {
    return ok({
      data: {
        id: target.id,
        name: target.name,
        avatarUrl: target.avatarUrl ?? null,
        title: target.title ?? null,
        role: target.role,
        affiliation: target.affiliation,
        collaboratorProfile: target.collaboratorProfile,
        collaboratorPolicy: target.collaboratorPolicy ? {
          id: target.collaboratorPolicy.id,
          status: target.collaboratorPolicy.status,
          version: target.collaboratorPolicy.version,
          capabilities: target.collaboratorPolicy.grants.map((grant) => grant.capabilityKey),
          affiliation: target.collaboratorPolicy.affiliation,
        } : null,
      },
    });
  }

  const gameRecord = await getGameRecordForUser(target.id);

  return ok({
    data: {
      id: target.id,
      name: target.name,
      email: target.email,
      gameRecord,
      role: target.role,
      affiliation: target.affiliation,
      collaboratorProfile: target.collaboratorProfile,
      collaboratorPolicy: target.collaboratorPolicy ? {
        id: target.collaboratorPolicy.id,
        status: target.collaboratorPolicy.status,
        version: target.collaboratorPolicy.version,
        capabilities: target.collaboratorPolicy.grants.map((grant) => grant.capabilityKey),
        affiliation: target.collaboratorPolicy.affiliation,
      } : null,
      staffingType: target.staffingType,
      locationId: target.locationId,
      location: target.location?.name ?? null,
      phone: target.phone,
      personalPhone: target.personalPhone ?? null,
      workPhone: target.workPhone ?? null,
      workPhoneNotApplicable: target.workPhoneNotApplicable,
      wiscardNumber: target.wiscardNumber ?? null,
      wiscardCardNumber: target.wiscardCardNumber ?? null,
      wiscardIssueCode: target.wiscardIssueCode ?? null,
      slackHandle: target.slackHandle ?? null,
      slackProfileUrl: target.slackProfileUrl ?? null,
      primaryArea: target.primaryArea,
      avatarUrl: target.avatarUrl ?? null,
      active: target.active,
      hiddenFromRoster: target.hiddenFromRoster,
      createdAt: target.createdAt?.toISOString() ?? null,
      sportAssignments: target.sportAssignments,
      areaAssignments: target.areaAssignments,
      icsToken: isSelfOrAdmin ? (target.icsToken ?? null) : undefined,
      title: target.title ?? null,
      athleticsEmail: target.athleticsEmail ?? null,
      startDate: target.startDate?.toISOString() ?? null,
      directReportId: target.directReportId ?? null,
      directReportName: target.directReportName ?? null,
      directReport: target.directReport
        ? { id: target.directReport.id, name: target.directReport.name }
        : null,
      gradYear: target.gradYear ?? null,
      graduationTerm: target.graduationTerm ?? null,
      studentYearOverride: target.studentYearOverride ?? null,
      topSize: target.topSize ?? null,
      topSizeFit: target.topSizeFit ?? null,
      bottomSize: target.bottomSize ?? null,
      shoeSize: target.shoeSize ?? null,
      shoeSizeSystem: target.shoeSizeSystem ?? null,
      birthdayMonth: target.birthdayMonth ?? null,
      birthdayDay: target.birthdayDay ?? null,
      birthYear: isSelfOrAdmin ? (target.birthYear ?? null) : undefined,
    },
  });
});

export const PATCH = withAuth<{ id: string }>(async (req, { user, params }) => {
  requireRole(user.role, ["ADMIN", "STAFF"]);

  const { id } = params;
  const canViewBirthYear = user.id === id || user.role === "ADMIN";
  const body = updateUserSchema.parse(await req.json());

  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    throw new HttpError(404, "User not found");
  }

  // STAFF can only edit STUDENT users — not other STAFF or ADMIN
  if (user.role === "STAFF" && target.role !== "STUDENT") {
    throw new HttpError(403, "Staff can only edit student profiles");
  }
  if (user.role !== "ADMIN" && Object.prototype.hasOwnProperty.call(body, "birthYear")) {
    throw new HttpError(403, "Only the user or an admin can update the birth year");
  }

  const updateData: Record<string, unknown> = {};
  let deactivationHandled = false;

  if (body.name !== undefined) {
    updateData.name = body.name;
  }

  if (body.email !== undefined) {
    const email = body.email.toLowerCase();
    if (email !== target.email) {
      updateData.email = email;
    }
  }

  if (body.locationId !== undefined) {
    updateData.locationId = body.locationId;
  }

  if (body.phone !== undefined) {
    const personalPhone = normalizeProfilePhone(body.phone);
    updateData.phone = personalPhone;
    updateData.personalPhone = personalPhone;
  }
  if (body.personalPhone !== undefined) {
    const personalPhone = normalizeProfilePhone(body.personalPhone);
    updateData.personalPhone = personalPhone;
    updateData.phone = personalPhone;
  }
  if (body.workPhone !== undefined) {
    const workPhone = normalizeProfilePhone(body.workPhone);
    updateData.workPhone = workPhone;
    updateData.workPhoneNotApplicable = workPhone === null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "wiscardNumber")) {
    updateData.wiscardNumber = normalizeWiscardNumber(body.wiscardNumber);
  }
  if (Object.prototype.hasOwnProperty.call(body, "wiscardCardNumber") || Object.prototype.hasOwnProperty.call(body, "wiscardIssueCode")) {
    const cardNumber = Object.prototype.hasOwnProperty.call(body, "wiscardCardNumber") ? body.wiscardCardNumber : target.wiscardCardNumber;
    const issueCode = Object.prototype.hasOwnProperty.call(body, "wiscardIssueCode") ? body.wiscardIssueCode : target.wiscardIssueCode;
    updateData.wiscardCardNumber = cardNumber || null;
    updateData.wiscardIssueCode = issueCode || null;
    updateData.wiscardNumber = cardNumber && issueCode ? `${cardNumber}${issueCode}` : null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "slackHandle")) {
    updateData.slackHandle = normalizeSlackHandle(body.slackHandle);
  }
  if (Object.prototype.hasOwnProperty.call(body, "slackProfileUrl")) {
    updateData.slackProfileUrl = normalizeSlackProfileUrl(body.slackProfileUrl);
  }

  if (body.primaryArea !== undefined) {
    updateData.primaryArea = body.primaryArea;
  }

  if (body.staffingType !== undefined) {
    updateData.staffingType = body.staffingType;
  }

  if (body.active !== undefined) {
    // Deactivation requires atomic check + cancel + session cleanup
    if (body.active === false && target.active === true) {
      if (Object.keys(body).some((key) => key !== "active")) {
        throw new HttpError(400, "Deactivate the user separately from other profile changes");
      }
      await deactivateUserWithCleanup({
        targetUserId: id,
        actorId: user.id,
        actorRole: user.role,
        audit: {
          action: "updated",
          before: { active: true },
          after: { active: false },
        },
      });
      deactivationHandled = true;
    } else if (body.active === false) {
      // A previous deactivation may have committed while Upstash was
      // unavailable. Keep the ordinary PATCH retry idempotent so an admin can
      // finish invalidating companion credentials after the account is already
      // inactive.
      try {
        await revokeCompanionUser(id);
      } catch (error) {
        console.error("[Companion] failed to repair deactivated user access", error);
        throw new HttpError(
          503,
          "The account is inactive, but companion access could not be revoked. Retry setting the account to inactive.",
        );
      }
    }

    updateData.active = body.active;
  }

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    updateData.title = body.title ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "athleticsEmail")) {
    updateData.athleticsEmail = body.athleticsEmail ? body.athleticsEmail.toLowerCase() : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "startDate")) {
    updateData.startDate = body.startDate ? new Date(body.startDate) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "gradYear")) {
    updateData.gradYear = body.gradYear ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "graduationTerm")) {
    updateData.graduationTerm = body.graduationTerm ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "studentYearOverride")) {
    updateData.studentYearOverride = body.studentYearOverride ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "topSize")) {
    updateData.topSize = body.topSize ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "topSizeFit")) updateData.topSizeFit = body.topSizeFit ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "bottomSize")) {
    updateData.bottomSize = body.bottomSize ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "shoeSize")) {
    updateData.shoeSize = body.shoeSize ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "shoeSizeSystem")) updateData.shoeSizeSystem = body.shoeSizeSystem ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "birthdayMonth")) updateData.birthdayMonth = body.birthdayMonth ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "birthdayDay")) updateData.birthdayDay = body.birthdayDay ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "birthYear")) updateData.birthYear = body.birthYear ?? null;

  // Direct report — staff/admin only. UI sends *either* a cuid (existing user)
  // *or* a free-text name. Setting one nulls the other so display logic stays unambiguous.
  if (Object.prototype.hasOwnProperty.call(body, "directReportId")) {
    if (body.directReportId) {
      await assertDirectReportAssignment(id, body.directReportId);
    }
    updateData.directReportId = body.directReportId ?? null;
    if (body.directReportId) {
      updateData.directReportName = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "directReportName")) {
    const name = body.directReportName?.trim() || null;
    updateData.directReportName = name;
    if (name) {
      updateData.directReportId = null;
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new HttpError(400, "No fields to update");
  }

  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const key of Object.keys(updateData)) {
    beforeDiff[key] = auditProfileValue(key, (target as Record<string, unknown>)[key] ?? null);
  }

  let updated;
  try {
    const include = {
      location: { select: { name: true } },
      sportAssignments: true,
      areaAssignments: true,
      directReport: { select: { id: true, name: true } },
    } as const;
    updated = deactivationHandled
      ? await db.user.findUniqueOrThrow({ where: { id }, include })
      : await db.user.update({
        where: { id },
        data: updateData,
        include,
      });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined) ?? [];
      if (target.some((t) => t.includes("athletics_email"))) {
        throw new HttpError(409, "That athletics email is already in use");
      }
      if (target.some((t) => t.includes("wiscard_number") || t.includes("wiscardNumber") || t.includes("wiscard_card_number"))) {
        throw new HttpError(409, "That Wiscard value is already linked to another account");
      }
      throw new HttpError(409, "A user with this email already exists");
    }
    throw err;
  }
  if (!deactivationHandled) {
    deferCompanionProjectionRefreshForCommittedMutation(req);
  }

  for (const key of Object.keys(updateData)) {
    afterDiff[key] = auditProfileValue(key, (updated as Record<string, unknown>)[key] ?? null);
  }

  if (!deactivationHandled) {
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: id,
      action: "updated",
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
      staffingType: updated.staffingType,
      locationId: updated.locationId,
      location: updated.location?.name ?? null,
      phone: updated.phone,
      personalPhone: updated.personalPhone ?? null,
      workPhone: updated.workPhone ?? null,
      workPhoneNotApplicable: updated.workPhoneNotApplicable,
      wiscardNumber: updated.wiscardNumber ?? null,
      wiscardCardNumber: updated.wiscardCardNumber ?? null,
      wiscardIssueCode: updated.wiscardIssueCode ?? null,
      slackHandle: updated.slackHandle ?? null,
      slackProfileUrl: updated.slackProfileUrl ?? null,
      primaryArea: updated.primaryArea,
      avatarUrl: updated.avatarUrl ?? null,
      active: updated.active,
      hiddenFromRoster: updated.hiddenFromRoster,
      createdAt: updated.createdAt?.toISOString() ?? null,
      sportAssignments: updated.sportAssignments,
      areaAssignments: updated.areaAssignments,
      title: updated.title ?? null,
      athleticsEmail: updated.athleticsEmail ?? null,
      startDate: updated.startDate?.toISOString() ?? null,
      directReportId: updated.directReportId ?? null,
      directReportName: updated.directReportName ?? null,
      directReport: updated.directReport
        ? { id: updated.directReport.id, name: updated.directReport.name }
        : null,
      gradYear: updated.gradYear ?? null,
      studentYearOverride: updated.studentYearOverride ?? null,
      topSize: updated.topSize ?? null,
      topSizeFit: updated.topSizeFit ?? null,
      bottomSize: updated.bottomSize ?? null,
      shoeSize: updated.shoeSize ?? null,
      shoeSizeSystem: updated.shoeSizeSystem ?? null,
      birthdayMonth: updated.birthdayMonth ?? null,
      birthdayDay: updated.birthdayDay ?? null,
      birthYear: canViewBirthYear ? (updated.birthYear ?? null) : undefined,
    },
  });
});
