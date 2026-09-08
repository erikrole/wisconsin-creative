---
name: gt-migrate
description: "Design, generate, diagnose, or deploy a Wisconsin Creative Prisma/Neon migration using the repository direct-connection wrappers. Distinguish offline schema work from isolated development and live mutation."
---

# GT Migrate

Use [the repository runbook](../../../docs/PRISMA_NEON_RUNBOOK.md), current `package.json`, `prisma.config.ts`, and migration wrapper source. Identify the mode: schema design, generation, history diagnosis, or authorized deployment. Shared rules live in `AGENTS.md`.

## Establish the contract

Before editing, read the schema in full and relevant owner contracts. Record touched models/enums, indexes, unique/exclusion constraints, mappings, nullability/defaults, cascade behavior, and affected callers. Inspect relevant migration history; do not require reading every historical SQL file.

`DATABASE_URL` is pooled runtime access. DDL and live health require the supported direct resolver (`DIRECT_URL`, then `DATABASE_URL_UNPOOLED`). Never use a pooled URL or `[SENSITIVE]` placeholder as a workaround, print credentials, or downgrade sensitive variables.

## Choose safe commands

- Schema-only: inspect current config, then `npx prisma format`, `npx prisma validate`, and client generation as needed. Read the complete resulting diff.
- Generation: `db:migrate:new` currently invokes `prisma migrate dev`, which can change a database and use a shadow database. Use an identified isolated development target. `db:migrate:raw` uses `--create-only` but still requires safe database/shadow configuration; it is not an offline command. Never accept a reset of shared data.
- Local checks: `npm run db:migrate:check` and the relevant schema/migration-pair guard after reviewing its base-ref behavior.
- Live history: `npm run db:migrate:health`/`status` via repository wrappers. Missing direct access means live history is unverified, not clean.
- Deployment: `npm run db:migrate:deploy` only for the authorized target. `npm run build` also deploys migrations; `build:app` is compile-only with its own dev-server guard.

Never edit applied migration SQL or manually rewrite `_prisma_migrations` to force success. Use the reviewed wrapper fallback for the known blank schema-engine error. Reconcile pending/failed/DB-only history before another attempt; do not retry under a different migration name.

Keep long backfills separate and bounded. The empty-database bootstrap is only for a verified empty isolated environment, never production or a repair shortcut.

Finish independent source/SQL review when live access is blocked. Report generated, locally checked, applied, live-health verified, and deployed states separately, with the remaining target-specific gate. Existing authorization is reusable; ask only for missing authority or an unresolved destructive change.
