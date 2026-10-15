import { execFileSync } from "node:child_process";
import { branchKey, previewRuntimeEnvironment, verifyPreviewState } from "./preview-environment.mjs";
import { readInfrastructureConfig } from "./migration-baseline.mjs";
import { localChecksums } from "./local-migrations.mjs";
import { VercelPreviewApi } from "./vercel-preview-api.mjs";
import { retainPreview } from "./preview-lifecycle.mjs";
import { previewDatabaseDecision } from "./preview-change-scope.mjs";

export const handoffKey = (branch) => `WC_PREVIEW_${branchKey(branch).toUpperCase()}_STATE`;
export function privateHandoff(state) {
  return {
    version: 1, gitBranch: state.gitBranch, key: state.key, projectId: state.projectId,
    branchId: state.branchId, endpointId: state.endpointId, templateBranchId: state.templateBranchId,
    environment: previewRuntimeEnvironment(state), resources: state.resources,
  };
}
export async function handoffVariable(gitBranch, api, config = readInfrastructureConfig()) {
  const { envs } = await api.request(`/v9/projects/${config.vercel.resourceProjectId}/env`);
  if (!Array.isArray(envs)) throw new Error("Could not inspect private preview handoff metadata.");
  const matches = envs.filter((entry) => entry.key === handoffKey(gitBranch));
  if (matches.length > 1 || matches.some((entry) => entry.type !== "encrypted" || entry.target?.length !== 1 || entry.target[0] !== "development" || entry.gitBranch)) {
    throw new Error("Preview handoff has an unexpected scope; operator reconciliation required.");
  }
  return matches[0];
}
export async function publishPreviewHandoff(state, { api = new VercelPreviewApi(), config = readInfrastructureConfig() } = {}) {
  const { sql } = await verifyPreviewState(state, localChecksums(), config);
  await retainPreview(sql);
  const existing = await handoffVariable(state.gitBranch, api, config);
  const project = config.vercel.resourceProjectId;
  // Config, not Secret: preview:setup must read this value back. upsert covers a key the
  // list call missed. A full project document still rejects a brand-new key.
  const body = { key: handoffKey(state.gitBranch), value: JSON.stringify(privateHandoff(state)), type: "encrypted", visibility: "config", target: ["development"] };
  await api.request(existing ? `/v9/projects/${project}/env/${existing.id}` : `/v10/projects/${project}/env?upsert=true`, { method: existing ? "PATCH" : "POST", body });
}
// Best-effort: name the real reason a branch has no environment. Returns [] when gh is unusable.
export function missingEnvironmentReason(gitBranch, gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 })) {
  let enabled;
  try {
    const variables = JSON.parse(gh("variable", "list", "--json", "name,value"));
    enabled = variables.find((v) => v.name === "MANAGED_PREVIEWS_ENABLED")?.value === "true";
  } catch { return []; }
  if (!enabled) return ["Managed previews are not enabled (repository variable MANAGED_PREVIEWS_ENABLED is not 'true'), so CI will not create environments. An authorized operator must enable it (docs/PREVIEW_ENVIRONMENTS.md, cutover step 2)."];
  try {
    // Previews only run for same-repository PRs that target main.
    const prs = JSON.parse(gh("pr", "list", "--head", gitBranch, "--state", "open", "--base", "main", "--json", "number,isCrossRepository,files,author,headRefName")).filter((pr) => !pr.isCrossRepository);
    if (!prs.length) return [`Branch ${gitBranch} has no open same-repository PR targeting main; push it and open one.`];
    const pr = prs[0];
    const decision = previewDatabaseDecision({
      files: Array.isArray(pr.files) ? pr.files : undefined,
      author: pr.author,
      branch: pr.headRefName || gitBranch,
    });
    if (decision.skip) return [decision.reason];
    return [`PR #${pr.number} is open: wait for CI and the Managed previews run to pass.`];
  } catch { return []; }
}
export async function fetchPreviewHandoff(gitBranch, { api = new VercelPreviewApi(), config = readInfrastructureConfig() } = {}) {
  const variable = await handoffVariable(gitBranch, api, config);
  if (!variable) {
    const reasons = missingEnvironmentReason(gitBranch);
    throw new Error(["No hosted environment exists for this branch yet.", ...(reasons.length ? reasons : ["Open its PR and wait for Managed previews, then run preview:setup again."]), "Branches that already have one: see preview:status on them. Never reuse another branch's credentials."].join("\n- "));
  }
  const { value } = await api.request(`/v1/projects/${config.vercel.resourceProjectId}/env/${variable.id}`);
  let state;
  try { state = JSON.parse(value); } catch { throw new Error("Private preview handoff is malformed; no credentials were saved."); }
  if (state.gitBranch !== gitBranch || state.key !== branchKey(gitBranch)) throw new Error("Private handoff belongs to another Git branch.");
  const { sql } = await verifyPreviewState(state, localChecksums(), config);
  await retainPreview(sql);
  return privateHandoff(state);
}
