-- Game snapshots for Scoreboard season replay and the December recap.
--
-- morning-refresh writes one row per finished season game: when it was, who
-- was on crew, and every result it has had. Live rows can change after the
-- fact (shift slots removed, admin-added workers removed, sources deleted,
-- results corrected, events archived), and audit logs are pruned after 90
-- days, so this table is the durable record. No foreign key to calendar_events
-- on purpose: a snapshot outlives a deleted event.

-- CreateTable
CREATE TABLE "game_snapshots" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "season_key" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "sport_code" TEXT,
    "opponent" TEXT,
    "site" "CalendarEventSite",
    "venue" TEXT,
    "title" TEXT NOT NULL,
    "raw_summary" TEXT,
    "status" "CalendarEventStatus" NOT NULL,
    "official" BOOLEAN NOT NULL,
    "result" "CalendarEventResult",
    "result_recorded_at" TIMESTAMP(3),
    "result_history" JSONB NOT NULL DEFAULT '[]',
    "crew" JSONB NOT NULL DEFAULT '[]',
    "crew_count" INTEGER NOT NULL DEFAULT 0,
    "event_deleted_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_snapshots_event_id_key" ON "game_snapshots"("event_id");

-- CreateIndex
CREATE INDEX "game_snapshots_season_key_starts_at_idx" ON "game_snapshots"("season_key", "starts_at");
