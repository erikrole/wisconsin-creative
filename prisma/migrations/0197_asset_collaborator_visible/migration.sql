-- Per-item switch that keeps a piece of gear out of the collaborator catalog and
-- collaborator reservations. Existing items stay visible (default true).
ALTER TABLE "assets" ADD COLUMN "collaborator_visible" BOOLEAN NOT NULL DEFAULT true;
