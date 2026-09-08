# Repository Audit and Improvement Plan - 2026-08-10

## Continued slop and query-efficiency pass - 2026-09-07

- User requested continued investigation and implementation. Preserve the prior pass plus active Schedule/native changes.
- [x] Kits: replace three total/active/archived counts with one `groupBy(active)` in `src/lib/services/kits.ts`, reducing list queries from five to three. `Kit.active` is non-null; keep search/location, archived visibility, empty-membership count, sorting, pagination, and response envelope unchanged. Add focused service regression coverage.
- [x] Usage report: derive total from the complete non-null platform aggregate in `src/lib/services/usage-analytics-report.ts`, reducing six queries to five. Keep the owner allowlist, 7/30/90-day window, active-user calculation, breakdowns, and version cap unchanged. Strengthen the existing route test to cover populated output and assert zero reads for unauthorized callers.
- [x] Remove `guide-freshness.ts` and its four tests: every export/type has zero product consumers; AREA_RESOURCES AC-12 explicitly preserves verification metadata without freshness badges. Retain stored verification and Mark verified behavior.
- [x] Remove unused `summarizeOperationalHealth` and `OperationalHealthSummary`, plus the source test that merely asserts the unused helper exists. Preserve `OperationalHealthState`, which Operations imports.
- [x] Remove unused `formatPickupLabel` and `uniqueHeadingId` after repository-wide reference checks. Retain the live date-formatting and line-based Markdown heading helpers.
- [x] Remove the unused battery-alert projection wrapper; move its useful battery threshold/model fixtures to the live `getBatteryCompatibilitySummaries` API, including explicit `isLow` assertions.
- Verification: focused tests and before/after query-count/output fixture replay; TypeScript, lint, migration-prefix check, regenerated codemaps/docs, full isolated app build, removed-symbol/reference sweep, final diff. Stop if output equivalence or current accepted contracts disagree. No API shape, UI, schema, mutation, native, or deployment change is planned.
- Proof boundary: count database operations at the service boundary; do not infer production latency from mock timings. Build in a temporary copy because the shared checkout has an active dev server.

### Continued-pass results

- Completed all six selected slices. Net 142 additional source/test lines removed, including the new 60-line kit regression suite. No response, UI, schema, permission, or mutation behavior changed.
- Before/after replay: complete output equality for 128 kit combinations (archived visibility, name/description search, location, page size, offset) and six usage fixtures (7/30/90 days, populated/empty), using real baseline/current service code with an in-memory database stub. Kits: 5 → 3 database calls; usage report: 6 → 5. This verifies operation counts and fixture behavior, not live SQL latency. [Replay](archive/proofs/slop-performance-2026-09-07/query-replay.mjs), [results](archive/proofs/slop-performance-2026-09-07/query-replay.json).
- Passed: 50 tests across 10 relevant suites; TypeScript; full lint; 149-migration prefix check; codemap regeneration/docs check; reference sweep; final diff whitespace check. The five removed tests exercised obsolete code; four battery fixtures were retained and redirected to the live summary function.
- Isolated optimized app build passed with exit 0, including lint/type validation, page data, prerendering, tracing, and route output. All 10 retained source/test files match the isolated build snapshot byte-for-byte. [Build log](archive/proofs/slop-performance-2026-09-07/second-build.log). Temporary build copy removed after saving evidence; active dev server left running.
- Investigated but not changed: low-stock/license notification loops, dormant Schedule/workflow exports, and other single-reference functions need runtime-discovery and delivery-contract checks; an export count alone is not sufficient evidence for deleting them. No new behavior was shipped, so area acceptance and gap states remain unchanged.
- Local only: no commit, push, deployment, production-data access, or measured production latency. Existing native and Schedule work is preserved.

## Slop and performance follow-up - 2026-09-07

Current authorization: audit and implement bounded cleanup/performance fixes locally. The August evidence below is historical, not a claim about this checkout.

