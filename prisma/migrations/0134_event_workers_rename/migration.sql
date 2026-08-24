-- Preserve the applied 0131_event_credits migration and move its table to the
-- event-worker vocabulary without recreating or copying any rows.

ALTER TABLE "event_credits" RENAME TO "event_workers";
ALTER TABLE "event_workers" RENAME COLUMN "created_by_id" TO "added_by_id";

ALTER TABLE "event_workers" RENAME CONSTRAINT "event_credits_pkey" TO "event_workers_pkey";
ALTER TABLE "event_workers" RENAME CONSTRAINT "event_credits_event_id_fkey" TO "event_workers_event_id_fkey";
ALTER TABLE "event_workers" RENAME CONSTRAINT "event_credits_user_id_fkey" TO "event_workers_user_id_fkey";
ALTER TABLE "event_workers" RENAME CONSTRAINT "event_credits_created_by_id_fkey" TO "event_workers_added_by_id_fkey";

ALTER INDEX "event_credits_event_id_user_id_key" RENAME TO "event_workers_event_id_user_id_key";
ALTER INDEX "event_credits_user_id_idx" RENAME TO "event_workers_user_id_idx";
ALTER INDEX "event_credits_event_id_idx" RENAME TO "event_workers_event_id_idx";

-- The production deployment that applied 0131 still uses the old Prisma model
-- while this migration runs during the next build. A simple PostgreSQL view is
-- automatically updatable, so old reads and writes continue to reach the
-- renamed base table until the event-worker application code is deployed.
CREATE VIEW "event_credits" AS
SELECT
    "id",
    "event_id",
    "user_id",
    "note",
    "added_by_id" AS "created_by_id",
    "created_at",
    "updated_at"
FROM "event_workers";
