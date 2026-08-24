# Scoreboard Tie Results Plan - 2026-08-24

## Goal

- Show completed games whose UWBadgers source marker is `[T]` on the shared and per-person Scoreboard.
- Keep the source-derived tie distinct from wins, losses, staffing coverage, and badge recognition.
- Keep every record meter in the same W–L–T order as the record label, with ties on the right.

## Route

- Owner area: Users / Scoreboard.
- Secondary areas: Events / Calendar sync and Mobile.
- Ledger: this active plan; closeout stays in `tasks/todo.md` and the Users/Events/Mobile area changelogs.
- Existing source: `CalendarEvent.result`, `parseEventResult`, `getScoreboardForUser`, `getTeamScoreboard`, and the native Scoreboard models.

## Source Checks

- The live Aug 23 rows are confirmed, visible, staffed soccer events: Men's Soccer vs Oakland carries `[W]`; Women's Soccer vs Marquette carries `[T]` and currently has `result = null`.
- `parseEventResult` accepts only `[W]` and `[L]`; `CalendarEventResult` currently contains only `WIN` and `LOSS`.
- Both Scoreboard services require a non-null result for official games, so the `[T]` row is excluded from the personal game list and aggregate record.
- Existing assignment/credit participation and official exhibition/scrimmage/alumni exclusions remain authoritative.

## Stop Conditions

- Stop if the source marker is not a completed tie or if another source meaning for `[T]` is found.
- Stop if a schema/migration readback shows an existing non-null result would be rewritten incorrectly.
- Do not infer wins or losses from a tie; do not change Schedule, assignments, notifications, or badge evidence.

## Slices

- [x] Slice 1: Add `TIE` to the Prisma enum, parser, sync classification, and additive backfill migration for stored `[T]` evidence.
- [x] Slice 2: Carry ties through game-record and team/profile Scoreboard aggregates, rate calculation, result filtering, and copy/formatting.
- [x] Slice 3: Update web and native Scoreboard rendering/models plus focused regression contracts; record meters now use W–L–T order.
- [x] Slice 4: Run migration shape, focused tests, TypeScript/lint/build, iOS project/build/source gates, and local matched visual proof. Authenticated production readback remains deferred until deployment.
- [x] Slice 5: Sync area docs, gap/ledger state, codemap/docs checks, and close the plan with verified/deferred boundaries.

## Verification

- [x] `npm run db:migrate:check` — 138 migrations pass shape/prefix checks.
- [x] Focused calendar identity/sync, game-record, team/profile Scoreboard, digest, route, native model, and bar-order source tests.
- [x] Full Vitest — 550 files and 3,758 tests passed.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run build:app` — production web build generated all 240 static pages.
- [x] `npm run ios:project:check` and the pinned iPhone 16 Pro iOS Simulator build/UI test.
- [x] `npm run codemap` followed by `npm run verify:docs`.
- [x] `git diff --check`
- [ ] Authenticated production browser proof that the Aug 23 Women's Soccer tie appears after deployment and the existing Oakland win remains present.
- [ ] Database readback of the migration/backfill after deployment; no production deployment claim unless explicitly requested and verified.

## Review

- Shipped: Local source, migrations, W/L/T aggregates, web/native presentation, W–L–T meter order, tests, and docs are implemented; batched commits `c493e0b7` and `aa1ad1a8` were pushed to `origin/main`.
- Verified: Preview diagnosis identified the `[T]` Marquette event as `result = null`; the Oakland `[W]` event already appears in the affected personal list. Native matched proof shows the tie moving from between wins/losses to the right edge. Full web gates and the current iPhone 16 Pro screenshot test pass.
- Deferred: Apply migrations, run production sync/readback, and repeat authenticated web/native live proof after deployment.
- Blocked: None for the local implementation. Production acceptance is intentionally open because deployment was not requested.
- Proof artifacts: `tasks/archive/proofs/scoreboard-tie-result-2026-08-24/` and `tasks/archive/proofs/scoreboard-wlt-meter-order-2026-08-24/index.html`.
- Next slice or stop: Stop here unless production rollout is explicitly authorized; then apply `0132`/`0133`, read back the two Aug 23 soccer rows, and capture authenticated production proof.
