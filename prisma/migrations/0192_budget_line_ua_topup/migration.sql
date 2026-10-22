-- A Creative budget line can top up one year of the Under Armour allotment. Additive and nullable:
-- the allotment stays on gear_pick_cycles.budget_cents, and the top-up amount lives only on the line.
ALTER TABLE "budget_lines" ADD COLUMN "gear_pick_cycle_id" TEXT;

CREATE INDEX "budget_lines_gear_pick_cycle_id_idx" ON "budget_lines"("gear_pick_cycle_id");

ALTER TABLE "budget_lines"
  ADD CONSTRAINT "budget_lines_gear_pick_cycle_id_fkey"
  FOREIGN KEY ("gear_pick_cycle_id") REFERENCES "gear_pick_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
