#!/usr/bin/env node
// Executed from the default branch. PR source is uploaded, never executed here.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { provisionPreview } from "./lib/provision-preview.mjs";
import { deployManagedPreview } from "./deploy-managed-preview.mjs";
import { readInfrastructureConfig } from "./lib/migration-baseline.mjs";
import { verifyHostedPreview } from "./lib/verify-hosted-preview.mjs";
const config = readInfrastructureConfig();
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
if (!run || run.event !== "pull_request" || run.conclusion !== "success" || run.head_repository?.full_name !== config.repository || !/^[a-f0-9]{40}$/.test(run.head_sha)) throw new Error("Only successful same-repository PR validation may provision a preview");
const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
const response = await fetch(`https://api.github.com/repos/${config.repository}/commits/${run.head_sha}/pulls`, { headers, signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Could not confirm current PR: ${response.status}`);
const prs = await response.json();
const pr = prs.find((p) => p.state === "open" && p.base.ref === "main" && p.head.sha === run.head_sha && p.head.ref === run.head_branch && p.head.repo?.full_name === config.repository);
if (!pr) throw new Error("Validated commit is no longer the head of an open same-repository PR; nothing deployed");
for (const args of [["fetch", "--no-tags", "origin", run.head_sha], ["worktree", "add", "--detach", ".tmp/preview-source", run.head_sha]]) {
  const r = spawnSync("git", args, { encoding: "utf8" }); if (r.status !== 0) throw new Error("Could not prepare the exact validated PR commit");
}
const state = await provisionPreview(pr.head.ref);
const currentResponse = await fetch(`https://api.github.com/repos/${config.repository}/pulls/${pr.number}`, { headers, signal: AbortSignal.timeout(30_000) });
if (!currentResponse.ok) throw new Error("Could not recheck PR before deployment");
const current = await currentResponse.json();
if (current.state !== "open" || current.head.sha !== run.head_sha || current.head.ref !== run.head_branch) throw new Error("PR changed while provisioning; deployment skipped");
const result = await deployManagedPreview(state, ".tmp/preview-source");
await verifyHostedPreview(result.id, state);
console.log(JSON.stringify({ pr: pr.number, sha: run.head_sha, branch: state.branchId, deployment: result.id, url: result.url }));
