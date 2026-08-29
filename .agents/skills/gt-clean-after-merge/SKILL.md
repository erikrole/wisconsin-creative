---
name: gt-clean-after-merge
description: Wisconsin Creative merge and parallel-work cleanup workflow. Use after merges, cherry-picks, worktree integrations, or parallel edits when duplicate types, helpers, UI remnants, imports, exports, CSS, routes, docs, tests, or task records may remain. Remove only confirmed artifacts and preserve intentional user work.
---

# GT Clean After Merge

Remove integration debris without turning cleanup into a broad refactor.

## Orient

1. Read `AGENTS.md`, `git status --short`, the merge or integration diff, and the active ledger.
2. Identify which files came from the integration and which dirty files are unrelated user work.
3. Read every affected file completely before editing it.

## Inspect

- Duplicate types, functions, helpers, wrappers, components, routes, tests, and exports.
- Dead modal, sheet, dialog, state, CSS, import, and feature-flag remnants.
- Conflicting copies where ownership is unclear.
- Stale docs, task records, generated maps, and tests that describe removed behavior.
- New files missing project membership, exports, registrations, or callers.

Use `rg` to prove consumers before deleting anything. Keep intentional parallel variants when current contracts do not resolve ownership.

## Verify

Select proof from the `AGENTS.md` verification matrix for every affected platform. Add focused tests or builds that prove removed symbols and retained behavior. Inspect the final diff for unrelated reversions.

Stop when ownership is ambiguous, cleanup would revert unrelated work, or the same cleanup approach fails twice. Report the conflict and the smallest safe reconciliation step.

Do not stage, commit, push, or open a PR unless explicitly requested.
