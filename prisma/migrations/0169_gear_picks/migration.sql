-- UA staff gear picks (cycle 2027-28). Participants are seeded separately by
-- scripts/seed-gear-pick-participants.mjs so the roster stays data, not schema.
-- CreateEnum
CREATE TYPE "GearPickFit" AS ENUM ('MEN', 'WOMEN');

-- CreateTable
CREATE TABLE "gear_pick_cycles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gear_pick_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_pick_participants" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fit" "GearPickFit" NOT NULL,
    "allowance_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gear_pick_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_pick_submissions" (
    "id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gear_pick_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gear_pick_lines" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "color_code" TEXT NOT NULL,
    "size" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,

    CONSTRAINT "gear_pick_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gear_pick_participants_user_id_idx" ON "gear_pick_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gear_pick_participants_cycle_id_user_id_key" ON "gear_pick_participants"("cycle_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gear_pick_submissions_participant_id_key" ON "gear_pick_submissions"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "gear_pick_lines_submission_id_sku_size_key" ON "gear_pick_lines"("submission_id", "sku", "size");

-- AddForeignKey
ALTER TABLE "gear_pick_participants" ADD CONSTRAINT "gear_pick_participants_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "gear_pick_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_pick_participants" ADD CONSTRAINT "gear_pick_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_pick_submissions" ADD CONSTRAINT "gear_pick_submissions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "gear_pick_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gear_pick_lines" ADD CONSTRAINT "gear_pick_lines_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "gear_pick_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed the 2027-28 cycle. The catalog is static JSON keyed by this id; the
-- deadline starts open (NULL) and is set by an admin from /gear/admin.
INSERT INTO "gear_pick_cycles" ("id", "title", "deadline", "created_at", "updated_at")
VALUES ('2027-28', '2027–28 Under Armour staff gear', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
