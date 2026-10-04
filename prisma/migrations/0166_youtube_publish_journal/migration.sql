-- CreateTable
CREATE TABLE "youtube_publish_records" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "undo_of" TEXT,
    "phase" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "read_back" JSONB,
    "source_url" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "failure_message" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_publish_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "youtube_publish_records_video_id_created_at_idx" ON "youtube_publish_records"("video_id", "created_at" DESC);
