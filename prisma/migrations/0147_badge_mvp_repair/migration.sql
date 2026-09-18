-- Repair two catalog rows that reseeding or the v8 seed copy could make
-- unreachable, then add two reservation-first automatic badges that the
-- evaluator already counts.

-- `category_collector` was converted from a manual rule in 0100. Production
-- kept the original rule_key, but `prisma/seed.mjs` omitted it, so a reseed
-- would null the key and the measured-rule award path would never match.
UPDATE "badge_definitions"
SET "rule_key" = 'category_collector'
WHERE "key" = 'category_collector'
  AND ("rule_key" IS NULL OR "rule_key" <> 'category_collector');

-- The rule is binary (home + away + neutral wins = 1). Seed copied threshold 3
-- while migration 0127 correctly used 1.
UPDATE "badge_definitions"
SET "threshold" = 1
WHERE "key" = 'result_site_sweep'
  AND ("threshold" IS NULL OR "threshold" <> 1);

INSERT INTO "badge_definitions" (
  "id", "key", "name", "description", "icon",
  "category", "kind", "trigger", "threshold", "rule_key", "active", "sort_order"
)
VALUES
  (
    'seed_badge_plan_ahead',
    'plan_ahead',
    'Plan Ahead',
    'Picked up five reservations at the counter.',
    'CalendarCheck2',
    'MILESTONE'::"BadgeCategory",
    'COUNT'::"BadgeKind",
    'checkout:opened',
    5,
    'checkout_from_reservation',
    true,
    1500
  ),
  (
    'seed_badge_crew_checkout',
    'crew_checkout',
    'Crew Checkout',
    'Opened five checkouts tied to a scheduled crew assignment.',
    'PackageCheck',
    'MILESTONE'::"BadgeCategory",
    'COUNT'::"BadgeKind",
    'checkout:opened',
    5,
    'checkout_for_shift',
    true,
    1510
  )
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "category" = EXCLUDED."category",
  "kind" = EXCLUDED."kind",
  "trigger" = EXCLUDED."trigger",
  "threshold" = EXCLUDED."threshold",
  "rule_key" = EXCLUDED."rule_key",
  "active" = EXCLUDED."active",
  "sort_order" = EXCLUDED."sort_order";

-- Backfill from immutable checkout-open receipts, matching the evaluator's
-- PERSON custody boundary and credited booking contents.
WITH credited_bookings AS (
  SELECT
    r."user_id",
    b."id" AS booking_id,
    b."source_reservation_id",
    b."shift_assignment_id"
  FROM "badge_event_receipts" r
  JOIN "bookings" b ON b."id" = r."source_key"
  WHERE r."event_type" = 'checkout_opened'
    AND b."kind" = 'CHECKOUT'::"BookingKind"
    AND b."custody_scope" = 'PERSON'::"BookingCustodyScope"
    AND b."status" IN ('OPEN'::"BookingStatus", 'COMPLETED'::"BookingStatus")
), credited_categories AS (
  SELECT DISTINCT c."user_id", a."category_id"
  FROM credited_bookings c
  JOIN "booking_serialized_items" i ON i."booking_id" = c.booking_id
  JOIN "assets" a ON a."id" = i."asset_id"
  WHERE a."category_id" IS NOT NULL
  UNION
  SELECT DISTINCT c."user_id", s."category_id"
  FROM credited_bookings c
  JOIN "booking_bulk_items" i ON i."booking_id" = c.booking_id
  JOIN "bulk_skus" s ON s."id" = i."bulk_sku_id"
  WHERE i."checked_out_quantity" > 0 AND s."category_id" IS NOT NULL
), rule_counts AS (
  SELECT c."user_id", 'category_collector' AS rule_key, COUNT(DISTINCT c."category_id")::int AS total
  FROM credited_categories c
  GROUP BY c."user_id"
  UNION ALL
  SELECT c."user_id", 'checkout_from_reservation', COUNT(*)::int
  FROM credited_bookings c
  WHERE c."source_reservation_id" IS NOT NULL
  GROUP BY c."user_id"
  UNION ALL
  SELECT c."user_id", 'checkout_for_shift', COUNT(*)::int
  FROM credited_bookings c
  WHERE c."shift_assignment_id" IS NOT NULL
  GROUP BY c."user_id"
)
INSERT INTO "student_badges" ("id", "user_id", "definition_id")
SELECT 'badge_backfill_' || md5(c."user_id" || ':' || d."id"), c."user_id", d."id"
FROM rule_counts c
JOIN "badge_definitions" d
  ON d."active" = true
  AND d."trigger" = 'checkout:opened'
  AND d."rule_key" = c.rule_key
  AND d."threshold" <= c.total
ON CONFLICT ("user_id", "definition_id") DO NOTHING;
