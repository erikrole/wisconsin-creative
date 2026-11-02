import { withAuth } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { createAuditEntry } from "@/lib/audit";
import { revokeCompanionUser } from "@/lib/companion-store";
import crypto from "crypto";

export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  requireRole(user.role, ["ADMIN"]);

  const { id } = params;

  if (user.id === id) {
    throw new HttpError(400, "Cannot reset your own password via this endpoint. Use your profile settings.");
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!target) throw new HttpError(404, "User not found");

  // Generate a secure temporary password (~16 chars, 96 bits of entropy).
  // Returned once in the response body, which ok() serves no-store; the user
  // is forced to change it on next login via forcePasswordChange.
  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  // Atomic: update password + invalidate every other credential together.
  // An administrator reset is account recovery, so passkeys and pending reset
  // links go too: a credential enrolled by whoever held the account before
  // must not outlive the password it was enrolled under.
  const [, sessions, passkeys, resetLinks] = await db.$transaction([
    db.user.update({ where: { id }, data: { passwordHash, forcePasswordChange: true } }),
    db.session.deleteMany({ where: { userId: id } }),
    db.passkeyCredential.deleteMany({ where: { userId: id } }),
    db.passwordResetToken.deleteMany({ where: { userId: id } }),
    db.apiToken.deleteMany({ where: { userId: id } }),
  ]);

  try {
    await revokeCompanionUser(id);
  } catch (error) {
    console.error("[Companion] failed to revoke password-reset user", error);
    throw new HttpError(
      503,
      "The password was reset, but companion access could not be revoked. Retry the reset before sharing the temporary password.",
    );
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: id,
    action: "password_reset",
    after: {
      resetBy: user.name,
      forcePasswordChange: true,
      revoked: { sessions: sessions.count, passkeys: passkeys.count, resetLinks: resetLinks.count },
    },
  });

  return ok({ data: { temporaryPassword: tempPassword, forcePasswordChange: true } });
});
