import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/hiring/contract";
import { HttpError, ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { createAllowedEmailInvite } from "@/lib/services/onboarding-lifecycle";

const inviteSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  /** Confirm linking to an account that already exists for the chosen email. */
  linkExistingUser: z.boolean().optional(),
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
      allowedEmail: { select: { id: true } },
      applicant: {
        select: {
          id: true,
          name: true,
          hiredUserId: true,
          emails: { select: { email: true, isPrimary: true }, orderBy: { isPrimary: "desc" } },
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

  const existingUser = await db.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (existingUser) {
    if (!body.linkExistingUser) {
      throw new HttpError(409, "An account already exists for this email.", {
        code: "user_exists",
        user: { id: existingUser.id, name: existingUser.name },
      });
    }
    await db.applicant.update({ where: { id: application.applicant.id }, data: { hiredUserId: existingUser.id } });
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "hiring_application",
      entityId: application.id,
      action: "hire_linked_existing",
      after: { userId: existingUser.id },
    });
    return ok({ data: { status: "linked", userId: existingUser.id } });
  }

  const invite = await createAllowedEmailInvite({
    actor: { id: user.id, role: user.role },
    email,
    role: "STUDENT",
    preloadedName: application.applicant.name,
    preloadedPrimaryArea: application.primaryArea,
    preloadedAreas: application.primaryArea ? [application.primaryArea] : [],
  });
  if (invite.skipped) throw new HttpError(409, "An invitation already exists for this email.");

  await db.application.update({ where: { id: application.id }, data: { allowedEmailId: invite.entry.id } });
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "hiring_application",
    entityId: application.id,
    action: "hire_invited",
    after: { allowedEmailId: invite.entry.id },
  });

  return ok({ data: { status: "invited", allowedEmailId: invite.entry.id } }, 201);
});