- Scope: `src/lib/equipment-sections.ts`, `tests/equipment-sections.test.ts`, and `src/lib/student-availability.ts`.
- Confirmed cleanup: `groupAssetsBySection`, `sectionIndex`, and the always-true `isSectionReachable` have no product consumers; six tests exercise these dead exports or the forwarding-only `classifyBulkCategory`. Inline the latter's sole product call into `groupBulkBySection` and retain the live classifier/grouping tests.
- Confirmed performance candidate: `evaluateAvailabilityPreferences` constructs two identical `Intl.DateTimeFormat` objects per call; candidate scoring calls it per candidate. Hoist the fixed-timezone formatter and retain all conversion options and conflict logic.
- Contracts checked: D-016 code-defined equipment classification; Student Availability V1 weekly/ad hoc, preference, and approved-time-off semantics; current caller in `candidate-scoring.ts`. No schema, API shape, UI behavior, permission, or lifecycle changes.
- Preserve active Schedule publication and iOS dashboard changes, including their tests and ledgers. Stop if another edit overlaps these selected files or output parity fails.
- Verification plan: baseline focused tests; before/after evaluator comparison over dated fixtures including DST transitions; alternating warm benchmark samples with complete-output parity; focused tests, TypeScript, lint, app-only build, codemap/docs checks, final reference and diff checks.
- Proof boundaries: benchmark measures local evaluator CPU only; no production latency claim. No visual review is required for dead exports and identical pure-function outputs; no native source changes.
- [x] Remove dead helpers and tests: three unused exports, one forwarding wrapper, six tests; net 130 source/test lines removed across the slice.
- [x] Reuse formatter and verify output parity/performance: 17,520 complete-output comparisons across every 2026 hour, with empty and 19-block inputs, including Central DST transitions. Seven alternating warmed samples of 2,000 evaluations: median 110.69 ms before, 14.92 ms after (7.42x local CPU speedup).
- [x] Finish repository gates and record results here. This bounded local slice is complete; production latency and rollout remain unclaimed.

### September review and proof

- Passed: baseline 37 tests; final 62 tests across equipment sections, student availability conflicts/routes, candidate scoring, auto-fill preview, and the related API hardening suite; `npx tsc --noEmit --pretty false`; `npm run lint`; `npm run verify:docs` after `npm run codemap`; `git diff --check`; zero remaining source/test references to removed exports.
- Benchmark source and raw samples: [benchmark.mjs](archive/proofs/slop-performance-2026-09-07/benchmark.mjs), [benchmark.json](archive/proofs/slop-performance-2026-09-07/benchmark.json). Run from the repository root with `node tasks/archive/proofs/slop-performance-2026-09-07/benchmark.mjs`; baseline source is read from commit `1f2af2aa`.
- Build: the shared `npm run build:app` compiled and passed type/lint checks, then failed page-data collection with missing Items pages. Read-only process inspection found an existing `next dev` on port 3000; the sandboxed port guard had not detected it, and the shared manifest no longer contained those pages. The equivalent app-only build **passed** in an isolated temporary source copy with its own `.next`, using `node node_modules/next/dist/bin/next build` (without the shared-directory guard). All three changed source/test files matched that copy byte-for-byte. [Build log](archive/proofs/slop-performance-2026-09-07/build.log). The active dev server was left running; authenticated dev-server recovery was not exercised.
- Generated codemaps also reflect the already-active Schedule service line counts and three pre-existing added test files. Their source edits were preserved.
- Surveyed candidates: equipment helpers/tests, availability conversion and its candidate-scoring caller, dashboard aggregates, report loops, kit queries, and app-time/availability-copy formatting. This was a bounded source survey, not an exhaustive native, security, or production performance audit.
- Rejected broad cuts: source-contract tests remain intentional repository contracts; short named helpers are not inherently wasteful; dashboard counts already use one aggregate; earlier DESLOPPIFY items are completed historical work. Other formatter and query candidates need their own caller/output/performance evidence before editing.
- No product behavior or acceptance contract changed, no gap closed, and no area changelog is required. No commit, push, deployment, native build, or production latency measurement was performed.

## Goal

- Audit the current Wisconsin Creative repository end to end, reject stale or unsupported concerns, and implement the highest-value confirmed repairs without disturbing unrelated work.
- Finish with every retained finding repaired, explicitly deferred, or blocked by a named external requirement and with source, test, build, simulator, browser, device, and production proof kept distinct.

## Route

- Owner: cross-cutting repository integrity.
- Ledger: this file.
- Primary contracts: `AGENTS.md`, `docs/NORTH_STAR.md`, `docs/DECISIONS.md`, `docs/GAPS_AND_RISKS.md`, relevant `docs/AREA_*.md` and `docs/BRIEF_*.md`, current schema/source/tests, and current runtime evidence when authorized and available.
- Historical inputs: existing root audits, archived plans, and session notes are leads only. They do not become findings until current source confirms them.

## Repository Provenance and Work Boundaries

- Baseline checkout: `main` at `7773c82e827518fd68a4855dbcf2b4cad5b5b1ee`, synchronized with `origin/main` when the audit began.
- Preserve these pre-existing unstaged files as unrelated active work:
  - `ios/Wisconsin.xcodeproj/project.pbxproj`
  - `ios/project.yml`
  - `tasks/app-store-connect-submission-content.md`
  - `tests/ios-app-web-trust-contract.test.ts`
- Do not clean, modify, stage, or reconcile the detached/prunable or advisor worktrees found during baseline inspection.
- No branch, worktree, subagent, commit, push, PR, deployment, production mutation, destructive cleanup, or GitHub issue is authorized by this goal.

## Ranking

Retained work is ordered by:

