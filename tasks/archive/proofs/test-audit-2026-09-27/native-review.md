# Native test review — 2026-09-26

Read-only review. No source/test changes or builds. Current dirty iOS work was inspected and preserved. Weekly reset remained `1791034365`; latest observed usage 3%, with no reset.

## Inventory and gate facts

- `ios/WisconsinTests`: 12 files, 3,268 lines; 83 XCTest methods and 93 Swift Testing declarations (syntactic counts, not run results).
- `ios/WisconsinKioskTests`: 1 file, 150 lines, 13 XCTest methods.
- `ios/WisconsinUITests`: 2 files, 1,262 lines, 41 XCTest methods: 3 metric tests and 38 screenshot/UI methods, including 4 baseline capture methods.
- `macos/GearOpsTests`: 5 files, 1,981 lines, 82 XCTest methods.
- Root source/contract files: 119 `ios-*` files / 11,673 lines; 2 `macos-gearops-*` files / 725 lines; 6 `companion-*` files / 1,028 lines. Companion files include actual service/route behavior tests, not just source greps.
- Shared schemes register WisconsinTests, WisconsinKioskTests, and GearOpsTests correctly. Wisconsin and kiosk unit test targets are present and non-skipped; their source folders are configured in XcodeGen. The Performance scheme selects the entire WisconsinUITests target.
- `.github/workflows/ci.yml:40-66` runs npm test and build:app on Ubuntu. Repository workflow search finds no xcodebuild/XCTest execution. Local `scripts/ios-xcode-verify.sh:135-165` does execute builds plus tests, but only when explicitly invoked. `tests/ios-xcode-test-gate.test.ts:5-19` reads shell source; it cannot prove XCTest ran or even that its exit failure propagates.

## Actionable findings

### N1 — Needed: an actual native execution gate

**Boundary:** `.github/workflows/ci.yml:40`, `scripts/ios-xcode-verify.sh:135`, `tests/ios-xcode-test-gate.test.ts:5`.

The checked-in default CI never compiles or runs the native suites, although the shared schemes do include them. A green web run therefore does not establish Swift correctness. Native model decoding, bundling, async ownership, notification behavior, and kiosk reducers all have tests that remain outside CI.

**Recommendation:** Add an affected-client native gate (appropriate macOS runner or clearly recorded local verification), selecting Wisconsin and kiosk only for their changed contracts and GearOps for macOS/companion contracts. Use the repository's required simulators; missing destinations remain an explicit blocker. Keep root Swift source contracts as a complementary cross-client gate. Do not describe source checks as a replacement for XCTest. This is coverage activation, not an argument to delete native tests.

**Speed:** Avoid running all screenshot capture cases for every native change; run fast native behavior first, then relevant UI or device proof.

### N2 — Safe consolidation: duplicate macOS refresh-failure scenarios

**Tests:** `macos/GearOpsTests/GearOpsModelTests.swift:7` `testFailedRefreshPreservesLastTrustedCounts` and `:141` `testCountPartialFailureDoesNotInstallFallbackZeroes`.

Both sign into the same MockGearOpsClient, start with checkedOut=12, set the same whole-projection network failure, and refresh. The second does not simulate a partial response and repeats its post-failure checkedOut assertion twice at lines 151-152. The first owns health/message but is missing a post-failure count assertion.

**Owner/callers:** `macos/GearOps/GearOpsModel.swift:457-520` refresh; real callers in `MenuBarContentView.swift:140,373`; production model created at `GearOpsApp.swift:80`. Both tests date to d7a9a6261; message updated in 20e0962ed.

**Action:** Add the single retained post-failure count assertion to the first test, remove the duplicate second scenario. Keep `testInvalidProjectionPreservesTrustedData` at :199: duplicate IDs are a different credible failure, and it verifies validation before installation. No production seam deletion follows from this consolidation.

**Risk/proof:** Low after preserving the count assertion. Run GearOps XCTest plus `tests/macos-gearops-*.test.ts` and companion contracts; do not claim a runtime saving before timing it.

### N3 — Obsolete native decoder test keeps two dead production types alive

