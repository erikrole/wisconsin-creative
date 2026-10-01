-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deactivated_at" TIMESTAMP(3);

-- Backfill: accounts that are already inactive have no recorded date. Their last update is the
-- closest record, and it can only be later than the true deactivation, so using it keeps their
-- applicant data a little longer rather than purging it early.
UPDATE "users" SET "deactivated_at" = "updated_at" WHERE "active" = false AND "deactivated_at" IS NULL;
