#!/usr/bin/env node
// Prisma's datamodel omits PostgreSQL-only functions, triggers, checks and
// partial indexes. This generator is only for disposable CI fixtures.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("Empty-database bootstrap is retired: it cannot preserve the full PostgreSQL contract. Use npm run preview:setup to clone the protected sanitized template. Disaster recovery requires a reviewed full-schema restore; migration receipts must never be fabricated.");
  process.exitCode = 1;
}

export function assertBootstrapSafe(tableNames) {
  const unexpected = tableNames.filter((name) => name !== "_prisma_migrations");
  if (unexpected.length) throw new Error(`Refusing bootstrap: target is not empty (${unexpected.join(", ")}).`);
}

export function generateBaselineSql(connectionString = "postgresql://fixture:fixture@127.0.0.1:5432/wc_integrity_test") {
  const environment = connectionString
    ? { ...process.env, DIRECT_URL: connectionString }
    : process.env;
  const result = spawnSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Could not generate baseline SQL.\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
