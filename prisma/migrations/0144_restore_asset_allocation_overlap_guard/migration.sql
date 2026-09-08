-- Restore the D-006 guard on Prisma timestamp-without-time-zone columns.
-- A single active-row unique index would incorrectly block later reservations.
-- Do not rewrite 0001 or its historical receipt. Existing overlaps fail this DDL
-- without deleting or choosing between bookings. Run through a direct connection.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.asset_allocations'::regclass
      AND conname = 'asset_allocations_no_overlap'
  ) THEN
    ALTER TABLE public.asset_allocations
      ADD CONSTRAINT asset_allocations_no_overlap
      EXCLUDE USING gist (
        asset_id WITH =,
        tsrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (active = true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_index i ON i.indexrelid = c.conindid
    WHERE c.conrelid = 'public.asset_allocations'::regclass
      AND c.conname = 'asset_allocations_no_overlap'
      AND c.contype = 'x' AND c.convalidated AND i.indisvalid AND i.indisready
      AND pg_get_constraintdef(c.oid) =
        'EXCLUDE USING gist (asset_id WITH =, tsrange(starts_at, ends_at, ''[)''::text) WITH &&) WHERE ((active = true))'
  ) THEN
    RAISE EXCEPTION 'Unexpected asset_allocations_no_overlap definition; inspect existing constraint before repair';
  END IF;
END $$;
