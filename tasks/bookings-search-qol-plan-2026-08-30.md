# Bookings and Search Quality-of-Life Plan — 2026-08-30

## Goal

- Keep an operator's Bookings search, filters, sort, page, and view intact across navigation and browser Back.
- Keep `New reservation` available from the Bookings page regardless of the selected tab or time scope.
- Give global Search an explicit retry path without clearing the current query or trustworthy results.

## Route

- Owner area: Reservations / unified Bookings web surface.
- Secondary area: Search.
- Ledger: this plan plus `tasks/todo.md`.
- Existing reference: `tasks/list-state-preservation-plan-2026-08-26.md` established URL-owned list state for Schedule and Items.

## Source Checks

- `src/components/BookingListPage.tsx` initializes filters from `useSearchParams`, but keeps pagination locally and resets it to page zero on any URL-signature change.
- `src/app/(app)/bookings/page.tsx` renders the reservation creation action only inside the Reservations tab.
- `src/app/(app)/search/page.tsx` preserves successful result groups during refresh, but terminal search errors have no Retry control.
- Existing routes, permissions, reservation creation, booking mutation, and kiosk custody contracts already own the underlying behavior and remain unchanged.

## Stop Conditions

- Stop if preserving list state requires an API, schema, permission, lifecycle, or custody change.
- Stop if the current query keys conflict with an accepted external deep-link contract.
- Stop if Search recovery cannot reuse the existing four-source fan-out without introducing a second result model.
- Stop if authenticated before/after capture cannot use the same account, data, viewport, and source baseline; record the visual-proof blocker instead of fabricating a comparison.

## Slices

- [x] Slice 1: Serialize and rehydrate Bookings query, status, special view, sport, location, requester, sort, and page through App Router replacement navigation; make clear-all include search.
- [x] Slice 2: Move the permission-aware `New reservation` action to the Bookings page header and remove the tab-local duplicate.
- [x] Slice 3: Add explicit Search Retry for complete and partial failures while retaining the query and successful results.
- [x] Slice 4: Add focused source/behavior contracts and sync Reservations/Search area docs.
- [ ] Slice 5: Produce matched UI review evidence and run the web verification gates.

## Verification

- [x] Focused Bookings/Search tests.
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run lint`.
- [x] `npm run codemap` before docs verification when generated ownership maps change.
- [x] `npm run verify:docs`.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [x] Authenticated desktop and narrow-width browser smoke for Bookings filter/page restoration, the persistent reservation action, and Search retry, or record the exact blocker.
- [ ] Matched before/after review page where the two columns differ only by this slice.

## Review

- Shipped: Not deployed. The three behavior slices are implemented in the local working tree.
- Verified: 37 focused tests pass; TypeScript, full lint, codemap freshness, docs verification, `git diff --check`, and `npm run build:app` pass.
- Deferred: Authenticated desktop and narrow-width runtime acceptance plus matched before/after capture.
- Blocked: `PLAYWRIGHT_EMAIL`, `PLAYWRIGHT_PASSWORD`, and `PLAYWRIGHT_ROLE` are unset, and `test-results/playwright/auth/user.json` does not exist. The isolated authenticated fixture required for honest same-account, same-data capture is unavailable.
- Proof artifacts: `tasks/archive/proofs/bookings-search-qol-review-2026-08-30/index.html` and `review-spec.json` record the implementation, gate results, and visual-proof blocker without claiming screenshots.
- Next slice or stop: Stop locally. Resume Slice 5 when an isolated authenticated Playwright identity is available; commit, deploy, and production acceptance remain separate permissions.
