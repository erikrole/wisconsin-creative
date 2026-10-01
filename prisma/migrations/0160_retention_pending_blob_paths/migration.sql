-- AlterTable
ALTER TABLE "applicant_retention_events" ADD COLUMN     "pending_blob_paths" TEXT[] DEFAULT ARRAY[]::TEXT[];

