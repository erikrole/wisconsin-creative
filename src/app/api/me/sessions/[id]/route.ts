import { cookies } from "next/headers";
import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { tokenHash } from "@/lib/auth";
import { env } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAuditEntry } from "@/lib/audit";

/** DELETE /api/me/sessions/[id] — revoke a specific session (cannot revoke the current one). */
export const DELETE = withAuth<{ id: string }>(async (_req, { user, params }) => {
  await enforceRateLimit(`sessions:revoke:${user.id}`, { max: 10, windowMs: 60_000 });

  const { id } = params;

  // Prevent revoking the session being used right now
  const cookieStore = await cookies();
  const raw = cookieStore.get(env.sessionCookieName)?.value;
  const currentHash = raw ? await tokenHash(raw) : null;

  if (currentHash) {
    const current = await db.session.findUnique({
      where: { tokenHash: currentHash },
      select: { id: true },
    });
    if (current?.id === id) {
      throw new HttpError(400, "Cannot revoke your current session. Sign out instead.");
    }
  }

  // Confirm the session belongs to the caller before deleting
  const deleted = await db.session.deleteMany({
    where: { id, userId: user.id },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Session not found.");
  }

  await createAuditEntry({
    actorId: user.id,
    actorRole: user.role,
    entityType: "session",
    entityId: id,
    action: "session_signed_out",
  });

  return ok({ success: true });
});
