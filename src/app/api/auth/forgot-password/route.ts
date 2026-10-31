import { db } from "@/lib/db";
import { tokenHash, randomHex } from "@/lib/auth";
import { renderEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { HttpError, ok } from "@/lib/http";
import { forgotPasswordSchema } from "@/lib/validation";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createSystemAuditEntry } from "@/lib/audit";

const RESET_TOKEN_EXPIRY_MS = 1000 * 60 * 60; // 1 hour
const FORGOT_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 }; // per IP; sized for shared NAT
const FORGOT_EMAIL_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 }; // per address; one inbox, one link

export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`forgot:${ip}`, FORGOT_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many requests. Please try again later.");

  const body = forgotPasswordSchema.parse(await req.json());
  const email = body.email.toLowerCase();

  if (!env.resendApiKey) {
    return ok({
      message: "Email password reset is not configured yet. Contact Erik Role for a temporary password.",
      resetEmailConfigured: false,
    });
  }

  // Always return success to prevent email enumeration. The per-address
  // budget is spent before the lookup so unknown addresses cost the same.
  const perAddress = await checkRateLimit(`forgot:email:${email}`, FORGOT_EMAIL_LIMIT);
  const user = perAddress.allowed ? await db.user.findUnique({ where: { email } }) : null;

  if (user?.active) {
    // Delete any existing reset tokens for this user
    await db.passwordResetToken.deleteMany({ where: { userId: user.id } });

    // Generate and store a hashed token
    const raw = randomHex(32);
    const hashed = await tokenHash(raw);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashed, expiresAt },
    });

    const resetUrl = `${env.appUrl}/reset-password?token=${raw}`;

    await sendEmail({
      to: user.email,
      subject: "Reset your password — Wisconsin Creative",
      ...buildResetEmail(user.name, resetUrl),
    });

    // Audit the issuance so reset abuse against a target account is traceable.
    // Consumption is logged separately in reset-password as password_reset_self.
    await createSystemAuditEntry({
      entityType: "user",
      entityId: user.id,
      action: "password_reset_requested",
      after: { ip, userAgent: req.headers.get("user-agent") ?? null },
    });
  }

  return ok({ message: "If that email exists, we sent a reset link.", resetEmailConfigured: true });
});

function buildResetEmail(name: string, resetUrl: string) {
  const firstName = name.trim().split(/\s+/)[0];
  return renderEmail({
    preheader: "Use this link within one hour to choose a new password.",
    eyebrow: "Password reset",
    headline: "Reset your password",
    paragraphs: [
      `${firstName ? `Hi ${firstName}, we` : "We"} got a request to reset the password on your account. This link works for one hour.`,
    ],
    action: { label: "Choose a new password", url: resetUrl },
    note: "Didn't ask for this? Ignore this email and your password stays the same.",
    showFallbackLink: true,
  });
}
