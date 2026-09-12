#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import "dotenv/config";
import { resolvePrismaDirectUrl } from "./lib/prisma-direct-url.mjs";
import { readMigrationRows, loadMigrationBaseline, assertBaselineFiles, canonical } from "./lib/migration-baseline.mjs";

const migrationsDir = join(process.cwd(), "prisma", "migrations");

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function main() {
  const { connectionString, source } = resolvePrismaDirectUrl();
  if (source === "DATABASE_URL_UNPOOLED") {
    console.log("Using DATABASE_URL_UNPOOLED for Prisma migration health.");
  }

  if (!existsSync(migrationsDir)) {
    console.error(`Missing migrations directory: ${migrationsDir}`);
    process.exit(1);
  }

  const localMigrations = readLocalMigrations();
  const sql = neon(connectionString);
  const migrationRows = await readMigrationRows(sql);

  const checksums = Object.fromEntries(localMigrations.map((name) => [
    name,
    createHash("sha256").update(readFileSync(join(migrationsDir, name, "migration.sql"))).digest("hex"),
  ]));
  const baseline = await loadMigrationBaseline(sql, checksums, migrationRows);
  const health = evaluateMigrationHealth(localMigrations, migrationRows, checksums, baseline);
  const allocationGuards = await sql`
    SELECT pg_get_constraintdef(c.oid) AS definition,
      c.convalidated AND i.indisvalid AND i.indisready AS valid
    FROM pg_constraint c
    JOIN pg_index i ON i.indexrelid = c.conindid
    WHERE c.conrelid = to_regclass('public.asset_allocations')
      AND c.conname = 'asset_allocations_no_overlap' AND c.contype = 'x'
  `;
  health.problems.push(...evaluateAllocationProtection(allocationGuards));
  health.ok = health.problems.length === 0;
  printHealthReport(health);

  if (!health.ok) {
    process.exit(1);
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function readLocalMigrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function evaluateMigrationHealth(localMigrations, migrationRows, localChecksums = {}, baseline = null) {
  const appliedNames = new Set();
  const unresolvedFailed = [];
  const rolledBack = [];
  const checksumMismatches = new Set();
  const unverifiedChecksums = new Set();
  const baselinedUnknown = new Set();
  const baselinedHistorical = new Set();
  if (baseline) assertBaselineFiles(baseline, localChecksums);
  const exceptions = new Map((baseline?.exceptions ?? []).map((entry) => [entry.id, entry]));
  const frozenRows = new Map((baseline?.receipts ?? []).map((row) => [row.id, row]));

  for (const row of migrationRows) {
    const migrationName = row.migration_name;
    if (row.rolled_back_at) {
      rolledBack.push(migrationName);
      continue;
    }

    if (row.finished_at) {
      appliedNames.add(migrationName);
      if (localMigrations.includes(migrationName)) {
        const exception = exceptions.get(row.id);
        if (exception && canonical(frozenRows.get(row.id)) === canonical(row)) {
          (exception.provenance === "unknown" ? baselinedUnknown : baselinedHistorical).add(migrationName);
        } else if (!/^[a-f0-9]{64}$/i.test(row.checksum ?? "") || !localChecksums[migrationName]) {
          unverifiedChecksums.add(migrationName);
        } else if (row.checksum.toLowerCase() !== localChecksums[migrationName].toLowerCase()) {
          checksumMismatches.add(migrationName);
        }
      }
      continue;
    }

    unresolvedFailed.push(migrationName);
  }

  const localSet = new Set(localMigrations);
  const pending = localMigrations.filter((migrationName) => !appliedNames.has(migrationName));
  const appliedDbOnly = [...appliedNames].filter((migrationName) => !localSet.has(migrationName)).sort();
  const newestLocal = localMigrations.at(-1) ?? null;
  const newestLocalApplied = newestLocal ? appliedNames.has(newestLocal) : true;
  const appliedLocalCount = localMigrations.filter((migrationName) =>
    appliedNames.has(migrationName),
  ).length;

  const problems = [];
  if (pending.length > 0) problems.push(`${pending.length} pending local migration(s)`);
  if (unresolvedFailed.length > 0) problems.push(`${unresolvedFailed.length} unresolved failed migration row(s)`);
  if (appliedDbOnly.length > 0) problems.push(`${appliedDbOnly.length} applied DB migration(s) missing locally`);
  if (!newestLocalApplied) problems.push(`newest local migration is not applied: ${newestLocal}`);
  if (checksumMismatches.size > 0) problems.push(`${checksumMismatches.size} applied migration checksum mismatch(es)`);
  if (unverifiedChecksums.size > 0) problems.push(`${unverifiedChecksums.size} applied migration checksum(s) unverified`);

  return {
    ok: problems.length === 0,
    problems,
    localCount: localMigrations.length,
    appliedLocalCount,
    appliedDbOnly,
    pending,
    unresolvedFailed,
    rolledBack,
    checksumMismatches: [...checksumMismatches].sort(),
    unverifiedChecksums: [...unverifiedChecksums].sort(),
    baselinedUnknown: [...baselinedUnknown].sort(),
    baselinedHistorical: [...baselinedHistorical].sort(),
    baselineId: baseline?.id ?? null,
    newestLocal,
    newestLocalApplied,
  };
}

function printHealthReport(health) {
  console.log("Prisma migration health");
  console.log(`Local migrations: ${health.localCount}`);
  console.log(`Applied local migrations: ${health.appliedLocalCount}/${health.localCount}`);
  console.log(
    `Newest local migration: ${health.newestLocal ?? "none"} (${health.newestLocalApplied ? "applied" : "missing"})`,
  );

  printList("Pending local migrations", health.pending);
  printList("Unresolved failed rows", health.unresolvedFailed);
  printList("Applied DB-only migrations", health.appliedDbOnly);
  printList("Rolled-back rows", health.rolledBack);
  printList("Applied SQL checksum mismatches", health.checksumMismatches);
  printList("Unverified applied SQL checksums", health.unverifiedChecksums);
  printList("Preview baseline: original SQL provenance UNKNOWN", health.baselinedUnknown);
  printList("Preview baseline: verified historical SQL version differs from local", health.baselinedHistorical);

  if (health.ok) {
    console.log(health.baselineId
      ? `OK: ${health.baselineId} preserved, forward SQL verified, and asset overlap protection present. Historical exceptions remain above.`
      : "OK: local SQL matches Neon migration history and asset overlap protection is present.");
    return;
  }

  console.error(`FAIL: ${health.problems.join("; ")}.`);
}

export function evaluateAllocationProtection(rows) {
  const expected = "EXCLUDE USING gist (asset_id WITH =, tsrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE ((active = true))";
  return rows.length === 1 && rows[0].valid === true && rows[0].definition === expected
    ? []
    : ["asset_allocations_no_overlap is missing, invalid, or has an unexpected definition"];
}

function printList(label, values) {
  if (values.length === 0) {
    console.log(`${label}: none`);
    return;
  }

  console.log(`${label}:`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}
