-- Admin-only budgets: one pot per fiscal year (Creative, Football) with planned and actual lines.
-- CreateEnum
CREATE TYPE "BudgetLineStatus" AS ENUM ('PLANNED', 'ORDERED', 'PURCHASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BudgetCategory" AS ENUM ('AWARDS_PRIZES', 'BUSINESS_TRAVEL', 'EQUIPMENT', 'IT_SERVICES', 'LEASES', 'MAINTENANCE_REPAIRS', 'MATERIALS_SUPPLIES', 'RENTALS', 'SERVICES', 'SUBSCRIPTIONS_DUES', 'TELECOMMUNICATIONS');

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "allocation_cents" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "status" "BudgetLineStatus" NOT NULL DEFAULT 'PLANNED',
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "unit_cost_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "quantity_bought" INTEGER,
    "spent_cents" INTEGER,
    "purchased_on" DATE,
    "order_number" TEXT,
    "po_number" TEXT,
    "link_url" TEXT,
    "justification" TEXT,
    "requester_user_id" TEXT,
    "requester_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_fiscal_year_idx" ON "budgets"("fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_name_fiscal_year_key" ON "budgets"("name", "fiscal_year");

-- CreateIndex
CREATE INDEX "budget_lines_budget_id_category_idx" ON "budget_lines"("budget_id", "category");

-- CreateIndex
CREATE INDEX "budget_lines_budget_id_status_idx" ON "budget_lines"("budget_id", "status");

-- CreateIndex
CREATE INDEX "budget_lines_requester_user_id_idx" ON "budget_lines"("requester_user_id");

-- CreateIndex
CREATE INDEX "budget_lines_po_number_idx" ON "budget_lines"("po_number");

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

