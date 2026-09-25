import { db } from "@/lib/db";

/**
 * The notification delivery ledger: one row per outbound attempt for an inbox
 * notification. Writes are best-effort and never fail a send.
 */

export type DeliveryChannel = "apns" | "web" | "email";

export type DeliveryOutcome =
  | "sent"
  | "sent_silent"
  | "suppressed"
  | "no_device"
  | "bad_token"
  | "error";

export type DeliveryRecord = {
  notificationId: string;
  category: string | null;
  channel: DeliveryChannel;
  outcome: DeliveryOutcome;
  reason?: string | null;
  latencyBucket?: string | null;
};

export const DELIVERY_RETENTION_DAYS = 180;

export function latencyBucket(ms: number): string {
  if (ms < 1_000) return "under_1s";
  if (ms < 5_000) return "1_5s";
  return "over_5s";
}

export async function recordDeliveries(rows: DeliveryRecord[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.notificationDelivery.createMany({
      data: rows.map((row) => ({
        notificationId: row.notificationId,
        category: row.category,
        channel: row.channel,
        outcome: row.outcome,
        reason: row.reason ?? null,
        latencyBucket: row.latencyBucket ?? null,
      })),
    });
  } catch (err) {
    console.error("[NOTIFY] Failed to record delivery outcomes:", err);
  }
}

/** Deletes ledger rows past retention; run from the morning-refresh cron. */
export async function pruneNotificationDeliveries(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await db.notificationDelivery.deleteMany({ where: { occurredAt: { lt: cutoff } } });
  return count;
}
