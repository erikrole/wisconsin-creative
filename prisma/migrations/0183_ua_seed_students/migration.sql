-- UA allotment: seed the 2027-28 student roster from last year's sheet.
-- Matches active student accounts by exact name (case-insensitive). Names with no
-- account are skipped; admins add them from the Students section in /gear/admin.
INSERT INTO "gear_pick_students" ("id", "cycle_id", "user_id")
SELECT 'seed-2027-28-' || u."id", '2027-28', u."id"
FROM "users" u
WHERE u."role" = 'STUDENT'
  AND u."active" = true
  AND lower(btrim(u."name")) IN (
    'david saddler', 'william clarke', 'benjamin xiong', 'owen phillips',
    'mason howard', 'connor oamek', 'mateo reynolds', 'billy powell',
    'miles felix', 'zach lowery', 'johnathan dye', 'amina haniieva',
    'maddy nissenbaum', 'abigail peterson'
  )
  AND EXISTS (SELECT 1 FROM "gear_pick_cycles" c WHERE c."id" = '2027-28')
ON CONFLICT ("cycle_id", "user_id") DO NOTHING;
