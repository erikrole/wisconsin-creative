import { branchKey, previewRuntimeEnvironment, verifyPreviewState } from "./preview-environment.mjs";
import { readInfrastructureConfig } from "./migration-baseline.mjs";
import { localChecksums } from "./local-migrations.mjs";
import { VercelPreviewApi } from "./vercel-preview-api.mjs";
import { retainPreview } from "./preview-lifecycle.mjs";

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
  const body = { key: handoffKey(state.gitBranch), value: JSON.stringify(privateHandoff(state)), type: "encrypted", target: ["development"] };
  await api.request(existing ? `/v9/projects/${project}/env/${existing.id}` : `/v10/projects/${project}/env`, { method: existing ? "PATCH" : "POST", body });
}
export async function fetchPreviewHandoff(gitBranch, { api = new VercelPreviewApi(), config = readInfrastructureConfig() } = {}) {
  const variable = await handoffVariable(gitBranch, api, config);
  if (!variable) throw new Error("No hosted environment exists for this branch yet. Open its PR and wait for Managed previews, then run preview:setup again.");
  const { value } = await api.request(`/v1/projects/${config.vercel.resourceProjectId}/env/${variable.id}`);
  let state;
  try { state = JSON.parse(value); } catch { throw new Error("Private preview handoff is malformed; no credentials were saved."); }
  if (state.gitBranch !== gitBranch || state.key !== branchKey(gitBranch)) throw new Error("Private handoff belongs to another Git branch.");
  const { sql } = await verifyPreviewState(state, localChecksums(), config);
  await retainPreview(sql);
  return privateHandoff(state);
}
