# Wisconsin Creative performance pass — 2026-10-20

Status: implementation, local checks, hosted preview, and authenticated browser verification complete; production merge/rollout pending. Baseline: `975982861` (current origin/main at start). Work is isolated in `codex/performance-web-ios-neon`; the original checkout's unrelated edits are preserved.

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
- Client bundles: browser-safe enum values replace runtime Prisma imports in Resources, Schedule assignment, Sports settings, and hiring helpers. Eight enum parity/order checks and a dependency-free bundle regression prevent drift. This complements the separate open PR #522 (audit constant, Blob import, font headers) without copying its changes.
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
| Authenticated application routes | Dashboard, Bookings, Items, Schedule, Resources, new guide, and Hiring loaded with successful client data reads and no uncaught browser errors or failed API responses; unsaved guide title survived “Keep editing” | Local browser using this branch's managed Neon environment and synthetic admin; Hiring empty state, not a populated applicant workflow |
| First-load JavaScript | Schedule 397 → 372 kB; Resources 343 → 318 kB; guide reader 274 → 248 kB; guide authoring 220–221 → 195 kB; Sports settings 287 → 262 kB; hiring 213 → 188 kB | Matching locked production builds before/after enum extraction; rounded build sizes, not measured page latency |
| Auth user projection | Average PostgreSQL row representation 452 → 210 bytes across 39 users (53.5% smaller) | Selected user fields only; not wire bytes or billed compute |
| Booking cursor EXPLAIN ANALYZE | 747 rows, 27 shared-buffer hits, 0.222 ms execution / 0.087 ms planning | One warm diagnostic sample, not a production latency percentile |
| Native model/runtime tests | 230/230 passed, including decoding off the main thread and cancellation | iPhone 18 Pro Max simulator, iOS 27.0; no energy comparison |
| Native UI performance smoke | 3/3 passed: launch, 300-item scrolling, equipment search/selection. Observed launch mean 2.518 s; peak physical memory averaged 39,488 kB during scrolling and 61,546 kB during search/selection | After-only DEBUG simulator run on iOS 27.0, no saved baseline or claimed improvement; device energy and stable-runtime comparison remain open |

## Neon findings and decisions

