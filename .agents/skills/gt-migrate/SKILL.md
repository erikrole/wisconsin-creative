---
name: gt-migrate
description: Canonical Gear Tracker Prisma and Neon migration workflow. Use when the user runs /gt-migrate, changes Prisma schema, designs a schema slice, generates migrations, investigates migration drift, works with Neon, or needs database deploy recovery. Supersedes prisma-migrate-safely.
---

# /gt-migrate

Use the repo's current Prisma and Neon path. Do not fall back to generic Prisma advice or raw Prisma status assumptions.

## Required Reads

1. `AGENTS.md`
2. `docs/NORTH_STAR.md`
3. `tasks/INDEX.md`
4. `tasks/todo.md`
5. Active plan or follow-up ledger for the slice
6. `prisma/schema.prisma` end-to-end
7. `prisma.config.ts` when present
8. `package.json` scripts
9. `docs/PRISMA_NEON_RUNBOOK.md` when present
10. Relevant `docs/AREA_*.md` and `docs/BRIEF_*.md`
11. `docs/DECISIONS.md`
12. `docs/GAPS_AND_RISKS.md`
13. Existing migrations under `prisma/migrations`
14. `scripts/prisma-migrate-deploy.mjs`
15. `scripts/prisma-migrate-health.mjs`

## Workflow

1. Confirm whether this is schema design, migration generation, deploy recovery, or drift diagnosis.
2. For schema work, complete the pre-implementation audit before editing: list touched models/enums, field names, indexes, cascade rules, decisions, gaps, and the owning AREA/BRIEF contract.
3. Write or update the active task plan before implementation. Keep schema/migration, API/service, UI/iOS, tests, docs, and deploy verification as independently testable slices.
4. Apply one coherent schema edit. Confirm cascade rules, `@map`, indexes, nullability, defaults, and `onDelete` policies match sibling models.
5. Generate migration with the repo's current supported path. If migration generation fails, stop and report instead of retrying with a different name.
6. Never edit an already-applied migration SQL file.
7. Use the wrapper-backed deploy and health scripts for Neon truth.
8. Avoid long-running data backfills inside migration deploy. Use a separate bounded script when data work can exceed Vercel function limits.
9. Update area docs, gaps, codemaps, and task ledgers in the same slice when behavior ships.

## Commands

- Format schema: `npx prisma format`
- Validate schema: `npx prisma validate`
- Generate local migration: `npm run db:migrate:new -- --name <feature>_<short_change>`. This is an offline committed-schema diff because the historical chain cannot replay in a fresh Prisma shadow database. Inspect the generated SQL before continuing.
- Check migration folder prefixes: `npm run db:migrate:check`
- Check live migration health: `npm run db:migrate:health`
- Deploy migrations: `npm run db:migrate:deploy` when live migration mutation is explicitly in scope and approved
- Regenerate codemaps when source/schema/docs maps changed: `npm run codemap`
- Verify docs/codemaps: `npm run verify:docs`
- App compile build: `npm run build:app`
- Full deploy-shaped build: `npm run build` when migration deploy preflight is safe and approved

## Stop Conditions

- Prisma reports a blank schema-engine error and the wrapper path has not been checked.
- Live Neon history disagrees with local migration folders.
- A migration would do long-running data backfill inside Vercel deploy time limits.
- Two migration attempts fail.
- Approval or network policy blocks a command that can mutate the shared database.
- Schema shape contradicts the active plan, decision record, or AREA/BRIEF contract.

## Closeout

- Record which migration was generated or deployed, whether live health was checked, and any pending deploy blocker.
- Update the active task ledger with shipped, verified, deferred, blocked, proof artifacts, and next-slice/stop notes.
- Use `gt-ship` for staging, commit, and push unless the user explicitly asked this skill to complete shipping.
