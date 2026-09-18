import { z } from "zod";
import { GraduationTerm, Prisma, StudentYear } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { getProfileCompletion, isCampusLoginEmail } from "@/lib/profile-completion";
import { profilePhoneSchema } from "@/lib/profile-phone";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

const currentYear = new Date().getFullYear();

const patchSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("EMAIL"),
    athleticsEmail: z.string().trim().email().max(255).refine(
      (value) => value.toLowerCase().endsWith("@athletics.wisc.edu"),
      "Use your @athletics.wisc.edu email",
    ),
  }),
  z.object({
    step: z.literal("PHONES"),
    personalPhone: profilePhoneSchema,
    workPhone: profilePhoneSchema.nullable().optional(),
    workPhoneNotApplicable: z.boolean().optional(),
  }),
  z.object({
    step: z.literal("WISCARD"),
    // Must match the canonical 10-digit card / 1-digit issue code format
    // (src/lib/validation.ts's wiscardCardNumberSchema/wiscardIssueCodeSchema)
    // — a looser format here would let someone "complete" this step with a
    // value that can never match a real Wiscard scan at the kiosk.
    wiscardCardNumber: z.string().trim().regex(/^\d{10}$/, "Wiscard card number must be 10 digits"),
    wiscardIssueCode: z.string().trim().regex(/^\d$/, "Wiscard issue code must be 1 digit"),
  }),
  z.object({
    step: z.literal("STUDENT"),
    studentYearOverride: z.nativeEnum(StudentYear),
    graduationTerm: z.nativeEnum(GraduationTerm),
    gradYear: z.number().int().min(currentYear - 1).max(currentYear + 10),
  }),
  z.object({
    step: z.literal("APPAREL"),
    topSizeFit: z.enum(["UNISEX", "WOMENS", "MENS"]),
    topSize: z.string().trim().min(1).max(40),
    shoeSizeSystem: z.enum(["US_WOMENS", "US_MENS"]),
    shoeSize: z.string().trim().min(1).max(40),
  }),
  z.object({ step: z.literal("SNOOZE") }),
]);

const profileSelect = {
  id: true,
  name: true,
  role: true,
  email: true,
  athleticsEmail: true,
  phone: true,
  personalPhone: true,
  workPhone: true,
  workPhoneNotApplicable: true,
  wiscardCardNumber: true,
  wiscardIssueCode: true,
  studentYearOverride: true,
  gradYear: true,
  graduationTerm: true,
  topSizeFit: true,
  topSize: true,
  shoeSizeSystem: true,
  shoeSize: true,
  avatarUrl: true,
  profilePromptSnoozedUntil: true,
  hiddenFromRoster: true,
} as const;

type ProfileClient = Pick<Prisma.TransactionClient, "user">;
type Profile = NonNullable<Awaited<ReturnType<typeof loadProfile>>>;
type PatchBody = z.infer<typeof patchSchema>;

function publicProfile(profile: Profile): Omit<Profile, "hiddenFromRoster"> {
  const { hiddenFromRoster, ...rest } = profile;
  void hiddenFromRoster;
  return rest;
}

function responseData(profile: Awaited<ReturnType<typeof loadProfile>>) {
  if (!profile) throw new HttpError(404, "User not found");
  return { profile: publicProfile(profile), completion: getProfileCompletion(profile) };
}

function loadProfile(client: ProfileClient, userId: string) {
  return client.user.findUnique({ where: { id: userId }, select: profileSelect });
}

function changedFields(step: PatchBody["step"], role: Profile["role"]): string[] {
  if (step === "EMAIL") return ["athleticsEmail"];
  if (step === "PHONES") {
    return role === "STUDENT"
      ? ["personalPhone", "phone"]
      : ["personalPhone", "phone", "workPhone", "workPhoneNotApplicable"];
  }
  if (step === "WISCARD") return ["wiscardCardNumber", "wiscardIssueCode", "wiscardNumber"];
  if (step === "STUDENT") return ["studentYearOverride", "graduationTerm", "gradYear"];
  if (step === "APPAREL") return ["topSizeFit", "topSize", "shoeSizeSystem", "shoeSize"];
  return ["profilePromptSnoozedUntil"];
}

function auditState(profile: Profile, step: PatchBody["step"]): Record<string, unknown> {
  if (step === "EMAIL") {
    return { athleticsEmailSet: Boolean(profile.athleticsEmail) };
  }
  if (step === "PHONES") {
    return {
      personalPhoneSet: Boolean(profile.personalPhone),
      workPhoneSet: Boolean(profile.workPhone),
      workPhoneNotApplicable: profile.workPhoneNotApplicable,
    };
  }
  if (step === "WISCARD") {
    return { wiscardLinked: Boolean(profile.wiscardCardNumber && profile.wiscardIssueCode) };
  }
  if (step === "STUDENT") {
    return {
      studentYearSet: Boolean(profile.studentYearOverride),
      anticipatedGraduationSet: Boolean(profile.graduationTerm && profile.gradYear),
    };
  }
  if (step === "APPAREL") {
    return {
      clothingSizeSet: Boolean(profile.topSizeFit && profile.topSize),
      shoeSizeSet: Boolean(profile.shoeSizeSystem && profile.shoeSize),
    };
  }
  return { reminderSnoozed: Boolean(profile.profilePromptSnoozedUntil) };
}

