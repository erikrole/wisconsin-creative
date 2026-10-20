# Wisconsin Creative performance pass — 2026-10-20

Status: local implementation and verification complete; hosted review and rollout pending. Baseline: `975982861` (current origin/main at start). Work is isolated in `codex/performance-web-ios-neon`; the original checkout's unrelated edits are preserved.

## Scope and contract

Web responsiveness and memory, native iOS CPU/memory/network/battery work, and live Neon compute diagnostics. Preserve current workflows, privacy, authorization, custody, notification truth, and offline recovery. No speculative infrastructure resizing, production data changes, or physical battery claims.

## Plan

1. Capture current source and live database evidence; distinguish prior completed performance fixes.
2. Bound browser cache retention, stabilize cache-provider identity, deduplicate shared reads, and stop unnecessary inactive polling.
3. Reduce iOS repeated persistence, main-thread decode, image pressure, and unnecessary network work.
4. Inspect live query statistics, compute configuration and query plans. Prepare only evidence-supported changes; ask before infrastructure changes.
5. Run behavioral regressions, full TypeScript/lint/app build, native builds/tests and available runtime measurements. Obtain independent review of cross-cutting changes.
6. Record measured results, exact delivery status and remaining authenticated/device/compute gates in this ledger and relevant area docs.

## Initial evidence

- The production Neon endpoint uses 0.25–2 CU; suspend timeout 0 (Neon default: five minutes, not disabled). Auxiliary `neondb` is not the application database.
- `pg_stat_statements` already exists on `gear-tracker`. No extension change is needed despite the initial auxiliary-database diagnostic error. User authorized enabling query diagnostics if needed.
- PostgreSQL table statistics include historical activity; query statistics are a shorter current compute window. Do not attribute all sequential scans to bad plans, or diagnostic-query execution time to app traffic.
- Browser query defaults retain all inactive responses for 24 hours even though only dashboard/booking roots persist. QueryProvider switches provider type after mounting.
- iOS Schedule writes the same loaded window twice; cache upserts fetch each record separately. The independent source review also identified main-actor decoding and avoidable Live Activity availability checks.

## Implemented

- Browser cache: stable persistence provider identity; five-minute inactive retention for transient queries, with the existing 24-hour dashboard/booking-detail persistence preserved. Concurrent Home/navigation counts share a user-scoped query, navigation still forces fresh custody counts, partial failures retain trusted values, and login returns to the current route.
- Polling: inventory requests abort when their effect ends; booking and inventory loops own their in-flight state so a canceled old loop cannot starve its replacement. Schedule release refreshes stop while hidden/offline, avoid overlapping requests and remount loops, and preserve active late-night editing. Working Crew's scheduled reads skip hidden/offline tabs.
- Auth reads: select identity, session validity, collaborator policy, and authorization fields instead of the entire staff profile. No credential, permission, or session-expiry rules change.
- iOS: concurrent request-local JSON decoding and image/SVG preview preparation; cancellation and identity/request ownership are rechecked before publishing. One foreground task owns refresh work and cancels on background/account change. App Intents reuse the already validated identity. Live Activities avoid return-insight availability requests for checkouts outside the existing 60-minute maximum lead window.
- Persistence: removed unused GearStore seeding and eager SwiftData container creation after independent consumer search. ScheduleWindowCache remains active and now saves each loaded window once; draft, widget, and legacy sign-out cleanup paths remain.
- Regression tooling: `npm run test:performance:web` exercises actual components in local Chromium fixtures. Third-party QR distribution bundles are excluded from app lint rules; first-party QR source remains linted.

## Measured evidence

| Check | Observed result | Boundary |
| --- | --- | --- |
| Query cache retention | 250 inactive search variants removed after five simulated minutes; active data and two persisted roots retained | Query objects, not a measured browser heap reduction |
| Chromium provider lifecycle | One mount, zero unmounts, unfinished input preserved | Real components, fixture APIs, no production login |
| Shared dashboard read | One request for two concurrent consumers; forced navigation refresh remains available | Request count, not page-load timing |
| Hidden/resumed browser activity | Zero scheduled reads during three simulated hidden minutes; booking/item reads resume, including while canceled old reads are still held; schedule refresh respects its cadence | Browser virtual-clock regression |
| Auth user projection | Average PostgreSQL row representation 452 → 210 bytes across 39 users (53.5% smaller) | Selected user fields only; not wire bytes or billed compute |
| Booking cursor EXPLAIN ANALYZE | 747 rows, 27 shared-buffer hits, 0.222 ms execution / 0.087 ms planning | One warm diagnostic sample, not a production latency percentile |
| Native model/runtime tests | 230/230 passed, including decoding off the main thread and cancellation | iPhone 18 Pro Max simulator, iOS 27.0; no energy comparison |

