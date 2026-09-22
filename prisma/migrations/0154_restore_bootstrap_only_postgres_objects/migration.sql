-- Prisma schema bootstraps omitted objects supplied by historical SQL. Repair
-- their physical contract without replaying old migrations or rewriting history.
LOCK TABLE public.bookings IN SHARE ROW EXCLUSIVE MODE;
DO $sequence$
DECLARE maximum_reference numeric;
BEGIN
  IF to_regclass('public.booking_ref_seq') IS NULL THEN
    SELECT max(substring(ref_number FROM 4)::numeric) INTO maximum_reference
      FROM public.bookings WHERE ref_number ~ '^(CO|RV)-[0-9]+$';
    IF maximum_reference >= 9223372036854775807 THEN
      RAISE EXCEPTION 'Booking reference exceeds sequence capacity; explicit reconciliation required';
    END IF;
    CREATE SEQUENCE public.booking_ref_seq;
    PERFORM setval('public.booking_ref_seq', greatest(coalesce(maximum_reference, 0)+1, 1)::bigint, false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_sequence WHERE seqrelid='public.booking_ref_seq'::regclass
      AND seqtypid='bigint'::regtype AND seqincrement=1 AND seqmin=1 AND NOT seqcycle) THEN
    RAISE EXCEPTION 'Existing booking sequence differs from expected contract';
  END IF;
END $sequence$;

DO $arrays$
BEGIN
  IF EXISTS (SELECT 1 FROM public.resources WHERE target_roles IS NULL OR target_areas IS NULL) THEN
    RAISE EXCEPTION 'Null resource targeting requires an explicit reviewed backfill';
  END IF;
END $arrays$;
ALTER TABLE public.resources
  ALTER COLUMN target_roles SET DEFAULT ARRAY[]::public."Role"[],
  ALTER COLUMN target_roles SET NOT NULL,
  ALTER COLUMN target_areas SET DEFAULT ARRAY[]::public."ShiftArea"[],
  ALTER COLUMN target_areas SET NOT NULL;

CREATE INDEX IF NOT EXISTS scan_events_location_mismatch_idx ON public.scan_events(location_mismatch);
DO $index$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='public.scan_events_location_mismatch_idx'::regclass
    AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)='CREATE INDEX scan_events_location_mismatch_idx ON public.scan_events USING btree (location_mismatch)') THEN
    RAISE EXCEPTION 'Scan mismatch index differs from expected contract';
  END IF;
END $index$;
