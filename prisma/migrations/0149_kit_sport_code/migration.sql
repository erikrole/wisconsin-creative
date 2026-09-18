-- Gameday kits are scoped to a sport so two Football kits cannot share a
-- camera, while a Basketball kit may still use that same body.
ALTER TABLE "kits" ADD COLUMN "sport_code" TEXT;

CREATE INDEX "kits_sport_code_idx" ON "kits"("sport_code");

CREATE INDEX "kits_location_id_sport_code_idx" ON "kits"("location_id", "sport_code");
