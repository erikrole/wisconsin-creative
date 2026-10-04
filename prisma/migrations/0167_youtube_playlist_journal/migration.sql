-- CreateTable
CREATE TABLE "youtube_playlist_additions" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "video_title" TEXT NOT NULL,
    "playlist" JSONB NOT NULL,
    "playlist_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "membership" JSONB,
    "failure_message" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_playlist_additions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "youtube_playlist_additions_video_id_created_at_idx" ON "youtube_playlist_additions"("video_id", "created_at" DESC);
