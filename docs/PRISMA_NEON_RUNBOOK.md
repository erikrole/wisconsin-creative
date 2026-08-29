# Prisma + Neon Runbook

Last updated: 2026-07-03

## Connection Rules

- `DATABASE_URL` is the pooled Neon runtime URL used by the app and `@prisma/adapter-neon`.
- `DIRECT_URL` is the repository's explicit direct Neon URL for Prisma CLI work,
  migration deploys, and migration health inspection.
- `DATABASE_URL_UNPOOLED` is the equivalent direct connection supplied by the
  Neon Vercel integration. Repository migration scripts resolve
  `DIRECT_URL` first, then `DATABASE_URL_UNPOOLED`.
- Do not run DDL through the pooled runtime URL. Migration writers refuse to
  run without `DIRECT_URL` or `DATABASE_URL_UNPOOLED`.
- `DATABASE_URL` remains the pooled runtime URL and is never a migration
  fallback. A key named `DIRECT_URL` that points at a Neon `-pooler` host is
  rejected as well.
- `prisma.config.ts` owns the Prisma CLI datasource and uses the same resolver
  when a direct URL is present. Prisma 6 still requires a schema URL
  syntactically, so the config supplies an internal `PRISMA_SCHEMA_URL`
  placeholder rather than requiring runtime or direct credentials. The config's
  datasource override remains authoritative for real CLI connections.
  Application runtime database access remains configured explicitly by the
  Neon Prisma adapter in `src/lib/db.ts`.
  Schema-only commands may use an inert localhost placeholder; deploy, health,
  bootstrap, and maintenance writers always require an executable direct URL.

## Vercel sensitive variables

Vercel Production and Preview variables marked Sensitive are intentionally
non-readable after creation. Local `vercel env pull`/`vercel env run` output may
therefore contain `[SENSITIVE]` instead of a connection string. The migration
resolver detects that marker before Prisma or the Neon driver runs and explains
the supported paths:

1. run the migration inside the target Vercel build, where sensitive values are
   injected at runtime;
2. provide a direct Neon URL explicitly in the local shell for the one command;
3. use the authenticated Neon operator path for that project and branch.

Do not copy a production database credential into a committed env file, and do
not downgrade it from Sensitive merely to make CLI download work.

## Supported Commands

```bash
npm run db:migrate:new -- --name <feature_name>
npm run db:migrate:check
npm run db:migrate:status
npm run db:migrate:health
npm run db:migrate:deploy
npm run build
```

- `db:migrate:new` (and its create-only compatibility alias `db:migrate:raw`) generates SQL offline by comparing the committed `HEAD` Prisma schema with the working schema. It chooses the next four-digit migration prefix, refuses dirty migration directories, and blocks destructive SQL unless the reviewed task passes `--allow-destructive`. It never connects to a database.
- `db:migrate:check` verifies local migration folder shape, required `migration.sql` files, and prefix uniqueness.
- `db:migrate:status` and `db:migrate:health` run the repo's Neon-backed health checker. They compare local migration folders with live `_prisma_migrations`, fail on pending local migrations, fail on unresolved failed rows, fail on applied DB rows missing locally, and verify the newest local migration is applied.
- `db:migrate:deploy` resolves `DIRECT_URL` or `DATABASE_URL_UNPOOLED`, exports
  the result to Prisma as `DIRECT_URL`, and runs `prisma migrate deploy` first.
  If Prisma exits with the known blank schema-engine error against Neon, the
  wrapper applies pending migration SQL through Neon HTTP and records
  `_prisma_migrations`.
- `build` runs the deploy wrapper before `next build`, so Vercel builds fail early if migration state is not deployable. Use `npm run build:app` for local app compile proof when you are not intentionally validating migration deploy behavior.

Raw `prisma migrate status` is not the source of truth in this repo because the local Prisma schema engine can fail blank against Neon. Use `npm run db:migrate:status` or `npm run db:migrate:health`.

## Normal Migration Flow

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma format`.
3. Create an offline migration with `npm run db:migrate:new -- --name <feature_name>` and inspect the generated SQL.
4. Run `npm run db:migrate:check`.
5. Run `npm run db:migrate:deploy`.
6. Run `npm run db:migrate:health`.
7. Run `npm run build`.
8. Commit schema, migration SQL, docs, and related code together.

## Recovery Rules

- If health reports pending local migrations, run `npm run db:migrate:deploy` and rerun health.
- If health reports unresolved failed rows, inspect `_prisma_migrations` before retrying. Do not edit an applied migration file to force a match.
- If health reports applied DB-only migrations, stop and reconcile the missing migration folder before shipping.
- If Prisma emits the blank schema-engine failure, let the deploy wrapper fallback handle it. Do not reintroduce one-off migration scripts.

## Empty Database Bootstrap

The historical migration chain begins with PostgreSQL constraints against tables that predate migration tracking, so `prisma migrate deploy` cannot initialize a brand-new empty database. For a new isolated environment only, use the guarded bootstrap:

```bash
EMPTY_DATABASE_BOOTSTRAP=confirm \
EMPTY_DATABASE_EXPECTED_HOST=<exact-direct-neon-host> \
DIRECT_URL=<direct-neon-url> \
npm run db:bootstrap:empty
```

The command refuses any target containing application tables, generates the current schema from an offline Prisma empty-to-datamodel diff, restores Prisma-inexpressible exclusion/partial/trigram indexes, and reconciles local migration checksums. It must never be used on production, a database with user data, or as a substitute for normal incremental migrations.

The same historical ordering also prevents raw `prisma migrate dev` from replaying the chain in a fresh shadow database. Generate new migrations through the offline `db:migrate:new` wrapper instead of weakening or rewriting applied migration history.
