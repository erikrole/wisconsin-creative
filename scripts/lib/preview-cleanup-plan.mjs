import { branchKey } from "./preview-environment.mjs";

/** Computes started at once. Small enough to stay under Neon's active-endpoint cap. */
export const CLEANUP_COMPUTE_BATCH = 3;
/** Stop before the 15-minute Preview cleanup job is killed mid-suspend. */
export const CLEANUP_TIME_BUDGET_MS = 8 * 60 * 1000;

export function isEndpointLimitError(error) {
  const message = String(error?.message ?? "");
  return error?.status === 402 || message.includes("concurrently active endpoints");
}

/** Map open same-repo PR heads to `wc-preview-*` branch names. Unsafe refs are ignored. */
export function openPreviewNames(gitBranches, { branchPrefix, key = branchKey } = {}) {
  const names = new Map();
  for (const gitBranch of gitBranches) {
    try { names.set(`${branchPrefix}${key(gitBranch)}`, gitBranch); } catch { /* main and detached names are not previews */ }
  }
  return names;
}

export function endpointsByBranchId(endpoints = []) {
  const grouped = new Map();
  for (const endpoint of endpoints) {
    if (!endpoint?.branch_id) continue;
    const list = grouped.get(endpoint.branch_id);
    if (list) list.push(endpoint);
    else grouped.set(endpoint.branch_id, [endpoint]);
  }
  return grouped;
}

/** Idle endpoints a SQL session would start. Already-active computes are left alone. */
export function endpointsInspectionWouldStart(endpoints = []) {
  return endpoints.filter((endpoint) => endpoint.current_state === "idle" && !endpoint.pending_state).map((endpoint) => endpoint.id);
}

/** Open PRs are refreshed from branch identity. Everyone else needs the runtime row. */
export function partitionPreviewCleanup(branches, openNames) {
  const metadata = [];
  const database = [];
  for (const branch of branches) {
    const gitBranch = openNames.get(branch.name);
    if (gitBranch) metadata.push({ branch, gitBranch });
    else database.push(branch);
  }
  return { metadata, database };
}

/** Day-rotate so a run that hits the time budget does not inspect the same children forever. */
export function rotateCleanupBranches(branches, now = Date.now()) {
  if (branches.length < 2) return branches;
  const offset = Math.floor(now / 86_400_000) % branches.length;
  return branches.slice(offset).concat(branches.slice(0, offset));
}

export function takeCleanupBatch(branches, { elapsedMs = 0, budgetMs = CLEANUP_TIME_BUDGET_MS, batchSize = CLEANUP_COMPUTE_BATCH } = {}) {
  if (elapsedMs >= budgetMs) return { batch: [], deferred: branches, reason: "time-budget" };
  return { batch: branches.slice(0, batchSize), deferred: branches.slice(batchSize), reason: null };
}
