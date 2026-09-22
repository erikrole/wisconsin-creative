#!/usr/bin/env node
// Explicit operator workflow; normal deployment cannot establish a checkpoint.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { resolvePrismaDirectUrl } from "./lib/prisma-direct-url.mjs";
import { buildBaselineInstall, readApprovedBaseline, digest } from "./lib/migration-baseline.mjs";

const manifest = readApprovedBaseline(process.argv[3] ?? "preview-2026-09-11");
const checksums = Object.fromEntries(readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map(({ name }) => [name,
    createHash("sha256").update(readFileSync(`prisma/migrations/${name}/migration.sql`)).digest("hex")]));
const statements = buildBaselineInstall(manifest, checksums);
if (process.argv[2] === "--plan") {
  console.log(JSON.stringify(statements));
} else if (process.argv[2] === "--apply") {
  const { connectionString } = resolvePrismaDirectUrl();
  const sql = neon(connectionString);
  try {
    await sql.transaction(statements.map((text) => sql.query(text)));
  } catch (error) {
    // No retry after an uncertain response. Inspect the separately persisted
    // record and original receipts before any operator continuation.
    throw new Error("Baseline outcome unverified; inspect the checkpoint before retrying", { cause: error });
  }
  const rows = await sql.query("SELECT manifest_hash FROM wc_migration_meta.baselines WHERE id=$1", [manifest.id]);
  if (rows[0]?.manifest_hash !== digest(manifest)) throw new Error("Baseline read-back failed");
  console.log(`Established ${manifest.id}; historical receipts preserved, legacy provenance remains explicit.`);
} else {
  throw new Error("Use --plan [baseline-id] or --apply [baseline-id] for an explicitly authorized target");
}
