-- When a check-in report's evidence last changed.
--
-- A kiosk can update an existing report with new evidence. created_at stays
-- the first report; last_reported_at moves with each update so the
-- dashboard's 30-day window and the item page's recent list surface the new
-- evidence. Existing rows start at their created_at.

ALTER TABLE "checkin_item_reports"
    ADD COLUMN "last_reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "checkin_item_reports" SET "last_reported_at" = "created_at";
