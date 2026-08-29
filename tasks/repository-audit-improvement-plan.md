# Repository Audit and Improvement Plan - 2026-08-10

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
