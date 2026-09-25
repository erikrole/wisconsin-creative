import { createHmac } from "node:crypto";
import type { AuthUser } from "@/lib/auth";
import { parseEmailList } from "@/lib/user-visibility";

export const PRODUCT_EVENT_NAMES = [
  "app_opened",
  "surface_viewed",
  "item_search_started",
  "item_search_result_selected",
  "scanner_opened",
  "scan_lookup_succeeded",
  "scan_lookup_failed",
  "reservation_started",
  "reservation_submitted",
  "reservation_blocked",
  "reservation_abandoned",
  "checkout_started",
  "checkout_completed",
  "return_started",
  "return_completed",
  "schedule_viewed",
  "open_work_viewed",
  "shift_claim_succeeded",
  "trade_completed",
  "notification_opened",
  "notification_destination_reached",
  // Notification telemetry: a lock-screen action, the daily push readiness
  // check-in, and a preference change (recorded server-side on save).
  "notification_action",
  "push_status",
  "notification_pref_changed",
  // How long a key screen took to load; the bucket rides in `reason`.
  "surface_loaded",
  "recoverable_error_shown",
  "retry_selected",
  "retry_succeeded",
] as const;

export const PRODUCT_EVENT_PLATFORMS = ["web", "ios", "kiosk"] as const;
export const PRODUCT_EVENT_SURFACES = [
  "home", "bookings", "items", "schedule", "reports", "settings",
  // The native profile record is its own screen reached from two places, so it
  // counts as itself rather than disappearing into "users".
  "search", "notifications", "users", "scoreboard", "resources", "licenses", "kiosk", "other",
] as const;
export const PRODUCT_EVENT_OUTCOMES = ["started", "succeeded", "failed", "cancelled"] as const;
export const PRODUCT_EVENT_DURATION_BUCKETS = ["under_5s", "5_15s", "15_60s", "over_60s"] as const;
export const PRODUCT_RELEASE_CHANNELS = ["app_store", "testflight", "development", "unknown", "web"] as const;

export function canViewUsageAnalytics(user: Pick<AuthUser, "email">): boolean {
  return parseEmailList(process.env.USAGE_ANALYTICS_OWNER_EMAILS).has(user.email.toLowerCase());
}

function analyticsSecret(): string | null {
  return process.env.USAGE_ANALYTICS_HASH_SECRET || process.env.SESSION_SECRET || null;
}

export function pseudonymousAnalyticsKey(value: string, occurredAt = new Date()): string | null {
  const secret = analyticsSecret();
  if (!secret) return null;
  const rotation = occurredAt.getUTCFullYear().toString();
  return createHmac("sha256", secret).update(`${rotation}:${value}`).digest("hex");
}

/** Stable only for this configured secret; used to keep one current row per app installation. */
export function pseudonymousInstallationKey(value: string): string | null {
  const secret = analyticsSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`installation:${value}`).digest("hex");
}
