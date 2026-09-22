import { createHash, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { catalogSql } from "./migration-catalog.mjs";

export const previewTarget = Object.freeze({
  branch: "br-morning-surf-aiuyphxx", endpoint: "ep-winter-leaf-ai0eekhl", database: "gear-tracker",
});
export const identitySql = `SELECT current_setting('neon.branch_id',true) AS branch,
  current_setting('neon.endpoint_id',true) AS endpoint, current_database() AS database`;
export const receiptsSql = `SELECT to_jsonb(m) AS receipt FROM public._prisma_migrations m
  ORDER BY migration_name, started_at, id`;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

const approvedTargets = Object.freeze({
  "preview-2026-09-11": previewTarget,
  "production-2026-09-22": { branch: "br-gentle-sky-aisuwcsf", endpoint: "ep-flat-firefly-ai889avp", database: "gear-tracker" },
  "review-2026-09-22": { branch: "br-broad-mouse-aid7tu0s", endpoint: "ep-little-voice-aiuepzzf", database: "neondb" },
  // The sanitized template target is recorded separately after schema-only
  // restoration. Its approval never authorizes a copied child automatically.
  "sanitized-template-2026-09-22": { branch: "br-late-feather-auptprel", endpoint: "ep-falling-art-aueftqbs", database: "gear-tracker" },
});

export function readInfrastructureConfig() {
  return JSON.parse(readFileSync(new URL("../../config/infrastructure.json", import.meta.url), "utf8"));
}

export function validateChildManifest(manifest, config = readInfrastructureConfig()) {
  const { signature, ...payload } = manifest;
  if (!signature || !verify(null, Buffer.from(canonical(payload)), config.preview.attestationPublicKey, Buffer.from(signature, "base64"))) {
    throw new Error("Preview child attestation signature is invalid");
  }
  const parent = readApprovedBaseline(config.preview.templateBaselineId);
  const approval = manifest.approval;
  if (approval?.kind !== "sanitized-child" || approval.projectId !== config.preview.projectId
    || approval.parentBranchId !== config.preview.templateBranchId || approval.templateBaselineHash !== digest(parent)
    || approval.provisioningVersion !== config.preview.provisioningVersion
    || !approval.gitBranch || manifest.target.branch === parent.target.branch
    || manifest.target.database !== config.preview.database || manifest.catalogVersion !== 2
    || canonical(manifest.exceptions) !== canonical(parent.exceptions)) {
    throw new Error("Preview child lineage does not match the approved sanitized template");
  }
  assertBaselineFiles(parent, manifest.checksums);
  const inherited = new Map(manifest.receipts.map((row) => [row.id, row]));
  for (const receipt of parent.receipts) {
    if (canonical(inherited.get(receipt.id)) !== canonical(receipt)) throw new Error("Preview child altered inherited migration history");
  }
  return manifest;
}

export function readApprovedBaseline(id = "preview-2026-09-11") {
  if (!Object.hasOwn(approvedTargets, id)) throw new Error("Unrecognized baseline ID");
  const manifest = JSON.parse(readFileSync(new URL(`../baselines/${id}.json`, import.meta.url), "utf8"));
  if (manifest.id !== id || canonical(manifest.target) !== canonical(approvedTargets[id])) {
    throw new Error("Unrecognized baseline target");
  }
  return manifest;
}

export function assertBaselineFiles(manifest, checksums) {
  for (const [name, checksum] of Object.entries(manifest.checksums)) {
    if (checksums[name] !== checksum) throw new Error(`Baseline SQL changed or missing: ${name}`);
  }
}

// A checkpoint is an explicit exception, never fabricated proof of old SQL.
// Pin every historical row, including rolled-back attempts, not only bad hashes.
export function validateBaseline(manifest, identity, record, checksums, rows) {
  if (canonical(identity) !== canonical(manifest.target)) {
    throw new Error("Preview baseline cannot authorize this database target");
  }
  if (!record || record.manifest_hash !== digest(manifest) || canonical(record.manifest) !== canonical(manifest)) {
    throw new Error("Preview baseline record is missing or changed");
  }
  assertBaselineFiles(manifest, checksums);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const receipt of manifest.receipts) {
    if (canonical(byId.get(receipt.id)) !== canonical(receipt)) {
      throw new Error(`Historical baseline receipt changed or missing: ${receipt.migration_name}`);
    }
  }
  return manifest;
}

export async function readMigrationRows(sql) {
  return (await sql.query(receiptsSql)).map((row) => row.receipt);
}

