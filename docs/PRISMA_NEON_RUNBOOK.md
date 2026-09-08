# Prisma + Neon Runbook

Last updated: 2026-09-07

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

### Preview isolation — 2026-09-07

The default Preview runtime and migration URLs now target Neon branch
`preview-default` (`br-morning-surf-aiuyphxx`), with compute
`ep-winter-leaf-ai0eekhl` at 0.25–1 CU and five-minute autosuspend. This is a
production data clone, not a sanitized fixture. Production endpoint ownership
and credentials were not changed.

Preview uses `DATABASE_URL_UNPOOLED`, not a generic `DIRECT_URL`, so the Neon
integration's branch-specific migration URL can override the default. Never
share a Production `DIRECT_URL` into Preview: it takes precedence over the
branch-specific unpooled URL. Preview also has a separate session secret.

Production APNs, web-push private key, Redis, and all three Blob write tokens
are now scoped to Production only. Preview push and uploads need dedicated test
credentials before those features can be exercised; Redis consumers use their
existing fallback or fail-closed behavior. Blob write tokens were also removed
from Development scope. Existing deployments retain their original variables
until redeployed or retired; this settings change is not proof of their isolation.

Seven overrides were removed for `codex/macos-companion-v1.0.0` and
`feat/approval-first-shift-claims`, whose tips are contained in main. Eight other
branches retain overrides because they have open PRs or divergent commits. No
Git branches, Neon branches, deployments, or stored artifacts were deleted.

Speed Insights 2.0.0 is wired into the root layout locally. Production collection
requires deployment and a browser/network read-back; dashboard enablement alone
does not prove telemetry delivery.

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
npm run db:migrate:check
npm run db:migrate:status
npm run db:migrate:health
npm run db:migrate:deploy
npm run build
```

- `db:migrate:check` verifies local migration folder shape, required `migration.sql` files, and prefix uniqueness.
- `db:migrate:status` and `db:migrate:health` run the repo's Neon-backed health checker. They compare local migration folders with live `_prisma_migrations`, fail on pending local migrations, unresolved failed rows, applied DB rows missing locally, missing/invalid SQL checksums, and checksum mismatches, and verify the newest local migration is applied. Rolled-back attempts are excluded from checksum comparisons. They also verify the validated, usable `asset_allocations_no_overlap` exclusion constraint and its active half-open `tsrange` definition.
- `db:migrate:deploy` resolves `DIRECT_URL` or `DATABASE_URL_UNPOOLED`, exports
  the result to Prisma as `DIRECT_URL`, and runs `prisma migrate deploy` first.
  If Prisma exits with the known blank schema-engine error or P1001/P1011 against
  Neon, the wrapper checks complete migration history before using atomic HTTP
  transactions. Each migration, its receipt, and its completion update commit
  together. It refuses failed, DB-only, changed, or unverifiable applied history.
- `build` runs the deploy wrapper before `next build`, so Vercel builds fail early if migration state is not deployable. Use `npm run build:app` for local app compile proof when you are not intentionally validating migration deploy behavior.

Raw `prisma migrate status` is not the source of truth in this repo because the local Prisma schema engine can fail blank against Neon. Use `npm run db:migrate:status` or `npm run db:migrate:health`.

## Normal Migration Flow

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma format`.
3. Create a migration with Prisma's migrate workflow.
4. Run `npm run db:migrate:check`.
5. Run `npm run db:migrate:deploy`.
6. Run `npm run db:migrate:health`.
7. Run `npm run build`.
8. Commit schema, migration SQL, docs, and related code together.

## Recovery Rules

