CREATE TABLE "label_print_jobs" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "browser_id" TEXT NOT NULL,
  "active_browser_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "last_request_id" TEXT NOT NULL,
  "last_request_hash" TEXT NOT NULL,
  "job" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "label_print_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "label_print_jobs_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "label_print_jobs_active_browser_check" CHECK ("active_browser_id" IS NULL OR "active_browser_id" = "browser_id"),
  CONSTRAINT "label_print_jobs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "label_print_jobs_active_browser_id_key" ON "label_print_jobs"("active_browser_id");
CREATE INDEX "label_print_jobs_actor_user_id_created_at_idx" ON "label_print_jobs"("actor_user_id", "created_at");
CREATE INDEX "label_print_jobs_browser_id_created_at_idx" ON "label_print_jobs"("browser_id", "created_at");
CREATE INDEX "label_print_jobs_created_at_idx" ON "label_print_jobs"("created_at");
