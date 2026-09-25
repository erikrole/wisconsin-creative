import { db } from "@/lib/db";
import { pseudonymousAnalyticsKey } from "@/lib/usage-analytics";

type ServerProductEvent = {
  userId: string;
  eventName: "notification_pref_changed";
  platform: "web" | "ios";
  surface: "settings";
  properties: { source?: string; mode?: string; reason?: string };
};

/**
 * Records usage events the server observes directly (a saved preference), with
 * the same pseudonymous actor key and tag rules as `/api/product-events`.
 * Best-effort: counting must never fail the user's request.
 */
export async function recordServerProductEvents(events: ServerProductEvent[]): Promise<void> {
  if (events.length === 0) return;
  const occurredAt = new Date();
  try {
    const rows = events.flatMap((event) => {
      const actorHash = pseudonymousAnalyticsKey(event.userId, occurredAt);
      if (!actorHash) return [];
      return [{
        actorHash,
        eventName: event.eventName,
        platform: event.platform,
        surface: event.surface,
        properties: event.properties,
        occurredAt,
      }];
    });
    if (rows.length > 0) await db.productEvent.createMany({ data: rows });
  } catch (err) {
    console.error("[USAGE] Failed to record server product events:", err);
  }
}

/** Tag values allow only lowercase snake case: "checkoutDue" → "checkout_due". */
export function analyticsTag(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32);
}
