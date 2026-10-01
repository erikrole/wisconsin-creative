-- AlterTable
ALTER TABLE "applicants" ADD COLUMN     "name_key" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "applicants_name_key_idx" ON "applicants"("name_key");

