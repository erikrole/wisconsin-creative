-- CreateEnum
CREATE TYPE "GameResultProvider" AS ENUM ('UW', 'ESPN');

-- CreateTable
CREATE TABLE "game_result_observations" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider" "GameResultProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "last_attempt_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,

    CONSTRAINT "game_result_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_result_observations_event_id_provider_key" ON "game_result_observations"("event_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "game_result_observations_provider_external_id_key" ON "game_result_observations"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "game_result_observations" ADD CONSTRAINT "game_result_observations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

