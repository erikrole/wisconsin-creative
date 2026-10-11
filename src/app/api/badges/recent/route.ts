import { badgesEnabled } from "@/lib/badges";
import { listEarnedBadgesSince } from "@/lib/badges/queries";
import { withAuth } from "@/lib/api";
import { HttpError, ok } from "@/lib/http";
import { requireRole } from "@/lib/rbac";
import { isOvernightQuietHours } from "@/lib/app-time";

// Installed iOS builds poll this route every 15 seconds for as long as the app stays open.
// Each authenticated poll reads sessions, users and badges, so one phone left open overnight
// kept the Neon compute awake all night. Overnight, answer a poll that already carries a valid
// cursor with an empty page before auth and the database are touched; the app asks again, with
// the same cursor, when it next polls in the daytime or comes back to the foreground.
function overnightQuietResponse(req: Request) {
  if (!isOvernightQuietHours()) return null;
  const afterValue = new URL(req.url).searchParams.get("after");
  if (!afterValue) return null;
  const after = new Date(afterValue);
  if (Number.isNaN(after.getTime()) || after > new Date()) return null;
  return ok({ data: { awards: [], nextCursor: after.toISOString() }, quiet: true });
}

function withOvernightQuiet<Args extends [Request, ...unknown[]]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return (...args: Args) => overnightQuietResponse(args[0]) ?? handler(...args);
}

export const GET = withOvernightQuiet(withAuth(async (req, { user }) => {
  requireRole(user.role, ["ADMIN", "STAFF", "STUDENT"]);

  const through = new Date();
  const nextCursor = through.toISOString();
  if (!badgesEnabled()) {
    return ok({ data: { awards: [], nextCursor }, disabled: true });
  }

  const afterValue = new URL(req.url).searchParams.get("after");
  if (!afterValue) {
    // Establish a server-time cursor without replaying the user's history.
    return ok({ data: { awards: [], nextCursor } });
  }

  const after = new Date(afterValue);
  if (Number.isNaN(after.getTime()) || after > through) {
    throw new HttpError(400, "after must be a valid prior ISO timestamp");
  }

  const awards = await listEarnedBadgesSince({
    userId: user.id,
    after,
    through,
  });

  return ok({ data: { awards, nextCursor } });
}));
