import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isWebPushConfigured, sendWebPushToUser } from "@/lib/push/web";
import { loadUserPrefs, shouldDeliverPush } from "@/lib/services/notification-prefs";

/** A real push per call; a handful a minute covers "tap again to be sure". */
const TEST_PUSH_LIMIT = { max: 5, windowMs: 60_000 };

export const POST = withAuth(async (_req, { user }) => {
  await enforceRateLimit(`push-test:web:${user.id}`, TEST_PUSH_LIMIT);
  if (!isWebPushConfigured()) {
    return ok({ data: { configured: false, devices: 0, delivered: 0, revoked: 0 } });
  }

  const prefs = await loadUserPrefs(user.id);
  if (!shouldDeliverPush(prefs)) {
    return ok({ data: { configured: true, devices: 0, delivered: 0, revoked: 0, disabled: true } });
  }

  const delivery = await sendWebPushToUser(user.id, {
    title: "Test notification",
    body: "Browser push delivery is working on this device.",
  });
  return ok({ data: { configured: true, ...delivery } });
});
