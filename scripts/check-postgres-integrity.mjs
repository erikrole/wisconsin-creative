#!/usr/bin/env node
// Disposable loopback-only PostgreSQL gate. Never reads application credentials.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateBaselineSql } from "./bootstrap-empty-database.mjs";

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
    sql(readFileSync(file, "utf8"));
  }
} else {
  sql(generateBaselineSql(connection));
}
const guard = readFileSync("prisma/migrations/0144_restore_asset_allocation_overlap_guard/migration.sql", "utf8");
const indexes = readFileSync("prisma/migrations/0145_restore_declared_lookup_indexes/migration.sql", "utf8");
sql(guard);
sql(indexes);
sql(guard); // existing correct guard must be safe to re-run

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
} finally { await db.$disconnect(); }
console.log("PostgreSQL schema, forward DDL, overlap rejection and all-model reads passed.");