export async function loadMigrationBaseline(sql, checksums, rows = null) {
  const [identity] = await sql.query(identitySql);
  // A copy of the checkpoint on Production or a new Neon branch is not approval.
  const id = Object.keys(approvedTargets).find((key) => canonical(identity) === canonical(approvedTargets[key]));
  const [table] = await sql.query("SELECT to_regclass('wc_migration_meta.baselines') AS name");
  if (!table.name) return null;
  if (!id) {
    const records = await sql.query("SELECT manifest_hash, manifest FROM wc_migration_meta.baselines WHERE manifest->'target'->>'branch'=$1", [identity.branch]);
    if (records.length === 0) return null;
    if (records.length !== 1) throw new Error("Multiple checkpoints claim this preview target");
    const manifest = validateChildManifest(records[0].manifest);
    return validateBaseline(manifest, identity, records[0], checksums, rows ?? await readMigrationRows(sql));
  }
  const manifest = readApprovedBaseline(id);
  const records = await sql.query("SELECT manifest_hash, manifest FROM wc_migration_meta.baselines WHERE id=$1", [manifest.id]);
  return validateBaseline(manifest, identity, records[0], checksums, rows ?? await readMigrationRows(sql));
}

// Embedded within the migration's existing advisory-locked transaction. No
// second connection or preflight-only exception can race receipt verification.
export function baselineGuardBody(manifest, { installing = false } = {}) {
  const payload = `${sqlLiteral(JSON.stringify(manifest))}::jsonb`;
  return `
    IF current_setting('neon.branch_id',true) IS DISTINCT FROM ${sqlLiteral(manifest.target.branch)}
      OR current_setting('neon.endpoint_id',true) IS DISTINCT FROM ${sqlLiteral(manifest.target.endpoint)}
      OR current_database() IS DISTINCT FROM ${sqlLiteral(manifest.target.database)} THEN
      RAISE EXCEPTION 'Preview baseline target mismatch; no SQL applied';
    END IF;
    LOCK TABLE public._prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(${payload}->'receipts') b
      LEFT JOIN public._prisma_migrations m ON m.id=b->>'id'
      WHERE to_jsonb(m) IS DISTINCT FROM b) THEN
      RAISE EXCEPTION 'Historical baseline receipt changed or missing; no SQL applied';
    END IF;
    ${installing ? `
    IF (SELECT count(*) FROM public._prisma_migrations) <> ${manifest.receipts.length} THEN
      RAISE EXCEPTION 'History changed since baseline review; no SQL applied';
    END IF;
    IF (SELECT encode(sha256(convert_to(catalog::text,'UTF8')),'hex') FROM (${catalogSql(manifest.catalogVersion ?? 1)}) s)
      IS DISTINCT FROM ${sqlLiteral(manifest.catalogHash)} THEN
      RAISE EXCEPTION 'Schema changed since baseline review; no SQL applied';
    END IF;` : `
    IF NOT EXISTS (SELECT 1 FROM wc_migration_meta.baselines WHERE id=${sqlLiteral(manifest.id)}
      AND manifest_hash=${sqlLiteral(digest(manifest))} AND manifest=${payload}) THEN
      RAISE EXCEPTION 'Preview baseline record missing or changed; no SQL applied';
    END IF;`}
  `;
}

export function buildBaselineInstall(manifest, checksums) {
  if (manifest.approval?.kind === "sanitized-child") validateChildManifest(manifest);
  else if (canonical(manifest) !== canonical(readApprovedBaseline(manifest.id))) throw new Error("Unapproved baseline manifest");
  assertBaselineFiles(manifest, checksums);
  return [
    "SET LOCAL lock_timeout='5s'",
    "SET LOCAL statement_timeout='60s'",
    "SET LOCAL timezone='UTC'",
    `DO $baseline$ BEGIN
      IF NOT pg_try_advisory_xact_lock(72707369) THEN RAISE EXCEPTION 'Another migration is running'; END IF;
      ${baselineGuardBody(manifest, { installing: true })}
    END $baseline$`,
    "CREATE SCHEMA IF NOT EXISTS wc_migration_meta",
    `CREATE TABLE IF NOT EXISTS wc_migration_meta.baselines (
      id text PRIMARY KEY, manifest_hash text NOT NULL, manifest jsonb NOT NULL,
      established_at timestamptz NOT NULL DEFAULT clock_timestamp(), established_by text NOT NULL DEFAULT current_user
    )`,
    `INSERT INTO wc_migration_meta.baselines(id,manifest_hash,manifest)
      VALUES (${sqlLiteral(manifest.id)},${sqlLiteral(digest(manifest))},${sqlLiteral(JSON.stringify(manifest))}::jsonb)`,
    "COMMENT ON TABLE wc_migration_meta.baselines IS 'Preserved operational checkpoints. Unknown historical provenance is not verified SQL. Never update or delete to bypass migration health.'",
  ];
}
