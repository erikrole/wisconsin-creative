-- Gear picks stay admin-only until an admin launches the cycle to everyone on the list.
-- AlterTable
ALTER TABLE "gear_pick_cycles" ADD COLUMN "launched_at" TIMESTAMP(3);
