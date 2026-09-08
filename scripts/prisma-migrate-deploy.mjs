#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import "dotenv/config";
import { resolvePrismaDirectUrl } from "./lib/prisma-direct-url.mjs";
import { evaluateMigrationHealth } from "./prisma-migrate-health.mjs";

const migrationsDir = join(process.cwd(), "prisma", "migrations");
const blankSchemaEnginePattern = /Error:\s*Schema engine error:\s*$/m;
// P1001/P1011: the engine can't establish a usable Postgres connection on
// 5432 (some networks block or reset direct TLS connections); the Neon HTTP
// driver still works, so fall back for those transport failures too.
const unreachableDbPattern = /P1001|P1011/;

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function main() {
  const { connectionString, source } = resolvePrismaDirectUrl();
  const migrationEnvironment = { ...process.env, DIRECT_URL: connectionString };
  if (source === "DATABASE_URL_UNPOOLED") {
    console.log("Using DATABASE_URL_UNPOOLED for Prisma migration deploy.");
  }

  const deploy = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: migrationEnvironment,
    encoding: "utf8",
  });

  if (deploy.status === 0) {
    process.stdout.write(deploy.stdout);
    process.stderr.write(deploy.stderr);
    return;
  }

  const deployOutput = `${deploy.stdout ?? ""}${deploy.stderr ?? ""}`;
  if (!blankSchemaEnginePattern.test(deployOutput) && !unreachableDbPattern.test(deployOutput)) {
    process.stdout.write(deploy.stdout ?? "");
    process.stderr.write(deploy.stderr ?? "");
    process.exit(deploy.status ?? 1);
  }

  process.stdout.write(deploy.stdout ?? "");
  process.stderr.write(deploy.stderr ?? "");
  console.warn(
    "Prisma schema engine could not connect; checking history before atomic Neon HTTP migration apply.",
  );

  const sql = neon(connectionString);

  const appliedRows = await sql`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM _prisma_migrations
  `;
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sources = Object.fromEntries(migrations.map((name) => {
    const migrationPath = join(migrationsDir, name, "migration.sql");
    if (!existsSync(migrationPath)) {
      throw new Error(`Missing migration.sql for ${name}`);
    }
    return [name, readFileSync(migrationPath, "utf8")];
  }));
  const checksums = Object.fromEntries(migrations.map((name) => [name, hashSql(sources[name])]));
  const pending = assertFallbackHistory(checksums, appliedRows);
  // Validate every pending file before the first write. HTTP cannot safely run
  // non-transactional migrations or SQL that commits the driver's transaction.
  const plans = pending.map((name) => buildFallbackTransaction(name, sources[name], checksums));

  for (const plan of plans) {
    console.log(`Applying ${plan.name} atomically via Neon HTTP fallback`);
    await applyFallbackMigration(sql, plan);
  }

  if (plans.length === 0) {
    console.log("Neon HTTP fallback found no pending migrations.");
  } else {
    console.log(`Neon HTTP fallback applied ${plans.length} migration(s).`);
  }
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function hashSql(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function assertFallbackHistory(checksums, rows) {
  const health = evaluateMigrationHealth(Object.keys(checksums).sort(), rows, checksums);
  if (health.unresolvedFailed.length || health.appliedDbOnly.length
    || health.checksumMismatches.length || health.unverifiedChecksums.length) {
    throw new Error("Refusing Neon HTTP fallback: migration history is failed, missing locally, or has unverified/changed checksums. Run db:migrate:health and reconcile before retrying.");
  }
  return health.pending;
}

export function buildFallbackTransaction(name, source, checksums) {
  const checksum = hashSql(source);
  if (checksums[name] !== checksum) throw new Error(`SQL checksum changed while preparing ${name}`);
  const statements = splitSqlStatements(source).filter((statement) => stripLeadingComments(statement));
  for (const statement of statements) {
    const command = stripLeadingComments(statement);
    if (/^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION|SAVEPOINT|RELEASE)\b/i.test(command)
      || /\bCONCURRENTLY\b/i.test(command) || /^VACUUM\b/i.test(command)) {
      throw new Error(`Refusing non-transactional SQL in ${name}; use a reviewed direct Prisma migration path.`);
    }
  }
  const id = randomUUID();
  return {
    id, name, checksum,
    queries: [
      { text: `SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '60s', true),
          set_config('wc.migration_name', $1, true), set_config('wc.migration_checksums', $2, true)`,
        values: [name, JSON.stringify(checksums)] },
      { text: `DO $guard$
        BEGIN
          -- Prisma's migration advisory-lock key; try rather than wait so a
          -- concurrent CREATE INDEX CONCURRENTLY cannot deadlock on this reader.
          IF NOT pg_try_advisory_xact_lock(72707369) THEN
            RAISE EXCEPTION 'Another migration is running; inspect health before retrying' USING ERRCODE = '55P03';
          END IF;
          IF EXISTS (SELECT 1 FROM _prisma_migrations m WHERE m.rolled_back_at IS NULL
            AND (m.finished_at IS NULL OR m.checksum IS DISTINCT FROM
              (current_setting('wc.migration_checksums')::jsonb ->> m.migration_name))) THEN
            RAISE EXCEPTION 'Migration history changed or needs reconciliation; no SQL applied';
          END IF;
          IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE rolled_back_at IS NULL
            AND migration_name = current_setting('wc.migration_name')) THEN
            RAISE EXCEPTION 'Migration already recorded; re-read history before retrying';
          END IF;
        END $guard$`, values: [] },
      { text: `INSERT INTO _prisma_migrations
          (id, checksum, migration_name, started_at, applied_steps_count)
          VALUES ($1, $2, $3, clock_timestamp(), 0)`, values: [id, checksum, name] },
      ...statements.map((text) => ({ text, values: [] })),
      { text: `UPDATE _prisma_migrations SET finished_at = clock_timestamp(), applied_steps_count = $2
          WHERE id = $1`, values: [id, statements.length] },
    ],
  };
}

