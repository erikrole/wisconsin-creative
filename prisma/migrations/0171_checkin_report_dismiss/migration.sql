-- Dismissable damage flags.
--
-- Staff or admin can dismiss a check-in damage report from the dashboard
-- banner. The row stays in the item's history; dismissed_at only hides it
-- from the dashboard's recent-flags list. Nulled dismissed_by_id on user
-- deletion keeps the dismissal timestamp.

ALTER TABLE "checkin_item_reports"
    ADD COLUMN "dismissed_at" TIMESTAMP(3),
    ADD COLUMN "dismissed_by_id" TEXT;

ALTER TABLE "checkin_item_reports"
    ADD CONSTRAINT "checkin_item_reports_dismissed_by_id_fkey"
    FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
