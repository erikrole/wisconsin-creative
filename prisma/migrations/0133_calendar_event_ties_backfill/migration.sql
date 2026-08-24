-- Backfill only rows whose captured source title explicitly says [T].
-- This is a separate migration from the enum alteration so the new enum value
-- is committed before it is used, including on transactional Postgres runners.

UPDATE "calendar_events"
SET "result" = 'TIE'::"CalendarEventResult"
WHERE "result" IS NULL
  AND "source_id" IS NOT NULL
  AND "raw_summary" ~* '^\s*\[T\](\s|$)';
