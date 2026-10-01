-- CreateTable
CREATE TABLE "applicant_retention_events" (
    "id" TEXT NOT NULL,
    "applicant_id" TEXT NOT NULL,
    "purged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "application_count" INTEGER NOT NULL,
    "document_count" INTEGER NOT NULL,
    "policy_months" INTEGER NOT NULL,

    CONSTRAINT "applicant_retention_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applicant_retention_events_applicant_id_idx" ON "applicant_retention_events"("applicant_id");

-- CreateIndex
CREATE INDEX "applicant_retention_events_purged_at_idx" ON "applicant_retention_events"("purged_at");

