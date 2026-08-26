# Event Worker Backfill Silence Plan - 2026-08-26

## Goal

- Make admin-added event-worker backfills immediate for finished events and fully silent for every notification channel, including badge recognition.
- Keep backfills outside Schedule assignments, working copies, release timing, crew coverage, My Shifts, trades, acknowledgements, and ICS.
- Remove worker-surface copy that discusses assignee notifications.

## Route

- Owner area: Events, with Badge recognition as a secondary area.
- Ledger: this plan; no existing event-worker implementation plan owns the follow-up.
- Existing contract: D-057 and `docs/AREA_EVENTS.md` define `EventWorker` as the stats-only record.

## Source Checks

- `POST /api/calendar-events/[id]/workers` writes the worker and audit row immediately, then invokes shift badge recognition for finished events.
- `onShiftsWorked` currently suppresses only badges whose threshold is reached solely by added workers; scheduled-threshold badges can still create `badge_awarded` rows.
- `morning-refresh` re-evaluates users whose added-worker events have just ended, so future-event backfills need the same all-silent policy.
- Scoreboard and profile aggregates already count workers alongside active assignments and deduplicate one person/event.

## Stop Conditions

- Stop if the change would create or mutate a `ShiftAssignment`, working copy, published schedule, crew slot, or notification fanout.
- Stop if the all-silent option leaks into ordinary checkout, return, trade, app-open, or normal scheduled-shift recognition calls.
- Stop if current source, tests, or accepted D-057 semantics contradict the requested immediate stats-only backfill.

## Slices

- [x] Slice 1: Add an explicit all-silent option to shift badge recognition and pass it from worker backfill and the future-event nightly sweep.
- [x] Slice 2: Remove notification-oriented copy from the worker card and add regression coverage for no notification rows in every backfill badge case.
- [x] Slice 3: Reconcile D-057/Events documentation and record verification boundaries.

## Verification

- [x] Focused worker, badge, Scoreboard, and profile tests (92 tests passed).
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run db:migrate:check`
- [x] `npx prisma validate`
- [x] Focused ESLint for changed source files.
- [x] `git diff --check`
- [x] `npm run codemap` and `npm run verify:docs` if source/doc ownership maps require regeneration.
- [ ] `npm run build:app` — stalled after Next setup with no error output; stopped with exit 130.
- [ ] Authenticated browser smoke is deferred until an authenticated session and safe test event/person are available; no live mutation is authorized by this plan.

## Review

- Shipped: Finished-event worker adds remain immediate and audited; direct backfill badge recognition passes `notify: false`; the nightly sweep applies the same silence to users whose recent finished work includes an added-worker row; badge award rows still count; worker-surface copy no longer discusses recipient notification.
- Verified: Focused worker/badge/Scoreboard/profile suite passed 92 tests; TypeScript, migration shape, Prisma schema, focused ESLint, docs/codemap verification, and selected-file whitespace checks passed.
- Deferred: No deployment or live data mutation; authenticated browser proof remains open because no authenticated browser tab and no safe target event/person were available.
- Blocked: `npm run build:app` produced no output after Next setup and was stopped with exit 130, so a completed app-build gate is not claimed.
- Proof artifacts: `tests/event-workers.test.ts`, `tests/badge-evaluator.test.ts`, `tests/badge-event-workers.test.ts`, `tests/morning-refresh-route.test.ts`, `docs/AREA_EVENTS.md`, and D-057 in `docs/DECISIONS.md`.
- Next slice or stop: Stop local implementation here. Deployment and authenticated acceptance require an explicit target and a controlled test record.
