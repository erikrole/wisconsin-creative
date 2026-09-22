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

// V1 is immutable because existing approvals use its digest. V2 also covers
// database objects Prisma cannot describe; counters and data are not structure.
export const catalogSnapshotV2Sql = `SELECT catalog || jsonb_build_object(
  'catalogVersion', 2,
  'tableAccess', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'forceRls',c.relforcerowsecurity) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'),
  'collations', (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'schema',cn.nspname,'collation',co.collname) ORDER BY c.relname,a.attname)
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_collation co ON co.oid=a.attcollation JOIN pg_namespace cn ON cn.oid=co.collnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations' AND a.attnum>0 AND NOT a.attisdropped),
  'triggerState', (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled) ORDER BY c.relname,t.tgname)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal),
  'functions', (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
    'definition',pg_get_functiondef(p.oid),'configuration',p.proconfig,'securityDefiner',p.prosecdef) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS
      (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
  'sequences', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(s.seqtypid,NULL),'start',s.seqstart,
    'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle) ORDER BY c.relname)
    FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'extensions', (SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) ORDER BY e.extname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('btree_gist','pg_trgm'))
) AS catalog FROM (${catalogSnapshotSql}) v1`;

export function catalogSql(version = 1) {
  if (version === 1) return catalogSnapshotSql;
  if (version === 2) return catalogSnapshotV2Sql;
  throw new Error(`Unsupported catalog version: ${version}`);
}
