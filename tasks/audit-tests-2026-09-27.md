# Test audit — 2026-09-27

Status: audit delivered; reliability repairs, a source-contract consolidation pilot, Item Insights CPU optimization, dependency updates including Vitest 4, custody/bulk owner tests, kiosk destination/retry-recovery repairs, and PostgreSQL rollback/contention/replay checks are implemented and verified locally. Database CI wiring is prepared; hosted/device acceptance and broader runtime coverage remain open. The user accepted the accurate coverage baseline.

The findings below preserve the original audit baseline. See the follow-ups at the end for the repaired baseline and current verification.

The suite has valuable domain and platform protection, but its count overstates its confidence. Repair false positives and order dependence first, consolidate source-check overhead second, and spend new coverage on custody, bulk scheduling, and actual native/browser execution. Deleting large numbers of tests is not the primary opportunity.

## Scope and evidence

Examined HEAD `1c62814365f89eb377689495ba8f1eb4f85a9d9e` plus the existing dirty working tree. Preserved unrelated dashboard, booking, Schedule, and iOS work. No product or test implementation was changed. Audit probes used temporary configuration under `/tmp/wc-test-audit-2026-09-26/`.

The inventory and pattern sweep cover all 727 discovered test files. Runtime evidence covers the full 702-file Vitest suite, coverage, a shuffled run, focused failure reproductions, and a source-check consolidation experiment. Semantic review was targeted at risky owners and flagged patterns; this is **not a claim that all 112,000+ test lines received individual manual review**. Native and browser suites were inspected but not executed. No production database or deployment was touched.

Work stopped when the original weekly usage window reset, then resumed on explicit instruction. The initial 9% stopping buffer was later replaced by a daily budget with unused allowance carried forward. On September 27 the user authorized up to three additional percentage points for the custody-contract fix, from a 10% weekly reading to a 13% stopping point, preserving the remaining reserve. Stop immediately if reset timestamp `1791047471` changes. Usage readings are account-wide, not task token accounting.

The user subsequently suspended the spending cap and asked to continue. The separate weekly-reset stop rule remains in effect.

Durable evidence:

- [Every discovered test file, classification, and runtime result](archive/proofs/test-audit-2026-09-27/inventory.tsv).
- [Run totals, failures, coverage scope, and measurements](archive/proofs/test-audit-2026-09-27/run-summary.json).
- [Coverage by instrumented source file](archive/proofs/test-audit-2026-09-27/coverage-by-file.tsv).
- [Source assertion duplicate candidates](archive/proofs/test-audit-2026-09-27/source-duplicate-candidates.tsv): a review queue, not a deletion list.
- [Independent native review, with ownership and retention evidence](archive/proofs/test-audit-2026-09-27/native-review.md).
- [Passkey boundary probe](archive/proofs/test-audit-2026-09-27/passkey-boundary-probe.log) and [corrected-fixture result](archive/proofs/test-audit-2026-09-27/passkey-corrected-fixture.log).

Full raw baseline, coverage, shuffle, timing, and CI logs remain in `/tmp/wc-test-audit-2026-09-26/`; temporary files are not durable storage. Findings and compact results above are retained in the repository.

## Inventory and measured baseline

| Layer | Files | Static case declarations | Interpretation |
| --- | ---: | ---: | --- |
| Vitest behavior | 369 | 2,850 | Executes TypeScript owners; mocks still need scrutiny |
| Web/tooling source checks | 137 | 567 | Inspects source instead of rendering or executing the owner |
| Native source checks | 132 | 714 | Includes cross-client/platform contracts |
| Mixed runtime/source | 64 | 518 | Both kinds in a file |
| Swift test files | 20 | 312 | Includes unit, UI, and performance declarations; not executed here |
| Playwright specs | 3 | 14 | Loops/projects expand runtime cases; auth setup is additional infrastructure |
| Python tooling | 2 | 18 | Skill verification and review-artifact tooling |

Classifications are heuristic. Static declarations are not runtime cases, particularly with tables, loops, and browser projects.

| Experiment | Result | Time |
| --- | --- | ---: |
| Full Vitest, default workers | 4,968 pass; 1 fail; 1 skip | 8.10s Vitest; 8.57s wall |
| Full coverage | Same failing test; configured percentage floors exceeded | 24.58s |
| Full suite, two workers | Same baseline failure | Approximately 50.59s result span |
| Shuffled suite, seed `260926`, four workers | 4,962 pass; 7 fail; 1 skip | 29.79s |
| Source-only files, two workers | 269 files / 1,296 cases pass | 13.36s |
| Same source checks imported by one temporary file, two workers | All 1,296 cases pass | 1.84s |
| Python review-artifact tooling | 11 pass | 0.133s reported |

Local measurements used Node 24.21.0 on an 18-logical-CPU arm64 Mac. Repository/CI use Node 22. These are single local observations, with warm-cache/order effects; do not promise the same improvement on CI. No change disabled Vitest isolation.

The default skip is the explicitly gated isolated Schedule replay integration test. No Vitest `.only` or `.todo` was found. The apparent assertion-free case calls the shared Serializable assertion helper; retain it. Five identical-body groups were inspected as false positives caused by different surrounding fixtures/parameters.

Coverage is **75.62% statements/lines, 77.28% branches, 82.33% functions**, limited to services, API wrappers, permissions, and RBAC. It excludes much of the app and all Swift execution. Floors are 70/70/75/75 respectively. The coverage command still failed because of the baseline test; this was not a passing gate.

## P1: restore trustworthy failures before optimizing

### 1. A real-clock fixture now breaks the baseline and CI

`tests/schedule-working-copy-backfill-route.test.ts:129` describes a future event but ends it at `2026-09-25T20:00:00Z`. The PATCH owner in `src/app/api/shift-groups/[id]/working-copy/route.ts` compares against `Date.now()`, so the fixture now enters the ended-event path.

