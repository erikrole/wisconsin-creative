import { after } from "next/server";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { sendPush } from "@/lib/push/apns";
import { sendWebPushToUsers } from "@/lib/push/web";
import { withNotificationHref } from "@/lib/notification-destination";
import {
  isInQuietHours,
  loadUserPrefs,
  normalizePrefs,
  pushSuppressionReason,
  resolvePushPresentation,
  shouldDeliverEmail,
  shouldDeliverCategory,
  type NotificationCategory,
  type QuietHours,
} from "@/lib/services/notification-prefs";
import {
  latencyBucket,
  recordDeliveries,
  type DeliveryRecord,
} from "@/lib/services/notification-deliveries";
import { analyticsTag } from "@/lib/services/product-event-log";
import { resolveSettledNotificationsForUser } from "@/lib/services/notification-resolution";
import { catalogEntry } from "@/lib/notification-catalog";

/**
 * Defers a push send past the response without letting the serverless
 * function freeze mid-send. A bare `void promise` races the APNs round-trip
 * against Vercel suspending the lambda once the response is written — pushes
 * were silently dropped whenever APNs lost that race. `after()` keeps the
 * function alive until the promise settles.
 */
export function deferPush(task: Promise<void>): void {
  try {
    after(task);
  } catch {
    // Outside a request scope (tests, scripts) — detach; the task never rejects.
    void task;
  }
}

export type PushMessage = {
  title: string;
  /** The booking, event, or item the alert is about, shown under the title. */
  subtitle?: string | null;
  /**
   * The push body. With a subtitle this should be the short next step; the
   * inbox row keeps its own self-contained body for clients without subtitles.
   */
  body?: string | null;
  payload?: Record<string, unknown>;
  category?: NotificationCategory;
  /** The inbox row this push announces, so the device can clear or mark it. */
  notificationId?: string;
  /**
   * A later push with the same key replaces this one on the device instead of
   * stacking, e.g. one alert per checkout as reminders escalate. Defaults to
   * the inbox row id, so unrelated alerts never replace each other.
   */
  collapseId?: string;
  /** Overrides the category's action set, e.g. no Approve on a decided review. */
  apnsCategory?: string;
  /**
   * Deliver silently overnight (see `OVERNIGHT`) whatever the recipient's
   * settings. For staff follow-ups nobody can act on at 3 AM; the person
   * holding the gear is never sent this flag.
   */
  quietOvernight?: boolean;
};

/** 10 PM to 7 AM Central, every night. */
export const OVERNIGHT: QuietHours = { enabled: true, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6], allowUrgent: false };

/** One Notification Center stack per checkout or event; otherwise per category. */
export function pushThreadId(payload: Record<string, unknown> | undefined, category: NotificationCategory | undefined): string {
  const bookingId = typeof payload?.bookingId === "string" ? payload.bookingId : null;
  if (bookingId) return `booking-${bookingId}`;
  const eventId = typeof payload?.eventId === "string" ? payload.eventId : null;
  if (eventId) return `event-${eventId}`;
  return category ?? "general";
}

