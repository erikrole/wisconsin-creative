-- Preserve each imported CalendarEvent while allowing one source event to use
-- another event as its operational Schedule/crew parent.
ALTER TABLE "calendar_events"
ADD COLUMN "combined_into_id" TEXT;

ALTER TABLE "calendar_events"
ADD CONSTRAINT "calendar_events_combined_into_id_fkey"
FOREIGN KEY ("combined_into_id") REFERENCES "calendar_events"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "calendar_events_combined_into_id_idx"
ON "calendar_events"("combined_into_id");
