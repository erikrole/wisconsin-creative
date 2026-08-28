import { destroySession } from "@/lib/auth";
import { ok } from "@/lib/http";
import { withAuth } from "@/lib/api";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";

export const POST = withAuth(async (_req, { user }) => {
  await createAuditEntry({
    actorId: user.id,
    actorRole: user.preview?.actualRole ?? user.role,
    entityType: "session",
    entityId: user.id,
    action: "logout",
  });

  // A browser Push subscription belongs to the signed-in account. Revoke it
  // before clearing the session so a later user on the same phone cannot
  // inherit notifications addressed to this account.
  try {
    await db.webPushSubscription.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (error) {
    // Keep logout available during a staged migration or transient database
    // issue; the subscription endpoint also revokes on explicit disable.
    console.error("[AUTH] Failed to revoke browser push subscriptions on logout", error);
  }

  await destroySession();
  return ok({ success: true });
});
