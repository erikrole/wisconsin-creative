import { db } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { buildInviteEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { HttpError, ok } from "@/lib/http";
import { assertNotHiringInvite } from "@/lib/hiring/invite-scope";
import { requirePermission } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { enforceRateLimit } from "@/lib/rate-limit";

// Each press mails a real person, so cap how fast one admin can fan out.
const SEND_INVITE_LIMIT = { max: 40, windowMs: 15 * 60 * 1000 };

/** Email the app login link to an unclaimed invitation. Only runs when someone presses the button. */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requirePermission(user.role, "allowed_email", "edit");
  await enforceRateLimit(`allowed-emails:send:${user.id}`, SEND_INVITE_LIMIT);
  await assertNotHiringInvite(user.role, params.id);

  const entry = await db.allowedEmail.findUnique({ where: { id: params.id } });
  if (!entry) throw new HttpError(404, "Allowed email not found");
  if (entry.claimedAt) throw new HttpError(400, "This invitation was already claimed.");
  if (!env.resendApiKey) {
    throw new HttpError(409, "Email delivery isn't set up on this site yet. Copy the login link and send it yourself.");
  }

  const loginUrl = `${env.appUrl}/login?email=${encodeURIComponent(entry.email)}`;
  const sent = await sendEmail({
    to: entry.email,
    subject: "Set up your Wisconsin Creative account",
    html: buildInviteEmail({ name: entry.preloadedName, loginUrl }),
  });
  if (!sent) throw new HttpError(502, "The email could not be sent. Try again, or copy the login link instead.");

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "allowed_email",
    entityId: entry.id,
    action: "invite_emailed",
    after: { email: entry.email },
  });

  return ok({ sent: true });
});
