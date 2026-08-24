# Profile Scoreboard Hardening Plan - 2026-08-23

Status: Completed and locally verified on 2026-08-23.

## Goal

- Make the new profile Scoreboard dependable across web and native iOS without changing its read-only privacy boundary or official-record semantics.
- Keep the active season server-owned so future scope changes do not require coordinated web and App Store releases.
- Make web pagination retain trustworthy rows, reject stale responses, avoid duplicate event keys, and offer visible recovery when another page cannot load.
- Keep season highlights honest and deterministic across both clients.

## Route

- Owner area: Users profile.
- Secondary areas: Events supplies `CalendarEvent` result/site/venue truth; Mobile consumes the same read contract.
- Ledger: this active plan.
- Existing plan/archive references: `tasks/archive/completed-2026-08-19/profile-scoreboard-plan-2026-08-19.md` owns the original web/API implementation; native parity is recorded in `docs/AREA_MOBILE.md` and `docs/AREA_USERS.md`.
- User-facing surfaces: `/users/{id}?tab=scoreboard` and native `ScoreboardView`.
- Read endpoint: `GET /api/users/{id}/scoreboard`.

## Source Checks

- The route uses `withAuth`, validates `season`, `sportCode`, and `result`, applies bounded shared pagination, and returns `ok({ data: scoreboard })`.
- The response shape is already consumed by web `UserScoreboardTab`, native `APIClient.scoreboard`, `ScoreboardModels.swift`, and the DEBUG fixture harness; this slice will keep that envelope additive-compatible and unchanged.
- `summary.eventsWorked` intentionally counts all completed assigned Schedule events in the scope, while wins/losses and breakdowns count only resolved official games. Filters narrow the official record and do not narrow `eventsWorked`.
- Collaborator directory access does not grant assignment-derived Scoreboard access. Admin can inspect any profile, Staff can inspect internal profiles, and Student/Collaborator readers are self-only for this private record.
- The server already defaults an omitted season to `SCOREBOARD_SCOPE`, but web and native callers redundantly send the literal `2026-27`, contradicting the documented server-owned scope.
- Native pagination already rejects pages overtaken by a filter change, deduplicates repeated event IDs, and exposes a retryable page error. The web tab currently swallows page failures and can request a new filter with a stale offset while placeholder data refreshes.
- Web and native highlight code says a lone `1-0` venue should not outrank sustained success, but both implementations currently sort win rate before volume and therefore do exactly that.
- Focused baseline on 2026-08-23: 5 Scoreboard test files, 23 tests passing.
- The worktree already contains unrelated typography-review edits; Scoreboard files are clean and those changes must remain untouched.

## Stop Conditions

- Stop if current source or live payloads require a new response field, schema migration, or a different privacy policy; reconcile that as a separate accepted contract first.
- Stop if omitting `season` changes the current route response; the present season must remain `2026-27` in current source.
- Stop rather than weaken native decoding if web hardening would make the server response incompatible with the installed app.
- Stop at the browser proof gate if an isolated authenticated Preview session is unavailable; do not use production credentials or production data to manufacture a visual baseline.
- Stop at the native runtime gate if the required iPhone 16 Pro simulator destination is unavailable; do not substitute another model.

## Slices

- [x] Slice 1: Add regression coverage for server-owned season defaults, the private-read role matrix, deterministic shift-area order, sustained venue ranking, and web paging recovery contracts.
- [x] Slice 2: Harden the web Scoreboard against stale/in-flight pagination, repeated event IDs, refresh-time stale cursors, and silent page failures; align filter targets with the 40px web baseline.
- [x] Slice 3: Remove the hard-coded season from default web/native requests and align the native venue highlight with the same deterministic ranking.
- [x] Slice 4: Sync Users/Mobile shipped reality, close the plan lifecycle, and produce matched visual proof for the visible web changes.

## Verification

- [x] `npx vitest run tests/scoreboard-route.test.ts tests/scoreboard.test.ts tests/scoreboard-digest.test.ts tests/scoreboard-sport-filter-source.test.ts tests/ios-scoreboard-wiring.test.ts`
- [x] Targeted `ScoreboardModelsTests` on `platform=iOS Simulator,name=iPhone 16 Pro`.
- [x] `npm run ios:project:check`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused ESLint for changed Scoreboard TypeScript files, followed by `npm run lint`.
- [x] `npm run db:migrate:check`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `npm run build:app`
- [x] `xcodebuild` for the `Wisconsin` target on `platform=iOS Simulator,name=iPhone 16 Pro`.
- [x] `git diff --check` and final scoped diff review.
- [x] Authenticated local Preview browser smoke for the Scoreboard tab at desktop and narrow width, including filters, refresh state, page retry, network/console inspection, or a precise blocker.
- [x] `gt-ui-review` page with matched before/after captures that differ only by this Scoreboard slice, plus measured 40px filter controls.

## Review

- Shipped: server-owned default season across web and iOS; pre-lookup collaborator denial; deterministic worked-area ordering; sustained-record Best venue ranking across both clients; abortable, deduplicated, retryable web pagination with a terminal cursor; and 40px result, sport, and breakdown controls.
- Verified: 5 focused files / 36 tests; 10 focused XCTest cases; TypeScript; focused and full ESLint; iOS project parity, drift, and audit-gap checks; migration-prefix validation; current codemaps/docs; `npm run build:app`; and a full Wisconsin build for iPhone 16 Pro on iOS 26.5.
- Deferred: the live Nolan fixture has only one resolved result page, so the load-more failure surface was regression/source tested instead of forced in the authenticated runtime. Production deployment and release proof were not requested.
- Blocked: none.
- Proof artifacts: `tasks/archive/proofs/profile-scoreboard-hardening-2026-08-23/index.html`; matched desktop before/after captures and crops; `web-after-narrow.jpg`; signed-in `ios-all.png` and `ios-wins.png`; targeted XCTest result bundle at `/private/tmp/wisconsin-scoreboard-tests/Logs/Test/Test-Wisconsin-2026.08.23_09-23-42--0500.xcresult`.
- Next slice or stop: stop. The bounded hardening slice is complete without a schema, response-shape, privacy-policy, or production-state change.
