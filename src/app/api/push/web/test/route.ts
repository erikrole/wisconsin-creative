import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { isWebPushConfigured, sendWebPushToUser } from "@/lib/push/web";
import { loadUserPrefs, shouldDeliverPush } from "@/lib/services/notification-prefs";

export const POST = withAuth(async (_req, { user }) => {
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
