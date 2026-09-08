-- Run only on the disposable local database described in the audit ledger.
-- Requires the minimal asset_allocations fixture and migration 0144 applied.
INSERT INTO asset_allocations VALUES
  ('a', 'camera', '2026-09-07 10:00', '2026-09-07 11:00', true),
  ('adjacent', 'camera', '2026-09-07 11:00', '2026-09-07 12:00', true),
  ('inactive', 'camera', '2026-09-07 10:30', '2026-09-07 11:30', false),
  ('other', 'lens', '2026-09-07 10:00', '2026-09-07 11:00', true);

DO $$
BEGIN
  BEGIN
    INSERT INTO asset_allocations VALUES
      ('overlap', 'camera', '2026-09-07 10:30', '2026-09-07 11:30', true);
    RAISE EXCEPTION 'FAIL: overlapping insert accepted';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: overlapping insert rejected';
  END;
  BEGIN
    UPDATE asset_allocations SET active=true WHERE id='inactive';
    RAISE EXCEPTION 'FAIL: conflicting reactivation accepted';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: conflicting reactivation rejected';
  END;
  BEGIN
    UPDATE asset_allocations SET ends_at='2026-09-07 11:30' WHERE id='a';
    RAISE EXCEPTION 'FAIL: overlapping extension accepted';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: overlapping extension rejected';
  END;
  IF (SELECT count(*) FROM asset_allocations) <> 4 THEN
    RAISE EXCEPTION 'FAIL: unexpected fixture row count';
  END IF;
  RAISE NOTICE 'PASS: adjacent windows, inactive history and different assets retained';
END $$;
