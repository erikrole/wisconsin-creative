#!/usr/bin/env node
// End-to-end flow tests: the real Next app against a disposable PostgreSQL
// cluster this script owns (Unix socket only, current Prisma schema, seeded
// test people and gear). Never accepts an app database URL. Flags:
//   --dev   run `next dev` instead of `next start` (no build needed)
//   --keep  leave the database and server up for authoring tests by hand
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { generateBaselineSql } from "./bootstrap-empty-database.mjs";

const require = createRequire(import.meta.url);
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const playwrightArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const dev = flags.has("--dev");
const keep = flags.has("--keep");
const port = Number(process.env.E2E_FLOWS_PORT || 3100);
const baseUrl = `http://localhost:${port}`;

function serverBinaries() {
  const configured = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (configured.status === 0 && existsSync(join(configured.stdout.trim(), "initdb"))) return configured.stdout.trim();
  const versions = existsSync("/usr/lib/postgresql") ? readdirSync("/usr/lib/postgresql").sort((a, b) => Number(b) - Number(a)) : [];
  const found = versions.map((version) => join("/usr/lib/postgresql", version, "bin")).find((dir) => existsSync(join(dir, "initdb")));
  if (!found) throw new Error("PostgreSQL server tools are required.");
  return found;
}
const binaries = serverBinaries();
// initdb refuses root (the cloud sandbox); the server tools then run as the
// postgres user, which owns the cluster directory. Elsewhere they run as-is.
const asPostgres = process.getuid?.() === 0;
const root = mkdtempSync(join(realpathSync("/tmp"), "wc-e2e-flows-pg-"));
const data = join(root, "data");
const socket = join(root, "socket");
mkdirSync(socket, { mode: 0o700 });
if (asPostgres) spawnSync("chown", ["-R", "postgres:postgres", root]);
const connection = new URL("postgresql://wc_e2e_flows@localhost/wc_e2e_flows");
connection.searchParams.set("host", socket);
const seedFile = join(process.cwd(), "test-results", "e2e-flows", "seed.json");
const environment = {
  ...process.env,
  DATABASE_URL: connection.href, DIRECT_URL: connection.href, DATABASE_URL_UNPOOLED: connection.href,
  SESSION_SECRET: "e2e-flows-session-secret-only-never-production-0000000000000000",
  SESSION_COOKIE_NAME: "wc_session",
  APP_URL: baseUrl, TRUSTED_ORIGINS: baseUrl, PORT: String(port),
  RESEND_API_KEY: "", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", CRON_SECRET: "",
  UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "",
  BLOB_READ_WRITE_TOKEN: "", NEXT_TELEMETRY_DISABLED: "1",
  E2E_FLOWS_BASE_URL: baseUrl, E2E_FLOWS_SEED_FILE: seedFile,
};
function pg(tool, args, input) {
  const [command, argv] = asPostgres
    ? ["runuser", ["-u", "postgres", "--", join(binaries, tool), ...args]]
    : [join(binaries, tool), args];
  return spawnSync(command, argv, { env: environment, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}
function run(tool, args, input) {
  const result = pg(tool, args, input);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${tool} failed`);
  return result.stdout;
}
function child(argv, extraEnv = {}) {
  return spawn(process.execPath, argv, { env: { ...environment, ...extraEnv }, stdio: "inherit" });
}
function exited(proc) {
  return new Promise((resolve, reject) => { proc.once("error", reject); proc.once("exit", (code) => resolve(code ?? 1)); });
}
async function waitForServer() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The app did not answer on ${baseUrl} within 3 minutes.`);
}

let started = false;
let server;
const stopServer = (signal = "SIGTERM") => server?.kill(signal);
process.on("SIGINT", () => stopServer("SIGINT"));
process.on("SIGTERM", () => stopServer());
try {
  run("initdb", ["-D", data, "-A", "trust", "-U", "wc_e2e_flows", "--no-locale", "--encoding=UTF8"]);
  started = true;
  run("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o", `-F -h '' -k ${socket} -c unix_socket_permissions=0700 -c max_connections=40`, "-w", "-t", "10", "start"]);
  const admin = new URL(connection); admin.pathname = "/postgres";
  run("psql", [admin.href, "-X", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE wc_e2e_flows"]);
  if (run("psql", [connection.href, "-X", "-Atc", "SHOW listen_addresses"]).trim() !== "") throw new Error("Disposable server permits TCP unexpectedly.");
  // The history does not replay from empty (0001 expects pushed tables), so the
  // schema baseline comes first and the idempotent repair migrations then add
  // the objects the datamodel cannot express: the booking reference sequence,
  // the asset tag sort-key trigger and the allocation overlap guard.
  run("psql", [connection.href, "-X", "-v", "ON_ERROR_STOP=1"], generateBaselineSql(connection.href));
  for (const repair of ["0144_restore_asset_allocation_overlap_guard", "0151_asset_tag_sort_key", "0154_restore_bootstrap_only_postgres_objects"]) {
    run("psql", [connection.href, "-X", "-1", "-v", "ON_ERROR_STOP=1", "-f", join(process.cwd(), "prisma", "migrations", repair, "migration.sql")]);
  }
  mkdirSync(join(process.cwd(), "test-results", "e2e-flows"), { recursive: true });
  const seedCode = await exited(child([join(process.cwd(), "tests", "e2e-flows", "seed.mjs")]));
  if (seedCode !== 0) throw new Error("Seeding the flow database failed.");
  console.log(`Disposable PostgreSQL seeded; starting the app (${dev ? "next dev" : "next start"}) on ${baseUrl}.`);

  const nextBin = require.resolve("next/dist/bin/next");
  server = child([nextBin, dev ? "dev" : "start", "-p", String(port), "-H", "127.0.0.1"], dev ? {} : { NODE_ENV: "production" });
  const serverExit = exited(server).then((code) => { throw new Error(`The app exited early with code ${code}.`); });
  await Promise.race([waitForServer(), serverExit]);

  if (keep) {
    console.log(`\nApp: ${baseUrl}\nDATABASE_URL=${connection.href}\nE2E_FLOWS_BASE_URL=${baseUrl}\nE2E_FLOWS_SEED_FILE=${seedFile}\nPress Ctrl+C to stop.`);
    process.exitCode = await exited(server).catch(() => 1);
  } else {
    const playwright = join(require.resolve("@playwright/test/package.json"), "..", "cli.js");
    process.exitCode = await Promise.race([
      exited(child([playwright, "test", "-c", "playwright.flows.config.ts", ...playwrightArgs])),
      serverExit,
    ]);
  }
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([exited(server).catch(() => 1), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
  let stopped = !started;
  if (started) {
    const status = () => pg("pg_ctl", ["-D", data, "status"]);
    if (status().status === 0) pg("pg_ctl", ["-D", data, "-m", "immediate", "-w", "-t", "10", "stop"]);
    stopped = status().status === 3;
  }
  if (stopped) { rmSync(root, { recursive: true, force: true }); console.log("Disposable cluster stopped and removed."); }
  else { process.exitCode = 1; console.error(`Retained owned cluster for recovery: ${root}`); try { console.error(readFileSync(join(root, "server.log"), "utf8")); } catch {} }
}
