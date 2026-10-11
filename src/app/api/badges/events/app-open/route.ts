import { withAuth } from "@/lib/api";
import { badges, earnedBadgesSince } from "@/lib/badges";
import { ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";

/**
 * Records a signed-in app foreground event for server-authoritative easter
 * eggs. No client clock or timezone is accepted.
 *
 * The app passes its reward cursor as `after` and gets back everything earned
 * since, including anything this open just minted, so a foreground costs one
 * request instead of a poll before and after. Without a usable cursor the
 * response carries no awards, so history is never replayed.
 */
export const POST = withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);

  const occurredAt = new Date();
  await badges.onAppOpened({ userId: user.id, occurredAt });

  const afterValue = new URL(req.url).searchParams.get("after");
  const after = afterValue ? new Date(afterValue) : null;
  if (!after || Number.isNaN(after.getTime()) || after > occurredAt) {
    return ok({ data: { accepted: true } });
  }

  const through = new Date();
  const awards = await earnedBadgesSince(user.id, after);
  return ok({ data: { accepted: true, awards, nextCursor: through.toISOString() } });
});
