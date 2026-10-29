-- Admin-ticked onboarding steps on a student's profile ({ [step]: { at, by } }).
-- Nullable and additive: existing rows read as "nothing ticked yet".
ALTER TABLE "users" ADD COLUMN "onboarding_checks" JSONB;
