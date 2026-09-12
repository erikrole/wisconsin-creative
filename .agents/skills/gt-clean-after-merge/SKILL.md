---
name: gt-clean-after-merge
description: "Remove confirmed Wisconsin Creative integration debris after merges or parallel edits while preserving intentional work."
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

Select proof from the `AGENTS.md` verification matrix for every affected platform. Use existing focused tests and affected builds to prove retained behavior; add a regression test only when an uncovered behavioral risk warrants it. Inspect the final diff for unrelated reversions.

Pause only the affected cleanup when ownership is ambiguous or it would revert unrelated work. Re-plan a repeated failed approach using new evidence; continue independent cleanup and report any unresolved conflict.

Do not stage, commit, push, or open a PR unless explicitly requested.
