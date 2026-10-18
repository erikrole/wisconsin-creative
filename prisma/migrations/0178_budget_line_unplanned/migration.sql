-- Marks lines added after the plan was submitted so the submitted total stays fixed.
ALTER TABLE "budget_lines" ADD COLUMN "unplanned" BOOLEAN NOT NULL DEFAULT false;
