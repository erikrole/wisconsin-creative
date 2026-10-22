-- The "badge earned" celebration was acknowledged only by a per-device cursor, so any phone or
-- browser that had been closed replayed every award since its last cursor, and two open devices
-- showed the same award. Track it on the award itself. Everything earned so far counts as shown.
ALTER TABLE "student_badges" ADD COLUMN "celebrated_at" TIMESTAMP(3);
UPDATE "student_badges" SET "celebrated_at" = "awarded_at";