## Neon findings and decisions

- Inspected query calls/outliers, table sizes, vacuum status, compute metadata, and the booking cursor plan. Query statistics reset at `2026-10-20T13:30:04.753Z`; historical table scan counters cover a different window. Diagnostic queries appear in these statistics and must be excluded from application conclusions.
- At the later sample, repeated kiosk auth averaged 0.671 ms (125 calls); shift counts averaged 3.8–3.9 ms (26–27 calls). The cursor query's five-call average was about 44 ms, while the warm plan above was sub-millisecond. This short window cannot establish a capacity trend or p95/p99.
- The database is about 91 MB logically. Largest application tables were product events (~5.6 MB), audit logs (~4.2 MB), notifications (~1.2 MB), and calendar events (~1 MB). Vacuum diagnostics did not identify a maintenance need.
- No evidence justified lowering/raising the current 0.25–2 CU bounds, adding an index, disabling pooling, or changing suspend behavior. Request elimination and narrower reads are the implemented compute/egress improvements; actual CU-hour savings require post-rollout comparison over similar usage.
- The optional Neon working-set diagnostic requires the separate `neon` extension, which is absent. It was not installed: the user's approval named `pg_stat_statements`, which already exists on the app database. No production settings, schema, extension, or data mutation occurred.
- References: [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero), [Neon API endpoint conventions](https://github.com/neondatabase/ai-rules/blob/main/neon-api-projects.mdc).

## Review and verification

- Independent native review: no blocking findings; removed obsolete empty cache-seeding conditions/comments.
- Independent web review: fixed fresh-navigation badges, current-route auth redirects, and the schedule immediate-mount refresh loop. Final review found no remaining actionable issue.
- Generic iOS device architecture build passed with signing disabled. Unit tests passed on the exact required simulator. Project consistency and iOS drift checks passed.
- Web tests/build initially used older reused `node_modules`; final verification used `npm ci` and Node 22/npm 11.17.0. Earlier results remain diagnostic only.
- Locked verification: `npm ci` completed under Node 22.23.3/npm 11.17.0; Next 15.5.27, React 19.3.0 and React Query 5.104.2 match the lockfile. All 6,101 Vitest tests passed, one PostgreSQL integration test skipped locally. TypeScript passed. Lint passed with 43 existing warnings. Chromium fixtures passed, including delayed requests surviving a hide/show transition. Docs/codemaps and the existing dependency-advisory gate passed; the gate retains its existing dated braces/tinypool exceptions.
- The locked production app build passed, generating all 300 static pages. `build:app` does not apply database migrations.
- Logs and local browser JSON live under ignored `.tmp/performance/`. XCTest result: `/private/tmp/wc-performance-unit.xcresult`. No test artifacts or private generated data belong in Git.

## Delivery and remaining acceptance

All local applicable gates passed. Implementation commit: `bec9b5ad`. Review: [PR #534](https://github.com/erikrole/wisconsin-creative/pull/534). Hosted checks, authenticated preview, and rollout remain pending. No changes have been deployed; no compute settings or user data have changed.

1. Verify hosted CI and the branch's own managed authenticated preview. Fixture proof is not authenticated application proof; do not borrow another branch's environment.
2. Compare physical-device memory/energy and stable-runtime launch/scroll metrics. The available required simulator uses iOS 27.0; do not record it as a stable baseline or claim battery percentages.
3. After rollout, compare request rates and Neon CU-hours across equivalent activity windows before making infrastructure changes.

The original checkout remains untouched. A separate concurrent edit to `scripts/youtube-record-replay.py` in this worktree is unrelated, preserved, and excluded from this task's delivery.
