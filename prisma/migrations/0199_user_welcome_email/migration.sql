-- When the one-time "you're set up" email went out, so it is sent once per person.
-- Accounts that exist when this ships are marked as sent so only new people get it.
ALTER TABLE "users" ADD COLUMN "welcome_email_sent_at" TIMESTAMP(3);
UPDATE "users" SET "welcome_email_sent_at" = NOW();
