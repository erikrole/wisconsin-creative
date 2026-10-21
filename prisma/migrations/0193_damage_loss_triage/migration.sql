-- Damage and loss triage: staff close each serialized-asset report with an
-- outcome (repaired, replaced, written off, found, no issue). A report with
-- no resolution is an open case on the Damage and loss page.

-- CreateEnum
CREATE TYPE "ReportResolution" AS ENUM ('REPAIRED', 'REPLACED', 'WRITTEN_OFF', 'FOUND', 'NO_ISSUE');

-- AlterTable
ALTER TABLE "checkin_item_reports"
  ADD COLUMN "resolution" "ReportResolution",
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolved_by_id" TEXT,
  ADD COLUMN "resolution_note" TEXT;

-- A report can now be filed from the item page, outside any checkout.
ALTER TABLE "checkin_item_reports" ALTER COLUMN "booking_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "checkin_item_reports"
  ADD CONSTRAINT "checkin_item_reports_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "checkin_item_reports_resolved_at_idx" ON "checkin_item_reports"("resolved_at");

-- Backfill so the new queue starts with what is actually open. A damage
-- report whose item is no longer held, or that staff dismissed from the
-- dashboard, was already handled. Missing-item reports stay open unless the
-- asset is retired: those are exactly the cases nobody was tracking.
UPDATE "checkin_item_reports" r
SET "resolution" = CASE WHEN a."status" = 'RETIRED' THEN 'WRITTEN_OFF'::"ReportResolution" ELSE 'NO_ISSUE'::"ReportResolution" END,
    "resolved_at" = COALESCE(r."dismissed_at", r."last_reported_at")
FROM "assets" a
WHERE r."asset_id" = a."id"
  AND r."resolution" IS NULL
  AND (
    a."status" = 'RETIRED'
    OR (r."type" = 'DAMAGED' AND (a."status" <> 'MAINTENANCE' OR r."dismissed_at" IS NOT NULL))
  );

-- Batteries and counted stock join the queue. A numbered-unit report stays open
-- only while that unit is still marked LOST; everything else is closed as handled.
-- Counted-stock reports older than 30 days are closed so the queue starts current.
UPDATE "checkin_item_reports" r
SET "resolution" = 'NO_ISSUE'::"ReportResolution",
    "resolved_at" = r."last_reported_at"
FROM "bulk_sku_units" u
WHERE r."bulk_sku_unit_id" = u."id"
  AND r."resolution" IS NULL
  AND NOT (r."type" = 'LOST' AND u."status" = 'LOST');

UPDATE "checkin_item_reports"
SET "resolution" = 'NO_ISSUE'::"ReportResolution",
    "resolved_at" = "last_reported_at"
WHERE "bulk_sku_id" IS NOT NULL
  AND "bulk_sku_unit_id" IS NULL
  AND "resolution" IS NULL
  AND "last_reported_at" < now() - interval '30 days';
