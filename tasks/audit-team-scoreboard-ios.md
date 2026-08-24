# Audit: Team Scoreboard (iOS) — 2026-08-23

**Status:** locally accepted; production rollout proof remains under GAP-71.
**Audit type:** source contract, simulator build, and matched local runtime
proof for the shared authenticated team destination.

## Scope

`TeamScoreboardView` is the read-only native team Scoreboard reached from
Browse on compact iPhone and from the Team section on regular-width layouts.
It consumes the aggregate `/api/scoreboard` contract and keeps person links on
the dedicated Scoreboard route rather than opening private `UserDetailView`.

## Contract

- Admin, Staff, Student, and Collaborator accounts can reach the destination
  through the explicit shared `scoreboard.view` permission.
- Server-owned totals, exact stacked Sport/Venue/Opponent/Site filters, stable
  facets, deterministic Events/Wins/Win rate ranking, and the Snapshot use the
  same aggregate response without client-owned record math.
- Initial loading, empty, unavailable, refresh, stale-response, filtered-empty,
  and retry states remain explicit and recoverable.
- Person rows expose only the minimal shared identity and Scoreboard metrics;
  no private profile, contact, booking, schedule, or custody data is loaded.

## Verification

- `npm run audit:ios:gaps` reports this surface as covered.
- `tests/ios-scoreboard-wiring.test.ts` and the focused Scoreboard model/API
  contracts pass.
- The Wisconsin Xcode project includes `TeamScoreboardView.swift`, and the
  pinned iPhone 16 Pro / iOS 26.5 simulator build passes.
- Local authenticated web/native proof and the matched review artifact are in
  `tasks/archive/completed-2026-08-23/team-scoreboard-plan-2026-08-23.md`.

## Remaining rollout proof

Deploy the aggregate server route before a dependent native release, then smoke
live totals and stacked filters for Student and Collaborator accounts. The
installed signed-in native build currently receives the expected production
404 until that route is deployed.
