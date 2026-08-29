#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectMigrationDirectories } from "./check-migration-prefixes.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const SCHEMA_PATH = "prisma/schema.prisma";
const MIGRATION_NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const DESTRUCTIVE_SQL_PATTERN = /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b/i;

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

async function main() {
  const { name, allowDestructive } = parseArguments(process.argv.slice(2));
  assertCleanMigrationHistory();

  if (runGit(["diff", "--quiet", "HEAD", "--", SCHEMA_PATH]).status === 0) {
    throw new Error(`No Prisma schema changes found relative to HEAD (${SCHEMA_PATH}).`);
  }

  const migrationEntries = readMigrationEntries();
  const inspection = inspectMigrationDirectories(migrationEntries);
  if (!inspection.ok) {
    throw new Error(`Migration directory check failed:\n${inspection.errors.join("\n")}`);
  }

  const directoryName = nextMigrationDirectoryName(migrationEntries.map((entry) => entry.name), name);
  const destination = join(MIGRATIONS_DIR, directoryName);
  if (existsSync(destination)) throw new Error(`Migration directory already exists: ${directoryName}`);

  const temporaryRoot = mkdtempSync(join(tmpdir(), "wisconsin-prisma-migration-"));
  try {
    const baselinePath = join(temporaryRoot, "schema.prisma");
    const baseline = runGit(["show", `HEAD:${SCHEMA_PATH}`]);
    if (baseline.status !== 0 || !baseline.stdout.trim()) {
      throw new Error(`Could not read committed Prisma schema from HEAD.\n${baseline.stderr || baseline.stdout}`);
    }
    writeFileSync(baselinePath, baseline.stdout, "utf8");

    const diff = spawnSync(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datamodel",
        baselinePath,
        "--to-schema-datamodel",
        SCHEMA_PATH,
        "--script",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    if (diff.status !== 0) {
      throw new Error(`Could not generate offline migration SQL.\n${diff.stderr || diff.stdout}`);
    }

    const migrationSql = diff.stdout.trim();
    if (!migrationSql || migrationSql === "-- This is an empty migration.") {
      throw new Error("Prisma schema diff is empty; no migration was created.");
    }
    assertSafeGeneratedSql(migrationSql, { allowDestructive });

    mkdirSync(destination);
    writeFileSync(join(destination, "migration.sql"), `${migrationSql}\n`, "utf8");

    const check = spawnSync("node", ["scripts/check-migration-prefixes.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    if (check.status !== 0) {
      rmSync(destination, { recursive: true, force: true });
      throw new Error(`Generated migration failed repository checks.\n${check.stderr || check.stdout}`);
    }

    console.log(`Created prisma/migrations/${directoryName}/migration.sql`);
    process.stdout.write(check.stdout);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function parseArguments(args) {
  let name = null;
  let allowDestructive = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--name") {
      name = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--allow-destructive") {
      allowDestructive = true;
      continue;
    }
    throw new Error(`Unknown migration option: ${argument}`);
  }

  if (!name || !MIGRATION_NAME_PATTERN.test(name)) {
    throw new Error("Migration name is required and must use lowercase snake_case.");
  }
  return { name, allowDestructive };
}

export function nextMigrationDirectoryName(existingNames, migrationName) {
  if (!MIGRATION_NAME_PATTERN.test(migrationName)) {
    throw new Error("Migration name must use lowercase snake_case.");
  }
  const highestPrefix = existingNames.reduce((highest, name) => {
    const prefix = Number.parseInt(name.split("_")[0] ?? "", 10);
    return Number.isFinite(prefix) ? Math.max(highest, prefix) : highest;
  }, 0);
  const nextPrefix = String(highestPrefix + 1).padStart(4, "0");
  return `${nextPrefix}_${migrationName}`;
}

export function assertSafeGeneratedSql(sql, options = {}) {
  if (!options.allowDestructive && DESTRUCTIVE_SQL_PATTERN.test(sql)) {
    throw new Error(
      "Generated migration contains destructive SQL. Review it, then rerun with --allow-destructive only when the task explicitly authorizes that change.",
    );
  }
}

function assertCleanMigrationHistory() {
  const tracked = runGit(["diff", "--name-only", "HEAD", "--", "prisma/migrations"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "--", "prisma/migrations"]);
  const dirty = [tracked.stdout, untracked.stdout].join("\n").trim();
  if (tracked.status !== 0 || untracked.status !== 0) {
    throw new Error(`Could not inspect migration history.\n${tracked.stderr || untracked.stderr}`);
  }
  if (dirty) {
    throw new Error(`Migration history is already dirty; reconcile it before generating another migration.\n${dirty}`);
  }
}

function readMigrationEntries() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      hasMigrationSql: existsSync(join(MIGRATIONS_DIR, entry.name, "migration.sql")),
    }));
}

function runGit(args) {
  return spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
