-- A holder can report a Photo Mechanic code that won't activate. The code is retired
-- and stamped so admins can see it was reported (and by whom).
ALTER TABLE "license_codes"
  ADD COLUMN "reported_broken_at" TIMESTAMP(3),
  ADD COLUMN "reported_broken_by_id" TEXT;