1. Security, authorization, privacy, and irreversible data-integrity risk.
2. Custody, booking, kiosk, Schedule, notification, and synchronization correctness.
3. High-impact API/client contract failures, including native rollout tolerance.
4. Serverless timeout, N+1, unbounded fanout, and operational reliability risks.
5. Accessibility, recovery-state, test, documentation, and maintainability gaps with concrete user or operator impact.

Severity alone does not authorize a risky change. Prefer the smallest independently verifiable root-cause repair and isolate decision-dependent options.

## Stop Conditions

- Stop a candidate if current source contradicts the historical report, evidence is speculative, or another active plan already owns the same work.
- Stop and record a product-direction option when repair would change a role, custody boundary, lifecycle, notification policy, public exposure, or authority contract without an accepted decision.
- Stop schema work if migration provenance, current schema, or controlled database verification disagrees. Do not hand-create migration history.
- Stop production, authenticated mutation, device, App Store, deployment, or external-service work unless separately authorized.
- Stop editing any file when an unrelated dirty change overlaps the required lines and cannot be safely preserved.
- If the same verification or repair approach fails twice, re-plan instead of repeating it.

## Audit Coverage

| Surface | Status | Evidence or exclusion |
|---|---|---|
| Repository provenance, history, task ownership, CI, scripts | Verified | Baseline established; migration, codemap, iOS project, native drift, TypeScript, lint, and full Vitest gates executed. |
| Product workflows and route/navigation states | Verified at source/test layers | Current area contracts, route/view state branches, and focused recovery contracts were inspected. Authenticated runtime appearance remains outside the available proof. |
| API wrappers, validation, envelopes, errors, pagination, idempotency | Verified | All 267 route handlers remain on repository wrappers; mutation, public abuse, RBAC, validation, pagination, and concurrency contract suites pass. |
| Authorization, privacy, secrets, abuse, trust boundaries | Verified at repository layer | Tracked secret scan, dependency audit, CSRF/Origin, public abuse, role denial, collaborator, and kiosk-custody contracts pass. No live identity or production mutation was used. |
| Booking, custody, kiosk, Schedule, notifications, sync invariants | Verified | Current transaction, serialization, custody, publication, notification, and negative-route suites pass. Historical findings that no longer reproduce were rejected. |
| Prisma schema, migrations, constraints, indexes, query efficiency | Verified at source/migration layer | Schema and all 116 migration folders inspected; prefix and malformed-folder check passes. No controlled live database mutation was authorized. |
| Native Wisconsin and WisconsinKiosk | Verified at source/static layers; compile blocked | Codable, request ownership, navigation/capability, audit registry, project drift, source contracts, and Swift parser pass. Exact simulator XCTest/build is blocked by unavailable CoreSimulator approval. |
| Web accessibility, responsive behavior, and UI primitives | Verified at source/build layers | Shared primitives and report recovery states inspected; lint, TypeScript, source contracts, and optimized Next build pass. No authenticated browser session was available. |
| Performance, caching, fanout, serverless limits, observability | Verified | Current reports, route fanout, batching, cache, rate-limit, and serverless contracts inspected. The confirmed audit lookup N+1 is repaired and route-tested. |
| Tests, skips, brittle mocks, dependency state, documentation drift | Verified | Final Vitest passes 476 files and 3,075 tests; lint, dependency audit, generated codemaps, docs check, and production-shaped web build pass. |

## Finding Contract

Each retained or rejected candidate records:

- Classification: confirmed defect; contract/security weakness; missing test/verification gap; maintainability/performance opportunity; decision-dependent product option; or rejected/stale/duplicate/unsupported.
- Exact file and line evidence.
- User/operator impact, confidence, severity, effort, change risk, dependencies, active-work overlap, and smallest safe repair.
- Proof at the layer that can fail.

## Ranked Findings

