-- Creative Wrapped: one frozen recap per person per season.
--
-- The recap is generated from durable sources (game_snapshots, assignments,
-- bookings, trades, badges) the first time a person opens it after unlock,
-- then read back unchanged. No foreign key to users: a recap is a small JSON
-- payload keyed by id, and admins can delete a row to regenerate it.

-- CreateTable
CREATE TABLE "wrapped_recaps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "season_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wrapped_recaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wrapped_recaps_user_id_season_key_key" ON "wrapped_recaps"("user_id", "season_key");
