#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePreviewUpload } from "./lib/preview-upload.mjs";
import { readInfrastructureConfig } from "./lib/migration-baseline.mjs";
import { VercelPreviewApi } from "./lib/vercel-preview-api.mjs";

const commit = process.argv[2], config = readInfrastructureConfig();
if (!/^[a-f0-9]{40}$/.test(commit ?? "")) throw new Error("Supply an exact reviewed commit SHA from origin/main. Default is plan-only; --apply refreshes the review site.");
if (spawnSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"]).status) throw new Error("Commit is not on the locally fetched origin/main; fetch and inspect first.");
const project = await new VercelPreviewApi().request(`/v9/projects/${config.vercel.reviewProjectId}`);
if (project.id !== config.vercel.reviewProjectId || project.link) throw new Error("Review project identity or manual-only policy differs; nothing deployed.");
console.log(JSON.stringify({ project: project.id, commit, apply: process.argv.includes("--apply") }));
if (process.argv.includes("--apply")) {
  const source = mkdtempSync(join(tmpdir(), "wc-review-source-"));
  let upload;
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", commit], { maxBuffer: 256 * 1024 * 1024 });
    if (spawnSync("tar", ["-xf", "-", "-C", source], { input: archive }).status) throw new Error("Could not prepare the exact review source");
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", commit], { encoding: "utf8" }).split("\0").filter(Boolean);
    const trustedConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    upload = preparePreviewUpload(source, trustedConfig, { files });
    const args = ["deploy", upload.path, "--yes", "--prod", "--project", config.vercel.reviewProjectId, "--scope", config.vercel.teamId,
      "--archive=tgz", "--json", "--env", "WC_ENVIRONMENT=review", "--build-env", "WC_ENVIRONMENT=review", "--meta", `reviewCommit=${commit}`];
    if (process.env.VERCEL_TOKEN) args.push("--token", process.env.VERCEL_TOKEN);
    const result = spawnSync("vercel", args, { cwd: upload.path, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, VERCEL_TELEMETRY_DISABLED: "1", NO_UPDATE_NOTIFIER: "1" }, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (result.status) throw new Error("Manual review refresh failed; inspect review deployments before retrying.");
    const deployment = JSON.parse(result.stdout);
    console.log(JSON.stringify({ project: project.id, commit, deployment: deployment.id, url: deployment.url, status: deployment.readyState }));
  } finally { upload?.dispose(); rmSync(source, { recursive: true, force: true }); }
}
