-- Position label (e.g. SLOW1) and optional half on a worker's event assignment.
CREATE TYPE "ShiftAssignmentHalf" AS ENUM ('FIRST', 'SECOND');

ALTER TABLE "shift_assignments"
  ADD COLUMN "crew_label" TEXT,
  ADD COLUMN "crew_half" "ShiftAssignmentHalf";
