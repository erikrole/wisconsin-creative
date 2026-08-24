import { db } from "@/lib/db";
import { tokenHash } from "@/lib/auth";
import { ok, HttpError } from "@/lib/http";
import { resetPasswordAccountSchema } from "@/lib/validation";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const LOOKUP_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 }; // per IP; sized for shared NAT

/**
 * POST /api/auth/reset-password/account — the address a reset link belongs to.
 *
 * The reset page is reached from an email link with no session, so it cannot
 * name the account it is about to change. That leaves the person guessing which
 * address they are resetting, and leaves a password manager with a new password
 * and no record to file it against.
 *
 * The token already grants full control of this account, so returning its email
 * to whoever holds it discloses nothing they could not already reach. The token
 * is read, never consumed, and the failure message never distinguishes an
 * unknown token from an expired one.
 */
export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`reset:account:${ip}`, LOOKUP_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many attempts. Please try again later.");

  const body = resetPasswordAccountSchema.parse(await req.json());
  const resetToken = await db.passwordResetToken.findUnique({
    where: { tokenHash: await tokenHash(body.token) },
    select: {
      expiresAt: true,
      user: { select: { email: true, active: true } },
    },
  });

  if (!resetToken || !resetToken.user.active || resetToken.expiresAt < new Date()) {
    throw new HttpError(400, "Invalid or expired reset link");
  }

  return ok({ email: resetToken.user.email });
});
