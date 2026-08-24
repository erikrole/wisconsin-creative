# Scoreboard Explorer Plan — 2026-08-23

## Goal

- Expand the shared Scoreboard into a generic current-window explorer without naming the feature “2026–27 stats.”
- Let every signed-in role stack Sport, Venue, Opponent, and Site filters so totals, records, breakdowns, and per-person leaderboards all describe the same intersection.

## Route

- Owner area: Users / Scoreboard.
- Secondary areas: Events and Mobile.
- Ledger: this active plan; prior shared-access work is archived at `tasks/archive/completed-2026-08-23/team-scoreboard-plan-2026-08-23.md`.
- No schema or migration is required. `CalendarEvent` already owns normalized `sportCode`, `opponent`, `site`, and venue source text.

## Source Checks

- `/api/scoreboard` is an authenticated all-role read protected by `scoreboard.view`.
- `getTeamScoreboard` is season-bounded and uses two batched event reads with active-visible assignment filtering and per-event person deduplication.
- `CalendarEvent.site` distinguishes Home, Away, and Neutral; `scheduleVenueDisplayName(rawLocationText)` supplies venue-style labels rather than pickup locations.
- The existing profile Scoreboard already treats Events worked separately from official W–L records and exposes sport, opponent, site, and venue record dimensions.
- Web peers use `OperationalToolbar` plus removable active-filter chips; native peers use system `Picker` controls and explicit recovery states.

## Product Contract

- Keep the destination name `Scoreboard`; visible copy may say “current season” but must not call the feature “2026–27 stats.” The server-owned scope key and date bounds remain unchanged.
- One value may be selected per dimension. Different dimensions combine with AND semantics; clearing one preserves the others.
- Filter options come from the full bounded Scoreboard window so a selected option does not disappear after another filter narrows the result.
- Every displayed total, dimensional breakdown, and leaderboard row is recomputed from the same active filter intersection.
- Venue means the Schedule venue display derived from source venue text, never an equipment pickup location.
- The response remains read-only and limited to shared Scoreboard identity and metrics.

## Stop Conditions

- Stop if live/source venue values cannot be reduced through the existing Schedule venue helper without inventing a second venue identity contract.
- Stop if stacked filters require widening the shared response to private profile, assignment, call-time, or booking data.
- Stop native client changes if the additive response cannot remain tolerant of the current production endpoint and server-first rollout order.

## Slices

- [x] Slice 1: Add validated Scoreboard query filters, stable facets, and filtered aggregate/breakdown service tests.
- [x] Slice 2: Replace the web sport-only control with a stacked operational filter toolbar and generic dimensional breakdowns.
- [x] Slice 3: Add tolerant native filter models, API query encoding, and stacked native filters/breakdowns.
- [x] Slice 4: Run focused/API/privacy/web/native gates and authenticated browser/simulator review.
- [x] Slice 5: Sync decisions, area docs, gaps, codemaps, proof artifacts, and archive this plan when local acceptance is complete.

## Verification

- [x] Focused service, route, page-source, privacy/RBAC, and native source-contract Vitest suites.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run ios:project:check`
- [x] Focused `ScoreboardModelsTests` and the pinned iPhone 16 Pro build.
- [x] `npm run build:app`
- [x] Authenticated browser proof for at least two stacked combinations, filtered-empty recovery, console, and network behavior.
- [x] Native runtime proof where the local endpoint is reachable; otherwise record the exact production-route blocker.
- [x] Matched `gt-ui-review` artifact.
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`

## Review

- Shipped: one exact Sport, Schedule Venue, Opponent, and Site filter per dimension with AND-stacked server semantics; stable bounded facets; intersection-wide totals, four breakdowns, and person summaries; web and native explorer controls; filtered empty/error recovery; and a deterministic Snapshot/most-events story layer. The destination and shared identity/privacy contract are unchanged.
- Verified: 110 focused Vitest contracts across 15 files, TypeScript, full ESLint, `npm run build:app`, XcodeGen project sync, focused `ScoreboardModelsTests`, and the pinned iPhone 16 Pro iOS 26.5 build pass. Authenticated local Preview rendered real unfiltered data, a three-filter Volleyball/UW Field House/Butler intersection, a filtered-empty recovery, successful stacked `/api/scoreboard` requests, and no browser console errors.
- Deferred: production deployment and cross-role production smoke remain under GAP-71.
- Blocked: none for local acceptance. The installed signed-in native build reaches the canonical production host, which still returns 404 for the undeployed aggregate route; live native totals and filter interaction therefore remain a rollout gate rather than local proof.
- Proof artifacts: `tasks/archive/proofs/scoreboard-explorer-2026-08-23/index.html`, its matched 1440 × 1000 captures, and `review-spec.json`.
- Next slice or stop: implement the bounded service/API contract first.
