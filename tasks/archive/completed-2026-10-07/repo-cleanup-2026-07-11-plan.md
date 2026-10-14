# Repository Cleanup - 2026-07-11

## Goal

Reduce repository drag without changing product behavior or disturbing the active
iOS privacy/account/icon work already present in the worktree.

## Scope

- Remove confirmed orphaned source modules and the unreferenced one-off migration script.
- Archive completed root task plans into `tasks/archive/completed-2026-07/`.
- Refresh the task index and generated codemaps after the file-tree changes.
- Verify typecheck, focused repository checks, whitespace, and the app build.
- Keep unmerged branches, dirty worktrees, active icon files, and ambiguous temporary
  assets untouched until ownership is clear.

## Plan

- [x] Inventory current worktree, branches, worktrees, generated artifacts, and
  cleanup candidates.
- [x] Remove five confirmed-orphaned modules and one unreferenced script.
- [x] Archive only completed root plans with no unchecked work.
- [x] Refresh `tasks/INDEX.md` and codemaps without overwriting unrelated dirty changes.
- [x] Recheck branch/worktree cleanup candidates and leave ambiguous ownership intact.
- [x] Run verification and record the review below.

## Confirmed deferred items

- The active main worktree has unrelated uncommitted iOS/privacy/account/icon changes.
- Two linked battery-label worktrees are dirty and must not be removed.
- Several local branches are unmerged or contain unique commits; they remain until
  their owners confirm retirement.
- The Illustrator-created `ios/~ai-*.tmp` PDF is current-day user content, not an
  automatically disposable build artifact, so it remains for now.

## Review

- Removed five source modules with no source/test/script consumers and one
  unreferenced migration-repair script.
- Archived 46 completed root plans into the July 2026 archive bucket.
- Refreshed the task index counts and archive rules.
- Added the ignored generated workflow route to ESLint's generated-artifact ignore
  list, so the full lint gate is clean.
- Updated three active task documents that still named the removed standalone
  `DataList` or import `SummaryCard` files; historical changelog/archive prose was
  left intact.
- Added `ios/~ai-*.tmp` to `.gitignore`, removed the clean detached `96a0` worktree,
  and pruned stale remote-tracking refs with `git fetch --prune origin`.
- Full Vitest initially exposed 16 stale iOS source-contract assertions. The tests
  now describe the shipped Browse, Settings, and Notifications surfaces; the final
  suite passed 331 files and 1,987 tests.
- Regenerated codemaps; `npm run codemap:check` is clean.
- Verification passed: `npx tsc --noEmit --pretty false`, `npm run lint --
  --max-warnings=0`, `npm test`, `git diff --check`, and `npm run build:app`.
- Five local branches still point to deleted remote branches but contain unique
  unmerged commits, so they remain intentionally intact. Three linked worktrees
  also remain: one clean advisor worktree and two dirty battery-label worktrees.
