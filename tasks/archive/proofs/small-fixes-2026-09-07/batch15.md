# Fifteen additional small fixes — 2026-09-07

Scope: local, uncommitted fixes. Preserve all existing checkout changes. No schema, custody, deployment, or external account changes.

## Bounded implementation plan

1. Audit export: reject invalid and inverted date windows before Prisma reads.
2. Audit, booking, item, and user CSV exports: explicitly disable private-data caching.
3. User export: honor the Collaborator role filter instead of exporting every role.
4. User export: use validated directory area filters instead of passing invalid enum strings to Prisma.
5. User export: normalize location filter whitespace consistently with the directory.
6. User export: bound synchronous work to 5,000 rows and report truncation.
7. User export: preserve the existing admin-only collaborator private-profile boundary for Staff exports.
8. User directory: use a unique tiebreaker so equal names/sort values cannot shuffle between pages.
9. Capped audit and booking exports: use deterministic timestamp/id ordering for tied timestamps.
10. Client report CSV: escape formula prefixes preceded by whitespace, matching server CSV safety.
11. Both download helpers: warn on truncation even when the total-count header is missing.
12. Both download helpers: use fallback error copy for JSON null/non-object bodies.
13. Recent-item history: update the first entry after its record is renamed.
14. Recent-item history: recover future writes after stored JSON is corrupt.
15. URL filter synchronization: preserve browser/router history state instead of replacing it with null.

## Verification plan

Regression tests for the concrete before/after failures, existing affected tests, TypeScript, lint, application build, codemap/docs and diff checks. Review the final scoped diff. UI feedback/navigation are helper-level behavior changes; a local review must distinguish behavioral proof from authenticated browser proof.

## Final acceptance

All 15 numbered fixes are implemented locally. The batch changes nine production source files; existing unrelated edits are preserved. The user export reuses the directory query builder, removing duplicated filter logic.

- 132 focused tests pass across 12 files, including 35 new regression cases.
- The pre-fix helper run reproduced nine failures; all now pass.
- TypeScript, repository lint, `npm run build:app`, `npm run verify:docs`, and `git diff --check` pass.
- Headless Chromium verifies actual browser storage recovery, renamed-history refresh, preserved history state, and missing-total truncation warnings using bundled source helpers.
- The local [review page](review.html) rendered and was visually inspected. It lists the 15 behavior changes and explicitly has no matched product screenshots.
- Existing hidden-user kiosk tests needed a test-only no-preview cookie mock; this preserves their actual roster visibility assertions. The collaborator directory ordering expectation now includes the unique id tiebreaker.
- Authenticated app interactions, database-backed export execution, and deployment remain unverified. No database migration or production data mutation occurred. Nothing is staged, committed, or pushed.
