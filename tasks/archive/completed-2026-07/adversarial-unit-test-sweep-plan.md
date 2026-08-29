# Adversarial Unit Test Sweep Plan - 2026-07-17

## Goal

- Establish a clean, repeatable automated-test baseline and deliberately attack malformed input, boundary values, concurrency, idempotency, resource bounds, corrupted state, and invalid assumptions across Wisconsin Creative.
- Keep only tests that protect meaningful behavior. Consolidate or remove tests only when their behavioral coverage is demonstrably duplicated or obsolete.
- Fix every verified product or test-harness bug found, add a permanent regression test for each product bug, and repeat the relevant focused and full suites until no unexplained failures remain.

## Route

- Owner area: cross-cutting platform integrity and test infrastructure.
- Secondary areas: reservations/checkouts, kiosk and item-family custody, auth/permissions, Schedule, imports, notifications, native iOS, and source-contract coverage. Read each area's current brief and area doc before changing its behavior.
- Ledger: this plan.
- Existing references: `docs/TESTING.md`, `docs/RELEASE_VERIFICATION.md`, `docs/DECISIONS.md`, `tasks/lessons.md`, `tasks/archive/completed-2026-07/testing-guide-refresh-plan.md`, `tasks/archive/completed-2026-07/decision-contracts-plan.md`, and the 2026-07-02 contract-test recovery notes in `tasks/todo.md`.

## Source Checks

- `main` matched `origin/main` and the worktree was clean at intake.
- Vitest runs in the Node environment over `tests/**/*.test.ts`, with global mock clearing from `tests/_setup.ts`.
- Intake static inventory: 377 Vitest files, 2,231 `it()` / `test()` declarations, 52 `ios-*.test.ts` files, 79 source/contract files, and 63 route-named files.
- No committed `.skip`, `.todo`, `.only`, `describe.skip`, or `describe.only` markers were found at intake.
- Final static inventory: 391 Vitest files, 2,331 `it()` / `test()` declarations, 54 `ios-*.test.ts` files, 79 source/contract files, and 66 route-named files.
- `vitest.config.ts` scopes coverage to `src/lib/services/**`, `src/lib/rbac.ts`, `src/lib/permissions.ts`, and `src/lib/api.ts`. The sweep added the matching V8 provider, a durable `npm run test:coverage` command, and non-regression thresholds at the measured baseline.
- Native behavior has both Swift XCTest targets and TypeScript source-contract tests. Static source assertions do not replace XCTest and Xcode compilation.
- Current accepted integrity contracts prioritize derived status, SERIALIZABLE booking mutations, database-enforced active-allocation uniqueness, audit completeness, terminal lifecycle states, default-deny collaborator access, and kiosk-only custody.

## Stop Conditions

- Stop and reconcile the relevant brief, area doc, or decision before changing behavior when a failing test conflicts with current product direction.
- Do not classify a failure as a product bug from a stale source-string assertion alone. Prove the desired runtime or service behavior first.
- Do not weaken authorization, transactions, audit writes, uniqueness, lifecycle guards, or kiosk custody to make a test pass.
- Do not delete or consolidate a test until its assertions, fixtures, production subject, and overlapping tests have been read in full and the remaining suite demonstrably protects the same meaningful behavior.
- Do not run the migration-deploying `npm run build` against an uncontrolled database. Use `npm run build:app` unless schema or deployment behavior enters scope and the environment is explicitly safe.
- Do not use live production data for destructive, concurrency, exhaustion, or corruption tests. Keep these tests deterministic with mocks, local fixtures, or isolated test targets.
- If coverage measurement requires a new package download, request approval rather than silently changing dependency state.
- If a suspected race cannot be reproduced deterministically at the unit/service boundary, record the concrete limitation and add the narrowest deterministic invariant test instead of a timing-dependent flaky test.

## Slices

- [x] Slice 0: Baseline and harness integrity.
  - Run the complete Vitest suite and capture exact failures, duration, worker behavior, unhandled errors, open handles, and resource usage.
  - Re-run in shuffled deterministic orders and inspect test-framework options for isolation, timeouts, and concurrency behavior.
  - Validate the native XCTest inventory and current Xcode scheme test actions.
- [x] Slice 1: Test-value audit and consolidation.
  - Inventory duplicate test titles, repeated source-string checks, oversized fixtures, tests without meaningful assertions, and clusters that pin implementation text instead of behavior.
  - Consolidate only proven duplicates. Preserve narrow contract sentinels when they defend distinct architectural boundaries.
  - Strengthen weak assertions where the production outcome is more meaningful than call-count or source-text evidence.
- [x] Slice 2: Malformed-input, boundary, and resource-bound tests.
  - Attack schema normalization, query/body parsing, date/time boundaries, pagination, CSV/import fields, scan normalization, URL/SSRF constraints, numeric ranges, empty/duplicate collections, oversized strings/arrays, and timeout/error-body handling.
  - Require explicit, bounded, user-safe failures and verify no partial mutation occurs.
- [x] Slice 3: Concurrency, idempotency, and atomicity.
  - Exercise booking and allocation races, P2002 conflict mapping, optimistic version checks, duplicate submissions, retry-safe cron/workflow operations, audit atomicity, and transaction isolation.
  - Verify logically atomic writes roll back together and terminal or stale state cannot be resurrected.
