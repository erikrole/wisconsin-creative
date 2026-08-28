-- Auto assignment is not run the same way for every sport. Some are crewed
-- end to end; some staff the full-time positions and deliberately leave the
-- student slots open so students request them through Open Work; some are held
-- back from automation entirely while their scheduling is worked out by hand.
--
-- FULL_CREW is the default so every sport without an explicit policy keeps
-- behaving exactly as it did before this migration.
CREATE TYPE "SportAutoAssignPolicy" AS ENUM ('FULL_CREW', 'STAFF_ONLY', 'HOLD');

ALTER TABLE "sport_configs"
    ADD COLUMN "auto_assign_policy" "SportAutoAssignPolicy" NOT NULL DEFAULT 'FULL_CREW';

-- Seed the Big 6 policies. Insert rather than update alone: a sport with no
-- config row yet would otherwise fall through to the FULL_CREW default and be
-- auto-assigned against its stated policy.
INSERT INTO "sport_configs" ("id", "sport_code", "active", "auto_assign_policy", "created_at", "updated_at")
VALUES
    (gen_random_uuid()::text, 'FB',   true, 'HOLD',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'MBB',  true, 'STAFF_ONLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'WBB',  true, 'STAFF_ONLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'MHKY', true, 'STAFF_ONLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'WHKY', true, 'STAFF_ONLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VB',   true, 'STAFF_ONLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sport_code") DO UPDATE
    SET "auto_assign_policy" = EXCLUDED."auto_assign_policy",
        "updated_at" = CURRENT_TIMESTAMP;
