# Claude Workflow

`AGENTS.md` is the canonical repository contract. This file is intentionally thin: it gives Claude task routing and points to the deeper source-of-truth documents without duplicating their rules.

## Before starting

- Read [AGENTS.md](AGENTS.md) and follow its instruction priority, safety boundaries, and verification matrix.
- Read [docs/NORTH_STAR.md](docs/NORTH_STAR.md) before planning product work.
- Inspect `git status`, the relevant source, tests, schema, and current area documentation before making claims or edits.
- For product work, read only the relevant brief, area doc, decisions, and risks material. Do not load every repository document by default.

## How to work

- Write a bounded plan for non-trivial work, then execute it without waiting for an unnecessary approval loop.
- Follow the six rules in the "Coding rules" section of `AGENTS.md` (edge-case code needs asking first, validate at the entry point, inline one-time logic, keep functions whole, cut unneeded UI text, ship only clear improvements).
- Implement the smallest independently verifiable slice.
- Preserve unrelated work and stage explicit paths only when a commit is requested.
- Do not update `tasks/lessons.md` for every correction. Promote only reusable, non-obvious lessons supported by verified evidence, and place dated context in `tasks/archive/lessons-history-2026.md`.
- When a user corrects scope or product language, follow the correction immediately and update affected contracts or docs when the change is durable.

## Preview handoff

Use [docs/PREVIEW_ENVIRONMENTS.md](docs/PREVIEW_ENVIRONMENTS.md) for the shared Claude/Cursor/Codex branch environment. Run `preview:setup`, `dev:preview`, then `auth:local`; use the printed URL. Do not pull production variables or create a new database for an existing branch. For Erik's local review of a PR, give him `npm run review <PR#>` (worktree beside his checkout, existing preview or DB-free, never a new database).

## Verification routing

- Use [docs/RELEASE_VERIFICATION.md](docs/RELEASE_VERIFICATION.md) for closeout gates.
- Use `npm run build:app` for safe local app compile proof. Use full `npm run build` only when intentionally validating deploy-shaped behavior and remote migration access is approved.
- For schema or migration work, follow [docs/PRISMA_NEON_RUNBOOK.md](docs/PRISMA_NEON_RUNBOOK.md), including migration checks and health verification.
- For web runtime or authenticated UI work, add authenticated browser proof when the relevant environment is available.
- For native iOS work, run the affected Xcode build and the web-side source-contract tests that inspect Swift files.
- For docs or task structure, run `npm run verify:docs`, `git diff --check`, and a reference sweep.

## Completion boundary

- Do not stage, commit, push, merge, or delete unless the user asks for it.
- Before declaring done, inspect the final diff, report evidence and remaining risks, and recommend the next bounded slice or say to stop.
