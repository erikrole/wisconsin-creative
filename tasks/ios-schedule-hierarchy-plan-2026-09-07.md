# iOS Schedule hierarchy — September 7, 2026

Scope: Schedule list/calendar event rows and native Event detail, following the user's cleaner-hierarchy, less-clutter direction. Availability, Trade Board, and staff editing sheets remain a later slice.

Contracts: preserve shared event classification, date/all-day boundaries, crew coverage, personal call/gear context, role permissions, published roster fallback, and all existing navigation/actions. No API or scheduling lifecycle changes.

Files: `ios/Wisconsin/Views/ScheduleView.swift`, `ios/Wisconsin/Views/EventDetailSheet.swift`; existing screenshot fixtures/tests and this evidence ledger. Both view files inspected in full before implementation.

- [x] Inspect current source, Schedule contracts, existing source tests, and baseline screenshots.
- [x] Capture matched standard and accessibility baselines on iPhone 16 Pro.
- [x] Keep a compact standard time column; give venue and personal-work text wrapping room and stack the row at large Dynamic Type sizes.
- [x] Reduce detail headline weight, let header metadata wrap, and quiet repeated crew overflow controls.
- [x] Xcode build/UI capture plus affected Swift source-contract tests; inspect final diff.
- [x] Deliver matched before/after review with measured differences and local-only acceptance state.

Existing fixture limitation: staff Event detail's unmapped working-copy request shows the published-crew fallback banner. Preserve that state in both comparison columns; it is not evidence of a production error.

Release: local implementation only; no commit, push, TestFlight, or physical-device acceptance requested.

## Local acceptance evidence

User narrowed priority to standard-size visual hierarchy during the pass. The delivered review leads with standard Schedule, Event detail, and multi-day headers; no additional accessibility expansion was pursued after that direction.

- Review: `tasks/archive/proofs/ios-schedule-2026-09-07/review.html`, served at `http://127.0.0.1:8770/review.html` and inspected in the in-app browser.
- Final standard UI tests: `/tmp/schedule-standard-final.xcresult`, 2 tests pass; covers List, Calendar, ended/live/all-day detail.
- Final source build: `/tmp/schedule-current-build.log` (Wisconsin / iPhone 16 Pro).
- 34 focused source-contract tests pass across Schedule UI, Dynamic Type, all-day, venue, crew, working-copy, and filters/calendar-management contracts.
- Project consistency, drift, audit inventory, docs verification, and diff checks pass.
- The broader temporal-state suite has one existing literal assertion expecting a direct `workingEditor = try await ...` expression. HEAD already uses a guarded intermediate `editor`; this pass does not change loading behavior.
- Screenshot navigation now selects the first matching multi-day title because the same event appears under multiple dates.

The review's Schedule pair uses the 14:57 baseline and 15:02 capture, whose live fixture timestamps match. Detail pairs use the stable Volleyball and Swimming events from the final standard run. CSS excludes status-bar clocks, retaining original PNGs.

- [ ] Promote accepted visual changes into the mobile area changelog during release closeout; signed-in production, physical device, and TestFlight acceptance are separate and not claimed.
