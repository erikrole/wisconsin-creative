CREATE TABLE "quick_links" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "detail" TEXT,
  "roles" "Role"[] NOT NULL DEFAULT ARRAY[]::"Role"[],
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quick_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quick_links_sort_order_idx" ON "quick_links"("sort_order");

-- Starting links; admins edit or remove them in Settings > Quick links.
INSERT INTO "quick_links" ("id", "label", "url", "detail", "roles", "sort_order", "updated_at") VALUES
  ('qlink_apm_music', 'APM Music', 'https://www.apmmusic.com', 'Production music', ARRAY['ADMIN', 'STAFF', 'STUDENT']::"Role"[], 0, CURRENT_TIMESTAMP),
  ('qlink_greenfly', 'Greenfly', 'https://app.greenfly.com', 'Send content to athletes', ARRAY['ADMIN', 'STAFF']::"Role"[], 1, CURRENT_TIMESTAMP);
