-- UA allotment: the cycle's total budget (placeholder until confirmed), admin-only.
ALTER TABLE "gear_pick_cycles" ADD COLUMN "budget_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gear_pick_cycles" ADD COLUMN "budget_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- 2027-28 starts at last year's $5,500 as an unconfirmed placeholder.
UPDATE "gear_pick_cycles" SET "budget_cents" = 550000 WHERE "id" = '2027-28' AND "budget_cents" = 0;
