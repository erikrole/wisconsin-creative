-- AlterTable
ALTER TABLE "users" ADD COLUMN     "radio_clip_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "radio_clip_authorizations" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "parent_session_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radio_clip_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radio_clip_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "parent_session_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radio_clip_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "radio_clip_authorizations_code_hash_key" ON "radio_clip_authorizations"("code_hash");

-- CreateIndex
CREATE INDEX "radio_clip_authorizations_parent_session_id_idx" ON "radio_clip_authorizations"("parent_session_id");

-- CreateIndex
CREATE INDEX "radio_clip_authorizations_expires_at_idx" ON "radio_clip_authorizations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "radio_clip_sessions_token_hash_key" ON "radio_clip_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "radio_clip_sessions_parent_session_id_idx" ON "radio_clip_sessions"("parent_session_id");

-- CreateIndex
CREATE INDEX "radio_clip_sessions_expires_at_idx" ON "radio_clip_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "radio_clip_authorizations" ADD CONSTRAINT "radio_clip_authorizations_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radio_clip_sessions" ADD CONSTRAINT "radio_clip_sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

