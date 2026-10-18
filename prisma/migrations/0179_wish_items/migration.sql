-- Wish list: things staff would like bought, reviewed by admins and moved into the budget.
-- CreateEnum
CREATE TYPE "WishStatus" AS ENUM ('OPEN', 'APPROVED', 'IN_BUDGET', 'DECLINED');

-- CreateTable
CREATE TABLE "wish_items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link_url" TEXT,
    "estimate_cents" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "needed_by" DATE,
    "reason" TEXT,
    "status" "WishStatus" NOT NULL DEFAULT 'OPEN',
    "status_note" TEXT,
    "requested_by_id" TEXT,
    "budget_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wish_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wish_items_quantity_check" CHECK ("quantity" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "wish_items_budget_line_id_key" ON "wish_items"("budget_line_id");
CREATE INDEX "wish_items_status_created_at_idx" ON "wish_items"("status", "created_at");
CREATE INDEX "wish_items_requested_by_id_idx" ON "wish_items"("requested_by_id");

-- AddForeignKey
ALTER TABLE "wish_items" ADD CONSTRAINT "wish_items_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wish_items" ADD CONSTRAINT "wish_items_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