| Rank | Classification | Finding and evidence | Impact / confidence | Repair / dependency | State |
|---|---|---|---|---|---|
| 1 | Confirmed defect | `ReportsViewModel.load` rejected the replacement `.task(id: vm.days)` while an older period load owned `isLoading`, then treated cancellation as an error. Its paired `async let` also installed neither report when only one endpoint failed. | Medium user impact, high confidence: a period switch during load could leave the selected window unloaded, and one report outage hid usable data from the other. | Period-aware UUID ownership, independent endpoint outcomes, optional partial-failure decoding, XCTest coverage, and Swift-source contracts. | Implemented; source contracts and Swift parse pass; exact simulator XCTest/build blocked by CoreSimulator approval limit |
| 2 | Contract / reliability weakness | Utilization and checkout report queries used `Promise.allSettled` but silently replaced rejected sections with zero or empty data, while utilization's second query stage still failed as one `Promise.all`. | Medium operator-trust impact, high confidence: a partial database failure could look like zero utilization, no overdue gear, or an empty trend instead of unknown data. | Additive fixed-label `partialFailures`, server logging, settled metadata lookups, web/native warnings, and focused service/display tests. | Implemented and verified |
| 3 | Maintainability / performance opportunity | `POST /api/audit/last` accepted up to 200 entity IDs and ran one indexed `findFirst` per ID through an unbounded `Promise.all`. | Medium serverless efficiency impact, high confidence: one decorative settings request could fan out to 200 database round trips. | One aggregate plus one deterministic row fetch, preserving STAFF privacy and response shape, with route tests. | Implemented and verified |
| 4 | Missing test / verification gap | `ReportsView.swift` was absent from the audit registry, so the tool reported full audited coverage while separately warning about an uncounted surface. | Medium release-proof impact, high confidence: the percentage could look complete while omitting a newly shipped screen. | Focused native Reports audit, registry entry, nonzero gap-mode exit, and an inventory contract test. | Implemented and verified: 54/54 covered, 0 missing, 0 unregistered |
| 5 | Confirmed defect | `.gitignore` declared `.tmp/` repository-local scratch but ESLint did not ignore it, so generated scratch output broke the canonical lint gate. | Low product impact but high verification impact, high confidence. | Add the already-gitignored scratch tree to ESLint global ignores without excluding tracked product code. | Implemented and verified |

## Rejected or Historical Candidates

| Candidate | Classification | Reason |
|---|---|---|
| Completed `DESLOPPIFY.md` items | Historical input | The registry marks every item complete or converted to policy. Current source must independently reproduce any concern. |
| May/June API, OWASP, security, and technical-debt inventories | Historical input | High-churn services and later hardening make their old severity labels non-authoritative. Each item must be re-verified. |
| July Snow Leopard web and iOS hardening findings | Historical input | Source repairs are recorded complete; remaining browser, device, performance, and production proof is tracked as proof debt unless current source exposes a regression. |

## Dependency-Aware Slices

- [x] Slice 0: Finish repository and contract inventory; establish baseline gate results without changing product behavior.
- [x] Slice 1: Verify cross-cutting security, authorization, transaction, route-wrapper, validation, error, pagination, and bounded-work candidates; rank the retained findings.
- [x] Slice 2: Verify product/web/native contract candidates, including route states, Codable envelopes, accessibility, offline/recovery, and recent high-churn surfaces.
- [x] Slice 3: Implement the strongest safe retained finding from Slices 1-2 with focused tests and area/risk documentation.
- [x] Slice 4: Repeat bounded implementation slices in rank order while leverage remains high and proof is available.
- [x] Slice 5: Run broad closeout gates, inspect the combined diff, synchronize docs/codemaps/task lifecycle, and classify every remaining item.

## Verification

- [x] Focused tests for each repaired behavior at the available source/service/route layers.
- [x] `npm test` (476 files, 3,075 tests)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run db:migrate:check`
- [x] `npm run codemap` and generated codemap review.
- [x] `npm run verify:docs`
- [x] `git diff --check`
- [x] `npm run build:app`
- [ ] `npm run build` deliberately not run because it may execute migration deployment steps against an uncontrolled environment; `build:app` is the controlled application build.
- [x] Final `npm run ios:project:check`, `npm run drift:ios`, and Swift syntax parse.
- [x] `npm run audit:ios:gaps`: 54/54 covered, 0 missing, 0 unregistered.
- [ ] Exact `iPhone 16 Pro` Simulator XCTest/build: CoreSimulator failed inside the sandbox; required escalation was rejected because the Codex approval-usage limit was exhausted until 2026-08-15.
- [ ] Authenticated browser smoke: no safe authenticated session or failure-injection runtime was available; web proof stops at focused tests and optimized production build.
- [ ] Physical-device, external-service, and production proof remain outside this repository-only authorization.

## Review

- Implemented: truthful partial report results on server/web/native; independent native report loading with newest-period ownership; two-query audit-last batching; fail-closed native audit inventory; and scratch-aware lint configuration.
- Verified: focused service, route, display, Swift-source, and inventory contracts; 476-file Vitest; TypeScript; lint; dependency audit; migration health; generated codemaps; docs; iOS project parity; native drift; Swift parse; and optimized Next build.
- Rejected: historical security, custody, booking, Schedule, rate-limit, CSRF, SSRF, and migration concerns that current source and negative tests no longer reproduce or that an accepted decision explicitly defers.
- Blocked proof: exact native XCTest/build by the exhausted CoreSimulator approval allowance; authenticated report appearance by the absence of a safe authenticated failure-injection session; device, external-service, and production evidence by scope.
- Stop recommendation: close this repository audit. Every retained source finding is repaired and verified at its available layer. Resume only when the exact iPhone 16 Pro simulator gate or a safe authenticated failure-injection session is available.