export async function sendPushToUser(userId: string, opts: PushMessage): Promise<void> {
  // Never throws: callers fire-and-forget with `void`, and an unhandled
  // rejection is fatal in modern Node — push is best-effort by design.
  // Every outcome for an inbox row lands in the delivery ledger.
  const ledger: DeliveryRecord[] = [];
  const record = (entry: Omit<DeliveryRecord, "notificationId" | "category">) => {
    if (opts.notificationId) {
      ledger.push({ notificationId: opts.notificationId, category: opts.category ?? null, ...entry });
    }
  };
  try {
    const prefs = await loadUserPrefs(userId);
    const now = new Date();
    let presentation = resolvePushPresentation(prefs, opts.category, now);
    if (!presentation) {
      record({ channel: "apns", outcome: "suppressed", reason: pushSuppressionReason(prefs, opts.category, now) });
      return;
    }
    const overnight = Boolean(opts.quietOvernight) && presentation.sound && isInQuietHours(OVERNIGHT, now);
    if (overnight) presentation = { interruptionLevel: "passive", sound: false };
    const silentReason = presentation.sound
      ? null
      : overnight ? "overnight" : isInQuietHours(prefs.quietHours, now) ? "quiet_hours" : "level_silent";

    // Keep native APNs tokens and browser subscriptions on their own delivery
    // paths. The web sender is best-effort and has its own failure boundary, so
    // missing VAPID configuration never suppresses iOS delivery.
    const payloadType = typeof opts.payload?.type === "string" ? opts.payload.type : undefined;
    const payload = withNotificationHref(
      {
        ...opts.payload,
        ...(opts.notificationId ? { notificationId: opts.notificationId } : {}),
        // Lets the device tag its open/action telemetry without the title.
        ...(opts.category ? { category: analyticsTag(opts.category) } : {}),
      },
      payloadType,
    );
    const [tokens, webDeliveries] = await Promise.all([
      db.deviceToken.findMany({
        where: {
          userId,
          platform: "IOS",
          revokedAt: null,
          user: { active: true },
        },
        select: { token: true },
      }),
      // Browser notifications have no subtitle line; lead the body with it.
      sendWebPushToUsers([userId], {
        title: opts.title,
        body: opts.subtitle ? [opts.subtitle, opts.body].filter(Boolean).join(" · ") : opts.body,
        payload,
        silent: !presentation.sound,
        // Same replace-in-place key as iOS; re-alert only when it's urgent.
        tag: opts.collapseId ?? opts.notificationId,
        renotify: opts.category === "checkoutOverdue",
      }),
    ]);
    const web = webDeliveries.get(userId);
    if (web && web.devices > 0) {
      record(web.delivered > 0
        ? { channel: "web", outcome: silentReason ? "sent_silent" : "sent", reason: silentReason }
        : { channel: "web", outcome: web.revoked > 0 ? "bad_token" : "error", reason: web.revoked > 0 ? "expired" : null });
    }
    if (tokens.length === 0) {
      if (!web || web.devices === 0) record({ channel: "apns", outcome: "no_device" });
      return;
    }

    // Producers write the inbox row before pushing, so this count includes it.
    // The icon badge is this number, so settled rows must not inflate it.
    await resolveSettledNotificationsForUser(userId);
    const unreadCount = await db.notification.count({ where: { userId, readAt: null } });
    const entry = opts.category ? catalogEntry(opts.category) : null;

    const dispatchStartedAt = Date.now();
    const { revoked, ok: accepted } = await sendPush(
      tokens.map((t) => t.token),
      {
        title: opts.title,
        subtitle: opts.subtitle ?? undefined,
        body: opts.body ?? "",
        payload,
        // Selects the native long-press action set (Mark as Read everywhere,
        // plus snooze, acknowledge, or Approve/Decline where they apply).
        category: opts.apnsCategory ?? entry?.apnsCategory,
        interruptionLevel: presentation.interruptionLevel,
        sound: presentation.sound,
        threadId: pushThreadId(opts.payload, opts.category),
        badge: unreadCount,
        relevanceScore: entry?.relevance,
        filterCriteria: entry?.group,
        collapseId: opts.collapseId ?? opts.notificationId,
      }
    );
    const latency = latencyBucket(Date.now() - dispatchStartedAt);
    if (accepted > 0) {
      record({ channel: "apns", outcome: silentReason ? "sent_silent" : "sent", reason: silentReason, latencyBucket: latency });
    } else if (revoked.length === tokens.length) {
      record({ channel: "apns", outcome: "bad_token", latencyBucket: latency });
    } else {
      record({ channel: "apns", outcome: "error", latencyBucket: latency });
    }

    if (revoked.length > 0) {
      await db.deviceToken.updateMany({
        where: { token: { in: revoked } },
        data: { revokedAt: new Date() },
      });
    }
  } catch (err) {
    console.error(`[NOTIFY] Push to user ${userId} failed:`, err);
    record({ channel: "apns", outcome: "error", reason: "exception" });
  } finally {
    await recordDeliveries(ledger);
  }
}

/**
 * Email wrapper that consults the user's notification prefs.
 * Pass null `userId` for system emails that should always send (e.g. password reset).
 */
export async function sendEmailToUser(
  userId: string | null,
  args: Parameters<typeof sendEmail>[0],
  category?: NotificationCategory
): Promise<boolean> {
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { active: true, notificationPrefs: true },
    });
    if (!user?.active) return false;
    const prefs = normalizePrefs(user.notificationPrefs);
    if (!shouldDeliverEmail(prefs)) return false;
    if (category && !shouldDeliverCategory(prefs, category)) return false;
  }
  return sendEmail(args);
}

/**
 * Fallback escalation schedule used when no DB rules exist.
 */
export const DEFAULT_SCHEDULE = [
  { hoursFromDue: -2, type: "checkout_due_2h", title: "Due back in 2 hours", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 0 },
  { hoursFromDue: 0, type: "checkout_due_now", title: "Due back now", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 1 },
  { hoursFromDue: 0, type: "checkout_overdue_grace", title: "Checkout overdue", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 2 },
  { hoursFromDue: 4, type: "checkout_overdue_4h", title: "4 hours overdue", notifyRequester: true, notifyAdmins: false, enabled: true, sortOrder: 3 },
  { hoursFromDue: 24, type: "checkout_overdue_24h", title: "1 day overdue", notifyRequester: true, notifyAdmins: true, enabled: true, sortOrder: 4 },
];

export function formatRelative(dueAt: Date, now: Date): string {
  const diffMs = now.getTime() - dueAt.getTime();
  if (diffMs < 0) {
    const hours = Math.round(-diffMs / 3600_000);
    return hours <= 1 ? "in less than an hour" : `in ${hours} hours`;
  }
  const hours = Math.round(diffMs / 3600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}