- [x] Slice 4: Authorization and corrupted-state recovery.
  - Test actor/target role boundaries, collaborator default denial and response sanitization, kiosk location scope, hidden/deactivated users, missing relations, orphan/stale allocations, impossible lifecycle transitions, and partial downstream failures.
  - Preserve already-loaded/readable state where the accepted contract requires graceful degradation.
- [x] Slice 5: Native iOS and cross-language contracts.
  - Test Codable nullability/envelopes, date-only and timezone boundaries, state-reset/retry behavior, duplicate action guards, kiosk scanner phase ownership, and target membership.
  - Run the affected XCTest targets, source-contract tests, drift/gap checks, and Xcode builds.
- [x] Slice 6: Coverage, repeated clean runs, and closeout.
  - Measure executable coverage for critical server modules if the local toolchain supports it; add a documented coverage command/provider only if needed and approved.
  - Close material uncovered branches with behavioral tests, not line-filling assertions.
  - Refresh `docs/TESTING.md`, update this review, and sync any affected area docs or risk entries.

## Regression-Test Rules

- Use `BUG: <plain-language failure>` sparingly for high-risk regressions where the label materially improves discovery; otherwise use a precise behavioral title and record the defect in this review.
- Make every regression test fail against the pre-fix behavior and pass for the accepted contract.
- Keep factories minimal and override-friendly; fixtures should contain only state relevant to the assertion.
- Prefer observable state, returned errors, persisted writes, isolation options, and audit snapshots over implementation call counts.
- Bound exhaustion tests to safe deterministic sizes that prove limits without making the normal suite slow or flaky.
- Record every removed or consolidated test cluster in the review with the surviving coverage point.

## Verification

- [x] Focused Vitest files after each fix.
- [x] `npm test` with zero failures, skips, unhandled errors, or unexplained warnings: 391 files and 2,464 tests.
- [x] Three deterministic shuffled full-suite runs: seeds `1701`, `1702`, and `20260717`, each at 2,464 passing tests.
- [x] `npm run test:coverage`: 391 files and 2,464 tests pass with 70.80% statements/lines, 78.03% branches, and 77.35% functions across the configured critical-server scope. Enforced floors are 70% statements/lines and 75% branches/functions.
- [x] Affected Swift XCTest targets: `Wisconsin` 12/12 and `WisconsinKiosk` 5/5. Both repository Xcode wrappers pass project/static gates, simulator tests/builds, and generic-device builds after approved CoreSimulator/compiler access.
- [x] `npx tsc --noEmit --pretty false`.
- [x] `npm run lint`.
- [x] `npm run db:migrate:check`.
- [x] `npm run codemap` before docs verification when codemap-owned source changes.
- [x] `npm run verify:docs`.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [x] Authenticated browser proof was not applicable: this sweep changed validation, transactional services, workflows, and native async ownership, not a browser-rendered interaction. `npx playwright test --list` discovered all 27 smoke tests successfully; running them requires the isolated authenticated credentials outside this unit-test scope.

## Review

- Shipped: strict malformed-JSON and pagination handling; bounded mutation arrays and quantities; truthful asset date/conflict validation; atomic reservation caps, kiosk completion, category mutations, and shift edits; bounded checkout bulk-line edits; retry-safe post-commit effects; and latest-request ownership across native auth, Items, Bookings, and kiosk availability.
- Verified: the final 391-file, 2,464-test Vitest suite passes in normal order, with V8 coverage, and in all three shuffled orders. TypeScript, ESLint, live Neon migration health, migration-prefix checks, iOS drift/project/gap checks, both production Xcode verification wrappers, the production app build, and 17 Swift XCTest cases pass.
- Consolidated or removed: five redundant transaction export assertions and one duplicated Schedule export source assertion were removed. Accessibility source checks were replaced by rendered behavior, stale product-language expectations were corrected, and expected error paths now assert their logging instead of polluting suite output.
- Bugs found and regression tests: malformed JSON was misclassified; handler-thrown `SyntaxError` could be mislabeled as bad JSON; pagination accepted ambiguous values; numeric policies accepted non-finite or unsafe values; asset dates and uniqueness messages were unreliable; request arrays and numbered-unit creation were unbounded; numbered reservation planning could exceed kiosk capacity; quantity-only pickup required impossible unit scans; conversion could discard off-location stock; reservation capacity, kiosk completion, category trees, and shift mutation paths had race or atomicity gaps; legacy overdeep category trees blocked harmless renames; checkout bulk edits and reservation-pickup per-SKU writes could exceed the Vercel timeout budget; four native flows allowed stale async work to overwrite newer state; and logout could clear a newer login cookie. Every verified defect has focused permanent regression coverage.
- Deferred: no product defect. The configured server coverage scope is measured and thresholded; browser-only rendering remains covered by the separate isolated Playwright layer, and native compilation/races are covered by source contracts plus XCTest.
- Blocked: none.
- Proof artifacts: Vitest seeds above; Xcode result bundles under `~/Library/Developer/XcodeBuildMCP/workspaces/gear-tracker-ff0dd6451482/result-bundles/`; focused regression files beside each changed service/route; and the verification commands recorded in this plan.
- Next slice or stop: stop. The bounded adversarial sweep is clean, measured, and guarded against coverage regression.
