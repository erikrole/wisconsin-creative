import * as webpush from "web-push";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;
const WEB_PUSH_TIMEOUT_MS = 5_000;

export type WebPushMessage = {
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
};

export type WebPushDelivery = {
  devices: number;
  delivered: number;
  revoked: number;
};

type StoredSubscription = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function emptyDelivery(): WebPushDelivery {
  return { devices: 0, delivered: 0, revoked: 0 };
}

function readConfiguration(): {
  subject: string;
  publicKey: string;
  privateKey: string;
} | null {
  const subject = env.webPushSubject;
  const publicKey = env.webPushVapidPublicKey;
  const privateKey = env.webPushVapidPrivateKey;
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export function isWebPushConfigured(): boolean {
  return readConfiguration() !== null;
}

export function getWebPushPublicKey(): string | null {
  return readConfiguration()?.publicKey ?? null;
}

function isExpiredSubscription(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

function notificationUrl(payload: Record<string, unknown> | undefined): string {
  const candidate = payload?.url;
  return typeof candidate === "string" && candidate.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/notifications";
}

function mergeDelivery(
  deliveries: Map<string, WebPushDelivery>,
  userId: string,
  patch: Partial<WebPushDelivery>,
): void {
  const current = deliveries.get(userId) ?? emptyDelivery();
  deliveries.set(userId, {
    devices: current.devices + (patch.devices ?? 0),
    delivered: current.delivered + (patch.delivered ?? 0),
    revoked: current.revoked + (patch.revoked ?? 0),
  });
}

/**
 * Sends a browser push to all active browser subscriptions for the users.
 * Missing VAPID configuration is an intentional no-op, so enabling the web
 * app never disables the existing iOS delivery path during rollout.
 */
export async function sendWebPushToUsers(
  userIds: string[],
  message: WebPushMessage,
): Promise<Map<string, WebPushDelivery>> {
  const uniqueUserIds = [...new Set(userIds)];
  const deliveries = new Map(uniqueUserIds.map((userId) => [userId, emptyDelivery()]));
  const configuration = readConfiguration();
  if (!configuration || uniqueUserIds.length === 0) return deliveries;

  try {
    webpush.setVapidDetails(
      configuration.subject,
      configuration.publicKey,
      configuration.privateKey,
    );

    const subscriptions = await db.webPushSubscription.findMany({
      where: {
        userId: { in: uniqueUserIds },
        revokedAt: null,
        user: { active: true },
      },
      select: { userId: true, endpoint: true, p256dh: true, auth: true },
      orderBy: { lastSeenAt: "desc" },
    });
    if (subscriptions.length === 0) return deliveries;

    const revokedEndpoints: string[] = [];
    const payload = JSON.stringify({
      title: message.title,
      body: message.body ?? "",
      url: notificationUrl(message.payload),
    });

    await Promise.allSettled(subscriptions.map(async (subscription: StoredSubscription) => {
      mergeDelivery(deliveries, subscription.userId, { devices: 1 });
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          {
            TTL: WEB_PUSH_TTL_SECONDS,
            urgency: "high",
            timeout: WEB_PUSH_TIMEOUT_MS,
          },
        );
        mergeDelivery(deliveries, subscription.userId, { delivered: 1 });
      } catch (error) {
        if (isExpiredSubscription(error)) {
          revokedEndpoints.push(subscription.endpoint);
          mergeDelivery(deliveries, subscription.userId, { revoked: 1 });
          return;
        }
        console.error(`[WEB_PUSH] Delivery to ${subscription.endpoint.slice(-24)} failed:`, error);
      }
    }));

    if (revokedEndpoints.length > 0) {
      await db.webPushSubscription.updateMany({
        where: { endpoint: { in: revokedEndpoints } },
        data: { revokedAt: new Date() },
      });
    }
  } catch (error) {
    console.error("[WEB_PUSH] Delivery failed:", error);
  }

  return deliveries;
}

export async function sendWebPushToUser(
  userId: string,
  message: WebPushMessage,
): Promise<WebPushDelivery> {
  const deliveries = await sendWebPushToUsers([userId], message);
  return deliveries.get(userId) ?? emptyDelivery();
}
