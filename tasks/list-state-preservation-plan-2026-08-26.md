# Web List State Preservation Plan — 2026-08-26

## Goal

Keep an operator's current Schedule and Items list context intact when they open a detail route and use browser Back. A filtered Schedule should return to the same view and filters; a searched, sorted, or paginated Items list should return to the same result set.

## Accepted contracts

- The list URL is the source of truth for state that must survive route navigation and browser history.
- Next App Router navigation owns query-string updates so `useSearchParams` rehydrates after Back/Forward.
- Existing deep links, permissions, data fetching, and detail-route behavior remain unchanged.
- Filter changes remain replacement navigations; opening a detail route remains a normal forward navigation.
- Existing local-storage preferences remain defaults only when the URL does not specify the Schedule view or personal-shifts scope.

## Bounded slices

- [x] Serialize and rehydrate Schedule view, calendar/week position, venue, sport, area, coverage, archived, personal-shifts, and existing queue/deep-link state.
- [x] Replace Items list native history writes with router-owned replacement navigations while preserving filter, sort, page, and limit parameters.
- [x] Add source contracts covering the exact state keys and router rehydration behavior.
- [x] Update Schedule and Items area ledgers, then run focused tests and web verification gates.

## Verification gates

- Focused Schedule/Items source-contract tests pass (`tests/list-state-preservation-source.test.ts`, Items UI, Schedule queue contracts).
- `npx tsc --noEmit --pretty false` passes.
- `npm run lint` passes.
- `npm run build:app` compiles the changed code but fails in the existing shared `.next` manifest phase because `pages-manifest.json` is missing.
- `git diff --check` passes. `npm run verify:docs` remains blocked by pre-existing generated codemap drift from parallel dirty slices.
- Authenticated browser proof for filtered Schedule and searched Items detail → Back remains a separate runtime gate if credentials/session are unavailable in this turn.

UI review: `tasks/archive/proofs/list-state-preservation-review-2026-08-26/review.html` records the behavior-only boundary and the unavailable authenticated capture gate; no pixel delta is claimed.

## Boundary

No API, database, migration, permission, detail-page, deployment, or production-data changes. Preserve unrelated dirty worktree edits and do not stage or commit this slice.
