-- CreateTable
CREATE TABLE "varsity_season_owners" (
    "id" TEXT NOT NULL,
    "sport_code" TEXT NOT NULL,
    "area" "ShiftArea" NOT NULL,
    "user_id" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "varsity_season_owners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "varsity_season_owners_sport_code_area_starts_on_ends_on_idx" ON "varsity_season_owners"("sport_code", "area", "starts_on", "ends_on");

-- CreateIndex
CREATE INDEX "varsity_season_owners_user_id_starts_on_ends_on_idx" ON "varsity_season_owners"("user_id", "starts_on", "ends_on");

-- CreateIndex
CREATE UNIQUE INDEX "varsity_season_owners_sport_code_area_user_id_starts_on_key" ON "varsity_season_owners"("sport_code", "area", "user_id", "starts_on");

-- AddForeignKey
ALTER TABLE "varsity_season_owners" ADD CONSTRAINT "varsity_season_owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "varsity_season_owners" ADD CONSTRAINT "varsity_season_owners_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
