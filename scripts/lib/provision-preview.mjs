import { randomBytes, sign } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { branchKey, savePreviewState, verifyPreviewState } from "./preview-environment.mjs";
import { localChecksums } from "./local-migrations.mjs";
import { canonical, digest, readApprovedBaseline, readInfrastructureConfig, identitySql, readMigrationRows, buildBaselineInstall } from "./migration-baseline.mjs";
import { catalogSnapshotV2Sql } from "./migration-catalog.mjs";
import { assertFallbackHistory } from "../prisma-migrate-deploy.mjs";
import { NeonPreviewApi } from "./neon-preview-api.mjs";
import { provisionPreviewStorage } from "./provision-preview-storage.mjs";
import { publishPreviewHandoff } from "./preview-handoff.mjs";

export function assertProviderLineage(branch, gitBranch, config = readInfrastructureConfig()) {
  if (branch.project_id !== config.preview.projectId || branch.parent_id !== config.preview.templateBranchId
    || branch.name !== `${config.preview.branchPrefix}${branchKey(gitBranch)}` || branch.default || branch.primary || branch.protected) {
    throw new Error("Provider branch identity/parent/name differs from the approved disposable preview.");
  }
}

export async function initializePreviewChild({ branch, gitBranch, pooledUrl, directUrl, signingKey = process.env.PREVIEW_SIGNING_KEY, config = readInfrastructureConfig() }) {
  assertProviderLineage(branch, gitBranch, config);
  const sql = neon(directUrl);
  const [identity] = await sql.query(identitySql);
  if (identity.branch !== branch.id || identity.database !== config.preview.database) throw new Error("Provider and database branch identities differ");
  const key = branchKey(gitBranch), checksums = localChecksums();
  const state = { version: 1, gitBranch, key, projectId: config.preview.projectId, branchId: branch.id, endpointId: identity.endpoint, templateBranchId: branch.parent_id, environment: { DATABASE_URL: pooledUrl, DIRECT_URL: directUrl, DATABASE_URL_UNPOOLED: directUrl } };
  const [runtimeTable] = await sql.query("SELECT to_regclass('wc_preview_meta.runtime') AS name");
  if (runtimeTable.name) {
    await sql.query("ALTER TABLE wc_preview_meta.runtime ADD COLUMN IF NOT EXISTS cleanup_started_at timestamptz");
    const [runtime] = await sql.query("SELECT environment FROM wc_preview_meta.runtime WHERE id=true");
    if (!runtime) throw new Error("Preview runtime metadata is incomplete; operator reconciliation required");
    state.environment = { ...runtime.environment, ...state.environment };
    await verifyPreviewState(state, checksums, config);
    return state;
  }
  if (!signingKey) throw new Error("PREVIEW_SIGNING_KEY is required only to provision a new child. It must stay in trusted provisioning, never in app build variables.");
  const parent = readApprovedBaseline(config.preview.templateBaselineId);
  const receipts = await readMigrationRows(sql);
  const byId = new Map(receipts.map((row) => [row.id, row]));
  for (const receipt of parent.receipts) if (canonical(byId.get(receipt.id)) !== canonical(receipt)) throw new Error("Template receipts changed before provisioning");
  assertFallbackHistory(checksums, receipts, parent);
  const [catalog] = await sql.query(`SELECT encode(sha256(convert_to(catalog::text,'UTF8')),'hex') AS hash FROM (${catalogSnapshotV2Sql}) c`);
  const payload = {
    id: `preview-${key}`, target: identity, catalogVersion: 2, catalogHash: catalog.hash,
    checksums, receipts, exceptions: parent.exceptions, reviewedPending: assertFallbackHistory(checksums, receipts, parent),
    approval: { kind: "sanitized-child", projectId: config.preview.projectId, parentBranchId: branch.parent_id, gitBranch,
      templateBaselineHash: digest(parent), provisioningVersion: config.preview.provisioningVersion, provisionedAt: new Date().toISOString() },
  };
  const manifest = { ...payload, signature: sign(null, Buffer.from(canonical(payload)), signingKey).toString("base64") };
  const runtime = {
    WC_ENVIRONMENT: "preview", WC_PREVIEW_BRANCH: branch.id, WC_PREVIEW_KEY: key,
    SESSION_SECRET: randomBytes(32).toString("hex"), SESSION_COOKIE_NAME: `wc-preview-${key}`,
    SOFTWARE_VAULT_KEY: randomBytes(32).toString("base64"), PLAYWRIGHT_PASSWORD: randomBytes(24).toString("base64url"), BADGES_ENABLED: "true",
  };
  const passwordHash = await bcrypt.hash(runtime.PLAYWRIGHT_PASSWORD, 10);
  await sql.transaction([
    ...buildBaselineInstall(manifest, checksums).map((text) => sql.query(text)),
    sql.query("CREATE SCHEMA wc_preview_meta"),
    sql.query("CREATE TABLE wc_preview_meta.runtime (id boolean PRIMARY KEY DEFAULT true CHECK(id), environment jsonb NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), git_deleted_at timestamptz, pinned boolean NOT NULL DEFAULT false, cleanup_started_at timestamptz)"),
    sql.query("INSERT INTO wc_preview_meta.runtime(environment) VALUES ($1::jsonb)", [JSON.stringify(runtime)]),
    sql.query("UPDATE users SET password_hash=$1,force_password_change=false,hidden_from_roster=true WHERE email='admin@creative.local'", [passwordHash]),
  ]);
  state.environment = { ...runtime, ...state.environment };
  await verifyPreviewState(state, checksums, config);
  return state;
}