- Missing checksums mean unverified historical SQL, not a match. Reconcile original deployment evidence before another deployment; do not populate old receipts with today's hash or edit applied SQL to silence the check.
- Matching migration names do not prove physical constraints exist. The 2026-09-07 production audit found the overlap guard missing despite all 149 then-local names being applied. Forward migration `0144_restore_asset_allocation_overlap_guard` is locally prepared; production application is not established by source or fixture tests. See [the audit ledger](../tasks/database-audit-plan-2026-09-07.md).
- If health reports pending local migrations, run `npm run db:migrate:deploy` and rerun health.
- If health reports unresolved failed rows, inspect `_prisma_migrations` before retrying. Do not edit an applied migration file to force a match.
- If health reports applied DB-only migrations, stop and reconcile the missing migration folder before shipping.
- If Prisma emits the blank schema-engine failure, let the deploy wrapper fallback handle it. Do not reintroduce one-off migration scripts.
- The HTTP fallback acquires Prisma's migration advisory-lock key with a
  transaction-scoped try-lock and rechecks history inside the lock. A busy lock
  fails immediately; it does not queue another deploy. Statements use a five-second
  lock timeout and sixty-second statement timeout. Failed SQL rolls back its whole
  migration and receipt. A lost response triggers one read of that exact attempt's
  receipt; an unconfirmed outcome stops without automatic replay.
- All pending fallback files are checked before writes. Explicit transaction
  control, concurrent index commands, and VACUUM require a reviewed direct Prisma
  path. Other SQL PostgreSQL refuses inside a transaction fails atomically. Split
  enum additions from later use; do not work around transaction errors by executing
  statements individually. Missing `_prisma_migrations` requires the isolated
  bootstrap path, not automatic metadata creation on an unknown target.
- The stricter fallback will refuse the currently audited production legacy
  receipts until reconciliation. The normal Prisma deploy path is unchanged.
  This is a release boundary, not evidence that existing application reads fail.

Implementation references: [Neon transaction API](https://neon.com/docs/serverless/serverless-driver)
and [Prisma migration advisory-lock discussion/source pointer](https://github.com/prisma/prisma-engines/issues/5755).

## Empty Database Bootstrap

## Recovery and CI update — 2026-09-07

Production now has seven-day point-in-time history, a daily 07:00 UTC snapshot
schedule with seven-day retention, and branch protection. Retention grows going
forward; increasing it does not recover already-expired history. Snapshot
`snap-shiny-dust-airv1n4i` is retained until 2026-10-07.

The snapshot restore tool unexpectedly finalized the restored copy and moved the
production compute. The original branch and original endpoint were restored;
all 91 public tables had matching counts and row-content fingerprints both before
and after routing correction. Do not use restore defaults for isolated drills:
explicitly request `finalize: false` and verify endpoint/default-branch ownership
before treating any returned branch as isolated. See the incident evidence in
[the audit ledger](../tasks/database-audit-plan-2026-09-07.md).

The local CI candidate `scripts/check-postgres-integrity.mjs` permits only a fresh
loopback `wc_integrity_test` database. In PR/push CI it initializes the base
commit's schema and applies newly added forward SQL before reading every model
through the current generated Prisma client. It also checks forward integrity
DDL and overlap rejection on a cloned fixture table. This catches missing-column
rollout errors without production secrets. It does not prove historical migration
provenance or replace a production-clone rehearsal.

The 2026-09-07 Neon clone rehearsal failed closed on the legacy receipt checks;
no forward migrations were applied. Original historical receipts remain intact.

## Bootstrap procedure

The historical migration chain begins with PostgreSQL constraints against tables that predate migration tracking, so `prisma migrate deploy` cannot initialize a brand-new empty database. For a new isolated environment only, use the guarded bootstrap:

```bash
EMPTY_DATABASE_BOOTSTRAP=confirm \
EMPTY_DATABASE_EXPECTED_HOST=<exact-direct-neon-host> \
DIRECT_URL=<direct-neon-url> \
npm run db:bootstrap:empty
```

The command refuses any target containing application tables, generates the current schema from an offline Prisma empty-to-datamodel diff, restores Prisma-inexpressible exclusion/partial/trigram indexes, and reconciles local migration checksums. It must never be used on production, a database with user data, or as a substitute for normal incremental migrations.