export async function applyFallbackMigration(sql, plan) {
  try {
    await sql.transaction(plan.queries.map(({ text, values }) => sql.query(text, values)),
      { isolationLevel: "ReadCommitted" });
  } catch (error) {
    // A lost HTTP response is not proof of rollback. Look up this exact attempt;
    // never replay SQL or mark another attempt as ours after an uncertain result.
    let rows;
    try {
      rows = await sql.query(`SELECT checksum, finished_at, rolled_back_at FROM _prisma_migrations WHERE id = $1`, [plan.id]);
    } catch {
      throw new Error(`Migration ${plan.name} outcome is unverified; inspect history before retrying.`, { cause: error });
    }
    if (rows.length === 1 && rows[0].checksum === plan.checksum
      && rows[0].finished_at && !rows[0].rolled_back_at) return;
    throw new Error(`Migration ${plan.name} did not confirm completion; no automatic retry. Inspect history before retrying.`, { cause: error });
  }
}

function stripLeadingComments(source) {
  let text = source.trimStart();
  while (text.startsWith("--") || text.startsWith("/*")) {
    if (text.startsWith("--")) {
      const end = text.indexOf("\n");
      text = end === -1 ? "" : text.slice(end + 1).trimStart();
    } else {
      let depth = 1;
      let index = 2;
      while (index < text.length && depth) {
        if (text.startsWith("/*", index)) { depth += 1; index += 2; }
        else if (text.startsWith("*/", index)) { depth -= 1; index += 2; }
        else index += 1;
      }
      if (depth) throw new Error("Unterminated SQL comment");
      text = text.slice(index).trimStart();
    }
  }
  return text.trim();
}

export function splitSqlStatements(source) {
  const statements = [];
  let current = "";
  let quote = null;
  let dollarTag = null;
  let lineComment = false;
  let blockComment = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "/" && next === "*") {
        current += next;
        index += 1;
        blockComment += 1;
      } else if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment -= 1;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += char + next;
      index += 1;
      blockComment = 1;
      continue;
    }

    if (char === "'" || char === '"') {
      current += char;
      quote = char;
      continue;
    }

    if (char === "$") {
      const tag = readDollarTag(source, index);
      if (tag) {
        current += tag;
        index += tag.length - 1;
        dollarTag = tag;
        continue;
      }
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function readDollarTag(source, start) {
  const end = source.indexOf("$", start + 1);
  if (end === -1) return null;
  const tag = source.slice(start, end + 1);
  return /^\$[A-Za-z_][A-Za-z0-9_]*\$$|^\$\$$/.test(tag) ? tag : null;
}
