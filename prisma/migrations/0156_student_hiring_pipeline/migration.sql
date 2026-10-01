-- CreateEnum
CREATE TYPE "HiringCycleStatus" AS ENUM ('PLANNING', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApplicantStanding" AS ENUM ('INCOMING', 'FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR', 'GRADUATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'ROUND_1', 'HIRE', 'PASSED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicantDocumentKind" AS ENUM ('RESUME', 'COVER_LETTER', 'PORTFOLIO_FILE', 'OTHER');

-- CreateTable
CREATE TABLE "hiring_cycles" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "term" "GraduationTerm" NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "HiringCycleStatus" NOT NULL DEFAULT 'PLANNING',
    "opens_on" DATE,
    "closes_on" DATE,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_cycle_slots" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "area" "ShiftArea" NOT NULL,
    "target_count" INTEGER NOT NULL,

    CONSTRAINT "hiring_cycle_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standing" "ApplicantStanding",
    "grad_term" "GraduationTerm",
    "grad_year" INTEGER,
    "phone" TEXT,
    "location" TEXT,
    "portfolio_url" TEXT,
    "social_handles" TEXT,
    "notes" TEXT,
    "hired_user_id" TEXT,
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_emails" (
    "id" TEXT NOT NULL,
    "applicant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "applicant_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "external_application_id" TEXT,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMP(3),
    "interviewed_at" TIMESTAMP(3),
    "interview_url" TEXT,
    "summer_available" BOOLEAN,
    "software_experience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fields_experience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fields_interested" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raw_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primary_area" "ShiftArea",
    "decided_at" TIMESTAMP(3),
    "decided_by_id" TEXT,
    "allowed_email_id" TEXT,
    "source_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_documents" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "kind" "ApplicantDocumentKind" NOT NULL,
    "pathname" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_notes" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "rating" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hiring_cycles_label_key" ON "hiring_cycles"("label");

-- CreateIndex
CREATE INDEX "hiring_cycles_status_idx" ON "hiring_cycles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_cycles_term_year_key" ON "hiring_cycles"("term", "year");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_cycle_slots_cycle_id_area_key" ON "hiring_cycle_slots"("cycle_id", "area");

-- CreateIndex
CREATE UNIQUE INDEX "applicants_hired_user_id_key" ON "applicants"("hired_user_id");

-- CreateIndex
CREATE INDEX "applicants_name_idx" ON "applicants"("name");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_emails_email_key" ON "applicant_emails"("email");

-- CreateIndex
CREATE INDEX "applicant_emails_applicant_id_idx" ON "applicant_emails"("applicant_id");

-- CreateIndex
CREATE INDEX "applications_cycle_id_stage_idx" ON "applications"("cycle_id", "stage");

-- CreateIndex
CREATE INDEX "applications_decided_by_id_idx" ON "applications"("decided_by_id");

-- CreateIndex
CREATE INDEX "applications_allowed_email_id_idx" ON "applications"("allowed_email_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_applicant_id_cycle_id_key" ON "applications"("applicant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_cycle_id_external_application_id_key" ON "applications"("cycle_id", "external_application_id");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_documents_pathname_key" ON "applicant_documents"("pathname");

-- CreateIndex
CREATE INDEX "applicant_documents_application_id_idx" ON "applicant_documents"("application_id");

-- CreateIndex
CREATE INDEX "applicant_documents_uploaded_by_id_idx" ON "applicant_documents"("uploaded_by_id");

-- CreateIndex
CREATE INDEX "application_notes_application_id_created_at_idx" ON "application_notes"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_notes_author_id_idx" ON "application_notes"("author_id");

-- AddForeignKey
ALTER TABLE "hiring_cycle_slots" ADD CONSTRAINT "hiring_cycle_slots_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "hiring_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_hired_user_id_fkey" FOREIGN KEY ("hired_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_emails" ADD CONSTRAINT "applicant_emails_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "hiring_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_allowed_email_id_fkey" FOREIGN KEY ("allowed_email_id") REFERENCES "allowed_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_documents" ADD CONSTRAINT "applicant_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_documents" ADD CONSTRAINT "applicant_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

