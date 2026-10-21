import { withAuth } from "@/lib/api";
import { db } from "@/lib/db";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveSettledNotificationsForUser } from "@/lib/services/notification-resolution";

export const GET = withAuth(async (_req, { user }) => {
  await enforceRateLimit(`notifications:count:${user.id}`, { max: 180, windowMs: 60_000 });
  // Count open work, not reminders for gear that is already back.
  await resolveSettledNotificationsForUser(user.id);
  const unreadCount = await db.notification.count({
    where: { userId: user.id, readAt: null },
  });
  return ok({ unreadCount });
});
