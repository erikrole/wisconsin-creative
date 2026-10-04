-- AlterTable
ALTER TABLE "student_badges" ADD COLUMN "celebrated_at" TIMESTAMP(3);

-- Backfill: awards that already exist have already been available on shelves
-- and prior celebration surfaces. Mark them celebrated at their award time so
-- deploy cannot replay history as popups across web, iOS, and kiosk.
UPDATE "student_badges" SET "celebrated_at" = "awarded_at" WHERE "celebrated_at" IS NULL;

-- CreateIndex
CREATE INDEX "student_badges_user_id_celebrated_at_awarded_at_idx" ON "student_badges"("user_id", "celebrated_at", "awarded_at");
