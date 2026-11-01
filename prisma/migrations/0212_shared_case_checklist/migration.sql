-- Shared case checklist ticks per trip ({ [itemId]: { at, by } }). The list itself
-- lives in system_config ("shared_case_checklist"). Nullable and additive.
ALTER TABLE "bookings" ADD COLUMN "packing_checks" JSONB;
