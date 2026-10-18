-- Refunds or credits on a line, and a yearly-repeat flag.
ALTER TABLE "budget_lines" ADD COLUMN "refund_cents" INTEGER;
ALTER TABLE "budget_lines" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT false;
