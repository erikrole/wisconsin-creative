-- Links a budget line to the inventory it bought (one serialized asset, or a quantity of a bulk SKU).
-- CreateTable
CREATE TABLE "budget_line_items" (
    "id" TEXT NOT NULL,
    "budget_line_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "bulk_sku_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_line_items_pkey" PRIMARY KEY ("id"),
    -- Exactly one target, and a positive quantity.
    CONSTRAINT "budget_line_items_one_target_check" CHECK (("asset_id" IS NULL) <> ("bulk_sku_id" IS NULL)),
    CONSTRAINT "budget_line_items_quantity_check" CHECK ("quantity" >= 1)
);

-- CreateIndex
CREATE INDEX "budget_line_items_asset_id_idx" ON "budget_line_items"("asset_id");

-- CreateIndex
CREATE INDEX "budget_line_items_bulk_sku_id_idx" ON "budget_line_items"("bulk_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_items_budget_line_id_asset_id_key" ON "budget_line_items"("budget_line_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_items_budget_line_id_bulk_sku_id_key" ON "budget_line_items"("budget_line_id", "bulk_sku_id");

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_bulk_sku_id_fkey" FOREIGN KEY ("bulk_sku_id") REFERENCES "bulk_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
