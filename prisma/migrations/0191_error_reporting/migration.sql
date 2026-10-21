-- Error reporting and support.
--
-- error_issues groups every crash and error report by fingerprint so repeats
-- are one row to triage; error_events keeps occurrences with their context
-- (version, build, channel, device, person, screen, recent actions, request
-- id), capped per issue and pruned after 90 days by morning-refresh.
-- support_reports holds "Report a problem" submissions (365-day retention).
--
-- app_diagnostics is superseded: morning-refresh moves its remaining MetricKit
-- rows into error_events through the same grouping code, then deletes them.

-- CreateTable
CREATE TABLE "error_issues" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "culprit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_version" TEXT,
    "last_version" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "regressed_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "error_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "app_build" TEXT,
    "release_channel" TEXT,
    "os_version" TEXT,
    "device_model" TEXT,
    "user_id" TEXT,
    "role" TEXT,
    "screen" TEXT,
    "request_id" TEXT,
    "digest" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "breadcrumbs" JSONB,
    "context" JSONB,
    "call_stack" JSONB,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "app_build" TEXT,
    "release_channel" TEXT,
    "os_version" TEXT,
    "device_model" TEXT,
    "role" TEXT,
    "screen" TEXT,
    "breadcrumbs" JSONB,
    "related_issue_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,

    CONSTRAINT "support_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_issues_fingerprint_key" ON "error_issues"("fingerprint");

-- CreateIndex
CREATE INDEX "error_issues_status_last_seen_at_idx" ON "error_issues"("status", "last_seen_at");

-- CreateIndex
CREATE INDEX "error_issues_last_seen_at_idx" ON "error_issues"("last_seen_at");

-- CreateIndex
CREATE INDEX "error_events_issue_id_occurred_at_idx" ON "error_events"("issue_id", "occurred_at");

-- CreateIndex
CREATE INDEX "error_events_occurred_at_idx" ON "error_events"("occurred_at");

-- CreateIndex
CREATE INDEX "error_events_user_id_occurred_at_idx" ON "error_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "error_events_digest_idx" ON "error_events"("digest");

-- CreateIndex
CREATE INDEX "support_reports_status_created_at_idx" ON "support_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "support_reports_created_at_idx" ON "support_reports"("created_at");

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "error_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_reports" ADD CONSTRAINT "support_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

