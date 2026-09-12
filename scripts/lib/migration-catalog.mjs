// Structural evidence only: no application rows, credentials, or ownership data.
// Private operational metadata is excluded. Public extension views are retained.
export const catalogSnapshotSql = `SELECT jsonb_build_object(
  'tables', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM (
    SELECT c.relname AS name, c.relkind AS kind, c.relrowsecurity AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
  ) t),
  'columns', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.table_name,t.name) FROM (
    SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_expr,
      a.attidentity AS identity, a.attgenerated AS generated
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
      AND a.attnum>0 AND NOT a.attisdropped
  ) t),
  'enums', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name) FROM (
    SELECT typ.typname AS name, jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type typ JOIN pg_enum e ON e.enumtypid=typ.oid JOIN pg_namespace n ON n.oid=typ.typnamespace
    WHERE n.nspname='public' GROUP BY typ.typname
  ) t),
  'constraints', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.table_name,t.name) FROM (
    SELECT c.relname AS table_name, con.conname AS name, con.contype AS type,
      pg_get_constraintdef(con.oid) AS definition, con.convalidated AS valid
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname <> '_prisma_migrations'
  ) t),
  'indexes', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.table_name,t.name) FROM (
    SELECT c.relname AS table_name, idx.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
      i.indisvalid AS valid, i.indisready AS ready
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname <> '_prisma_migrations'
  ) t),
  'triggers', (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal),
  'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public'),
  'views', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'definition',pg_get_viewdef(c.oid)) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m'))
) AS catalog`;