export async function provisionPreview(gitBranch, { api = new NeonPreviewApi(), config = readInfrastructureConfig(), root = process.cwd() } = {}) {
  const key = branchKey(gitBranch), name = `${config.preview.branchPrefix}${key}`;
  let branch = (await api.branches(config.preview.projectId)).find((b) => b.name === name);
  if (!branch) {
    if (!process.env.PREVIEW_SIGNING_KEY) throw new Error("New previews require the trusted provisioner's PREVIEW_SIGNING_KEY.");
    const result = await api.request(`/projects/${config.preview.projectId}/branches`, { method: "POST", body: {
      branch: { parent_id: config.preview.templateBranchId, name },
      endpoints: [{ type: "read_write", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 1, suspend_timeout_seconds: 300 }],
    } });
    branch = await api.readyBranch(config.preview.projectId, result.branch.id);
    assertProviderLineage(branch, gitBranch, config);
  }
  assertProviderLineage(branch, gitBranch, config);
  let [pooledUrl, directUrl] = await Promise.all([
    api.connection(config.preview.projectId, branch.id, config.preview.database, config.preview.ownerRole, true),
    api.connection(config.preview.projectId, branch.id, config.preview.database, config.preview.ownerRole, false),
  ]);
  const sql = neon(directUrl);
  const [runtimeTable] = await sql.query("SELECT to_regclass('wc_preview_meta.runtime') AS name");
  if (!runtimeTable.name) {
    // This also repairs an interrupted create/ready/reset attempt. Existence
    // alone never proves that the template's inherited password was rotated.
    if (!process.env.PREVIEW_SIGNING_KEY) throw new Error("Uninitialized previews require the trusted signing key.");
    await api.request(`/projects/${config.preview.projectId}/branches/${branch.id}/roles/${config.preview.ownerRole}/reset_password`, { method: "POST" });
    [pooledUrl, directUrl] = await Promise.all([
      api.connection(config.preview.projectId, branch.id, config.preview.database, config.preview.ownerRole, true),
      api.connection(config.preview.projectId, branch.id, config.preview.database, config.preview.ownerRole, false),
    ]);
  }
  const state = await initializePreviewChild({ branch, gitBranch, pooledUrl, directUrl, config });
  await provisionPreviewStorage(state, { config });
  await publishPreviewHandoff(state, { config });
  savePreviewState(state, root);
  return state;
}
