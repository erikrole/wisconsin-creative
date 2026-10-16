# Native Reports Audit - 2026-08-10

## Scope

- Surface: `ios/Wisconsin/Views/ReportsView.swift`
- Models: `ios/Wisconsin/Models/Models.swift`
- API methods: `APIClient.utilizationReport(days:)` and `APIClient.checkoutActivityReport(days:)`
- Server contracts: `GET /api/reports/utilization` and `GET /api/reports/checkouts`
- Product contracts: `docs/AREA_REPORTS.md` and `docs/AREA_MOBILE.md`
- Roles: STAFF and ADMIN through the Browse capability gate

## User job

Answer floor-level questions quickly: how much gear is moving, whether checkout activity changed, what is overdue, which gear is most used, and what has stayed idle. Detailed exports and row-level analysis remain web-owned.

## Reachability and state inventory

| State | Current behavior | Audit result |
| --- | --- | --- |
| Browse entry | Reports is visible only to STAFF and ADMIN | Accepted |
| Initial load | Full-screen progress while neither endpoint has data | Accepted |
| Complete load | Summary, trend, status, most-used, and shelf sections render | Accepted |
| One endpoint fails | Successful endpoint remains visible with source-specific recovery copy | Fixed |
| Server returns partial data | Additive `partialFailures` renders an incomplete-data warning | Fixed |
| Period changes | New period becomes the only request allowed to publish | Fixed |
| Superseded request finishes late | Late results cannot overwrite the selected period or clear its loading state | Fixed |
| Refresh fails after data | Existing data remains visible with a warning | Accepted |
| Both endpoints fail | Error state offers Retry | Accepted |
| Empty chart sections | Sections without usable points stay absent rather than showing decorative emptiness | Accepted |
| Pull to refresh | Both sources refresh under one newest-request owner | Accepted |
| Overdue drill-in | Existing native overdue report remains the detail destination | Accepted |

## Findings and resolutions

### P1: period changes could strand the replacement load

`load()` previously returned whenever `isLoading` was true. SwiftUI's replacement `.task(id: days)` could therefore arrive while the old task was still unwinding and exit without loading the new period. The old response was later dropped, leaving the screen on stale data or a stuck loading state.

Resolution: each load now owns a UUID and period. A different period can replace active work immediately, and only the newest owner may publish data or clear loading state. Period changes also clear data from the previous window so 30-day values cannot be relabeled as 90-day values.

### P1: one failed endpoint discarded the successful endpoint

The paired throwing `async let` tuple treated utilization and checkout activity as one failure domain. A checkout failure could discard a valid utilization response, and vice versa.

Resolution: each endpoint produces an independent success, failure, or cancellation outcome. Successful data installs immediately after both operations settle, while source-specific failure copy remains visible.

### P1: partial server results looked complete

The report services intentionally retained successful query groups, but substituted zero or empty fallbacks without telling clients which sections failed.

Resolution: both endpoints now return optional additive `partialFailures`. Native decoders tolerate the new key, keep usable data visible, show an incomplete-data warning, and do not mark the result fresh.

## Deliberate boundaries

- iOS keeps the shared 30-day and 90-day periods only because both endpoints support them.
- CSV export, heatmap, requester ranking, audit report, badge analytics, and dense row drill-downs remain on web.
- Server permissions remain authoritative. The Browse gate is navigation hygiene, not authorization.
- Simulator tests and source contracts cover ownership and decoding. Authenticated visual inspection is still required for exact chart composition, Dynamic Type, VoiceOver order, and real slow-network behavior.

## Verification ledger

- [x] `tests/ios-reports-resilience.test.ts`
- [x] `ios/WisconsinTests/ReportModelsTests.swift`: **passed 2026-08-20 — 10 tests, 0 failures.** Executed 2026-08-20: the simulator gate that blocked this is no longer in force.
- [x] `ios/WisconsinTests/ReportsViewModelTests`: **passed 2026-08-20 — 3 tests, 0 failures.** Executed 2026-08-20: the simulator gate that blocked this is no longer in force.
- [x] Swift syntax parse for the changed view, models, and XCTest source
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`: 54/54 covered, 0 missing, 0 unregistered
- [ ] Wisconsin iPhone 16 Pro Simulator test and build: CoreSimulator was unavailable in the sandbox, and escalation was rejected because the Codex approval-usage limit is exhausted until 2026-08-15
- [ ] Authenticated native visual walkthrough: no safe authenticated test session was available

## Decision

Source behavior is accepted by the passing repository gates. Native compilation, XCTest execution, and authenticated visual behavior remain named proof gaps, not source-level claims.

## 2026-08-21 UI Pass

Captured through the new `GT_PERFORMANCE_SCENARIO=reports` scenario on iPhone 16 Pro in light and dark. The screen renders correctly in both: the 30d/90d window control, a utilization/checkouts/overdue summary with a trend delta, the overdue drill-in row, the Swift Charts activity line, and the status donut. Nothing visually wrong was found.

- [ ] [Hardening] **`custody` is optional but `custody.topUsed` is not, so a partial server payload fails the whole report.** `UtilizationReport.custody` is `UtilizationCustody?` and its doc comment states the intent plainly -- "A shipped build can outrun the server it talks to" -- but `UtilizationCustody.topUsed` is a non-optional `[UtilizationTopUsedAsset]`. A server that sends the custody block without `topUsed` therefore fails to decode the entire response, and the screen shows "Utilization could not refresh" rather than the utilization rate it did receive.
      Found by construction rather than by inspection: the first fixture omitted `topUsed`, which is exactly the shape an older or partial server would send, and the report died on it.
      `ios/Wisconsin/Models/Models.swift` -- `UtilizationCustody`.
      Suggested fix: `let topUsed: [UtilizationTopUsedAsset]?` with an empty-array fallback at the read site, matching the tolerance the surrounding model already claims.

## 2026-10-16 Read-only report library

The glance stays. Reports now also opens read-only screens for the reports iOS was missing.

| Screen | Endpoint | What the phone shows | What stays on web |
| --- | --- | --- | --- |
| Utilization | `GET /api/reports/utilization` | 30/90/365, status donut, most-used bars, breakdown shares, idle gear | CSV, items drill-down |
| Checkouts | `GET /api/reports/checkouts` | 7/30/90, trend, requesters, recent rows into booking detail | CSV, heatmap day focus |
| Scans | `GET /api/reports/scans` | 7/30/90/all, phase, daily volume, paged rows | CSV |
| Missing Units | `GET /api/reports/bulk-losses` | Location and category, families, people, recent check-ins, battery units and history | CSV |
| Badges | `GET /api/reports/badges` | 30/90/365, leaderboard, distribution, rarely awarded, recent awards | CSV of the visible rows |
| Usage | `GET /api/reports/usage` | Aggregate counts, only when `GET /api/me` sets `canViewUsageAnalytics` | The named App activity roster in Settings |

A new period or filter discards the previous value before the replacement request can publish. Usage stays off the list until `/api/me` allows it, and a 403 shows an owner-only state.

- [x] `tests/ios-report-library-contract.test.ts`
- [x] `ios/WisconsinTests/ReportLibraryModelTests.swift` and `ReportSessionTests.swift` (source; not executed here)
- [x] `npm run ios:project:check`, `npm run drift:ios`, `npm run audit:ios:gaps`
- [ ] Xcode build of `Wisconsin` for iPhone 18 Pro Max, plus the new XCTest cases
- [ ] Authenticated iPhone walkthrough: each report, a period change during load, Usage hidden and shown, and no CSV action
