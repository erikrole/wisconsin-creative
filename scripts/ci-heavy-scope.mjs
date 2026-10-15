#!/usr/bin/env node
// First step of the required CI jobs. Fail safe: uncertainty runs the heavy checks.
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { needsHeavyChecks, pathsFromNameStatus } from "./lib/preview-change-scope.mjs";

function publish(heavy, reason) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `heavy=${heavy ? "true" : "false"}\n`);
  console.log(JSON.stringify({ heavy, reason }));
}

if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
  publish(true, "Not a pull request; running the heavy checks.");
} else {
  const base = process.env.BASE_SHA ?? "";
  const head = process.env.HEAD_SHA ?? "";
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) {
    publish(true, "Missing pull request SHAs; running the heavy checks.");
  } else {
    const diff = spawnSync("git", ["diff", "--name-status", "--find-renames", `${base}...${head}`], { encoding: "utf8" });
    if (diff.status !== 0) publish(true, "git diff failed; running the heavy checks.");
    else {
      const files = pathsFromNameStatus(diff.stdout);
      const heavy = needsHeavyChecks(files);
      publish(heavy, heavy ? "App, test, workflow, or other non-doc paths changed." : "Docs-only pull request; skipping install, tests, build, and the database run.");
    }
  }
}