- Inspected query calls/outliers, table sizes, vacuum status, compute metadata, and the booking cursor plan. Query statistics reset at `2026-10-20T13:30:04.753Z`; historical table scan counters cover a different window. Diagnostic queries appear in these statistics and must be excluded from application conclusions.
- At the later sample, repeated kiosk auth averaged 0.671 ms (125 calls); shift counts averaged 3.8–3.9 ms (26–27 calls). The cursor query's five-call average was about 44 ms, while the warm plan above was sub-millisecond. This short window cannot establish a capacity trend or p95/p99.
- The database is about 91 MB logically. Largest application tables were product events (~5.6 MB), audit logs (~4.2 MB), notifications (~1.2 MB), and calendar events (~1 MB). Vacuum diagnostics did not identify a maintenance need.
- No evidence justified lowering/raising the current 0.25–2 CU bounds, adding an index, disabling pooling, or changing suspend behavior. Request elimination and narrower reads are the implemented compute/egress improvements; actual CU-hour savings require post-rollout comparison over similar usage.
- Existing connection handling already caps each Prisma pool at five connections, releases idle connections after five seconds, and registers the underlying pool with Vercel Fluid compute. Configured Vercel jobs run daily or weekly, not as minute-by-minute keepalives. These existing controls were retained.
- The optional Neon working-set diagnostic requires the separate `neon` extension, which is absent. It was not installed: the user's approval named `pg_stat_statements`, which already exists on the app database. No production settings, schema, extension, or data mutation occurred.
- References: [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero), [Neon API endpoint conventions](https://github.com/neondatabase/ai-rules/blob/main/neon-api-projects.mdc).

## Review and verification

- Independent native review: no blocking findings; removed obsolete empty cache-seeding conditions/comments.
- Independent web review: fixed fresh-navigation badges, current-route auth redirects, and the schedule immediate-mount refresh loop. Final review, including enum values/types/ordering and their consumers, found no remaining actionable issue.
- Generic iOS device architecture build passed with signing disabled. Unit tests and all three existing UI performance scenarios passed on the exact required simulator. Project consistency and iOS drift checks passed.
- Web tests/build initially used older reused `node_modules`; final verification used `npm ci` and Node 22/npm 11.17.0. Earlier results remain diagnostic only.
- Locked verification: `npm ci` completed under Node 22.23.3/npm 11.17.0; Next 15.5.27, React 19.3.0 and React Query 5.104.2 match the lockfile. All 6,110 Vitest tests passed, one PostgreSQL integration test skipped locally. TypeScript passed. Lint passed with 43 existing warnings. Chromium fixtures passed, including delayed requests surviving a hide/show transition. Docs/codemaps and the existing dependency-advisory gate passed; the gate retains its existing dated braces/tinypool exceptions.
- The locked production app build passed, generating all 300 static pages. `build:app` does not apply database migrations.
- Authenticated route checks used `preview:setup`, `dev:preview`, and `auth:local` for this branch's own environment. The first guide test reached server-rendered inputs before client/editor readiness during development reloads; the corrected test waits for actual client data and editor readiness, then exercises the unsaved-change dialog. A global network-idle wait also timed out against the development server and was replaced with explicit route-data assertions. Neither diagnostic was treated as a passing result.
- After-only guide and Hiring captures and a private local HTML review are retained under ignored `.tmp/performance/`. They demonstrate the current presentation and guide recovery flow; there is no matched visual baseline, production latency measurement, or guide persistence claim.
- Logs and local browser JSON live under ignored `.tmp/performance/`. XCTest results: `/private/tmp/wc-performance-unit.xcresult` and `/private/tmp/wc-performance-ui-smoke.xcresult`. No test artifacts or private generated data belong in Git.

## Delivery and remaining acceptance

All local applicable gates passed. Initial implementation commit: `bec9b5ad`; release-note commit: `290aed29`; final implementation commit: `58253cbe`. Review: [PR #534](https://github.com/erikrole/wisconsin-creative/pull/534). Hosted `validate` and `postgres-integrity` passed on `58253cbe` ([CI run](https://github.com/erikrole/wisconsin-creative/actions/runs/39448209699)). No changes have been deployed to production; no production compute settings or user data have changed.

Initial authenticated testing was blocked by the preview pool's nine-child limit ([failed provisioning run](https://github.com/erikrole/wisconsin-creative/actions/runs/39446291102)). The existing [scheduled cleanup](https://github.com/erikrole/wisconsin-creative/actions/runs/39446304895) then removed the expired condition-report preview `br-autumn-pond-au20l4uy` and travel-roster preview `br-raspy-grass-aurr65rd` after their grace periods. Our subsequent [read-only dry run](https://github.com/erikrole/wisconsin-creative/actions/runs/39446367942) found no further candidates; live inventory confirmed seven children at that point. The user chose pruning instead of raising capacity, and the unused capacity-increase proposal was withdrawn. No environment was borrowed and no limit or cleanup setting was changed.

The next provisioning attempt reached Vercel but hit its 64 kB environment-variable limit (64.67 kB requested). Inventory found orphan preview stores and handoffs whose Neon databases were already gone. Following explicit approval of the exact targets, this task removed 11 signed, development-only Blob stores and three handoff records belonging to merged PRs #411, #415, and #426. Current PR state, absent Neon IDs/names, signed resource ownership, store connections, unchanged handoff metadata, and absence of deployments were checked before deletion; an independent review added rechecks immediately before deletion. Read-back at `2026-10-20T15:55:01Z` confirmed all approved stores and 14 associated variables absent, reducing resource-project variables from 205 to 191. No live preview database or production resource was deleted. Metadata-only plan, receipt, and verification are retained under ignored `.tmp/performance/`.

Older orphan stores remain outside those explicitly approved targets. The current database-driven cleanup cannot inspect ownership rows after a Neon branch has already disappeared; a separate signed orphan-resource reconciliation is a follow-up, not an expanded deletion authorization.

The managed-preview retry [passed](https://github.com/erikrole/wisconsin-creative/actions/runs/39449600059), including synthetic login and database reads. Its [hosted deployment](https://wisconsin-creative-czlhyb38b-erikrole.vercel.app) is ready. Local authenticated browser proof then passed all seven routes against the same branch-owned database. The approved pruning cleared the provisioning blockers without increasing limits.

1. Obtain explicit approval before merging PR #534 to main, then verify the production deployment and changed product paths. Recheck required CI on the final PR head.
2. Compare physical-device memory/energy and stable-runtime launch/scroll metrics. The available required simulator uses iOS 27.0; do not record it as a stable baseline or claim battery percentages.
3. After rollout, compare request rates and Neon CU-hours across equivalent activity windows before making infrastructure changes.

The original checkout remains untouched. A separate concurrent edit to `scripts/youtube-record-replay.py` is byte-identical to the independently merged PR #533 (`638372089`); it is preserved and is not part of this performance change.
