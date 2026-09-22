#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readPreviewState, verifyPreviewState, blockedPreviewKeys, previewRuntimeEnvironment } from "./lib/preview-environment.mjs";
import { localChecksums } from "./lib/local-migrations.mjs";
import { readInfrastructureConfig } from "./lib/migration-baseline.mjs";
import { preparePreviewUpload } from "./lib/preview-upload.mjs";
import { VercelPreviewApi } from "./lib/vercel-preview-api.mjs";

export async function deployManagedPreview(state, sourceRoot = process.cwd(), { cli = "vercel", token = process.env.VERCEL_TOKEN, api = new VercelPreviewApi({ token }) } = {}) {
  await verifyPreviewState(state, localChecksums());
  const config = readInfrastructureConfig();
  // Blank every provider variable, including newly added integration keys.
  // Only this branch's allowlisted credentials are then supplied explicitly.
  const providerEnvironment = await api.request(`/v9/projects/${config.vercel.productionProjectId}/env`);
  if (!Array.isArray(providerEnvironment.envs)) throw new Error("Could not enumerate inherited provider variables; refusing deployment.");
  const environment = {
    ...Object.fromEntries(providerEnvironment.envs.map(({ key }) => [key, ""])),
    ...Object.fromEntries(blockedPreviewKeys.map((key) => [key, ""])),
    ...Object.fromEntries(Object.entries(previewRuntimeEnvironment(state)).filter(([key]) => !key.startsWith("PLAYWRIGHT_"))),
    APP_URL: "", TRUSTED_ORIGINS: "", PASSKEY_RP_ID: "", PASSKEY_ORIGINS: "", WC_ENVIRONMENT: "preview",
  };
  const upload = preparePreviewUpload(resolve(sourceRoot), JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")));
  const args = ["deploy", upload.path, "--yes", "--target=preview", "--project", config.vercel.productionProjectId,
    "--scope", config.vercel.teamId, "--archive=tgz", "--no-wait", "--json",
    "--meta", `wcPreviewBranch=${state.branchId}`, "--meta", `wcPreviewKey=${state.key}`, "--meta", `githubCommitRef=${state.gitBranch}`];
  if (token) args.push("--token", token);
  for (const [key, value] of Object.entries(environment)) args.push("--env", `${key}=${value}`, "--build-env", `${key}=${value}`);
  // Do not inherit privileged provisioner credentials into the upload process.
  let result;
  try { result = spawnSync(cli, args, { cwd: upload.path, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    VERCEL_TELEMETRY_DISABLED: "1", NO_UPDATE_NOTIFIER: "1" }, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } finally { upload.dispose(); }
  if (result.status !== 0) throw new Error("Vercel preview creation failed. Inspect deployment status; no automatic retry or promotion.");
  let deployment;
  try { deployment = JSON.parse(result.stdout); } catch { throw new Error("Vercel response was not JSON; inspect deployments before retrying."); }
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(join(".tmp", "preview-deployment.json"), JSON.stringify({ id: deployment.id, url: deployment.url, branchId: state.branchId, gitBranch: state.gitBranch }, null, 2) + "\n");
  return deployment;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await deployManagedPreview(readPreviewState(), process.argv[2]); console.log(JSON.stringify({ id: result.id, url: result.url, status: result.readyState })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
