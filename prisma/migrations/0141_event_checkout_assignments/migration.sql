-- Event-owned checkout identity is additive. Existing bookings remain
-- person-scoped, and serialized assignments remain optional.
CREATE TYPE "BookingCustodyScope" AS ENUM ('PERSON', 'EVENT');

ALTER TABLE "bookings"
    ADD COLUMN "custody_scope" "BookingCustodyScope" NOT NULL DEFAULT 'PERSON';

ALTER TABLE "booking_serialized_items"
    ADD COLUMN "assigned_user_id" TEXT,
    ADD COLUMN "assigned_at" TIMESTAMP(3);

CREATE INDEX "bookings_kind_custody_scope_status_ends_at_idx"
    ON "bookings"("kind", "custody_scope", "status", "ends_at");

CREATE INDEX "booking_serialized_items_assigned_user_id_allocation_status_idx"
    ON "booking_serialized_items"("assigned_user_id", "allocation_status");

ALTER TABLE "booking_serialized_items"
    ADD CONSTRAINT "booking_serialized_items_assigned_user_id_fkey"
    FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