export const GET = withAuth(async (_req, { user }) => {
  return ok({ data: responseData(await loadProfile(db, user.id)) });
});

export const PATCH = withAuth(async (req, { user }) => {
  requirePermission(user.role, "user", "edit_self");
  await enforceRateLimit(`profile-completion:${user.id}`, SETTINGS_MUTATION_LIMIT);

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.errors[0]?.message ?? "Invalid profile details");
    }
    throw error;
  }

  if (
    body.step === "PHONES"
    && user.role !== "STUDENT"
    && user.role !== "COLLABORATOR"
    && !body.workPhoneNotApplicable
    && !body.workPhone
  ) {
    throw new HttpError(400, "Enter a work phone or choose that you do not have one");
  }

  if (user.role === "COLLABORATOR" && body.step !== "SNOOZE" && body.step !== "PHONES") {
    throw new HttpError(400, "Collaborator setup only includes a phone number and a profile photo.");
  }

  const data = body.step === "EMAIL"
    ? { athleticsEmail: body.athleticsEmail.toLowerCase(), profilePromptSnoozedUntil: null }
    : body.step === "PHONES"
      ? user.role === "STUDENT" || user.role === "COLLABORATOR"
        ? {
            personalPhone: body.personalPhone,
            phone: body.personalPhone,
            profilePromptSnoozedUntil: null,
          }
        : {
            personalPhone: body.personalPhone,
            phone: body.personalPhone,
            workPhone: body.workPhoneNotApplicable ? null : body.workPhone,
            workPhoneNotApplicable: body.workPhoneNotApplicable,
            profilePromptSnoozedUntil: null,
          }
      : body.step === "WISCARD"
        ? {
            wiscardCardNumber: body.wiscardCardNumber,
            wiscardIssueCode: body.wiscardIssueCode,
            wiscardNumber: `${body.wiscardCardNumber}${body.wiscardIssueCode}`,
            profilePromptSnoozedUntil: null,
          }
        : body.step === "STUDENT"
          ? {
              studentYearOverride: body.studentYearOverride,
              graduationTerm: body.graduationTerm,
              gradYear: body.gradYear,
              profilePromptSnoozedUntil: null,
            }
          : body.step === "APPAREL"
          ? {
              topSizeFit: body.topSizeFit,
              topSize: body.topSize,
              shoeSizeSystem: body.shoeSizeSystem,
              shoeSize: body.shoeSize,
              profilePromptSnoozedUntil: null,
            }
          : { profilePromptSnoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) };

  let updated: Profile;
  try {
    updated = await db.$transaction(async (tx) => {
      const before = await loadProfile(tx, user.id);
      if (!before) throw new HttpError(404, "User not found");
      if (body.step === "EMAIL" && !isCampusLoginEmail(before.email)) {
        throw new HttpError(409, "Your site login must be a @wisc.edu email. Ask an administrator to update it before completing your profile.");
      }
      if (body.step === "STUDENT" && before.role !== "STUDENT") {
        throw new HttpError(400, "Student details can only be saved for a student profile.");
      }

      const next = await tx.user.update({
        where: { id: user.id },
        data,
        select: profileSelect,
      });

      await createAuditEntryTx(tx, {
        actorId: user.id,
        actorRole: user.role,
        entityType: "user",
        entityId: user.id,
        action: body.step === "SNOOZE" ? "profile_completion_snoozed" : "profile_completion_updated",
        before: { step: body.step, ...auditState(before, body.step) },
        after: {
          step: body.step,
          fieldsChanged: changedFields(body.step, before.role),
          ...auditState(next, body.step),
        },
      });

      return next;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    const prismaError = error as { code?: string; meta?: { target?: string[] | string } };
    const target = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta?.target.join(",")
      : String(prismaError.meta?.target ?? "");
    if (prismaError.code === "P2002" && target.includes("athletics_email")) {
      throw new HttpError(409, "That Athletics email is already linked to another account.");
    }
    if (prismaError.code === "P2002" && (target.includes("wiscard_number") || target.includes("wiscard_card_number"))) {
      throw new HttpError(409, "That Wiscard is already linked to another account.");
    }
    throw error;
  }

  return ok({ data: responseData(updated) });
});
