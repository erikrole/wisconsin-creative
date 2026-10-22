-- Existing accounts retain their current access and reminder policy. New
-- internal registrations opt in; FINISH records their shared completion.
ALTER TABLE "users"
  ADD COLUMN "onboarding_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
