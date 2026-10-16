-- Speed up scan history, Most popular aggregates, open bulk-unit
-- allocations, and recent condition-report lists. Not applied by this change.

CREATE INDEX "bulk_unit_alloc_checked_in_out_idx" ON "booking_bulk_unit_allocations"("checked_in_at", "checked_out_at" DESC);

CREATE INDEX "scan_events_created_at_idx" ON "scan_events"("created_at" DESC);

CREATE INDEX "scan_events_asset_id_created_at_idx" ON "scan_events"("asset_id", "created_at" DESC);

CREATE INDEX "scan_events_bulk_sku_id_created_at_idx" ON "scan_events"("bulk_sku_id", "created_at" DESC);

CREATE INDEX "checkin_item_reports_dismissed_at_last_reported_at_idx" ON "checkin_item_reports"("dismissed_at", "last_reported_at" DESC);

CREATE INDEX "checkin_item_reports_asset_id_last_reported_at_idx" ON "checkin_item_reports"("asset_id", "last_reported_at" DESC);
