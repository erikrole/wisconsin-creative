#!/usr/bin/env node
// Disposable loopback-only PostgreSQL gate. Never reads application credentials.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { generateBaselineSql } from "./bootstrap-empty-database.mjs";
import { retainPreviewSql, claimPreviewCleanupSql } from "./lib/preview-lifecycle.mjs";

const connection = process.env.POSTGRES_TEST_URL;
if (!connection) throw new Error("POSTGRES_TEST_URL is required");
const target = new URL(connection);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/wc_integrity_test") {
  throw new Error("Refusing non-loopback or non-test database");
}
function sql(input) {
  const result = spawnSync("psql", [connection, "-X", "-v", "ON_ERROR_STOP=1", "-At"], { input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "psql failed");
  return result.stdout.trim();
}
if (sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'") !== "0") {
  throw new Error("Refusing nonempty test database");
}
const baseRef = process.env.MIGRATION_BASE_REF;
if (baseRef && !/^0+$/.test(baseRef)) {
  if (!/^[a-f0-9]{40}$/.test(baseRef)) throw new Error("Expected an exact base commit SHA");
  const baseSchema = spawnSync("git", ["show", `${baseRef}:prisma/schema.prisma`], { encoding: "utf8" });
  if (baseSchema.status !== 0) throw new Error("Cannot read base schema");
  const directory = mkdtempSync(join(tmpdir(), "wc-ci-schema-"));
  try {
    const schemaPath = join(directory, "schema.prisma");
    writeFileSync(schemaPath, baseSchema.stdout);
    const baseline = spawnSync("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPath, "--script"], { encoding: "utf8" });
    if (baseline.status !== 0) throw new Error(baseline.stderr);
    sql(baseline.stdout);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const added = spawnSync("git", ["diff", "--name-only", "--diff-filter=A", baseRef, "HEAD", "--", "prisma/migrations"], { encoding: "utf8" });
  if (added.status !== 0) throw new Error("Cannot identify forward migrations");
  for (const file of added.stdout.trim().split("\n").filter((p) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(p)).sort()) {
    sql(`BEGIN; ${readFileSync(file, "utf8")} COMMIT;`);
  }
} else {
  sql(generateBaselineSql(connection));
}
const guard = readFileSync("prisma/migrations/0144_restore_asset_allocation_overlap_guard/migration.sql", "utf8");
const indexes = readFileSync("prisma/migrations/0145_restore_declared_lookup_indexes/migration.sql", "utf8");
sql(guard);
sql(indexes);
sql(guard); // existing correct guard must be safe to re-run
const bootstrapRepair = readFileSync("prisma/migrations/0154_restore_bootstrap_only_postgres_objects/migration.sql", "utf8");
sql(`BEGIN; ${bootstrapRepair} COMMIT;`);
const firstReference = sql("SELECT nextval('booking_ref_seq')");
sql(`BEGIN; ${bootstrapRepair} COMMIT;`);
if (sql("SELECT nextval('booking_ref_seq')") !== String(Number(firstReference) + 1)) throw new Error("Bootstrap repair rewound the reference sequence");
if (sql("SELECT count(*) FROM pg_attribute WHERE attrelid='resources'::regclass AND attname IN ('target_roles','target_areas') AND attnotnull") !== "2") throw new Error("Resource target arrays remain nullable");
// Reproduce the old bootstrap shape with existing references, in a transaction
// that restores the real tables afterward. No application fixtures are needed.
sql(`BEGIN;
ALTER TABLE public.bookings RENAME TO bookings_integrity_original;
CREATE TABLE public.bookings(ref_number text);
INSERT INTO public.bookings VALUES ('CO-0042'), ('RV-4242'), ('legacy');
DROP SEQUENCE public.booking_ref_seq;
${bootstrapRepair}
DO $$ BEGIN
  IF nextval('public.booking_ref_seq') <> 4243 THEN RAISE EXCEPTION 'Reference collision after sequence repair'; END IF;
END $$;
ROLLBACK;`);
const nullFixture = spawnSync("psql", [connection, "-X", "-v", "ON_ERROR_STOP=1", "-At"], { encoding: "utf8", input: `BEGIN;
ALTER TABLE public.resources RENAME TO resources_integrity_original;
CREATE TABLE public.resources(target_roles public."Role"[], target_areas public."ShiftArea"[]);
INSERT INTO public.resources VALUES (NULL, ARRAY[]::public."ShiftArea"[]);
${bootstrapRepair}
ROLLBACK;` });
if (!nullFixture.status || !nullFixture.stderr.includes("Null resource targeting requires an explicit reviewed backfill")) throw new Error("Bootstrap repair did not reject ambiguous null targeting");
const foreignKeys = readFileSync("prisma/migrations/0153_restore_bulk_item_and_notification_foreign_keys/migration.sql", "utf8");
sql(`BEGIN; ${foreignKeys} COMMIT;`);

// A LIKE table retains the actual column types and NOT NULL requirements,
// but avoids seeding unrelated users/bookings/assets to test exclusion behavior.
sql(`BEGIN;
CREATE TABLE allocation_fixture (LIKE asset_allocations INCLUDING ALL);
INSERT INTO allocation_fixture(id,asset_id,booking_id,starts_at,ends_at,kind,updated_at)
VALUES ('a','camera','booking','2026-09-07 10:00','2026-09-07 11:00','RESERVATION',now()),
('b','camera','booking','2026-09-07 11:00','2026-09-07 12:00','RESERVATION',now());
DO $$ BEGIN
  BEGIN
    UPDATE allocation_fixture SET ends_at='2026-09-07 11:30' WHERE id='a';
    RAISE EXCEPTION 'Overlapping extension accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
END $$;
ROLLBACK;`);
if (sql("SELECT count(*) FROM pg_constraint WHERE conname='asset_allocations_no_overlap' AND convalidated") !== "1") {
  throw new Error("Missing live exclusion guard");
}
// Query every scalar field through the generated Prisma client: catches P2022
// payload/schema mismatch at the database boundary without real user records.
const { PrismaClient, Prisma } = await import("@prisma/client");
const db = new PrismaClient({ datasourceUrl: connection });
try {
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = model.name[0].toLowerCase() + model.name.slice(1);
    await db[delegate].findMany({ take: 1 });
  }
  await db.$executeRawUnsafe("CREATE SCHEMA wc_preview_meta");
  await db.$executeRawUnsafe("CREATE TABLE wc_preview_meta.runtime(id boolean PRIMARY KEY, pinned boolean NOT NULL DEFAULT false, last_seen_at timestamptz NOT NULL, git_deleted_at timestamptz, cleanup_started_at timestamptz)");
  const peerUrl = new URL(connection); peerUrl.searchParams.set("connection_limit", "1");
  const peer = new PrismaClient({ datasourceUrl: peerUrl.toString() });
  try {
    await peer.$executeRawUnsafe("SET application_name='wc_cleanup_race_peer'");
    for (const cleanupFirst of [false, true]) {
      await db.$executeRawUnsafe("TRUNCATE wc_preview_meta.runtime");
      await db.$executeRawUnsafe("INSERT INTO wc_preview_meta.runtime(id,last_seen_at,git_deleted_at) VALUES(true,'2000-01-01','2000-01-01')");
      let release, started;
      const held = new Promise((resolve) => { release = resolve; });
      const locked = new Promise((resolve) => { started = resolve; });
      const cleanupArgs = ["2000-01-01", "2000-01-01", 7];
      const first = db.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe(cleanupFirst ? claimPreviewCleanupSql : retainPreviewSql, ...(cleanupFirst ? cleanupArgs : [true]));
        if (rows.length !== 1) throw new Error("First lifecycle claim failed");
        started(); await held;
      });
      await locked;
      // PrismaPromise is lazy; then() starts the competing writer now.
      const second = peer.$queryRawUnsafe(cleanupFirst ? retainPreviewSql : claimPreviewCleanupSql, ...(cleanupFirst ? [true] : cleanupArgs)).then((rows) => rows);
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          waiting = sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='wc_cleanup_race_peer' AND wait_event_type='Lock'") === "1";
          if (waiting) break;
          await delay(20);
        }
        if (!waiting) throw new Error("Competing lifecycle writer was not observed waiting on the row lock");
      } finally { release(); }
      await first;
      if ((await second).length !== 0) throw new Error("Cleanup raced a successful local retention lease");
    }
  } finally { await peer.$disconnect(); await db.$executeRawUnsafe("DROP SCHEMA wc_preview_meta CASCADE"); }
} finally { await db.$disconnect(); }
console.log("PostgreSQL schema, forward DDL, overlap rejection, all-model reads and both cleanup/pin race orderings passed.");
