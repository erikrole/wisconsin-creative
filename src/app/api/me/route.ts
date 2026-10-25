import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { canViewHiddenUsers } from "@/lib/user-visibility";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";

// Profile edits go through /api/me/profile and password changes through
// /api/me/change-password, which is rate limited and revokes companion sessions.
export const GET = withAuth(async (_req, { user }) => {
  // Lets Home show first-weeks guidance without widening the session lookup.
  const account = await db.user.findUnique({ where: { id: user.id }, select: { createdAt: true } });
  return ok({
    user: { ...user, accountCreatedAt: account?.createdAt.toISOString() ?? null },
    canViewHiddenUsers: canViewHiddenUsers(user),
    canViewUsageAnalytics: canViewUsageAnalytics(user),
  });
});
