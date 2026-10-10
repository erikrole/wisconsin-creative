-- CreateTable
CREATE TABLE "youtube_library_videos" (
    "video_id" TEXT NOT NULL,
    "live" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "thumbnail_url" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_library_videos_pkey" PRIMARY KEY ("video_id")
);

-- CreateTable
CREATE TABLE "youtube_review_drafts" (
    "video_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "matched_title" TEXT,
    "matched_game" JSONB,
    "recap" JSONB,
    "selected_sentence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edited_title" TEXT,
    "edited_description" TEXT,
    "manual_source" BOOLEAN NOT NULL DEFAULT false,
    "manual_video" BOOLEAN NOT NULL DEFAULT false,
    "conference_kind" TEXT,
    "speaker_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planned_playlist_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_kind" TEXT,
    "game_choices" JSONB,
    "hold" TEXT,
    "prepared_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_review_drafts_pkey" PRIMARY KEY ("video_id")
);

-- CreateTable
CREATE TABLE "youtube_library_state" (
    "channel_id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3),
    "reached_limit" BOOLEAN NOT NULL DEFAULT false,
    "last_failure" TEXT,
    "playlists" JSONB NOT NULL DEFAULT '[]',
    "playlist_members" JSONB NOT NULL DEFAULT '{}',
    "playlist_failure" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_library_state_pkey" PRIMARY KEY ("channel_id")
);

-- CreateIndex
CREATE INDEX "youtube_library_videos_published_at_idx" ON "youtube_library_videos"("published_at");
