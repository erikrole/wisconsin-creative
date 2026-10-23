import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { inviteResendSchema } from "@/lib/validation";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createSystemAuditEntry } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/services/invite-email";
import { env } from "@/lib/env";

// Per address, so a stuck student cannot be mailed repeatedly by a stranger,
// and per IP so one network cannot sweep the roster for pending invites.
const RESEND_EMAIL_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };
const RESEND_IP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };

/**
 * POST /api/auth/invite/resend — email the sign-up link to an invited address.
 *
 * Sign-up needs the one-time token from the invite email, so someone who typed
 * the sign-in page by hand, or whose link is older than 30 days, asks for a
 * fresh one here. The mail only ever goes to the invited address itself, which
 * is why this can stay public. The response is the same whether or not the
 * address has a pending invite (D-037 membership-enumeration boundary; the
 * discover route already exposes the pending state deliberately, but this
 * route adds nothing to it).
 */
export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const body = inviteResendSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  const [ipCheck, emailCheck] = await Promise.all([
    checkRateLimit(`invite-resend:ip:${ip}`, RESEND_IP_LIMIT),
    checkRateLimit(`invite-resend:email:${email}`, RESEND_EMAIL_LIMIT),
  ]);
  if (!ipCheck.allowed || !emailCheck.allowed) {
    throw new HttpError(429, "Too many requests. Please try again later.");
  }

  if (!env.resendApiKey) {
    return ok({
      message: "Invite email is not configured yet. Contact Erik Role for your sign-up link.",
      inviteEmailConfigured: false,
    });
  }

  const [invite, user] = await Promise.all([
    db.allowedEmail.findUnique({
      where: { email },
      select: {
        id: true,
        preloadedName: true,
        claimedAt: true,
        role: true,
        collaboratorPolicy: { select: { status: true } },
      },
    }),
    db.user.findUnique({ where: { email }, select: { id: true } }),
  ]);

  const pending = Boolean(
    invite
      && !invite.claimedAt
      && !user
      && (invite.role !== "COLLABORATOR" || invite.collaboratorPolicy?.status === "ACTIVE"),
  );

  if (pending && invite) {
    const emailStatus = await sendInviteEmail({ email, name: invite.preloadedName, allowedEmailId: invite.id });
    // Records that a public resend happened and how it ended, never the address.
    await createSystemAuditEntry({
      entityType: "allowed_email",
      entityId: invite.id,
      action: "invite_link_requested",
      after: { emailStatus, ip },
    });
  }

  return ok({ message: "If that address has a pending invite, we sent the link.", inviteEmailConfigured: true });
});
