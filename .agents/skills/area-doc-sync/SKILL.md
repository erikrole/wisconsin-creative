---
name: area-doc-sync
description: Wisconsin Creative documentation and task-lifecycle closeout workflow. Use when shipped or nearly shipped work needs AREA docs, gaps, decisions, active ledgers, plan archives, codemaps, and proof notes reconciled before handoff or gt-ship. Do not stage or commit unless explicitly requested.
---

# Area Doc Sync

Make durable documentation match verified shipped reality.

## Establish scope

1. Run `git status --short`; do not infer scope from staged files alone.
2. Read `tasks/README.md`, `tasks/INDEX.md`, the active ledger or plan, and relevant prior audit.
3. Map touched behavior to its actual owner `docs/AREA_*.md` and any secondary areas. Use source and accepted contracts when route names do not map directly to doc names.
4. Separate in-scope work from unrelated dirty files.

## Reconcile

- AREA docs: add a dated user-facing outcome and update acceptance state only when evidence proves it shipped.
- Gaps: resolve or add entries with the current state and date.
- Decisions: record durable architectural or product choices, not routine implementation detail.
- Ledgers: record shipped, verified, deferred, blocked, proof artifacts, and next-slice/stop notes.
- Plans: move fully completed plans to the current archive bucket named by `tasks/INDEX.md`; update references. Do not archive audits while the index keeps them active at root.
- Lessons: add only reusable, non-obvious rules supported by a verified failure or user correction.

## Verify

Use the `AGENTS.md` verification matrix for the affected documentation and source. Run `npm run codemap` before `npm run verify:docs` when generated maps are stale or codemap-owned inputs changed. Record authenticated browser or native runtime proof for visible behavior, or the exact blocker.

Leave staging, commit, push, PR, and release work to `gt-ship` unless explicitly included in the request.

Report documents and ledgers changed, acceptance or gap state changed, proof recorded, and anything still deferred or blocked.
