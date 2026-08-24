-- Scoreboard-only participation records.
--
-- An admin can credit a person for an event -- past or future -- without
-- creating a shift, an assignment, or a notification. Scoreboard totals,
-- profile records, and worked-event counts read this table alongside active
-- shift assignments; Schedule, published crews, My Shifts, trades, and ICS do
-- not. The unique pair keeps one credit per person per event, so a credit can
-- never multiply a person's stats the way a second shift never does.

CREATE TABLE "event_credits" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_credits_event_id_user_id_key" ON "event_credits"("event_id", "user_id");
CREATE INDEX "event_credits_user_id_idx" ON "event_credits"("user_id");
CREATE INDEX "event_credits_event_id_idx" ON "event_credits"("event_id");

ALTER TABLE "event_credits" ADD CONSTRAINT "event_credits_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_credits" ADD CONSTRAINT "event_credits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_credits" ADD CONSTRAINT "event_credits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
