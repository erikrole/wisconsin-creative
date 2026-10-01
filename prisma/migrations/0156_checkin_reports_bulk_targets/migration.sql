-- Check-in reports for bulk gear (kiosk "Report a problem" for batteries and
-- counted stock). Additive: asset_id becomes nullable and a report targets
-- exactly one of a serialized asset, a numbered bulk unit, or counted stock by
-- SKU (with a quantity). Existing rows all have asset_id set, so the CHECK
-- validates against current data.

-- AlterTable
ALTER TABLE "checkin_item_reports" ADD COLUMN     "bulk_sku_id" TEXT,
ADD COLUMN     "bulk_sku_unit_id" TEXT,
ADD COLUMN     "quantity" INTEGER,
ALTER COLUMN "asset_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "checkin_item_reports_booking_id_bulk_sku_unit_id_key" ON "checkin_item_reports"("booking_id", "bulk_sku_unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_item_reports_booking_id_bulk_sku_id_type_key" ON "checkin_item_reports"("booking_id", "bulk_sku_id", "type");

-- AddForeignKey
ALTER TABLE "checkin_item_reports" ADD CONSTRAINT "checkin_item_reports_bulk_sku_unit_id_fkey" FOREIGN KEY ("bulk_sku_unit_id") REFERENCES "bulk_sku_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_item_reports" ADD CONSTRAINT "checkin_item_reports_bulk_sku_id_fkey" FOREIGN KEY ("bulk_sku_id") REFERENCES "bulk_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one target; quantity is present (and positive) only for counted stock.
ALTER TABLE "checkin_item_reports" ADD CONSTRAINT "checkin_item_reports_one_target_check"
  CHECK (num_nonnulls("asset_id", "bulk_sku_unit_id", "bulk_sku_id") = 1);
ALTER TABLE "checkin_item_reports" ADD CONSTRAINT "checkin_item_reports_quantity_check"
  CHECK ((("bulk_sku_id" IS NULL) = ("quantity" IS NULL)) AND ("quantity" IS NULL OR "quantity" > 0));
