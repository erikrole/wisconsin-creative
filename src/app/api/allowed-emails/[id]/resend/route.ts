import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { assertNotHiringInvite } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { sendInviteEmail } from "@/lib/services/invite-email";

/** Per invite, so a stuck student is not mailed repeatedly by mistake. */
const RESEND_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };

/** Email (or re-email) the sign-in link for an unclaimed invitation. */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "allowed_email", "edit");
  await enforceRateLimit(`allowed-emails:write:${user.id}`, SETTINGS_MUTATION_LIMIT);

  await assertNotHiringInvite(user.role, params.id);
  const entry = await db.allowedEmail.findUnique({
    where: { id: params.id },
    select: { id: true, email: true, preloadedName: true, claimedAt: true },
  });
  if (!entry) throw new HttpError(404, "Invitation not found");
  if (entry.claimedAt) throw new HttpError(409, "This person already signed in, so there is nothing to resend.");

  await enforceRateLimit(`allowed-emails:resend:${entry.id}`, RESEND_LIMIT);
  // Unclaimed means they have never signed in, so they get the invite itself.
  const emailStatus = await sendInviteEmail({ email: entry.email, name: entry.preloadedName, allowedEmailId: entry.id });

  // The audit entry records that a send was attempted and how it ended, never the address.
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "allowed_email",
    entityId: entry.id,
    action: "invite_resent",
    after: { emailStatus },
  });

  if (emailStatus === "failed") throw new HttpError(502, "The email could not be sent. Try again, or share the sign-in link directly.");
  return ok({ data: { emailStatus } });
});
