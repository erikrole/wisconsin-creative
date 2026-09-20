import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { HttpError, ok } from "@/lib/http";
import { registerSchema } from "@/lib/validation";
import { shiftWorkerTypeForRole } from "@/lib/shift-display";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createAuditEntriesTx, createAuditEntry } from "@/lib/audit";
import { capabilitiesForActor, collaboratorPolicyMetadataForActor, compatibilityCollaboratorProfile } from "@/lib/collaborator-access";
import { collaboratorPolicyActorSelect } from "@/lib/services/collaborator-policies";
import { unique } from "@/lib/utils";

// Registration is invitation-gated (allowlist), so the IP ceiling is sized for
// an onboarding wave from a shared network rather than for abuse defense.
const REGISTER_LIMIT = { max: 40, windowMs: 15 * 60 * 1000 }; // per IP per 15 min

// One shared response for missing invite, claimed invite, and existing account,
// so public registration can't be used to probe which emails the system knows
// about (D-037 membership-enumeration boundary).
const INVITE_GATE_MESSAGE =
  "Registration is by invitation only. If you already have an account, sign in. Otherwise contact Erik Role to request access.";

export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`register:${ip}`, REGISTER_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many registration attempts. Please try again later.");

  const body = registerSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  // ── Allowlist gate ──────────────────────────────────────
  const allowedEntry = await db.allowedEmail.findUnique({
    where: { email },
    include: { collaboratorPolicy: { select: collaboratorPolicyActorSelect } },
  });

  if (!allowedEntry) {
    throw new HttpError(403, INVITE_GATE_MESSAGE);
  }

  if (allowedEntry.claimedAt) {
    throw new HttpError(403, INVITE_GATE_MESSAGE);
  }
  if (allowedEntry.role === "COLLABORATOR" && allowedEntry.collaboratorPolicy?.status !== "ACTIVE") {
    throw new HttpError(403, INVITE_GATE_MESSAGE);
  }
  // ────────────────────────────────────────────────────────

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(403, INVITE_GATE_MESSAGE);
  }

  const passwordHash = await hashPassword(body.password);
  const preloadedPrimaryArea = allowedEntry.preloadedPrimaryArea ?? allowedEntry.preloadedAreas?.[0] ?? null;
  // Atomic: create user + claim invitation in one transaction
  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: allowedEntry.preloadedName?.trim() || body.name.trim(),
          email,
          wiscardNumber: null,
          passwordHash,
          role: allowedEntry.role, // Use role from allowlist (not hardcoded STUDENT)
          affiliation: allowedEntry.affiliation,
          collaboratorProfile: allowedEntry.collaboratorProfile,
          collaboratorPolicyId: allowedEntry.collaboratorPolicyId,
          primaryArea: allowedEntry.role === "STUDENT" ? preloadedPrimaryArea : null,
          staffingType: shiftWorkerTypeForRole(allowedEntry.role),
        },
        include: { collaboratorPolicy: { select: collaboratorPolicyActorSelect } },
      });

      await tx.allowedEmail.update({
        where: { id: allowedEntry.id },
        data: { claimedAt: new Date(), claimedById: created.id },
      });

      if (allowedEntry.role === "STUDENT") {
        const areas = unique([
          ...(allowedEntry.preloadedAreas ?? []),
          ...(allowedEntry.preloadedPrimaryArea ? [allowedEntry.preloadedPrimaryArea] : []),
        ]);
        const primaryArea = preloadedPrimaryArea ?? areas[0] ?? null;
        const assignmentAudits: Array<{
          actorId: string;
          actorRole: typeof created.role;
          entityType: string;
          entityId: string;
          action: string;
          after: Record<string, unknown>;
        }> = [];

        for (const area of areas) {
          const assignment = await tx.studentAreaAssignment.create({
            data: {
              userId: created.id,
              area,
              isPrimary: area === primaryArea,
            },
          });
          assignmentAudits.push({
            actorId: created.id,
            actorRole: created.role,
            entityType: "student_area_assignment",
            entityId: assignment.id,
            action: "created",
            after: {
              userId: created.id,
              area,
              isPrimary: area === primaryArea,
              source: "preloaded_allowed_email",
            },
          });
        }

        for (const sportCode of unique(allowedEntry.preloadedSportCodes ?? [])) {
          const assignment = await tx.studentSportAssignment.create({
            data: {
              userId: created.id,
              sportCode,
            },
          });
          assignmentAudits.push({
            actorId: created.id,
            actorRole: created.role,
            entityType: "student_sport_assignment",
            entityId: assignment.id,
            action: "created",
            after: {
              userId: created.id,
              sportCode,
              defaultTraveler: assignment.defaultTraveler,
              source: "preloaded_allowed_email",
            },
          });
        }

        if (assignmentAudits.length > 0) {
          await createAuditEntriesTx(tx, assignmentAudits);
        }
      }

      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = (error.meta?.target as string[] | string | undefined) ?? "";
      const targetStr = Array.isArray(target) ? target.join(",") : String(target);
      if (targetStr.includes("wiscard_number") || targetStr.includes("wiscardNumber")) {
        throw new HttpError(409, "That Wiscard value is already linked to another account");
      }
      throw new HttpError(403, INVITE_GATE_MESSAGE);
    }
    throw error;
  }

  await createSession(user.id);
  const collaboratorPolicy = collaboratorPolicyMetadataForActor(user);

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: user.id,
    action: "registered",
    after: {
      name: user.name,
      email: user.email,
      role: user.role,
      affiliation: collaboratorPolicy?.affiliationKey ?? user.affiliation,
      collaboratorProfile: compatibilityCollaboratorProfile(collaboratorPolicy, user.collaboratorProfile),
      collaboratorPolicyId: user.collaboratorPolicyId,
      staffingType: user.staffingType,
      wiscardLinked: Boolean(user.wiscardNumber),
    },
  });

  return ok(
    {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        affiliation: collaboratorPolicy?.affiliationKey ?? user.affiliation,
        collaboratorProfile: compatibilityCollaboratorProfile(collaboratorPolicy, user.collaboratorProfile),
        collaboratorPolicy,
        capabilities: capabilitiesForActor(user),
      },
    },
    201
  );
});
