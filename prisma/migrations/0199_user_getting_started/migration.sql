-- Getting started checklist progress ({ done: string[], dismissed: boolean }),
-- so web and iOS share one state per person instead of one per device.
-- Nullable and additive: existing rows read as "nothing done yet".
ALTER TABLE "users" ADD COLUMN "getting_started" JSONB;
