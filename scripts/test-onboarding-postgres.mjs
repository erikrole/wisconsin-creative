#!/usr/bin/env node
// Own disposable cluster, Unix socket only. Never accepts an app database URL.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { generateBaselineSql } from "./bootstrap-empty-database.mjs";

const require = createRequire(import.meta.url);
const configured = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
if (configured.status !== 0) throw new Error("PostgreSQL server tools are required.");
const binaries = configured.stdout.trim();
const root = mkdtempSync(join(realpathSync("/tmp"), "wc-onboarding-pg-"));
const data = join(root, "data");
const socket = join(root, "socket");
mkdirSync(socket, { mode: 0o700 });
const connection = new URL("postgresql://wc_onboarding_test@localhost/wc_onboarding_test");
connection.searchParams.set("host", socket);
const environment = {
  ...process.env, DATABASE_URL: connection.href, DIRECT_URL: connection.href,
  DATABASE_URL_UNPOOLED: connection.href, PRISMA_SCHEMA_URL: connection.href,
  WC_ONBOARDING_POSTGRES_ROOT: root, WC_ONBOARDING_POSTGRES_URL: connection.href,
  SESSION_SECRET: "disposable-onboarding-session-secret-only",
  RESEND_API_KEY: "", SENTRY_DSN: "", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "",
  KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
};
function run(command, args, input) {
  const result = spawnSync(command, args, { env: environment, encoding: "utf8", input });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}
let started = false;
let child;
const stop = (signal) => child?.kill(signal);
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  run(join(binaries, "initdb"), ["-D", data, "-A", "trust", "-U", "wc_onboarding_test", "--no-locale", "--encoding=UTF8"]);
  started = true;
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(root, "server.log"), "-o", `-F -h '' -k ${socket} -c unix_socket_permissions=0700 -c max_connections=20`, "-w", "-t", "10", "start"]);
  const admin = new URL(connection); admin.pathname = "/postgres";
  run(join(binaries, "psql"), [admin.href, "-X", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE wc_onboarding_test"]);
  if (run(join(binaries, "psql"), [connection.href, "-X", "-Atc", "SHOW listen_addresses"]).trim() !== "") throw new Error("Disposable server permits TCP unexpectedly.");
  run(join(binaries, "psql"), [connection.href, "-X", "-v", "ON_ERROR_STOP=1"], generateBaselineSql(connection.href));
  console.log("Disposable PostgreSQL: current Prisma schema; Unix socket only.");
  process.exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [require.resolve("vitest/vitest.mjs"), "run", "--config", "vitest.onboarding-postgres.config.ts"], { env: environment, stdio: "inherit" });
    child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  let stopped = !started;
  if (started) {
    const status = () => spawnSync(join(binaries, "pg_ctl"), ["-D", data, "status"], { env: environment, encoding: "utf8" });
    if (status().status === 0) spawnSync(join(binaries, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "-t", "10", "stop"], { env: environment, encoding: "utf8" });
    stopped = status().status === 3;
  }
  if (stopped) { rmSync(root, { recursive: true, force: true }); console.log("Disposable cluster stopped and removed."); }
  else { process.exitCode = 1; console.error(`Retained owned cluster for recovery: ${root}`); try { console.error(readFileSync(join(root, "server.log"), "utf8")); } catch {} }
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
}