**Test:** `macos/GearOpsTests/GearOpsModelTests.swift:219` `testDashboardEnvelopeDecodesOperationalLanes`.

This decodes a hand-written old dashboard JSON envelope into `DashboardStatsEnvelope`. Repository rg finds its declaration at `macos/GearOps/Models.swift:78` and this test as its only consumer. `DashboardStatsPayload` at :49 is consumed only by that dead envelope. Current `GearOpsClient.swift:95-100` decodes `CompanionProjectionEnvelope`, and its complete client contract contains no dashboard fetch. D-047 (`docs/DECISIONS.md:1051-1071`) explicitly excludes database-backed dashboard fallback reads.

**Action:** Remove this obsolete test and both unused types (`Models.swift:49-97`, 49 production lines) as one bounded follow-up. Do not delete Models.swift itself: it contains many active types.

**Stronger retained proof:** Projection wire decoding at GearOpsModelTests :237 and :274; real URLSession request/response test at :319; source test `tests/macos-gearops-source.test.ts:259-300` rejects database-backed fallback endpoints. Both deleted types originated in d7a9a6261.

**Other inventory-only candidates:** `OpenBookingsPage`, `OpenBookingsResult`, `BookingActivityPage`, `BookingActivityEnvelope`, `BookingChangesEnvelope`, `MeResponse`, `KioskDevicesResponse` also have only declarations in macOS/test searches. Treat as a separate, fully scoped source cleanup; do not inflate the confirmed test-cleanup count with them.

**Risk/proof:** Low for the two verified unused internal types; full GearOps build + tests required after edit, plus source contracts and diff review. No cache migration implicated: the active persisted model is GearOpsSnapshot, which stays.

### N4 — Make async regressions fail promptly instead of spinning forever

**Locations:** `macos/GearOpsTests/GearOpsModelTests.swift:1128-1132`, `:1143-1145`, `:1231-1235`, `:1248-1252`, `:1272-1276`, `:1369-1373`; bounded-but-scheduler-sensitive loop at :704-709.

Helpers repeatedly call Task.yield until a requested call/continuation appears, with no deadline. Example: testDelayedIdentityRestoreCannotUndoSignOut at :78 waits at :90 for `waitForUserRead`; a regression that stops reading credentials spins indefinitely instead of producing a useful failing assertion. Similar waits cover projection, revocation, authorization, and APNs registration. A separate 100-yield retry test assumes scheduling progress within an arbitrary iteration budget.

**Recommendation:** Retain these important account/session/notification regressions. Replace busy waiting with explicit arrival signals plus bounded XCTest fulfillment and clean up/resume pending continuations on failure. Give the native runner an outer timeout too. Do not solve with larger sleeps. Source checks and mock behavior cannot replace these true asynchronous owner tests.

**Related iOS case:** `ios/WisconsinTests/LatestRequestGenerationTests.swift:5-22` has unbounded continuation waits. Keep the auth serialization scenarios; use bounded arrival synchronization if this harness is edited.

### N5 — Separate performance measurement, deterministic UI regression, and manual capture selection

**Owner:** `ios/project.yml:242-251`; `WisconsinPerformance.xcscheme:53-64` includes all WisconsinUITests. `WisconsinPerformanceUITests.swift:9,23,40` are the three measurement tests. The other 38 methods are screenshot/UI workflows in ReportsScreenshotUITests.swift.

Running the Performance scheme currently runs all 41. `ReportsScreenshotUITests.swift:13-44` launches without a fixture and requires an already signed-in live session; missing Browse can cost 20 seconds, with further 10/25-second waits. This differs materially from the deterministic fixture measurement tests. No checked-in xctestplan/xcbaseline or explicit performance budget was found; metrics produce measurement evidence, but a checked-in budget gate is not established by this source review.

**Recommendation:** Configure scheme/test-plan selections so measurement runs only the 3 metric methods, regression runs appropriate deterministic UI methods, and authenticated/manual capture tasks stay explicitly callable. Preserve signed-in live proof as such. Consider a known-device baseline and tolerances for actual performance gating after establishing repeatability; do not impose speculative thresholds.

