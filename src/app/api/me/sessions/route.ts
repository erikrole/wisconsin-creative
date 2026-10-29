import { cookies } from "next/headers";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { tokenHash } from "@/lib/auth";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAuditEntry } from "@/lib/audit";

/** GET /api/me/sessions — list all non-expired sessions for the caller. */
export const GET = withAuth(async (_req, { user }) => {
  await enforceRateLimit(`sessions:read:${user.id}`, { max: 30, windowMs: 60_000 });

  const cookieStore = await cookies();
  const raw = cookieStore.get(env.sessionCookieName)?.value;
  const currentHash = raw ? await tokenHash(raw) : null;

  const sessions = await db.session.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Determine current session id without exposing tokenHash to the client
  let currentSessionId: string | null = null;
  if (currentHash) {
    const current = await db.session.findUnique({
      where: { tokenHash: currentHash },
      select: { id: true },
    });
    currentSessionId = current?.id ?? null;
  }

  return ok({
    data: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.id === currentSessionId,
    })),
  });
});

/** DELETE /api/me/sessions — revoke all sessions except the current one. */
export const DELETE = withAuth(async (_req, { user }) => {
  await enforceRateLimit(`sessions:revoke:${user.id}`, { max: 10, windowMs: 60_000 });

  const cookieStore = await cookies();
  const raw = cookieStore.get(env.sessionCookieName)?.value;
  const currentHash = raw ? await tokenHash(raw) : null;

  let currentSessionId: string | null = null;
  if (currentHash) {
    const current = await db.session.findUnique({
      where: { tokenHash: currentHash },
      select: { id: true },
    });
    currentSessionId = current?.id ?? null;
  }

  if (!currentSessionId) {
    throw new HttpError(401, "Current session could not be verified. Sign in again.");
  }

  const result = await db.session.deleteMany({
    where: {
      userId: user.id,
      id: { not: currentSessionId },
    },
  });

  if (result.count > 0) {
    await createAuditEntry({
      actorId: user.id,
      actorRole: user.role,
      entityType: "session",
      entityId: user.id,
      action: "sessions_signed_out",
      after: { count: result.count },
    });
  }

  return ok({ revokedCount: result.count });
});
