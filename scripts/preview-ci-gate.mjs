#!/usr/bin/env node
// Runs before npm ci. Node built-ins and repository JSON only; no install.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readInfrastructureConfig } from "./lib/migration-baseline.mjs";
import { isDependabotPullRequest, previewDatabaseDecision } from "./lib/preview-change-scope.mjs";
import { findValidatedPullRequest, listPullRequestFiles } from "./lib/pull-request-files.mjs";

const CONFIRMATION_FAILURE = /nothing deployed|may provision a preview|Could not confirm current PR/;

export async function decidePreviewGate(run, { repository, token, fetcher } = {}) {
  if (isDependabotPullRequest({ author: run?.actor?.login, branch: run?.head_branch })) {
    return { needed: false, reason: "Dependabot pull requests do not get a Neon preview branch." };
  }
  const pr = await findValidatedPullRequest(run, { repository, token, fetcher });
  const files = await listPullRequestFiles(repository, pr.number, { token, fetcher });
  const decision = previewDatabaseDecision({ files, author: pr.user?.login ?? pr.user, branch: pr.head?.ref });
  return {
    needed: !decision.skip,
    reason: decision.reason || "This pull request changes prisma/, src/, or scripts/.",
  };
}

function publish(result) {
  const needed = result.needed ? "true" : "false";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
  if (!result.needed) console.log(`::notice title=Neon preview skipped::${result.reason}`);
  console.log(JSON.stringify({ needed: result.needed, reason: result.reason }));
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  try {
    publish(await decidePreviewGate(event.workflow_run, {
      repository: readInfrastructureConfig().repository,
      token: process.env.GITHUB_TOKEN,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not classify the pull request";
    if (CONFIRMATION_FAILURE.test(message)) {
      console.error(message);
      process.exitCode = 1;
      return;
    }
    console.error(message);
    publish({ needed: true, reason: "Could not classify changed files; provisioning continues." });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
