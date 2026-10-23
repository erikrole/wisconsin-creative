-- Invite emails carry a one-time sign-up token; registration requires it.
ALTER TABLE "allowed_emails"
  ADD COLUMN "invite_token_hash" TEXT,
  ADD COLUMN "invite_token_issued_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "allowed_emails_invite_token_hash_key" ON "allowed_emails"("invite_token_hash");
