#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { currentBranch, previewStatePath, readPreviewState, savePreviewState, verifyPreviewState, localPreviewEnvironment, availablePreviewPort } from "./lib/preview-environment.mjs";
import { fetchPreviewHandoff } from "./lib/preview-handoff.mjs";
import { retainPreview } from "./lib/preview-lifecycle.mjs";
import { provisionPreview } from "./lib/provision-preview.mjs";
import { localChecksums } from "./lib/local-migrations.mjs";
import { acquireProcessLock } from "./lib/process-lock.mjs";
import { writeDotenvValue } from "./ensure-dev-env.mjs";
import { readMigrationRows } from "./lib/migration-baseline.mjs";
import { assertFallbackHistory } from "./prisma-migrate-deploy.mjs";

const root = process.cwd(), mode = process.argv[2] ?? "status";
const serverPath = join(root, ".tmp", "preview-server.json");
const show = (state, extra = {}) => console.log(JSON.stringify({ gitBranch: state.gitBranch, projectId: state.projectId, branchId: state.branchId, endpointId: state.endpointId, ...extra }, null, 2));
async function run(script, environment, args = [], lease) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env: environment, stdio: "inherit" });
  if (child.pid) lease?.registerChild(child.pid);
  const stop = (signal) => child.kill(signal);
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try { return await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); }); }
  finally { lease?.registerChild(null); process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
try {
  let state;
  if (mode === "setup") {
    const branch = currentBranch(root);
    if (existsSync(previewStatePath(branch, root))) {
      state = readPreviewState(root); await verifyPreviewState(state, localChecksums());
    } else {
      state = process.env.NEON_API_KEY && process.env.PREVIEW_SIGNING_KEY
        ? await provisionPreview(branch) : await fetchPreviewHandoff(branch);
      savePreviewState(state, root);
    }
    show(state, { status: "ready", next: "npm run dev:preview" });
  } else if (mode === "attach") {
    state = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : await fetchPreviewHandoff(currentBranch(root));
    if (state.gitBranch !== currentBranch(root)) throw new Error("Environment belongs to another Git branch");
    await verifyPreviewState(state, localChecksums()); savePreviewState(state); show(state, { status: "attached" });
  } else {
    state = readPreviewState(root);
    const { sql, baseline } = await verifyPreviewState(state, localChecksums());
    const pending = assertFallbackHistory(localChecksums(), await readMigrationRows(sql), baseline);
    if (["pin", "unpin"].includes(mode)) {
      await retainPreview(sql, mode === "pin");
      show(state, { pinned: mode === "pin" });
    } else if (["status", "doctor"].includes(mode)) {
      show(state, { status: pending.length ? "migration-needed" : "ready", pending, templateVerified: true });
    } else if (mode === "dev") {
      await retainPreview(sql);
      const lease = acquireProcessLock(join(root, ".tmp", "preview-server.lock"));
      try {
        const port = await availablePreviewPort(root);
        const environment = localPreviewEnvironment(state, port);
        if (pending.length) {
          const code = await run("scripts/prisma-migrate-deploy.mjs", environment, [], lease);
          if (code) throw new Error("Preview migration failed; server was not started");
        }
        for (const key of ["PLAYWRIGHT_EMAIL", "PLAYWRIGHT_PASSWORD", "PLAYWRIGHT_ROLE", "PLAYWRIGHT_BASE_URL", "PLAYWRIGHT_TARGET_ISOLATED", "SESSION_COOKIE_NAME"]) {
          writeDotenvValue(join(root, ".env.development.local"), key, environment[key]);
        }
        mkdirSync(join(root, ".tmp"), { recursive: true });
        writeFileSync(serverPath, JSON.stringify({ pid: process.pid, gitBranch: state.gitBranch, branchId: state.branchId, port, origin: environment.APP_URL, startedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
        show(state, { url: environment.APP_URL, next: "npm run auth:local" });
        // Changing Git branches under a running server invalidates its contract.
        const watcher = setInterval(() => {
          if (currentBranch(root) !== state.gitBranch) { console.error("Git branch changed; stopping the old preview. Restart on the new branch."); process.kill(process.pid, "SIGTERM"); }
        }, 3_000);
        try { process.exitCode = await run("scripts/run-next.mjs", environment, ["dev", "--hostname", "127.0.0.1", "--port", String(port)], lease); }
        finally { clearInterval(watcher); }
      } finally { lease(); }
    } else if (mode === "auth") {
      if (!existsSync(serverPath)) throw new Error("Start npm run dev:preview first");
      const server = JSON.parse(readFileSync(serverPath, "utf8"));
      if (server.gitBranch !== state.gitBranch || server.branchId !== state.branchId) throw new Error("Running preview belongs to another branch");
      try { process.kill(server.pid, 0); } catch { throw new Error("Recorded preview server is no longer running"); }
      process.exitCode = await run("scripts/bootstrap-local-session.mjs", localPreviewEnvironment(state, server.port));
    } else if (mode === "migrate") {
      await retainPreview(sql);
      process.exitCode = await run("scripts/prisma-migrate-deploy.mjs", localPreviewEnvironment(state, 3000));
    } else throw new Error("Use setup, attach, status, doctor, dev, auth, migrate, pin or unpin");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Preview operation failed");
  process.exitCode = 1;
}