The same failure appears in [CI run 36189181633](https://github.com/erikrole/wisconsin-creative/actions/runs/36189181633). A temporary fixed September 1 clock makes all three cases pass. This is a demonstrated fixture defect, not evidence that the product's ended-event branch should change.

**Repair:** Freeze time in this owner suite, explicitly test before/at/after the end boundary, and restore the clock afterward. Do not merely move the fixture farther into the future. The interrupted full-suite 2027-clock experiment has no complete result and supplies no additional findings.

### 2. Mock implementations and queued results leak between cases

The shuffle produces six additional failures across four files. Global `tests/_setup.ts` calls `vi.clearAllMocks()`, which clears call history but retains implementations and queued one-shot results. File isolation does not isolate cases inside a file.

| Test owner | Reproduced weakness | Smallest repair |
| --- | --- | --- |
| `collaborator-negative-routes.test.ts:188` | Student booking success depends on `getAllowedBookingActions` configured by the preceding 404 case | Give each case an independent baseline implementation |
| `schedule-publication.test.ts:1357` | Adopted-shift removal depends on `shiftGroupWorkingCopy.deleteMany` resolving to a count from earlier setup | Reset this mock and establish an explicit per-case default |
| `pending-claim-review.test.ts:88` | Persistent rejection from blocked/error cases survives into three approval cases | Reset workflow mock implementations and queued results before restoring defaults |
| `passkey-auth.test.ts:157` | An unconsumed `deleteMany` one-shot result survives into registration | Reset implementations/queues and repair the misleading negative fixture below |

The first two also fail when selected individually. The latter two reproduce in a focused shuffled run. Preserve all affected behavioral regressions. Do not turn on global `resetMocks` blindly: existing factory defaults and module mocks need a deliberate migration.

There are 213 files with local `clearAllMocks` calls in addition to the global hook. Removing these duplicate calls is small housekeeping; it does not repair state leakage. Avoid introducing one giant mock factory that supplies plausible defaults for every service and hides missing setup.

### 3. The passkey replay test passes without reaching replay protection

`tests/passkey-auth.test.ts:430`, “does not accept a ceremony that has already been consumed,” queues `deleteMany -> { count: 0 }`. However, its default user fixture only contains `passwordHash`. In `src/lib/passkey.ts:305`, `!user?.active` rejects that fixture before the transaction consumes the ceremony.

This is directly demonstrated without editing checked-in code:

1. Existing case alone: passes.
2. Temporary assertion that `passkeyChallenge.deleteMany` was called once: fails, actual calls zero.
3. Same assertion with an active-user fixture: passes and still returns 401.

**Repair:** Configure the preceding authentication conditions as valid, assert that the consumed-ceremony boundary was reached, and assert that no session/counter update follows. Preserve separate inactive-user coverage. Negative cases must fail for the reason named by the test. This also explains the unused queued result in the shuffle failure.

### 4. Positive access controls allow arbitrary downstream failures

Three “still admits a student” cases in `tests/collaborator-negative-routes.test.ts:150` assert only `status !== 403`. They knowingly reach incomplete DB mocks and return 500. They establish the absence of one denial code, not successful access, and can stay green on unrelated failures.

**Repair:** Supply minimal valid read fixtures and assert the expected success status and role-appropriate body, or explicitly observe the intended downstream boundary if authorization alone is the contract. Keep collaborator denial and resource-existence privacy cases.

`checkout-escalation-service.test.ts` also logs incomplete `notificationDelivery.createMany` mock failures while tests pass. Distinguish intended delivery failure cases from accidental harness errors. Add expected-log assertions locally; migrate toward rejecting unexpected errors instead of globally silencing the console.

## P1/P2: add coverage where breakage would matter

These percentages are from executed coverage, not filename matching. Active callers were checked. Zero coverage does not itself prove a bug; it identifies missing executable evidence.

| Priority / owner | Line coverage | Needed proof |
| --- | ---: | --- |
| P1 `services/kiosk-item-transfer.ts` | 0% / 86 instrumented lines | Serialized and numbered-bulk custody movement, stale source, operator permission, incompatible destination, duplicate selections/history, no shelf-stock change, source closure, paired audit, receipt replay and atomic rollback |
| P1 `services/bulk-schedule-assignment.ts` | 10.42% / 825 lines | Execute preview/apply/finalize; stale/versioned input, authorization, conflicts, published/private boundaries, batch cancellation and idempotency |
| P1 `services/bulk-assignment-batches.ts` | 0% / 174 lines | Real list/cancel owner behavior, partial state and concurrent cancellation |
| P1 `services/scans.ts` | 0% / 133 lines | Admin-only override, missing booking, bypassed serialized/bulk/unit evidence, transaction and audit outcomes |
| P2 `services/dashboard-counts.ts` | 0% / 49 lines | Execute its aggregate SQL against disposable Postgres with personal/shared/open/overdue/pending/window/zero cases, plus result mapping |
| P2 `services/claim-review-notifications.ts` | 0% / 148 lines | Reviewer/recipient selection, delivery preferences, resolved/reclaimed state and duplicate delivery control |
| P2 `services/sport-setup.ts`, `sport-roster-preview.ts` | 0% / 129 and 63 lines | Required roles, roster matching, empty/ambiguous configurations and preview semantics |
| P2 `services/shift-trade-emails.ts` | 0% / 39 lines | Correct recipients, meaningful content, transport failure and preferences at their actual owners |

Other custody adapters are thinly exercised: `booking-custody` 15.62%, `kiosk-location` 2%, `kiosk-scan` 6.89%, `kiosk-pickup-substitute` 14.81%, and `kiosk-pickup-add` 26.79%. Map shared lower-level coverage before adding tests; cover the adapter's unique permission, state, payload, or sequencing contract rather than replaying the entire engine.

The kiosk transfer route calls the unexecuted transfer owner directly. Its service deliberately pairs stock-ledger movements without changing shelf stock; this is exactly the kind of invariant that source-string checks cannot establish. Keep mocked owner cases fast, and add a small real-Postgres slice for atomicity, constraints, concurrent custody, and receipt replay.

An additional source finding deserves investigation: `createAdminOverride` writes an `admin_override` audit, and its route writes another after awaiting it. The duplicate call path is visible in source; persisted duplicate rows were not reproduced. Establish the intended one-action audit contract with an owner test before changing either writer.

## P2: reduce overhead while retaining independent contracts

### Source-check consolidation has a measured opportunity

269 files contain source checks with no detected runtime owner imports or Vitest mocks/timer/global stubs. Running all 1,296 cases separately took 13.36s with two workers; importing the same files into one temporary suite took 1.84s, about 86% less elapsed time for that subset. Preparation fell from 7.68s aggregate to 32ms. Assertions were retained, and isolation remained enabled.

This proves an overhead opportunity, not the production design. Consolidate into several domain-owned files or explicit source-contract suites—Schedule, booking/custody, native navigation/API, and tooling are plausible boundaries. Avoid one unmaintainable mega-file. Preserve every case initially, compare collected names/counts, and benchmark with Node 22 and the same CI worker count. Only then prune independently reviewed duplication. Do not combine stateful service suites or disable isolation to obtain a headline speedup.

The literal-source scan found 8,048 assertions and 265 duplicate groups containing 301 repeat occurrences beyond the first. Targets and exact literal matchers were included in the comparison. Context can still differ; these numbers are **not approved deletions**. Examples suitable for owner-by-owner consolidation:

- `requirePermission(...publish_now)` / `requireWorkingCopy: true` recur in Schedule assignment, mutation-guard, and source-truth files.
- Queue URL preservation recurs in list-state, queue-contract, and source-truth files.
- Browse navigation to Guides/Licenses appears in several native source files, sometimes repeatedly in one file.

Retain a canonical test for each independent permission, publication, navigation, or API contract. Organize by current owner instead of the historical feature or polish session that created the test.

### CI critical path is bigger than test execution alone

[Successful run 36151403760](https://github.com/erikrole/wisconsin-creative/actions/runs/36151403760) at the audited HEAD took 433s for validate: dependency install 33s, tests 126s, build 250s. Another sampled main run took 424s, with tests 123s and build 246s. These are historical run observations, not controlled hardware benchmarks.

The CI Vitest run reported only 16.30s aggregate case execution, alongside 123.96s collection and 76.29s preparation. Those overlapping worker totals are not additive wall time. They nevertheless support reducing setup/import/isolation overhead before micro-optimizing assertions.

Recommended sequence:

1. Fix red/flaky/false-positive tests before measuring a green baseline.
2. Consolidate a bounded source-check owner and measure on Node 22.
3. Consider running the app build and tests as parallel required jobs. Ideal overlap could remove roughly the two-minute test step from the current serial critical path, but duplicate setup/runner cost must be measured.
4. Add bounded timeouts and cancellation of superseded PR validation. Preserve current main/release semantics.
5. Keep the real Postgres integrity job. Its useful SQL work took about two seconds; most of the 72–74s job was installation/container overhead. Removing those integrity assertions barely helps speed and loses strong proof.

`build:app` already performs lint and TypeScript checking in GitHub CI; do not add redundant jobs claiming those gates are absent. Vercel-specific skip settings do not describe the sampled GitHub run. Avoid using deploy-shaped `npm run build` casually because it can deploy migrations.

Coverage floors are configured but ordinary CI runs `npm test`, not `test:coverage`. Enforce the coverage lane at an intentional cadence or on changes to critical owners; avoid running the same full suite twice on every PR without a reason. Global percentages should not substitute for named risk contracts.

### Related-test selection currently misses filesystem dependencies

`vitest related src/components/DebouncedSearchInput.tsx --run` selected zero tests, despite 13 source checks in `search-input-focus-stability.test.ts`. Reading a source file with `readFileSync` does not establish an import-graph dependency for related-test selection.

Do not adopt related/changed-only CI as the sole gate. A fast source lane can run in full, or use an explicit source-to-contract manifest with a full-run fallback for unknown/shared paths. Validate the selection mechanism against representative web, Swift, schema, migration, and script changes before trusting it.

## Cleanup: approved candidate scope versus rewrites

These are recommendations, not applied deletions. Refresh reference searches at implementation time because the checkout is shared.

| Candidate | What it currently protects / remaining proof | Why it exists; cleanup unlocked | Risk and focused proof |
| --- | --- | --- | --- |
| `tests/_helpers/mock-db.ts` | No caller imports its three helpers; no behavior test depends on it | Introduced with testing infrastructure (`7856080a`); unused generic mock abstraction; remove 48-line helper and stale guide mention | Low after fresh repository-wide reference sweep; full TypeScript and test collection |
| `expectNoIsolation` in `_helpers/assert-transaction.ts:23` | Only declaration and guide examples remain; retain used `expectSerializableIsolation` | Legacy/default-isolation demonstration from `7856080a`; remove unused export and obsolete example | Low; affected helper consumers, TypeScript, docs references |
| `resetFactoryCounter` in `_helpers/factories.ts:148` | No callers; retain factories and their counter | Unused reset seam in long-lived test infrastructure; remove function only | Low after fresh caller search; factory consumers and TypeScript |
| GearOps `testDashboardEnvelopeDecodesOperationalLanes`, `GearOpsModelTests.swift:219` | Tests old dashboard decoder with no production caller; real client uses Companion projection; retained decode and URLSession tests at 237/274/319 | Old types from `d7a9a6261`; remove test plus `DashboardStatsPayload` and `DashboardStatsEnvelope`, 49 production lines in Models.swift | Low, but requires GearOps build/test and macOS/companion source checks; do not delete Models.swift |
| GearOps refresh-failure tests at 7 and 141 | Same whole-projection failure; first owns health/message, second owns count preservation and repeats one assertion | Same original change; move count assertion into first, remove second scenario; no production removal | Retain separate invalid-projection case; GearOps XCTest and source checks |
| `macos-gearops-source.test.ts:286,294` | Asserts exact prose in comments, not code behavior; retained D-047 route exclusions, native missing-credential tests, and transport/refresh guards are stronger | Comment-wording coupling; remove two assertions only | Low; focused macOS source tests; native gates if Swift also changes |

The obsolete decoder and duplicate native scenario have complete owner/caller/history evidence in the linked native review. Other declaration-only macOS types are leads for a separately scoped source cleanup; they are not counted as confirmed test-driven removals.

Rewrite candidates requiring replacement proof before deletion:

- **Equipment picker split:** `equipment-picker-render-split-source.test.ts` pins import syntax, callback spelling, export names, and absence of hook names. Exercise selected-item removal and bulk quantity updates at the rendered consumer; existing lower-level quantity helpers do not prove wiring. Preserve independent architectural constraints only when an accepted decision requires them.
- **Dashboard motion:** exact durations, transforms, keys, and `forwardRef` text couple tests to implementation. Retain reduced-motion and transition/state behavior; a rename or a harmless duration adjustment should not need broad test repair. Current dashboard files are dirty user work.
- **Search focus:** source checks for `setText`, cancellation order, and query options cannot prove focus retention while typing. A small rendered regression should exercise debounce, pending cancellation, stale responses, and focus. Keep credible source guards until replacement proof exists.
- **Schedule polish and source-truth smoke:** exact component names, CSS, timeout constants, or a browser test title prove structure only. Move current behavior to its owner; browser test existence does not prove it runs. Keep real permission, publication, queue-state, and cross-client contracts.
- **Cache-reset exports:** image search and Companion Redis expose test-only reset helpers. They are candidates for fresh-module/test-harness isolation, not immediate deletions: cache TTL and fail-closed behavior must remain tested. Do not add new production injection layers merely to hide the seam.

## Native and browser execution need deliberate selection

**Native:** Checked-in CI does not execute Xcode tests. Shared schemes and local verification scripts are present; source-contract checks cannot establish compilation, runtime decoding, bundled resources, or async behavior. Activate affected-client verification on a suitable macOS runner or require recorded local results. Keep the required Wisconsin iPhone 18 Pro Max and kiosk iPad Air 11-inch (M4) / iOS 26.5 destinations; report unavailable destinations rather than silently substituting hardware.

The Wisconsin Performance scheme selects all 41 UI methods, including 38 screenshot/UI methods alongside three measurement methods. Separate metric runs, deterministic UI regression, and authenticated/manual captures. Live Reports capture can wait on a missing signed-in session. Four baseline-only capture methods are useful review utilities, not independent current-code regression tests; retain them as explicitly selected captures. Two belong to active dirty work and should not be deleted.

Unbounded `Task.yield()` loops in GearOps and iOS ownership tests can hang if the expected request never arrives. Keep these important security/ownership cases, but use bounded arrival signals and failure cleanup. An arbitrary larger sleep is not a solution. Before increasing native concurrency, resolve process-global timezone mutations; this audit did not reproduce a current timezone race.

**Browser:** Playwright is configured but not invoked by the normal app CI. Chromium desktop and narrow viewport projects do not prove native iOS or Safari compatibility. The existing isolated-target credential/role safety guards are worth retaining.

- Define explicit staff/student/collaborator fixtures and verify the role actually signed in. Execute the relevant critical flow on an isolated seeded target when its owner changes.
- Keep mocked browser scenarios for deterministic interaction; label them separately from real backend/database end-to-end proof.
- `booking-item-holder.spec.ts` writes screenshots to a fixed historical proof folder. Move run artifacts to per-run output locations; retain manual baseline capture explicitly instead of overwriting historical evidence.
- `launch-smoke.spec.ts` broadly ignores 404 console noise. Narrow suppression to known requests so missing application resources remain visible.
- Schedule's credential/skip behavior differs from the other specs; align declared prerequisites and fail/skip messages. A skipped role path is not accepted runtime coverage.
- Conditional screenshot interactions that skip absent controls should not be promoted to regression assertions without a deterministic fixture and explicit presence checks.

Native capture selection and browser execution increase useful confidence while keeping routine gates focused. No claim of saved native/browser runtime is made because those suites were not timed here.

## What to retain

Keep permission/default-deny tests, transaction isolation assertions, booking/allocation/custody lifecycle, publication/private working-copy boundaries, audit snapshots, notification preferences/idempotency, date/timezone edges, API envelopes, migrations and real-Postgres constraints, Companion authorization, native async ownership, and bundle/resource checks.

Keep complementary layers when they protect different failures. A Swift helper unit test cannot prove its view callers use it; a Codable fixture cannot prove the server still selects the required fields; a source assertion cannot prove SQL or UI behavior. Strong tests using mocks still execute the real owner—for example, GearOps' URLProtocol test rejects the wrong route/method/token from the real client. That is useful contract proof, not a mock restating its own answer.

The dedicated Skills workflow already installs Python dependencies and runs metadata/link checks plus both tooling suites on relevant changes, with a five-minute timeout. Preserve it. Local `verify:skills` was blocked by missing PyYAML, not by a demonstrated repository defect; 11 dependency-free review-tool cases passed separately.

## Safe implementation order and completion criteria

| Slice | Scope | Required acceptance before proceeding |
| --- | --- | --- |
| 1. Trustworthy baseline | Clock fixture, four order-dependent owners, passkey negative control, weak access positives | Correct boundary fails under a targeted regression; isolated cases and fixed-seed shuffle pass; normal full suite green apart from explicitly gated replay |
| 2. Low-risk cleanup | Unused helpers, two comment assertions, native obsolete decoder and duplicate refresh case | Fresh caller searches; retained owner proof; applicable TypeScript/lint/build and native gates; no new skips |
| 3. Source overhead pilot | One domain's source contracts, initially retaining all assertions | Same collected contracts; shuffled/focused pass; measured Node 22 CI improvement; independent file isolation preserved |
| 4. Critical executable gaps | Custody transfer and bulk scheduling first, then override/SQL/delivery | Owner behavior cases plus minimal real-Postgres concurrency/rollback proof; no live DB use |
| 5. Gate selection | Parallel CI where justified, coverage cadence, native/UI/capture separation, filesystem dependency mapping | Demonstrate each representative changed owner selects the right gate; record cost/runtime; retain full fallback |
| 6. Documentation | Refresh Testing Guide and ownership inventory | Current counts generated or explicitly dated; distinguish static, runtime, executed, and skipped proof |

For each edit, capture its baseline, make one coherent owner change, and verify before broad consolidation. Do not improve the passing percentage by dropping retained failing tests, weakening assertions, increasing retries, or excluding high-risk files. Report test versus production changes separately. No implementation, staging, commit, push, or PR was performed for this audit.

Actual verification: full Vitest and coverage ran with one baseline failure; shuffle exposed six additional failures; focused probes confirmed the listed causes; source aggregation retained all 1,296 selected cases; TypeScript passed; test-directory lint had zero errors and one unused-variable warning; Python review tests passed. Native/Xcode, browser, local Postgres, deploy-shaped builds, real-device behavior, and exhaustive per-line semantic review remain unperformed. The audit is an evidence-backed repair plan, not a no-breakage guarantee.

Report verification: `npm run verify:docs` passed with current codemaps; repository `git diff --check` passed; local report links resolved. Audit changes are documentation and evidence only: production LOC changed 0; test implementation LOC changed 0. The latest weekly meter while completing the report was 2% used, with the same reset timestamp as at resume.

## Reliability follow-up — 2026-09-27

Authorized scope: implementation step 1 only. Updated five test files; no production code, global setup, test isolation, skips, or retry configuration changed. Unrelated working-tree edits were preserved. No commit, push, or deployment was performed.

- `schedule-working-copy-backfill-route.test.ts`: fixed Date-only clock with cleanup; retained the future/past cases and added equality at the event-end boundary. The future event is one millisecond ahead, so the test cannot silently age into the ended path.
- `schedule-publication.test.ts`: reset mock implementations/queues and establish successful draft deletion explicitly. Resetting also exposed three cases borrowing another case's `shiftGroup.update` result; each now supplies its own published-row fixture.
- `pending-claim-review.test.ts`: reset leaked approval failures and restore explicit successful defaults.
- `passkey-auth.test.ts`: reset queued results; give the consumed-ceremony case an active user; require an actual ceremony-consumption attempt and no counter update, session, or success audit afterward.
- `collaborator-negative-routes.test.ts`: independent allowed-action setup; student positive controls now have valid read fixtures and require HTTP 200 plus their response shape. Real permission gates remain in use.

Verification is recorded in [reliability-repair.json](archive/proofs/test-audit-2026-09-27/reliability-repair.json):

| Gate | Result |
| --- | --- |
| All affected cases selected individually | 84 / 84 pass, each in a fresh invocation |
| Focused shuffle, seed `260926` | 84 / 84 pass |
| Full suite | 4,970 pass, 0 fail, 1 existing isolated-replay skip, across 702 files |
| Full shuffle, seed `260926`, four workers | Same passing totals |
| Temporary event-end `<=` to `<` mutation | Equality case fails at the unexpected release timer |
| Temporary removal of consumed-ceremony rejection | Replay case fails on HTTP 200 instead of 401 |
| Temporary calendar read failure | Student positive control fails on HTTP 500 instead of 200 |
| TypeScript | Pass, non-incremental |
| Lint on five changed tests | Pass |
| `npm run build:app` | Pass; existing unused `state` warning at `src/components/Sidebar.tsx:200` |

Mutation probes changed only Vite-transformed source in temporary audit configuration; no production file was edited. The first calendar probe selected no cases because the table formatter quotes labels; a corrected selector ran the intended case and observed the asserted failure. Only that verified result is counted above.

Local validation used Node 24.21.0; Node 22 CI was not run. The build used placeholder database URLs and disabled source-map upload. No native, browser, schema, or runtime product behavior changed, so native/device/UI proof was not rerun. Raw repair logs remain in `/tmp/wc-test-reliability-2026-09-27/`; the compact results above are durable.

Next bounded slice: the source-contract consolidation pilot, initially preserving all assertions and benchmarking on Node 22. The audit's cleanup candidates and unexecuted service gaps are still open.

## Performance and dependency follow-up — 2026-09-27

Authorized scope: implement the consolidation pilot, include app runtime performance, and review/update worthwhile dependencies. This is a bounded follow-up to the audit, not an exhaustive runtime profile. No staging, commit, push, migration, or deployment occurred. Unrelated dashboard/iOS/Schedule work remains intact.

### Source-contract pilot

Consolidated `schedule-assign-source`, `schedule-working-copy-route-source`, and `schedule-working-copy-mutation-guard` into `tests/schedule-authoring-source.test.ts`. All 23 cases and every non-import source body were retained byte-for-byte. Only repeated imports were removed; no assertion, mock isolation, retry, or skip changed. Updated the current working-schedule plan reference. Historical inventory/proof filenames retain their original meaning.

On Node 22.23.3/Vitest 3.2.6 with two workers, eight alternating runs (two warmups, three measured per layout) reduced median group wall time from **383.46 ms to 293.36 ms (23.5%)**. Sorted case-name hashes matched in every run. This is about 90 ms saved for this small group, not evidence of a 23% full-suite or CI improvement. [Raw measurements](archive/proofs/test-audit-2026-09-27/pilot-benchmark.json).

### Item Insights runtime

The private utilization helper in `src/app/api/assets/[id]/insights/route.ts` previously inserted every sampled booking day into a Set for each reporting window. It now converts clipped intervals into inclusive day-bucket ranges, sorts them, and counts their union. Work depends on booking count rather than the sum of booking durations. The API, database reads, permission gate, cache header, and existing partial-day sampling stay unchanged; no test-only export was introduced.

Nine route cases own utilization behavior: empty, overlapping, adjacent, duplicated, partial-day, clipped, zero-length, out-of-window, and unsorted/nested intervals. These passed against both the original and optimized owner. An independent temporary comparison also matched **10,003 interval results and 4,000 complete window-stat objects** against the original source, including randomized inputs, invalid dates, and pre-epoch dates.

Six alternating measurement pairs, after warmup, timed computation of all four windows:

| Synthetic history | Before | After | CPU reduction |
| --- | --- | --- | --- |
| 20 bookings, seven-day duration | 0.111 ms | 0.097 ms | 12.4% |
| 1,000 bookings, 180-day duration | 27.898 ms | 4.552 ms | 83.7% |
| 1,000 bookings, five-year overlap stress | 125.475 ms | 4.577 ms | 96.4% |

These are synthetic CPU measurements, excluding authentication, database access, HTTP, and rendering. They demonstrate removal of duration-dependent work; they do not establish current production traffic or end-user latency. [Measurements](archive/proofs/test-audit-2026-09-27/insights-benchmark.json), [reproducible comparison/benchmark](archive/proofs/test-audit-2026-09-27/insights-benchmark.cjs), and [original owner](archive/proofs/test-audit-2026-09-27/asset-insights-before.txt). Run the script from repository root with Node 22; it writes its results alongside the script.

### Dependencies

- Updated Vitest and matching coverage from **3.2.6 to 3.2.7**; the minimum manifest version is now 3.2.7. The [official release](https://github.com/vitest-dev/vitest/releases/tag/v3.2.7) backports browser command filesystem-access checks. Compatible transitive updates included Vite 7.3.5 → 7.3.6, tinyspy 4.0.4 → 4.0.6, and expect-type 1.3.0 → 1.4.0.
- Updated transitive **qs 6.15.3 → 6.16.0**, satisfying the existing dependency ranges and removing its [denial-of-service advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g). No override was needed.
- The resulting audit reports **zero high/critical and three moderate affected packages**, down from four. The three remaining entries share the [Vitest redirect-mock path traversal advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9); 3.2.7 does not fix it. The published patched range starts at 4.1.11; npm's suggested fix is 5.0.2. This needs a separately verified major migration, not `npm audit fix --force`.
- **Next.js:** retained 15.5.25 for this batch. The [15.5.26 hardening patch](https://nextjs.org/blog/nextjs-security-update-september-22-2026) is only five days old, below this repository's seven-day release-age setting. Next 15 is not affected by the critical RCE discussed in that notice. Another [security release is planned for September 30](https://nextjs.org/blog/upcoming-nextjs-security-release-september-2026), including 15.5.27; verify its final advisories and patch when available. No unpublished version was installed and no release-age bypass was added.
- **Major migrations:** Next 16, Prisma 7, TypeScript 7, Vitest 4/5, and ESLint 10 remain separate changes. Existing custom webpack wrappers, Prisma/Neon adapter contracts, lint/build gates, and mock/pool semantics need their own compatibility proof. There is no measured performance basis here for updating every available package.

The first install attempt used Node 22's bundled npm 10 and failed resolving the existing `$postcss` override. Retrying with npm 11 succeeded; the lock diff contains only the reviewed package families. The persistent Node/package-manager configuration and seven-day release-age policy were not changed. [Exact dependency changes](archive/proofs/test-audit-2026-09-27/dependency-changes.json), [before audit](archive/proofs/test-audit-2026-09-27/audit-before.json), [after audit](archive/proofs/test-audit-2026-09-27/audit-after.json), and [dated available-version inventory](archive/proofs/test-audit-2026-09-27/outdated.json).

### Verification and remaining boundaries

[Durable verification summary](archive/proofs/test-audit-2026-09-27/performance-verification.json): Node 22.23.3, focused 56/56 pass; full shuffled suite with coverage 4,979 pass, zero failures, one existing gated skip across 701 files; non-incremental TypeScript, changed-file lint, and `build:app` pass. Coverage remains above every existing floor: 75.62% statements/lines, 77.29% branches, 82.33% functions. Build retained the pre-existing unused `state` warning in `Sidebar.tsx:200`. Database URLs were process-local placeholders; build did not run migrations or upload source maps.

This batch changes production **+17/-10 LOC**, tests **+371/-317 LOC** (mostly the preserved three-file move; nine new route cases, four duplicate import/blank lines removed). Docs and dependency metadata are additional. Current testing docs and generated codemaps were refreshed. No schema/native/UI presentation changed. Authenticated browser and live latency proof remain unperformed because this run used no isolated seeded database; unit mocks do not establish live database or rendered behavior.

Recommended next slices, in order: review the September 30 Next security patch when published; migrate Vitest to a patched major with the full shuffle/coverage gates; add executable custody/bulk-scheduling coverage from the audit; then expand source-suite consolidation by coherent owner. CI job parallelization and broad app-runtime profiling remain unimplemented recommendations. The latest weekly usage reading during closeout was 6%, with the same reset timestamp; the account meter cannot attribute exact tokens to this task.

## Vitest 4 migration — 2026-09-27

Prepared `vitest` and `@vitest/coverage-v8` **4.1.11**, the first patched 4.x release for the redirect-mock advisory. Its August 18 release satisfies the seven-day release-age policy. Vite is now an explicit dev dependency on the existing **7.3.6** line: npm initially selected Vite 8, whose JSX transform failed to collect five suites; keeping Vite 7 restored all 31 affected cases without test or application edits. [Official release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11), [migration source](https://github.com/vitest-dev/vitest/blob/v4.1.11/docs/guide/migration.md).

The user accepted the measured baseline after reviewing the identical test/file scope and old remapper's overstatement. Branch/function thresholds are recalibrated to 61.48% and 72.50%; statements/lines retain their 70% floors. The original candidate failed the previous 75% branch/function thresholds; final verification is recorded below.

| Check | Result |
| --- | --- |
| Full normal and shuffled suite, four workers, shuffle seed `260926` | Each: 4,979 pass, one existing gated skip, zero failed tests across 701 files |
| Case identities and results against Vitest 3 baseline | Exact match |
| Instrumented source files against baseline | Same 98 files; none added or removed |
| Statements / lines | 71.07% / 74.08%; existing 70% gates pass |
| Branches / functions | 61.48% / 72.50%; accepted baseline replaces the old 75% gates |
| Normal versus shuffled coverage | Identical percentages and covered/total counts |
| TypeScript and `build:app` on Node 22.23.3 | Pass; existing `Sidebar.tsx:200` warning |
| Dependency audit | Zero reported vulnerabilities at every severity |

Vitest 4 replaces the old V8 remapper with AST-aware measurement. The difference is material: the same unexecuted `sport-setup.ts` had one supposedly covered branch/function in the old report (100%); the new report identifies 22 branches and 15 functions, all uncovered. The unexecuted `kiosk-item-transfer.ts` now exposes 76 branches and 18 functions instead of one of each. This is newly visible missing proof, not lost tests.

Accepted decision: use the accurate baseline with non-regression floors of 61.48% branches and 72.50% functions, retaining the existing 70% statements/lines floors. [Testing Guide](../docs/TESTING.md) documents the new policy and requires raising these floors as owner coverage improves. No tests, exclusions, retries, isolation, or skips were changed. Production and test implementation LOC changed in this migration: **0**; dependency metadata, coverage configuration, and audit/docs evidence changed. No commit or deployment.

Evidence: [coverage comparison](archive/proofs/test-audit-2026-09-27/vitest4-coverage-comparison.json), [newly measured gaps](archive/proofs/test-audit-2026-09-27/vitest4-uncovered.tsv), [dependency changes](archive/proofs/test-audit-2026-09-27/vitest4-dependency-changes.json), and [clean dependency audit](archive/proofs/test-audit-2026-09-27/vitest4-audit.json). Raw run logs and reversible package snapshots are in `/tmp/wc-vitest-upgrade-2026-09-27/`.

Final acceptance: the full shuffled coverage command exits **0** under the accepted thresholds: 4,979 pass, one existing gated skip, zero failures across 701 files. Coverage matches the measured baseline exactly. Non-incremental TypeScript, coverage-config lint, docs verification, and `git diff --check` pass. The previously passing app build and zero-vulnerability audit use these same dependency versions; neither app/build source nor dependency versions changed during acceptance. [Final verification](archive/proofs/test-audit-2026-09-27/vitest4-verification.json).

Coverage configuration changed +4/-2 LOC; no production or test implementation changed. This migration closes the remaining reported Vitest advisory while retaining all tests, source inclusion, isolation, and skips. Meaningful new behavior coverage remains future work; custody transfer and bulk scheduling are the next bounded owners. Nothing was staged, committed, pushed, or deployed.

## Custody and bulk-scheduling owner tests — 2026-09-27

Added 25 executable cases in two canonical service suites, totaling **204 test LOC; zero production LOC**. Database and external-service boundaries are mocked; the transfer service, permission gate, bulk preview/apply validation, and release finalization execute their real code. No production seam, skip, retry, or exclusion was added, and existing source contracts remain intact.

- `tests/kiosk-item-transfer.test.ts` (12 cases): existing serialized item/allocation ownership moves without rewriting allocation dates; legacy holder overrides clear; only an empty source closes; both linked audit records preserve the original evidence ID. Numbered units move their quantity obligation through equal outbound/inbound ledger entries without shelf restock or unit-status updates. Stale snapshots, in-progress returns, accountability exclusions, returned items, wrong allocation owners, incompatible due times, destination history collisions, unauthorized operators, and duplicate selection reject before moving custody.
- `tests/bulk-schedule-assignment.test.ts` (13 cases): held sports and pending working copies never reach candidate scoring; stale fingerprints and forged proposals reject before timers or transactions. The stale test first obtains an actual eligible proposal, so an unrelated invalid-proposal rejection cannot conceal a missing fingerprint guard. Finalization classifies complete/partial/blocked releases, defers unfinished or already-notified batches, leaves notification failures retryable, and records outcomes only against the pending item at the requested version.

Three temporary Vite-transform mutations were killed by the intended cases: unconditional source closure, removed preview fingerprint guard, and removed pending-release notification guard. Production files were never mutated. [Mutation evidence](archive/proofs/test-audit-2026-09-27/owner-test-mutations.json).

The full shuffled suite grew to 5,004 passing cases with one existing gated skip across 703 files. Critical-server coverage rose from 71.07% / 61.48% / 72.50% / 74.08% to **73.14% statements / 63.17% branches / 75.69% functions / 75.97% lines**. Branch/function floors were raised to 63.17% / 75.69% to preserve the added protection; the same 98 source files remain included. TypeScript, focused lint, and `build:app` passed on Node 22.23.3; the build retains the existing `Sidebar.tsx:200` warning. [Final verification](archive/proofs/test-audit-2026-09-27/owner-test-verification.json).

Remaining boundaries: mocked transactions do not prove real PostgreSQL atomic rollback, concurrent transfer protection, or receipt replay. New-recipient checkout creation, numbered-unit destination-history collisions, full valid bulk apply/staging, live apply conflicts, full-crew/travel selection, cancellation races, and concurrent notification idempotency still need independent behavior proof. D-061's fuller destination-reuse requirements (event set, purpose, source reservation) also need reconciliation with the kiosk service's current location/due-time checks before that surface is claimed fully aligned. No application behavior changed in this slice, and no native/browser/database deployment proof is claimed.

## Kiosk destination compatibility repair — 2026-09-27

The kiosk transfer owner accepted an existing checkout based on location and due time, bypassing D-061's personal-custody/context requirements and recipient eligibility. `booking-item-holder.ts` already enforces the fuller context for the web holder-transfer path. The kiosk owner now requires an open personal checkout that has started, matching purpose/title, primary event, sport, linked-event set, source reservation, location, and due time. Linked-event order is immaterial. Both existing and new destinations resolve their recipient through the canonical active, visible kiosk-roster policy inside the serializable transaction. An explicitly selected incompatible destination returns 409; choosing a recipient can still create a personal checkout preserving the source context.

Added 15 cases to the existing service suite (27 total), without a new suite or production test seam. On the pre-fix owner, 11 incompatible/ineligible transfers incorrectly succeeded; the recipient-query assertion also failed. All 27 cases pass after repair. Positive controls cover reordered event links, unlinked custom-purpose checkouts, and new personal custody from a shared source with original event/reservation/pickup context. Existing serialized and numbered-unit movement/audit protections remain.

Verification passed: all **5,019 cases** plus one existing gated skip across 703 files in the full shuffled coverage run (seed `260927`, four workers), non-incremental TypeScript, focused/config lint, and `build:app` with placeholder database URLs. Coverage is **73.18% statements / 63.28% branches / 75.74% functions / 76.00% lines**. Branch/function floors were raised to the measured values and the full coverage command passed again. The build retains the pre-existing `Sidebar.tsx:200` unused-variable warning. Codemaps were refreshed after the source edit; docs verification, local link sweep, and `git diff --check` pass. [Verification evidence](archive/proofs/test-audit-2026-09-27/custody-contract-verification.json).

This slice changes production code by **+16/-6 LOC** and expands the existing test file from 108 to 166 lines (+60/-2); its 15 new cases protect the missing destination rules and previously untested new-recipient creation path. The account-wide weekly meter moved from 10% to 12% during implementation and verification, below the approved 13% stopping point, with the reset timestamp unchanged.

Runtime boundary: the only checked-in production caller of `transferKioskItems` is the kiosk transfer route; no kiosk Swift transfer caller was found. No authenticated UI, managed-iPad, deployed API, or real PostgreSQL transaction execution is claimed. Real-database rollback/concurrency/replay and the remaining bulk-scheduling cases are separate follow-ups. No staging, commit, push, or deployment.

## Disposable PostgreSQL transaction proof — 2026-09-27

Added a local runner, dedicated Vitest configuration, and two database cases. Both pass on PostgreSQL 17.11 with Prisma's native PostgreSQL transport, executing the real transfer service, receipt helpers, and audit writer. Only the database module is redirected to the disposable database; no query or transaction is mocked.

- A PostgreSQL trigger rejects the final transfer audit after custody and both parents have been updated. The full booking/item/allocation/audit snapshot equals the pre-transfer snapshot afterward, and the claimed receipt is absent: the database rolled the whole transaction back.
- A successful transfer moves the item and allocation together, closes the emptied source, persists exactly the two transfer audits plus its receipt, and returns the stored result on receipt read-back. A repeat service call is rejected without changing the committed snapshot.

`node scripts/test-custody-postgres.mjs` owns an isolated Unix-socket cluster with TCP disabled, explicitly replaces database URLs, uses a fresh generated schema, and stops/removes only that cluster. No migration receipts are fabricated. The two cases are intentionally outside the default test glob and have a dedicated documented command; they do not add default-suite skips or CI database work. Native transport/generated schema proof does not establish Neon transport or migration-only constraints. Concurrent transfers, complete HTTP replay/rejection behavior, managed-device proof, and deployment remain open.

Both database cases, non-incremental TypeScript, focused lint, `build:app`, docs verification, local links, and `git diff --check` pass. The default suite remains **5,019 passing / one existing skip across 703 files**; the two Postgres cases ran separately in 330ms of test execution (810ms Vitest duration, excluding cluster setup). The build retains its existing Sidebar unused-variable warning. [Verification evidence](archive/proofs/test-audit-2026-09-27/custody-postgres-verification.json).

Production implementation changes in this slice: zero. New test/infrastructure code: 123 lines (79 test, 30 runner, 14 configuration). The resumed slice started at a fresh account-wide 19% reading and ended at 20%, below the 21% stopping point, with the same weekly reset timestamp. Concurrent transfer contention is the next database gap; no staging, commit, push, or deployment.

## Forced contention, HTTP recovery, and CI wiring — 2026-09-27

Expanded the PostgreSQL suite from two to eight cases, using a database advisory-lock barrier and observed `pg_stat_activity` waits to force real overlap. Both competing transactions pass their reads and reach the item write before the barrier is released. Exactly one succeeds; the loser returns a friendly conflict after serialization retry, leaves its destination untouched, and leaves no receipt. Item/allocation ownership, source closure, linked audits, and the winning receipt agree. This is observed contention, not merely two promises launched close together.

Two temporary Vite-transform mutation controls fail at the intended assertions: `ReadCommitted` permits two successful transfers, and removing serialization retry exposes a raw Prisma error instead of a 409. Production source was never temporarily weakened.

Route-level database cases keep the actual `withKiosk` wrapper, JSON validation, transfer owner, audit writes, and receipt handling. Device authentication and post-response live-activity delivery are mocked boundaries. Concurrent identical HTTP requests block on the receipt uniqueness constraint and return the same committed result, with one live-activity scheduling callback. Definitive rejection is persisted and replayed without moving custody. Changed, expired, and unreadable saved handoffs initially failed with generic 409/400 responses; the route now uses the existing `readKioskOperationReplay` and `unreadableKioskOperation` helpers, matching other kiosk routes' clearable `operationRejected` response. An existing successful receipt remains intact after changed-details rejection. The route repair is **+11/-4 production LOC**; the database test file grew from 79 to 241 lines.

Added `npm run test:postgres:custody` to the existing PostgreSQL CI job without an additional job or dependency-install step. The runner now uses the canonical `/tmp` path on macOS/Linux and still disables TCP and overwrites every database URL it consumes. The [GitHub Ubuntu image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#postgresql) confirms PostgreSQL tools are supplied by the hosted image; `pg_config --bindir` locates them. Workflow YAML parses locally; the hosted job has not run for these uncommitted changes. Local proof uses PostgreSQL 17.11 and is separate from the hosted image's PostgreSQL version and the existing PostgreSQL 17 integrity service.

Final local verification: **eight PostgreSQL cases pass**, **5,019 default cases pass with one existing skip across 703 files** under shuffled coverage, non-incremental TypeScript and focused lint pass, and `build:app` passes with the existing Sidebar warning. Critical-server coverage remains 73.18% statements / 63.28% branches / 75.74% functions / 76.00% lines at the raised floors. The complete local PostgreSQL command took **3.60s**, including cluster setup, schema creation, tests, and cleanup (958ms in the test cases). Docs/codemap and local-link verification pass. [Final evidence and mutation results](archive/proofs/test-audit-2026-09-27/custody-contention-verification.json).

Remaining proof: hosted CI, real device authentication, actual notification delivery, Neon transport, migration-only constraints/triggers/sequences, and managed-iPad/deployed acceptance. No commit, push, or deployment. The next bounded coverage priority is a successful bulk-scheduling apply with atomic staging and notification idempotency; these custody results do not establish those separate contracts.
