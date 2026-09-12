---
name: gt-deploy-debug
description: "Diagnose and repair Wisconsin Creative build, Vercel runtime, migration, or deployment failures from current evidence."
---

# GT Deploy Debug

Treat the deployment failure as the bounded task. Do not mix in unrelated cleanup.

## Gather evidence

1. Inspect `AGENTS.md`, current deployment logs, and the scripts/configuration for the failing phase. Read the Prisma/Neon runbook for database failures and relevant gaps or ledger entries when they explain the failure.
2. Read the scripts and source files named by the failure completely.
3. Record environment, commit, deployment, timestamp, failing phase, and exact error without exposing secrets.
4. Reproduce with the narrowest safe local command.

## Classify

- Install or dependency resolution.
- Environment or configuration.
- Prisma generation, migration health, or Neon connectivity.
- TypeScript, lint, or Next compile.
- Runtime route, authentication, or function limit.
- Cron scheduling, bearer validation, or partial failure.

Use wrapper-backed migration health before diagnosing database drift. Use `build:app` for compile isolation and full `build` only for controlled deploy-shaped proof. Patch the root cause and rerun the narrow failure before broad verification.

## Stop

- Required live access or logs are unavailable: stop the dependent live operation, state the missing evidence, and continue independent source diagnosis.
- A fix would require destructive or unapproved shared-database changes.
- Live migration history disagrees with local folders.
- Repeated failure without new evidence: re-plan the approach and continue independent diagnosis; report a blocker only when no supported repair remains.

## Closeout

Select final proof from the `AGENTS.md` verification matrix. Include deployment logs or redeploy proof when available. Update docs and gaps only when behavior or operating guidance changed. Report root cause, fix, proof, and any remaining external blocker.

Redeployment, production repair, and source-control actions follow existing authorization. Prepare the supported fix first; ask only when a required action remains outside that scope.
