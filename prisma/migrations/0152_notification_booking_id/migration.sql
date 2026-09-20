-- Notification.booking_id: a real, indexed column for booking-scoped notifications.
--
-- Why: the overdue repair sweep (processOverdueNotifications in
-- src/lib/services/notifications.ts) used to look up existing escalation rows with
-- `OR: bookingIds.map(id => ({ dedupeKey: { startsWith: `${id}:` } }))` — up to 500
-- LIKE branches in one query. With this column the same lookup becomes
-- `bookingId: { in: bookingIds }`, a single index scan.
--
-- No foreign key on purpose: draft bookings are hard-deleted
-- (src/app/api/drafts/[id]/route.ts, src/lib/services/bookings-lifecycle.ts) and a
-- delivered notification is history that must outlive the booking. The nullable,
-- FK-less column behaves like the repo's optional `onDelete: SetNull` booking links
-- without adding a cascade path or a Booking back-relation.

ALTER TABLE "notifications" ADD COLUMN "booking_id" TEXT;

CREATE INDEX "notifications_booking_id_idx" ON "notifications"("booking_id");

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every booking-scoped `dedupeKey` producer found in src/lib/services/*.ts,
-- src/lib/*.ts and the API routes, with its exact format:
--
--   A. `<bookingId>:<dueAtISO>:<type>:<recipientKind>:<recipientId>`
--      checkoutEscalationDedupeKey() in src/lib/checkout-escalation-policy.ts,
--      used by persistCheckoutEscalation() in src/lib/services/notifications.ts.
--      The ISO due-date contains colons, so segment 2 of the key is `YYYY-MM-DDTHH`.
--   B. `<bookingId>:reservation_<booked|updated|pickup_ready|cancelled>`
--      createReservationLifecycleNotification() in src/lib/services/notifications.ts.
--   C. `<bookingId>:item_report:<assetId>:<userId>`
--      notifyItemReport() in src/lib/services/notifications.ts.
--   D. `nudge-<bookingId>-<YYYY-MM-DDTHH>`
--      POST /api/bookings/[id]/nudge (src/app/api/bookings/[id]/nudge/route.ts).
--
-- Booking ids are cuids and never contain `:` or the `-YYYY-MM-DDTHH` suffix shape,
-- so each pattern below is unambiguous. Non-booking key families
-- (`shift:`, `shift_group_*:`, `schedule_*:`, `published_schedule:`, `low_stock:`,
-- `blast:`, `availability:`, `collaborator_policy:`, `firmware_release:`,
-- `calendar_sync_failure:`, `badge_awarded_*`, `trade_*`, `license-*`) are left NULL.

-- A. checkout escalation stages
UPDATE "notifications"
SET "booking_id" = split_part("dedupe_key", ':', 1)
WHERE "booking_id" IS NULL
  AND "dedupe_key" IS NOT NULL
  AND split_part("dedupe_key", ':', 1) <> ''
  AND split_part("dedupe_key", ':', 2) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$';

-- B. reservation lifecycle
UPDATE "notifications"
SET "booking_id" = split_part("dedupe_key", ':', 1)
WHERE "booking_id" IS NULL
  AND "dedupe_key" ~ '^[^:]+:reservation_(booked|updated|pickup_ready|cancelled)$';

-- C. check-in item damage/loss reports
UPDATE "notifications"
SET "booking_id" = split_part("dedupe_key", ':', 1)
WHERE "booking_id" IS NULL
  AND "dedupe_key" ~ '^[^:]+:item_report:';

-- D. manual overdue nudges
UPDATE "notifications"
SET "booking_id" = regexp_replace("dedupe_key", '^nudge-(.+)-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$', '\1')
WHERE "booking_id" IS NULL
  AND "dedupe_key" ~ '^nudge-.+-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$';

-- Safety net: rows whose dedupe_key predates one of the formats above (or is NULL)
-- but whose payload already recorded the booking. Every producer above writes
-- `payload.bookingId`, so this only widens coverage and never contradicts A–D.
UPDATE "notifications"
SET "booking_id" = "payload" ->> 'bookingId'
WHERE "booking_id" IS NULL
  AND "payload" ? 'bookingId'
  AND jsonb_typeof("payload" -> 'bookingId') = 'string'
  AND "payload" ->> 'bookingId' <> '';
