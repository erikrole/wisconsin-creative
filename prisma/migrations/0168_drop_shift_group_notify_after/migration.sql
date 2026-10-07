-- The unused schedule flush/debounce pipeline was deleted 2026-09-23
-- (AREA_NOTIFICATIONS). These ShiftGroup columns only stored pending flush
-- state and are no longer read or written for delivery. Drop them so the
-- live catalog matches the schema after the code cleanup in the same slice.
ALTER TABLE "shift_groups" DROP COLUMN IF EXISTS "notify_after";
ALTER TABLE "shift_groups" DROP COLUMN IF EXISTS "notify_attempted_at";
ALTER TABLE "shift_groups" DROP COLUMN IF EXISTS "notify_error";
