-- Restore database protection already declared by Prisma. The preflight audit
-- found zero orphans. NOT VALID bounds initial locking; validation then checks
-- existing rows without rewriting or deleting application data.
DO $repair$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.booking_bulk_items'::regclass
    AND conname='booking_bulk_items_bulk_sku_id_fkey') THEN
    ALTER TABLE public.booking_bulk_items ADD CONSTRAINT booking_bulk_items_bulk_sku_id_fkey
      FOREIGN KEY (bulk_sku_id) REFERENCES public.bulk_skus(id) ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass
    AND conname='notifications_user_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $repair$;
ALTER TABLE public.booking_bulk_items VALIDATE CONSTRAINT booking_bulk_items_bulk_sku_id_fkey;
ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_user_id_fkey;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.booking_bulk_items'::regclass
    AND conname='booking_bulk_items_bulk_sku_id_fkey' AND contype='f' AND convalidated
    AND pg_get_constraintdef(oid)='FOREIGN KEY (bulk_sku_id) REFERENCES bulk_skus(id) ON UPDATE CASCADE ON DELETE RESTRICT')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notifications'::regclass
    AND conname='notifications_user_id_fkey' AND contype='f' AND convalidated
    AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE') THEN
    RAISE EXCEPTION 'Foreign-key definition differs from the reviewed contract';
  END IF;
END $verify$;