**Four baseline-only methods:** :301 HomeAgenda; :610 SearchFirstPage; :956 UpcomingNeedExtension; :1177 OverdueNudge. They run the same current scenario as stronger sibling methods (:286, :583, :934, :1164) but skip new behavior assertions to support historical before captures. They do not provide an independent current-code regression. Keep them available for matched gt-ui-review captures, but exclude them from default regression/performance runs.

**Preservation warning:** HomeAgenda and BookingNudge baseline methods are part of current dirty work (75 additions in this file). They are not obsolete-user-work deletion candidates. The recommendation is test selection and lifecycle, not deleting active review evidence.

### N6 — Remove comment wording assertions, retain D-047 behavior guards

**Statements:** `tests/macos-gearops-source.test.ts:286` requires the prose `repeated missing reads keep the last projection visible`; :294 requires `no timer or polling loop`. These match comments at `GearOpsModel.swift:273,629`, not executing behavior. Both remain green if code violates the comment and fail if the prose is edited.

**Action:** Remove these two incidental assertions from the retained test. Keep route exclusions, projection-only transport, credential restoration, user-triggered refresh checks, and native missing-credential tests (:509, :539) intact. D-047 is an independent platform contract and must stay enforced. This is not grounds to delete the source test file or all source inspection.

**Risk/proof:** No legitimate behavior coverage loss from removing prose checks. Focused `npx vitest run tests/macos-gearops-source.test.ts tests/macos-gearops-security-source.test.ts` verifies the retained source contract; native build/tests remain required if any Swift cleanup accompanies it.

## Important limitations and retention false positives

- Swift source assertions overlap runtime tests, but often verify distinct consumer wiring. `ios-async-request-ownership.test.ts` confirms actual SessionStore/API/view paths use ownership checks; `LatestRequestGenerationTests` alone cannot prove those callers use the helper. Preserve both boundaries, while making incidental variable-name pins less brittle only within specific reviewed batches.
- `GearOpsModelTests.swift:319` uses a URLProtocol that returns 405 unless the real client sent GET, correct route, and Bearer token. This is not a mock implementing the behavior under test: the actual client generates and decodes the request/response. Keep it.
- `WisconsinCreativeIconTests.swift:11` checks resources inside the built host bundle. A source reference to AppIcon is weaker and cannot replace this packaging regression.
- `KioskFlowRoutingTests` tests credential replacement, one scanner owner, burst ordering, and old responses. These custody/platform safety contracts deserve retention, even though source wiring tests also inspect the relevant components.
- Source-contract API field/optional checks are needed: a Swift decode fixture does not by itself tie server-selected fields to Codable requirements. Large `ios-api-contract.test.ts` is organizationally mixed (directory/UI/markdown polish within an API file), but moving or deleting it needs owner-by-owner evidence, not filename heuristics.
- Screenshot attachments are human-review artifacts, not pixel-diff assertions. Schedule capture branches at `ReportsScreenshotUITests.swift:81,93,104` skip the interaction when a control is absent; those branches can pass without Today/day/month control proof. If promoted to a regression gate, establish the fixture state then assert the affordance before interaction; keep capture-only behavior honest meanwhile.
- Before increasing Swift concurrency, resolve process-global timezone mutation in `ScheduleDateMathTests.swift:49-51,442-444` and `LicenseExpiryTests.swift:23-25`. These are separate .serialized suites; that trait only serializes descendants, not unrelated suites. Current shared scheme has parallelizable=NO, so this review does not claim a reproduced current race. Prefer explicit calendar inputs where already supported or one scoped serialization boundary for global mutations rather than slowing every test. Apple's documented semantics: https://developer.apple.com/documentation/testing/parallelization .

## Validation performed

Read source, scheme/XcodeGen, CI, test bodies, owners/callers, git blame, and dirty diffs. No XCTest, build, UI automation, performance timing, or source mutation was performed in this lane. All runtime recommendations remain to be measured by the root audit or a bounded implementation follow-up.
