-- AlterTable
ALTER TABLE "users" ADD COLUMN     "start_term" "GraduationTerm",
ADD COLUMN     "start_term_year" INTEGER;

-- CreateTable
CREATE TABLE "student_term_placements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "term" "GraduationTerm" NOT NULL,
    "year" INTEGER NOT NULL,
    "area" "ShiftArea",
    "sport_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_term_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_term_placements_year_term_idx" ON "student_term_placements"("year", "term");

-- CreateIndex
CREATE UNIQUE INDEX "student_term_placements_user_id_term_year_key" ON "student_term_placements"("user_id", "term", "year");

-- AddForeignKey
ALTER TABLE "student_term_placements" ADD CONSTRAINT "student_term_placements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

