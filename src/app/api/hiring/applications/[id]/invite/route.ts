import { Prisma } from "@prisma/client";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntryTx } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/hiring/contract";
import { mapArea } from "@/lib/hiring/import";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";

const inviteSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  /** Confirm linking to an account that already exists for the chosen email. */
  linkExistingUser: z.boolean().optional(),
  /** Link to a same-name account the admin confirmed is this person. */
  linkUserId: z.string().cuid().optional(),
  /** Confirm no existing account is this person, despite a same-name account. */
  confirmNewAccount: z.boolean().optional(),
});

/**
 * Staged hire conversion (D-065). Marking Hire only records the decision; this
 * route is the explicit, admin-confirmed step that stages the account invite.
 */
export const POST = withAuth<{ id: string }>(async (req, { user, params }) => {
  requirePermission(user.role, "hiring", "manage");
  await enforceRateLimit(`hiring:write:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = inviteSchema.parse(await req.json().catch(() => ({})));

  const application = await db.application.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      stage: true,
      primaryArea: true,
      rawAreas: true,
      allowedEmail: { select: { id: true } },
      applicant: {
        select: {
          id: true,
          name: true,
          hiredUserId: true,
          // Newest first: a returning applicant's latest address is the one to invite by default.
          emails: { select: { email: true, isPrimary: true }, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!application) throw new HttpError(404, "Application not found.");
  if (application.stage !== "HIRE") throw new HttpError(409, "Mark the applicant as Hire before creating an invite.");
  if (application.applicant.hiredUserId) throw new HttpError(409, "This applicant is already linked to an account.");
  if (application.allowedEmail) throw new HttpError(409, "An invitation was already sent for this application.");

  const known = application.applicant.emails.map((e) => normalizeEmail(e.email));
  const email = body.email ? normalizeEmail(body.email) : known[0];
  if (!email || !known.includes(email)) throw new HttpError(400, "Choose one of the applicant's emails.");

  // Any authoritative alias counts: campus email or athletics email.
  const existingUser = await db.user.findFirst({
    where: { OR: [{ email }, { athleticsEmail: email }] },
    select: { id: true, name: true, active: true },
  });

  // Linking an existing account is part of the Hire decision, so it re-checks the stage
  // and writes its audit entry in the same serializable transaction. A decision undone
  // meanwhile cannot leave a passed applicant linked to a user.
  const link = async (userId: string, action: string) => {
    await db.$transaction(
      async (tx) => {
        const current = await tx.application.findUnique({
          where: { id: application.id },
          select: { stage: true, applicant: { select: { hiredUserId: true } } },
        });
        if (!current || current.stage !== "HIRE") {
          throw new HttpError(409, "This application is no longer marked Hire, so no account was linked.");
        }
        if (current.applicant.hiredUserId) throw new HttpError(409, "This applicant is already linked to an account.");
        await tx.applicant.update({ where: { id: application.applicant.id }, data: { hiredUserId: userId } });
        await createAuditEntryTx(tx, {
          actorId: user.id,
          actorRole: user.role,
          entityType: "hiring_application",
          entityId: application.id,
          action,
          after: { userId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return ok({ data: { status: "linked", userId } });
  };

  // A deactivated account cannot sign in, and linked applicants drop out of planning, so linking a
  // hire to one would hide them. It must be reactivated first (a deliberate lifecycle step).
  const inactive = (u: { id: string; name: string }) =>
    new HttpError(409, "That account is deactivated. Reactivate it on the Users page before linking this hire.", {
      code: "user_inactive",
      user: { id: u.id, name: u.name },
    });

  if (existingUser) {
    if (!existingUser.active) throw inactive(existingUser);
    if (!body.linkExistingUser) {
      throw new HttpError(409, "An account already exists for this email.", {
        code: "user_exists",
        user: { id: existingUser.id, name: existingUser.name },
      });
    }
    return link(existingUser.id, "hire_linked_existing");
  }

  // A different email can still be the same person (personal address vs campus
  // address). Same-name accounts need an explicit decision before a new invite.
  const sameName = await db.user.findMany({
    where: { name: { equals: application.applicant.name, mode: "insensitive" } },
    // Email and status let the admin tell same-name people apart (never just the shared name).
    select: { id: true, name: true, email: true, active: true },
    take: 10,
  });
  if (body.linkUserId) {
    const chosen = sameName.find((u) => u.id === body.linkUserId);
    if (!chosen) throw new HttpError(400, "That account is not a name match for this applicant.");
    if (!chosen.active) throw inactive(chosen);
    return link(chosen.id, "hire_linked_existing");
  }
  if (sameName.length > 0 && !body.confirmNewAccount) {
    throw new HttpError(409, "An account with the same name already exists.", { code: "possible_account", users: sameName });
  }

  // Create, audit, and attach the invite in ONE serializable transaction that re-reads
  // the stage. A failure anywhere leaves no orphan invite, and a decision undone while
  // the invite was being created cannot leave a live invite on a passed applicant, who
  // could otherwise register and gain a student account. The audit carries no contact data.
  let inviteId: string;
  try {
    inviteId = await db.$transaction(
      async (tx) => {
        const current = await tx.application.findUnique({
          where: { id: application.id },
          select: { stage: true, allowedEmailId: true, applicant: { select: { purgedAt: true } } },
        });
        if (!current || current.stage !== "HIRE") {
          throw new HttpError(409, "This application is no longer marked Hire, so no invite was created.");
        }
        // A purge that committed after the first read must not be undone by writing the
        // applicant's name and email into a new invitation.
        if (current.applicant.purgedAt) {
          throw new HttpError(409, "This applicant's personal data was purged, so no invite was created.");
        }
        if (current.allowedEmailId) throw new HttpError(409, "An invitation was already sent for this application.");

        // The primary area first, then every other recognized area from the application, so
        // registration creates all of the student's area assignments.
        const areas = [
          ...new Set([
            ...(application.primaryArea ? [application.primaryArea] : []),
            ...application.rawAreas.map((label) => mapArea(label)).filter((a): a is NonNullable<typeof a> => a !== null),
          ]),
        ];
        const profile = {
          preloadedName: application.applicant.name,
          preloadedPrimaryArea: application.primaryArea ?? areas[0] ?? null,
          preloadedAreas: areas,
        };

        // A pending ordinary student invite for this address would block a new one (unique
        // email) and, if claimed, would register the user without linking the applicant.
        // Adopt it for this application instead.
        const pending = await tx.allowedEmail.findUnique({
          where: { email },
          select: { id: true, role: true, claimedAt: true, applications: { select: { id: true } } },
        });
        let inviteId: string;
        let adopted = false;
        if (pending) {
          if (pending.claimedAt) throw new HttpError(409, "That address already registered an account. Link the applicant to it instead.");
          if (pending.role !== "STUDENT") throw new HttpError(409, "That address has a staff or collaborator invitation. Resolve it before inviting a student.");
          if (pending.applications.some((a) => a.id !== application.id)) {
            throw new HttpError(409, "That address is already invited for a different application.");
          }
          await tx.allowedEmail.update({ where: { id: pending.id }, data: profile });
          inviteId = pending.id;
          adopted = true;
        } else {
          const created = await tx.allowedEmail.create({
            data: { email, role: "STUDENT", ...profile, createdById: user.id },
            select: { id: true },
          });
          inviteId = created.id;
        }
        await tx.application.update({ where: { id: application.id }, data: { allowedEmailId: inviteId } });
        await createAuditEntryTx(tx, {
          actorId: user.id,
          actorRole: user.role,
          entityType: "allowed_email",
          entityId: inviteId,
          action: adopted ? "adopted_for_hire" : "created",
          after: { role: "STUDENT", source: "hiring_invite" },
        });
        await createAuditEntryTx(tx, {
          actorId: user.id,
          actorRole: user.role,
          entityType: "hiring_application",
          entityId: application.id,
          action: "hire_invited",
          after: { allowedEmailId: inviteId },
        });
        return inviteId;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "An invitation already exists for this email.");
    }
    throw error;
  }

  return ok({ data: { status: "invited", allowedEmailId: inviteId } }, 201);
});
