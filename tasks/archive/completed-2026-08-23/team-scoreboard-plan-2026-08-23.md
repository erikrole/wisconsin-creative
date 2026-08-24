# Team Scoreboard Plan — 2026-08-23

Status: completed locally; production rollout proof tracked by GAP-71.

## Goal

Add a first-class Scoreboard destination to the primary left navigation for every authenticated role. The page aggregates the current Scoreboard season into team totals and per-person leaderboards, and every authenticated role can open an active, visible person’s Scoreboard without gaining access to that person’s private profile data.

## Product contract

- “Anyone” means every authenticated app role: Admin, Staff, Student, and Collaborator.
- `/scoreboard`, `/scoreboard/[userId]`, and the read-only Scoreboard APIs are shared authenticated team surfaces.
- The exception is limited to Scoreboard identity and metrics: person id, name, avatar, season work totals, record totals, breakdowns, and resolved-game rows.
- Email, phone, role, affiliation, profile fields, availability, call times, booking history, activity, badges, audit, and custody data remain private.
- Cross-user Scoreboards are available for active, non-hidden people. Existing self/operator access to hidden or inactive records retains the established visibility boundary.
- Aggregate totals distinguish unique events/games from person-event and person-game credits so a game staffed by several people is not presented as several team games.
- Official-record exclusions and the 2026–27 season scope remain server-owned and match the existing profile Scoreboard.
- This is authenticated app visibility, not unauthenticated internet publishing.

## Completed implementation

### Shared visibility and aggregate data

- Added the explicit all-role `scoreboard.view` permission and shared visibility helper.
- Added `GET /api/scoreboard` backed by two batched `CalendarEvent` reads rather than an N+1 per-user loop.
- Filtered aggregate identity to active, non-hidden people and active assignment statuses.
- Deduplicated multiple shifts for the same person/event before work and record credit.
- Returned minimal identity plus explicit season and counting-method metadata.
- Opened the existing per-person Scoreboard read to every role under the same narrow active/visible boundary.

### Web

- Added `/scoreboard` with team metrics, sport scope, Events/Wins/Win rate rankings, desktop table, narrow cards, loading, empty, error, background-refresh recovery, and 40px controls.
- Added `/scoreboard/[userId]` as a minimal shared detail that bypasses the private user-profile payload and suppresses protected event links.
- Added Scoreboard to the primary left navigation and shared page search for every authenticated role, including Collaborator.

### Native iOS

- Added a native `TeamScoreboardView` and tolerant aggregate Codable models/API client method.
- Added Scoreboard first in compact Browse for every role and directly in the regular-width Team sidebar.
- Per-person navigation opens the read-only `ScoreboardView` directly instead of `UserDetailView`.
- Added loading, empty, error, refresh, stale-response, sport-filter, ranking, and methodology states.

## Verification evidence

- Focused Vitest suite: 15 files, 106 tests passed, covering aggregate service, route envelopes, all-role RBAC/privacy, detail visibility, web navigation/search, native wiring, tab stability, and adjacent profile Scoreboard contracts.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run lint`: passed.
- `npm run ios:project:check`: passed.
- `npm run build:app`: passed with `/scoreboard`, `/scoreboard/[id]`, and `/api/scoreboard` in the route manifest.
- Required iPhone 16 Pro iOS 26.5 build: passed.
- Focused native `ScoreboardModelsTests`: 12 tests passed.
- Authenticated local web proof: 2026–27 loaded with 15 unique events, a 3–2 team record, 45 work credits, and 16 contributors; Win rate and Volleyball filters re-ranked the real data; person detail exposed no Contact section or event/profile links; console errors and warnings were empty.
- Native signed-in proof: Browse renders Scoreboard first and the production-host 404 degrades into the intentional retryable unavailable state. Live native totals await the server deployment tracked by GAP-71.
- Matched visual review: `tasks/archive/proofs/team-scoreboard-2026-08-23/index.html`; the before/after left rail differs by the new 42px Scoreboard row and the resulting downstream shift.

## Acceptance

- [x] Every authenticated role has the Scoreboard permission and navigation destination.
- [x] Every authenticated role can load the aggregate page and an active, non-hidden person’s Scoreboard under source/route contract coverage.
- [x] Aggregate responses report unique coverage separately from person credits and use deterministic ranking.
- [x] A person assigned to multiple shifts on one event receives one event/game credit.
- [x] Hidden/test users do not enter aggregate results, and private profile fields do not enter aggregate or detail payloads.
- [x] Initial loading, empty, error, background refresh, desktop, narrow, and native unavailable states are intentional and recoverable.
- [x] Focused tests, web/native build gates, authenticated browser proof, and the matched visual review pass without overwriting unrelated work.

## Remaining rollout proof

- Deploy the aggregate server/web contract before a dependent native release.
- Smoke Student and temporary Collaborator aggregate/person reads while confirming private-profile denial.
- Verify live native totals and capture the signed-in regular-width iPad sidebar.
- These gates remain active in `GAP-71`; no deployment or production mutation was part of this local implementation slice.
