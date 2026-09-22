#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { acquireProcessLock } from "./lib/process-lock.mjs";

const require = createRequire(import.meta.url);
const [mode, ...args] = process.argv.slice(2);
if (!["dev", "build", "build:app", "analyze", "start"].includes(mode)) throw new Error("Unknown Next operation");
const release = acquireProcessLock(join(process.cwd(), ".tmp", mode === "dev" ? "next-dev.lock" : "next-build.lock"));
let child;
let stopping = false;
const environment = { ...process.env, WC_NEXT_MODE: mode, NODE_ENV: mode === "dev" ? "development" : "production", ...(mode === "analyze" ? { ANALYZE: "true" } : {}) };
const onSignal = (signal) => { stopping = true; child?.kill(signal); };
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

async function run(argv) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, argv, { cwd: process.cwd(), env: environment, stdio: "inherit" });
    if (child.pid) release.registerChild(child.pid);
    child.once("error", reject);
    child.once("exit", (code) => { release.registerChild(null); resolve(code ?? 1); });
  });
}
try {
  let code = mode === "build" ? await run(["scripts/prisma-migrate-deploy.mjs"]) : 0;
  if (!code && !stopping) code = await run([require.resolve("next/dist/bin/next"), ["dev", "start"].includes(mode) ? mode : "build", ...args]);
  process.exitCode = code || (stopping ? 1 : 0);
} finally {
  release();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}
