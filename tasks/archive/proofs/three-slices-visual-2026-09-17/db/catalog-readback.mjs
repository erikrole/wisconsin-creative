/**
 * Read-only Preview/Production catalog + migration probe.
 * Never writes. Prints database name/host only, never credentials.
 */
import { neon } from "@neondatabase/serverless";

function rewriteGearTracker(url) {
  if (!url || url.trim() === "[SENSITIVE]") return url;
  const parsed = new URL(url);
  parsed.pathname = "/gear-tracker";
  return parsed.toString();
}

function identity(url, label) {
  if (!url) return { label, present: false };
  if (url.trim() === "[SENSITIVE]") return { label, present: true, redacted: true };
  const parsed = new URL(url);
  return {
    label,
    present: true,
    protocol: parsed.protocol,
    host: parsed.hostname,
    db: parsed.pathname,
  };
}

const target = process.env.PROOF_DB_TARGET || "preview-gear-tracker";
const raw =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  "";
const connectionString = target.includes("gear-tracker")
  ? rewriteGearTracker(raw)
  : raw;

console.log(
  JSON.stringify(
    {
      target,
      env: process.env.VERCEL_ENV || process.env.PROOF_ENV || "local-shell",
      sources: {
        DATABASE_URL: identity(process.env.DATABASE_URL, "DATABASE_URL"),
        DATABASE_URL_UNPOOLED: identity(
          process.env.DATABASE_URL_UNPOOLED,
          "DATABASE_URL_UNPOOLED",
        ),
        DIRECT_URL: identity(process.env.DIRECT_URL, "DIRECT_URL"),
      },
      using: identity(connectionString, "using"),
    },
    null,
    2,
  ),
);

if (!connectionString || connectionString.trim() === "[SENSITIVE]") {
  console.error("NO_USABLE_CONNECTION");
  process.exit(2);
}

const sql = neon(connectionString);

const migrations = await sql`
  SELECT migration_name, finished_at, rolled_back_at, checksum
  FROM _prisma_migrations
  WHERE migration_name LIKE '%0147%'
     OR migration_name LIKE '%badge%'
  ORDER BY started_at DESC
`;

const latest = await sql`
  SELECT migration_name, finished_at
  FROM _prisma_migrations
  WHERE rolled_back_at IS NULL
  ORDER BY finished_at DESC NULLS LAST
  LIMIT 5
`;

const counts = await sql`
  SELECT COUNT(*)::int AS applied
  FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
`;

const catalog = await sql`
  SELECT key, name, rule_key, threshold::text AS threshold, active, trigger
  FROM badge_definitions
  WHERE key IN (
    'category_collector',
    'result_site_sweep',
    'plan_ahead',
    'crew_checkout'
  )
  ORDER BY key
`;

const awards = await sql`
  SELECT d.key, COUNT(*)::int AS awards
  FROM student_badges s
  JOIN badge_definitions d ON d.id = s.definition_id
  WHERE d.key IN (
    'category_collector',
    'result_site_sweep',
    'plan_ahead',
    'crew_checkout'
  )
  GROUP BY d.key
  ORDER BY d.key
`;

console.log(
  JSON.stringify(
    {
      appliedCount: counts[0]?.applied ?? null,
      latest,
      migrations0147ish: migrations,
      catalog,
      awards,
    },
    null,
    2,
  ),
);
