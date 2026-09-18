-- Football gameday kits are named jobs: Slow 1, Slow 2, Bench, Roam 1–4.
-- One active kit may own each job at a pickup location.
CREATE TYPE "FootballGamedayKitRole" AS ENUM (
  'SLOW1',
  'SLOW2',
  'BENCH',
  'ROAM1',
  'ROAM2',
  'ROAM3',
  'ROAM4'
);

ALTER TABLE "kits" ADD COLUMN "gameday_role" "FootballGamedayKitRole";

CREATE INDEX "kits_gameday_role_idx" ON "kits"("gameday_role");

CREATE INDEX "kits_location_id_gameday_role_idx" ON "kits"("location_id", "gameday_role");

CREATE UNIQUE INDEX "kits_active_gameday_role_uidx"
  ON "kits"("location_id", "gameday_role")
  WHERE "gameday_role" IS NOT NULL AND "active" = TRUE;
