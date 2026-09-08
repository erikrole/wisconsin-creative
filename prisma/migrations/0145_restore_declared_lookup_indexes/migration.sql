-- Restore six indexes already declared by schema.prisma but absent in the
-- production catalog audited 2026-09-07. Existing same-definition indexes with
-- truncated legacy names were excluded from this repair.
CREATE INDEX IF NOT EXISTS "bookings_requester_user_id_idx" ON "bookings"("requester_user_id");
CREATE INDEX IF NOT EXISTS "bulk_stock_movements_actor_user_id_idx" ON "bulk_stock_movements"("actor_user_id");
CREATE INDEX IF NOT EXISTS "scan_events_actor_user_id_idx" ON "scan_events"("actor_user_id");
CREATE INDEX IF NOT EXISTS "override_events_actor_user_id_idx" ON "override_events"("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
