import { db } from "@/lib/db";
import { tokenHash, hashPassword } from "@/lib/auth";
import { ok, HttpError } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/validation";
import { withHandler } from "@/lib/api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createAuditEntryTx } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { revokeCompanionUser } from "@/lib/companion-store";

const RESET_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 }; // per IP; sized for shared NAT

export const POST = withHandler(async (req) => {
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`reset:${ip}`, RESET_LIMIT);
  if (!allowed) throw new HttpError(429, "Too many attempts. Please try again later.");

  const body = resetPasswordSchema.parse(await req.json());

  const hashed = await tokenHash(body.token);
  const now = new Date();
  const newPasswordHash = await hashPassword(body.password);

  const resetUser = await db.$transaction(
    async (tx) => {
      const resetToken = await tx.passwordResetToken.findUnique({
        where: { tokenHash: hashed },
        include: { user: { select: { id: true, role: true, active: true } } },
      });

      if (!resetToken || !resetToken.user.active || resetToken.expiresAt < now) {
        throw new HttpError(400, "Invalid or expired reset link");
      }

      const consumed = await tx.passwordResetToken.deleteMany({
        where: {
          id: resetToken.id,
          expiresAt: { gte: now },
        },
      });

      if (consumed.count !== 1) {
        throw new HttpError(400, "Invalid or expired reset link");
      }

      const updated = await tx.user.updateMany({
        where: { id: resetToken.userId, active: true },
        data: { passwordHash: newPasswordHash, forcePasswordChange: false },
      });
      if (updated.count !== 1) {
        throw new HttpError(400, "Invalid or expired reset link");
      }
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId },
      });
      await tx.session.deleteMany({
        where: { userId: resetToken.userId },
      });
      await tx.apiToken.deleteMany({ where: { userId: resetToken.userId } });
      const deviceTokenCleanup = await tx.deviceToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      const liveActivityStartTokenCleanup = await tx.liveActivityStartToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Live Activity end delivery is external and must not hold the password
      // reset transaction open. Revoking every start token makes the still-open
      // rows eligible for the bounded durable-end retry while `endedAt: null`
      // remains the pending-delivery marker.
      const liveActivityTokensQueuedForEnd = await tx.liveActivityToken.count({
        where: { userId: resetToken.userId, endedAt: null },
      });
      const liveActivityStartsQueuedForEnd = await tx.liveActivityStart.count({
        where: { userId: resetToken.userId, endedAt: null },
      });

      await createAuditEntryTx(tx, {
        actorId: resetToken.user.id,
        actorRole: resetToken.user.role,
        entityType: "user",
        entityId: resetToken.user.id,
        action: "password_reset_self",
        after: {
          ip,
          userAgent: req.headers.get("user-agent") ?? null,
          notificationAccessRevoked: {
            deviceTokens: deviceTokenCleanup.count,
            liveActivityStartTokens: liveActivityStartTokenCleanup.count,
            liveActivityTokensQueuedForEnd,
            liveActivityStartsQueuedForEnd,
          },
        },
      });

      return resetToken.user;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  try {
    await revokeCompanionUser(resetUser.id);
  } catch (error) {
    console.error("[Companion] failed to revoke password-reset user", error);
    throw new HttpError(503, "The password was reset, but companion access could not be revoked. Contact an administrator.");
  }

  return ok({ message: "Password reset successfully. Please sign in." });
});
