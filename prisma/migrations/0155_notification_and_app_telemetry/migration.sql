-- Notification and app telemetry.
--
-- Notification delivery ledger: one row per outbound attempt (APNs, browser
-- push) for an inbox notification, recording whether it went out and, if not,
-- why (paused, category off, quiet hours, no device, rejected token).
--
-- Rows cascade with their notification, so user erasure (which deletes the
-- user's notifications) removes them too. Retention: 180 days, pruned by the
-- morning-refresh cron.

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "category" TEXT,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "latency_bucket" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_deliveries_occurred_at_idx" ON "notification_deliveries"("occurred_at");
CREATE INDEX "notification_deliveries_category_occurred_at_idx" ON "notification_deliveries"("category", "occurred_at");
CREATE INDEX "notification_deliveries_outcome_occurred_at_idx" ON "notification_deliveries"("outcome", "occurred_at");
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- App diagnostics: MetricKit crash, hang, and resource-exception reports from
-- iOS installs. No user identity. Retention: 90 days (morning-refresh).
CREATE TABLE "app_diagnostics" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "app_version" TEXT,
    "os_version" TEXT,
    "signature" TEXT,
    "metadata" JSONB,
    "call_stack" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_diagnostics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_diagnostics_received_at_idx" ON "app_diagnostics"("received_at");
CREATE INDEX "app_diagnostics_kind_received_at_idx" ON "app_diagnostics"("kind", "received_at");

-- Background job runs: lateness and outcome for workflow steps and cron
-- sub-jobs. Retention: 90 days (morning-refresh).
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "lateness_bucket" TEXT,
    "detail" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_runs_occurred_at_idx" ON "job_runs"("occurred_at");
CREATE INDEX "job_runs_job_occurred_at_idx" ON "job_runs"("job", "occurred_at");
