import { z } from "zod";
import { cookies } from "next/headers";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { hashPassword, verifyPassword, tokenHash } from "@/lib/auth";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { revokeCompanionUser } from "@/lib/companion-store";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
  revokeOtherSessions: z.boolean().default(false),
});

/** POST /api/me/change-password — verify current password and set a new one. */
export const POST = withAuth(async (req, { user }) => {
  // Tighter rate limit — protect against brute-force via this endpoint
  await enforceRateLimit(`change-password:${user.id}`, { max: 5, windowMs: 60_000 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new HttpError(400, err.issues[0]?.message ?? "Invalid request.");
    }
    throw err;
  }

  const userRecord = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true },
  });
  if (!userRecord?.passwordHash) throw new HttpError(400, "Cannot change password for this account.");

  const valid = await verifyPassword(userRecord.passwordHash, body.currentPassword);
  if (!valid) throw new HttpError(400, "Current password is incorrect.");

  if (body.newPassword === body.currentPassword) {
    throw new HttpError(400, "New password must be different from the current password.");
  }

  let currentSessionId: string | null = null;
  if (body.revokeOtherSessions) {
    const cookieStore = await cookies();
    const raw = cookieStore.get(env.sessionCookieName)?.value;
    const currentHash = raw ? await tokenHash(raw) : null;
    const current = currentHash
      ? await db.session.findUnique({ where: { tokenHash: currentHash }, select: { id: true } })
      : null;
    currentSessionId = current?.id ?? null;

    if (!currentSessionId) {
      throw new HttpError(401, "Current session could not be verified. Sign in again.");
    }
  }

  const newHash = await hashPassword(body.newPassword);

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, forcePasswordChange: false },
  });

  if (body.revokeOtherSessions) {
    if (!currentSessionId) {
      throw new HttpError(401, "Current session could not be verified. Sign in again.");
    }
    await db.session.deleteMany({
      where: {
        userId: user.id,
        id: { not: currentSessionId },
      },
    });
  }

  try {
    await revokeCompanionUser(user.id);
  } catch (error) {
    console.error("[Companion] failed to revoke password-changed user", error);
    throw new HttpError(503, "The password changed, but companion access could not be revoked. Retry the password change.");
  }

  return ok({ success: true });
});
