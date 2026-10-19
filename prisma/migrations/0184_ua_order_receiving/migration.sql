-- UA gear: the order record (placed by the Equipment department) and receiving.
ALTER TABLE "gear_pick_cycles" ADD COLUMN "order_placed_at" TIMESTAMP(3);
ALTER TABLE "gear_pick_cycles" ADD COLUMN "po_number" TEXT;
ALTER TABLE "gear_pick_cycles" ADD COLUMN "order_number" TEXT;
ALTER TABLE "gear_pick_cycles" ADD COLUMN "expected_at" TIMESTAMP(3);

CREATE TABLE "gear_pick_receipts" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT,
    "quantity" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "received_by_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gear_pick_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gear_pick_receipts_cycle_id_sku_idx" ON "gear_pick_receipts"("cycle_id", "sku");

ALTER TABLE "gear_pick_receipts" ADD CONSTRAINT "gear_pick_receipts_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "gear_pick_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gear_pick_receipts" ADD CONSTRAINT "gear_pick_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
