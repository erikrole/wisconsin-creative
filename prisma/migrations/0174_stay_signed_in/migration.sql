-- Sessions slide on activity; `persistent` records whether the sign-in asked to be remembered,
-- which picks the idle window (30 days vs 12 hours) the slide extends to.
-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT false;

-- Automatic passkey upgrades (conditional create right after a password sign-in)
-- do not show a prompt, so the authenticator may skip user verification at
-- enrollment. The ceremony records that so only those registrations relax it.
-- AlterTable
ALTER TABLE "passkey_challenges" ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false;
