---
name: gt-deploy-debug
description: Wisconsin Creative deployment diagnosis and recovery workflow. Use when the user runs /gt-deploy-debug or a Vercel build, production runtime, Prisma or Neon migration, cron, environment, authentication, or release deployment fails. Reproduce the real failure and fix the smallest safe root cause.
---

# GT Deploy Debug

Treat the deployment failure as the bounded task. Do not mix in unrelated cleanup.

## Gather evidence

1. Read `AGENTS.md`, `package.json`, `vercel.json`, the Prisma/Neon runbook, gaps, current deployment logs, and the active ledger.
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

- Required live access or logs are unavailable.
- A fix would require destructive or unapproved shared-database changes.
- Live migration history disagrees with local folders.
- The same repair attempt fails twice without new evidence.

## Closeout

Select final proof from the `AGENTS.md` verification matrix. Include deployment logs or redeploy proof when available. Update docs and gaps only when behavior or operating guidance changed. Report root cause, fix, proof, and any remaining external blocker.

Do not redeploy, mutate production data, commit, push, or open a PR unless explicitly requested.
