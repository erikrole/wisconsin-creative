-- Staff can override imported event times the same way they lock title,
-- type, and pickup location. Sync keeps writing the calendar window into
-- the raw_* columns so Restore calendar value can put the feed back.
ALTER TABLE "calendar_events"
ADD COLUMN "raw_starts_at" TIMESTAMP(3),
ADD COLUMN "raw_ends_at" TIMESTAMP(3),
ADD COLUMN "raw_all_day" BOOLEAN,
ADD COLUMN "timing_locked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "calendar_events"
SET
  "raw_starts_at" = "starts_at",
  "raw_ends_at" = "ends_at",
  "raw_all_day" = "all_day"
WHERE "source_id" IS NOT NULL;
