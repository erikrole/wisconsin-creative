import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Marks inbox rows read once the thing they asked about is settled, so the
 * unread count (web bell, iOS icon badge) counts work that is still open
 * instead of every reminder ever sent.
 *
 * Before this, production inboxes averaged 40+ unread rows: "Due back in 2
 * hours" for gear returned weeks ago, review requests another Admin already
 * decided, reminders for shifts that already happened. A row is settled when:
 *
 * - its checkout or reservation is no longer active (returned, picked up,
 *   cancelled, or deleted), or it is the receipt for a reservation the person
 *   made themselves;
 * - its event has ended, been cancelled, or been deleted (schedule, trade,
 *   reminder, and review rows), or a newer "Schedule ready/updated" row for
 *   the same event replaced it;
 * - it is a "Gear up" nudge and the person has since reserved or checked out
 *   gear for that shift or event;
 * - the request or trade claim it asks someone to review, or tells the
 *   claimant is waiting, is no longer pending;
 * - a bulk "new shifts" row's date range is over;
 * - a badge row is more than two weeks old (badges never push, so they only
 *   inflate the count).
 *
 * Damaged/lost item reports, license, firmware, calendar-health, blast, and
 * error rows are left alone: someone still has to look at those.
 *
 * Read state is the only thing touched. Rows stay in the inbox, and a settled
 * row someone wants back can still be marked unread.
 */

const SETTLED_BADGE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const BOOKING_ROW_TYPES = [
  "overdue_nudge",
  "reservation_booked",
  "reservation_updated",
  "reservation_pickup_ready",
  "kiosk_checkout_handover",
];
const REQUEST_REVIEW_TYPES = ["shift_request_review", "shift_request_pending", "claim_review_escalated", "claim_review_blocked"];
const TRADE_REVIEW_TYPES = ["trade_review_required", "trade_claim_pending", "claim_review_escalated", "claim_review_blocked"];

export async function resolveSettledNotifications(args: { userId?: string; now?: Date } = {}): Promise<number> {
  const now = args.now ?? new Date();
  const badgeCutoff = new Date(now.getTime() - SETTLED_BADGE_AGE_MS);
  const userFilter = args.userId ? Prisma.sql`AND n."user_id" = ${args.userId}` : Prisma.empty;

  return db.$executeRaw`
    UPDATE "notifications" AS n
    SET "read_at" = ${now}
    WHERE n."read_at" IS NULL
      ${userFilter}
      AND (
        (
          (n."type" LIKE 'checkout\\_%' OR n."type" IN (${Prisma.join(BOOKING_ROW_TYPES)}))
          AND n."booking_id" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "bookings" AS b
            WHERE b."id" = n."booking_id"
              AND b."status" IN ('BOOKED', 'PENDING_PICKUP', 'OPEN')
              AND NOT (n."type" = 'reservation_booked' AND b."created_by" = n."user_id")
          )
        )
        OR (
          (n."type" LIKE 'shift\\_%' OR n."type" LIKE 'trade\\_%' OR n."type" LIKE 'claim\\_review\\_%' OR n."type" = 'published_schedule_updated')
          AND n."payload"->>'eventId' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "calendar_events" AS e
            WHERE e."id" = n."payload"->>'eventId'
              AND e."ends_at" > ${now}
              AND e."status" <> 'CANCELLED'
          )
        )
        OR (
          n."type" IN (${Prisma.join(REQUEST_REVIEW_TYPES)})
          AND n."payload"->>'tradeId' IS NULL
          AND n."payload"->>'assignmentId' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "shift_assignments" AS a
            WHERE a."id" = n."payload"->>'assignmentId' AND a."status" = 'REQUESTED'
          )
        )
        OR (
          n."type" IN (${Prisma.join(TRADE_REVIEW_TYPES)})
          AND n."payload"->>'tradeId' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "shift_trades" AS t
            WHERE t."id" = n."payload"->>'tradeId' AND t."status" = 'CLAIMED'
          )
        )
        OR (
          n."type" IN ('shift_schedule_published', 'shift_schedule_updated')
          AND EXISTS (
            SELECT 1 FROM "notifications" AS newer
            WHERE newer."user_id" = n."user_id"
              AND newer."type" IN ('shift_schedule_published', 'shift_schedule_updated')
              AND newer."payload"->>'eventId' = n."payload"->>'eventId'
              AND newer."created_at" > n."created_at"
          )
        )
        OR (
          n."type" = 'shift_gear_up'
          AND EXISTS (
            SELECT 1 FROM "bookings" AS b
            WHERE b."requester_user_id" = n."user_id"
              AND b."status" IN ('BOOKED', 'PENDING_PICKUP', 'OPEN', 'COMPLETED')
              AND (
                b."shift_assignment_id" = n."payload"->>'assignmentId'
                OR EXISTS (
                  SELECT 1 FROM "booking_events" AS be
                  WHERE be."booking_id" = b."id" AND be."event_id" = n."payload"->>'eventId'
                )
              )
          )
        )
        OR (
          n."type" = 'shift_schedule_bulk_assigned'
          AND CASE
            WHEN n."payload"->>'endDate' ~ '^\\d{4}-\\d{2}-\\d{2}T'
              THEN ((n."payload"->>'endDate')::timestamptz AT TIME ZONE 'UTC') < ${now}
            ELSE false
          END
        )
        OR (n."type" = 'badge_awarded' AND n."created_at" < ${badgeCutoff})
      )
  `;
}

/**
 * Per-person variant for read paths (unread count, inbox, push badge). Never
 * throws: a failed cleanup must not break the count it runs in front of.
 */
export async function resolveSettledNotificationsForUser(userId: string, now?: Date): Promise<void> {
  try {
    await resolveSettledNotifications({ userId, now });
  } catch (error) {
    console.error(`[NOTIFY] Failed to settle notifications for user ${userId}:`, error);
  }
}
