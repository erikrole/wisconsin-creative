#!/usr/bin/env node
// Default is read-only. The protected main-branch workflow opts into --apply.
import { NeonPreviewApi } from "./lib/neon-preview-api.mjs";
import { VercelPreviewApi } from "./lib/vercel-preview-api.mjs";
import { readInfrastructureConfig, loadMigrationBaseline } from "./lib/migration-baseline.mjs";
import { localChecksums } from "./lib/local-migrations.mjs";
import { verifyPreviewState, branchKey } from "./lib/preview-environment.mjs";
import { validateResourceManifest } from "./lib/provision-preview-storage.mjs";
import { previewRetentionDecision } from "./lib/preview-retention.mjs";
import { assertProviderLineage } from "./lib/provision-preview.mjs";
import { handoffVariable } from "./lib/preview-handoff.mjs";
import { claimPreviewCleanupSql } from "./lib/preview-lifecycle.mjs";
import { neon } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply"), config = readInfrastructureConfig();
const provider = new NeonPreviewApi(), vercel = new VercelPreviewApi();
if (!process.env.GITHUB_TOKEN) throw new Error("GitHub read access is required; absence is not evidence of branch deletion");
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${config.repository}/${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub inventory failed (${response.status}); nothing may be deleted`);
  return response.json();
}
async function all(path) {
  const rows = [];
  for (let page = 1; ; page++) { const batch = await github(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`); rows.push(...batch); if (batch.length < 100) return rows; }
}
async function references() {
  const [branches, prs] = await Promise.all([all("branches"), all("pulls?state=open")]);
  return { branches: new Set(branches.map((b) => b.name)), prs: new Set(prs.filter((p) => p.head.repo?.full_name === config.repository).map((p) => p.head.ref)) };
}
let refs = await references();
for (const branch of await provider.branches(config.preview.projectId)) {
  if (branch.id === config.preview.templateBranchId || branch.protected || branch.default || branch.primary || branch.parent_id !== config.preview.templateBranchId || !/^wc-preview-[a-f0-9]{20}$/.test(branch.name)) continue;
  const pooled = await provider.connection(config.preview.projectId, branch.id, config.preview.database, config.preview.ownerRole, true);
  const direct = await provider.connection(config.preview.projectId, branch.id, config.preview.database, config.preview.ownerRole, false);
  const sql = neon(direct), baseline = await loadMigrationBaseline(sql, localChecksums());
  if (!baseline || baseline.approval?.kind !== "sanitized-child") { console.log({ branch: branch.id, status: "unattested-retained" }); continue; }
  const gitBranch = baseline.approval.gitBranch;
  assertProviderLineage(branch, gitBranch, config);
  const state = { projectId: config.preview.projectId, branchId: branch.id, endpointId: baseline.target.endpoint, gitBranch, key: branchKey(gitBranch), environment: { DATABASE_URL: pooled, DIRECT_URL: direct, DATABASE_URL_UNPOOLED: direct } };
  await verifyPreviewState(state, localChecksums(), config, { allowCleanup: true });
  const [runtime] = await sql.query("SELECT pinned,git_deleted_at,last_seen_at FROM wc_preview_meta.runtime WHERE id=true");
  const decision = previewRetentionDecision({ exists: refs.branches.has(gitBranch), openPullRequest: refs.prs.has(gitBranch), pinned: runtime.pinned, deletedAt: runtime.git_deleted_at, lastSeenAt: runtime.last_seen_at, graceDays: config.preview.cleanupGraceDays });
  console.log({ gitBranch, branch: branch.id, status: decision, apply });
  if (!apply) continue;
  if (decision === "referenced") { await sql.query("UPDATE wc_preview_meta.runtime SET git_deleted_at=NULL WHERE id=true"); continue; }
  if (decision === "record-deletion") { await sql.query("UPDATE wc_preview_meta.runtime SET git_deleted_at=now() WHERE id=true AND git_deleted_at IS NULL"); continue; }
  if (decision !== "eligible") continue;
  const [resourceRow] = await sql.query("SELECT manifest FROM wc_preview_meta.resources WHERE id=true");
  const resources = validateResourceManifest(resourceRow.manifest, state, config);
  const deployments = []; let until;
  do {
    const page = await vercel.request(`/v6/deployments?projectId=${config.vercel.productionProjectId}&limit=100${until ? `&until=${until}` : ""}`);
    deployments.push(...page.deployments.filter((d) => d.meta?.wcPreviewKey === state.key && d.meta?.wcPreviewBranch === branch.id)); until = page.pagination?.next;
  } while (until);
  if (deployments.some((d) => d.target === "production" || ["BUILDING", "QUEUED", "INITIALIZING"].includes(d.readyState ?? d.state))) { console.log({ branch: branch.id, status: "deployment-active-retained" }); continue; }
  refs = await references();
  const { branch: currentBranch } = await provider.request(`/projects/${config.preview.projectId}/branches/${branch.id}`);
  assertProviderLineage(currentBranch, gitBranch, config);
  const [current] = await sql.query("SELECT pinned,git_deleted_at,last_seen_at FROM wc_preview_meta.runtime WHERE id=true");
  if (previewRetentionDecision({ exists: refs.branches.has(gitBranch), openPullRequest: refs.prs.has(gitBranch), pinned: current.pinned, deletedAt: current.git_deleted_at, lastSeenAt: current.last_seen_at, graceDays: config.preview.cleanupGraceDays }) !== "eligible") continue;
  const inventory = (await vercel.request("/v1/storage/stores")).stores;
  const present = resources.stores.filter((s) => inventory.some((i) => i.id === s.id));
  for (const resource of present) {
    const { store } = await vercel.request(`/v1/storage/stores/${resource.id}`);
    if (store.name !== resource.name || store.access !== resource.access || store.ownerId !== config.vercel.teamId || (store.projectsMetadata ?? []).some((p) => p.projectId !== config.vercel.resourceProjectId)) throw new Error("Cleanup store ownership differs; refusing deletion");
  }
  // Atomic claim shares the runtime row lock with local pin/start/activity.
  // A prior local lease changes last_seen_at and loses this compare-and-set;
  // a later local lease sees the tombstone and refuses to start.
  const claimed = await sql.query(claimPreviewCleanupSql, [current.git_deleted_at, current.last_seen_at, config.preview.cleanupGraceDays]);
  if (!claimed.length) { console.log({ branch: branch.id, status: "activity-changed-retained" }); continue; }
  for (const deployment of deployments) await vercel.request(`/v13/deployments/${deployment.uid ?? deployment.id}`, { method: "DELETE" });
  for (const resource of present) {
    await vercel.request(`/v1/storage/stores/${resource.id}/connections`, { method: "DELETE" });
    await vercel.request(`/v1/storage/stores/blob/${resource.id}`, { method: "DELETE" });
  }
  const handoff = await handoffVariable(gitBranch, vercel, config);
  if (handoff) await vercel.request(`/v9/projects/${config.vercel.resourceProjectId}/env/${handoff.id}`, { method: "DELETE" });
  await provider.request(`/projects/${config.preview.projectId}/branches/${branch.id}`, { method: "DELETE" });
  console.log({ branch: branch.id, status: "removed-after-grace-period" });
}
