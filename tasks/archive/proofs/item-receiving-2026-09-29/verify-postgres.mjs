import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

// This runner owns the entire cluster. It never accepts a database URL or
// connects to TCP, and does not create or fabricate migration receipts.
const directory = mkdtempSync(join(realpathSync("/tmp"), "wc-custody-pg-"));
const data = join(directory, "data");
const url = `postgresql://custody_test@localhost:5432/custody_test?host=${encodeURIComponent(directory)}`;
const environment = { ...process.env, DATABASE_URL: url, DIRECT_URL: url,
  DATABASE_URL_UNPOOLED: url, PRISMA_SCHEMA_URL: url, WC_CUSTODY_TEST_DATABASE_URL: url };
let started = false;
function run(command, args, env = environment) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
try {
  run("initdb", ["-D", data, "-A", "trust", "-U", "custody_test", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-w", "-o", `-k ${directory} -c listen_addresses=''`, "start"]);
  started = true;
  run("createdb", ["-h", directory, "-U", "custody_test", "custody_test"]);
  // Generated schema is sufficient for transaction/receipt behavior, not for
  // accepting migration-only constraints, triggers, or production migrations.
  run(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]);
  run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.postgres.config.ts", "tests/postgres/intake-receipt.postgres.ts"]);
} finally {
  if (started) run("pg_ctl", ["-D", data, "-w", "-m", "immediate", "stop"]);
  rmSync(directory, { recursive: true, force: true });
}
