# Booking API and Lifecycle Hardening Plan - 2026-08-07

## Goal

- Make booking and reservation mutations preserve kiosk-only custody, reject
  ambiguous inputs, survive concurrent edits without lost updates, and return
  stable actionable API responses across web and native callers.
- Keep reservation creation, drafts, event linkage, ownership transfer,
  extension, cancellation, realtime refresh, and exports internally consistent.

## Route

- Owner area: Reservations and checkout lifecycle integrity
- Ledger: this plan
- Existing plan/archive references:
  - `tasks/archive/completed-2026-10-06/booking-rename-transfer-fix-plan.md`
  - `tasks/reservation-auto-schedule-plan.md`
  - `tasks/archive/completed-2026-07/pending-pickup-reservation-consolidation-plan.md`
  - `tasks/archive/bookings-hardening-plan.md`

## Source Checks

- D-012 disallows `OPEN -> CANCELLED` in the normal flow. D-040 assigns active
  checkout edits and returns to an identified kiosk session, with the audited
  admin close-without-scan path as the narrow exception.
- The current action policy and generic cancellation service still allow staff
  to cancel an `OPEN` checkout and restore custody from the signed-in web API.
- Booking PATCH, extend, event-link, and owner-transfer routes compare
  `If-Unmodified-Since` before entering the service transaction. The service
  re-reads current state but does not compare the edited snapshot, leaving a
  time-of-check/time-of-use lost-update window.
- The unified checkout PATCH accepts the reservation-shaped schema and silently
  ignores requester, location, and start fields. It also accepts equipment
  replacement for active checkout custody outside the kiosk route.
- The booking change cursor contains only a timestamp while two independently
  limited streams feed it. A busy page can advance past rows that were not
  returned, and equal timestamps have no stable tie-breaker.
- Draft date strings are converted without rejecting invalid dates, duplicate
  equipment lines can fall through to database errors, and draft listing
  performs unaudited deletion from a GET request.
- Booking export accepts malformed dates and unknown kinds instead of returning
  a bounded validation error.
- Baseline focused booking tests pass: 7 files and 62 tests. Baseline TypeScript
  is blocked by two unrelated `null` assignment errors in
  `tests/schedule-publication.test.ts:733` and `:743`.

## Stop Conditions

- Stop if a proposed mutation would move physical custody outside an
  authenticated kiosk or weaken the admin force-complete evidence path.
- Stop if client response envelopes or Swift Codable models contradict a route
  change; update compatible clients in the same slice.
- Stop if concurrency protection cannot be enforced inside the same serializable
  transaction as the write without changing accepted booking behavior.
- Do not remove legacy `PENDING_PICKUP` compatibility until a verified production
  zero-row check closes GAP-61.
- Do not commit, deploy, mutate production data, or rewrite unrelated Schedule
  work.

## Slices

- [x] Slice 1: Enforce lifecycle and custody boundaries. Remove normal
  `OPEN -> CANCELLED`, add service backstops, reject ignored checkout fields,
  and keep active checkout equipment mutation kiosk-owned.
- [x] Slice 2: Move booking snapshot checks into serializable mutation
  transactions for PATCH, extend, event links, and owner transfer while
  retaining exact committed-retry behavior.
- [x] Slice 3: Make the booking change feed lossless under bounded pagination
  with a stable cursor and backward-compatible first-poll behavior.
- [x] Slice 4: Normalize draft and export boundaries: invalid dates, duplicate
  lines, unknown enum values, and read-side cleanup behavior.
- [x] Slice 5: Remove verified route/service duplication and align web/native
  response handling only where the preceding fixes expose drift.
- [x] Slice 6: Sync area docs, decisions/gaps when behavior changes, and close
  the plan with verified evidence and remaining runtime proof gaps.

## Verification

- [x] Focused booking action, lifecycle, route, service, draft, change-feed,
  collaborator, and client contract tests
- [x] `npx tsc --noEmit --pretty false`, or record unchanged pre-existing errors
- [x] `npm run lint`
- [x] `npm run codemap` before docs verification when codemap-owned files change
- [x] `npm run verify:docs`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] `npm run build:app`
- [x] Authenticated browser smoke for touched booking web flows, or record why
  unavailable
- [x] iOS source-contract and Xcode gates if native sources or shared response
  contracts change

## Review

- Shipped: normal cancellation no longer closes an active checkout; generic
  checkout PATCH cannot move custody or replace gear; edit, extend, event-link,
  and owner-transfer snapshot checks now run inside the serializable write;
  edit audit history is no longer duplicated; change polling has independent
  stable cursors; drafts and exports reject ambiguous input; draft GET is
  read-only; and export selects only fields required by the CSV.
- Verified: 161 focused booking tests passed after the final export change, and
  the additional policy/source regression set passed 47 tests. The full suite
  reached 2,983 passing tests with only three unrelated failures. Focused lint,
  docs verification, migration-chain validation, diff checks, and the 217-page
  production app build passed. An authenticated local admin loaded `/bookings`;
  invalid export kind returned `400`, and the change feed returned a version-2
  composite cursor.
- Deferred: add `(updatedAt,id)`, `(requesterUserId,updatedAt,id)`, and
  `(entityType,createdAt,id)` indexes through a dedicated reviewed migration;
  replace the bounded in-memory 5,000-row CSV path with pagination or an export
  job before volume requires it; remove redundant pre-transaction policy reads;
  and add an explicit audited expired-draft cleanup job.
- Blocked: repository-wide TypeScript remains blocked by two unrelated null
  assignments in `tests/schedule-publication.test.ts:733` and `:743`.
  Repository-wide lint remains blocked by two `no-this-alias` errors in the
  generated `.tmp/call-time-sync-bundle.mjs`. The full suite's three unrelated
  failures are App Store submission copy, an iOS domain source expectation, and
  sport staffing defaults.
- Proof artifacts: local T3 preview session against the seeded database; command
  results recorded in this closeout. No native source or shared response
  envelope changed, so Xcode and native source-contract gates were not required.
- Next slice or stop: stop. Correctness hardening is complete; retain the
  booking read-path growth item in `docs/GAPS_AND_RISKS.md` for a separate
  migration/performance slice.
