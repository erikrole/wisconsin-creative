-- UA allotment: students on the cycle roster, and the per-student kit price.
ALTER TABLE "gear_pick_cycles" ADD COLUMN "student_kit_cents" INTEGER NOT NULL DEFAULT 0;

-- 2027-28 student kit: zip $52.50 + polo $40.00 + $50.00 shoe budget.
UPDATE "gear_pick_cycles" SET "student_kit_cents" = 14250 WHERE "id" = '2027-28' AND "student_kit_cents" = 0;

CREATE TABLE "gear_pick_students" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gear_pick_students_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gear_pick_students_cycle_id_user_id_key" ON "gear_pick_students"("cycle_id", "user_id");
CREATE INDEX "gear_pick_students_user_id_idx" ON "gear_pick_students"("user_id");

ALTER TABLE "gear_pick_students" ADD CONSTRAINT "gear_pick_students_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "gear_pick_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gear_pick_students" ADD CONSTRAINT "gear_pick_students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
