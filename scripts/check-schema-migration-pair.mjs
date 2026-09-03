#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = "prisma/schema.prisma";
const MIGRATION_SQL_PATTERN = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

export function evaluateSchemaMigrationPair({ changedPaths, prismaDiff }) {
  if (!changedPaths.includes(SCHEMA_PATH)) {
    return { ok: true, reason: "schema-unchanged" };
  }

  if (changedPaths.some((path) => MIGRATION_SQL_PATTERN.test(path))) {
    return { ok: true, reason: "migration-paired" };
  }

  const hasPhysicalChange = /\b(?:CREATE|ALTER|DROP|RENAME)\b/i.test(prismaDiff);
  if (!hasPhysicalChange) {
    return { ok: true, reason: "no-physical-change" };
  }

  return {
    ok: false,
    reason: "missing-migration",
    error: "prisma/schema.prisma has physical database changes, but this change adds no prisma/migrations/*/migration.sql file.",
  };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBaseSha(args) {
  const index = args.indexOf("--base");
  const requested = index >= 0 ? args[index + 1] : process.env.MIGRATION_GUARD_BASE_SHA;
  if (requested && !/^0+$/.test(requested)) return requested;

  return git(["rev-parse", "HEAD^"]);
}

function generatePrismaDiff(baseSha) {
  const baseSchema = git(["show", `${baseSha}:${SCHEMA_PATH}`]);
  const tempDir = mkdtempSync(join(tmpdir(), "schema-migration-guard-"));
  const baseSchemaPath = join(tempDir, "schema.prisma");

  try {
    writeFileSync(baseSchemaPath, `${baseSchema}\n`);
    const result = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datamodel",
        baseSchemaPath,
        "--to-schema-datamodel",
        SCHEMA_PATH,
        "--script",
      ],
      { encoding: "utf8" },
    );

    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Prisma migration diff failed");
    }

    return result.stdout;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const baseSha = resolveBaseSha(process.argv.slice(2));
  const changedPaths = git(["diff", "--name-only", baseSha, "HEAD"])
    .split("\n")
    .filter(Boolean);

  if (!changedPaths.includes(SCHEMA_PATH)) {
    console.log("OK: Prisma schema is unchanged from the CI base commit.");
    return;
  }

  const prismaDiff = generatePrismaDiff(baseSha);
  const result = evaluateSchemaMigrationPair({ changedPaths, prismaDiff });

  if (!result.ok) {
    console.error(`Schema migration guard failed: ${result.error}`);
    console.error("Generate and commit the migration SQL before deploying this schema change.");
    process.exit(1);
  }

  if (result.reason === "migration-paired") {
    console.log("OK: Prisma schema change is paired with migration SQL.");
  } else {
    console.log("OK: Prisma schema change has no physical database DDL.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
