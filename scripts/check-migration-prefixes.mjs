#!/usr/bin/env node
// Fails if migration directories are malformed, miss migration.sql, or share
// the same numeric prefix (e.g. 0049_foo and 0049_bar). Run via
// `npm run db:migrate:check` and from pre-commit / CI to catch migration drift.

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const MIGRATION_DIR_PATTERN = /^\d{4}_.+/;

// Historical collisions already applied in prod -- new collisions still fail.
const ALLOWED_COLLISIONS = new Set([
  '0009',
  '0077',
  // These exact migrations were applied from out-of-tree hardening commits
  // before their migration folders were restored to the canonical chain.
  '0104',
  '0105',
  '0106',
  // Applied from the football hardening branch before its migration folder
  // was restored to the canonical chain.
  '0139',
]);

export function inspectMigrationDirectories(entries, options = {}) {
  const allowedCollisions = options.allowedCollisions ?? ALLOWED_COLLISIONS;
  const errors = [];
  const byPrefix = new Map();

  for (const entry of entries) {
    if (!MIGRATION_DIR_PATTERN.test(entry.name)) {
      errors.push(`Invalid migration directory name: ${entry.name}`);
      continue;
    }

    if (!entry.hasMigrationSql) {
      errors.push(`Missing migration.sql: ${entry.name}`);
    }

    const prefix = entry.name.split('_')[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(entry.name);
  }

  for (const [prefix, names] of byPrefix.entries()) {
    if (names.length > 1 && !allowedCollisions.has(prefix)) {
      errors.push(`Migration prefix collision ${prefix}: ${names.join(', ')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    migrationCount: entries.length,
  };
}

function readMigrationEntries(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      hasMigrationSql: existsSync(join(migrationsDir, d.name, 'migration.sql')),
    }));
}

function main() {
  const result = inspectMigrationDirectories(readMigrationEntries(MIGRATIONS_DIR));

  if (result.ok) {
    console.log(`OK: ${result.migrationCount} migrations, no prefix collisions or malformed folders`);
    process.exit(0);
  }

  console.error('Migration directory check failed:');
  for (const error of result.errors) {
    console.error(`  ${error}`);
  }
  console.error('\nFix malformed migration folders, add missing migration.sql files, or');
  console.error('rename duplicate prefixes to the next available prefix. If a renamed');
  console.error('migration was already applied, run `npx prisma migrate resolve --applied <name>`.');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
