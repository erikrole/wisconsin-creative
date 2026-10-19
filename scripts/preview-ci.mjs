#!/usr/bin/env node
// Executed from the default branch. PR source is uploaded, never executed here.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { provisionPreview } from "./lib/provision-preview.mjs";
import { deployManagedPreview } from "./deploy-managed-preview.mjs";
import { readInfrastructureConfig } from "./lib/migration-baseline.mjs";
import { verifyHostedPreview } from "./lib/verify-hosted-preview.mjs";
import { previewDatabaseDecision } from "./lib/preview-change-scope.mjs";
import { findValidatedPullRequest, listPullRequestFiles } from "./lib/pull-request-files.mjs";
const config = readInfrastructureConfig();
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
const token = process.env.GITHUB_TOKEN;
const pr = await findValidatedPullRequest(run, { repository: config.repository, token });
const files = await listPullRequestFiles(config.repository, pr.number, { token });
const change = { files, author: pr.user?.login ?? pr.user, branch: pr.head.ref };
const decision = previewDatabaseDecision(change);
if (decision.skip) {
  console.log(`::notice title=Neon preview skipped::${decision.reason}`);
  console.log(JSON.stringify({ skipped: true, pr: pr.number, sha: run.head_sha, reason: decision.reason }));
  process.exit(0);
}
for (const args of [["fetch", "--no-tags", "origin", run.head_sha], ["worktree", "add", "--detach", ".tmp/preview-source", run.head_sha]]) {
  const r = spawnSync("git", args, { encoding: "utf8" }); if (r.status !== 0) throw new Error("Could not prepare the exact validated PR commit");
}
const state = await provisionPreview(pr.head.ref, { change });
if (state?.skipped) {
  console.log(`::notice title=Neon preview skipped::${state.reason}`);
  console.log(JSON.stringify({ skipped: true, pr: pr.number, sha: run.head_sha, reason: state.reason }));
  process.exit(0);
}
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
const currentResponse = await fetch(`https://api.github.com/repos/${config.repository}/pulls/${pr.number}`, { headers, signal: AbortSignal.timeout(30_000) });
if (!currentResponse.ok) throw new Error("Could not recheck PR before deployment");
const current = await currentResponse.json();
if (current.state !== "open" || current.head.sha !== run.head_sha || current.head.ref !== run.head_branch) throw new Error("PR changed while provisioning; deployment skipped");
const result = await deployManagedPreview(state, ".tmp/preview-source");
await verifyHostedPreview(result.id, state);
console.log(JSON.stringify({ pr: pr.number, sha: run.head_sha, branch: state.branchId, deployment: result.id, url: result.url }));
