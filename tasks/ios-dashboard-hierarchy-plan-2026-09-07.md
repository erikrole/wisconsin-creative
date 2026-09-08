# iOS dashboard hierarchy — 2026-09-07

## Goal
Make Home easier to scan with less header and summary chrome, following the user's direction: cleaner hierarchy and less clutter.

## Route and source checks
- Owner: Mobile, `docs/AREA_MOBILE.md`, Dashboard on Mobile.
- Source: `ios/Wisconsin/Views/HomeView.swift`; existing `HomeScreenshotUITests` and Home source contracts.
- Current Home already owns personal data, urgency ordering, refresh recovery, and staff follow-up. This slice changes presentation only.
- Prior audit: `tasks/audit-home-ios.md`.
- Baseline: clean working tree; existing iPhone 16 Pro screenshot tests passed before edits. Results in `/tmp/dashboard-before-0907.xcresult`.

## Slice
- [x] Reduce greeting typography and combine greeting/name into wrapping text.
- [x] Put active summary disclosures in two columns at standard sizes and one at accessibility sizes, preserving labels, colors, counts, and actions.
- [x] Remove the explanatory Next Up subtitle.
- [x] Match loading-summary geometry.

## Stop conditions
- Preserve personal scope, status semantics, navigation, queue order, and staff gates.
- Stop if compilation or focused contracts expose a behavior regression.
- Use iPhone 16 Pro only; distinguish fixture render proof from signed-in production proof.

## Second slice — booking title readability
- [x] Allow booking titles and supporting context to wrap across the row's available width.
- [x] Move booking timing below the title; preserve status tone, full accessibility label, queue order, and destination.
- [x] Stabilize Home fixture dates within the capture hour and add repeatable dark / accessibility UI captures.
- [x] Capture the first-pass layout as the baseline, then compare standard and accessibility layouts using the same fixture dates.
- [x] Re-run Home contracts, iOS checks, and Xcode screenshot tests; update this review page.

## Verification
- [x] 30 focused Home Swift source-contract tests pass.
- [x] iOS project check, drift and gap audits pass.
- [x] Wisconsin iPhone 16 Pro Xcode build and both screenshot tests pass before and after.
- [x] Before/after review using existing fixture captures; compare header/summary crops without time-relative row values or status-bar clock.
- [x] `git diff --check` passes.
- [ ] Docs verification: blocked by architecture/backend codemap drift during concurrent Schedule work.

## Review
Implemented locally in `HomeView.swift`. No commit, upload, or deployment requested.

- Review: `tasks/archive/proofs/ios-dashboard-2026-09-07/review.html` (self-contained; no Artifact publishing tool available).
- Measured Next Up card position: first broad white row at y=1119 before, y=830 after, using identical white-pixel threshold across x=85...1120. Difference 289px / 3 = approximately 96pt at standard text size.
- Supplementary direct simulator capture confirms Dark / Accessibility Large wrapping and single-column summary. Initial UI-test appearance attempt did not apply settings to the test installation; not counted as accessibility proof.
- Second slice completed locally: all six booking titles are fully visible at standard size (previously one of six); booking title, meta, and supporting context wrap at Accessibility Large. Event/shift row layout is unchanged.
- Second-slice proof: `/tmp/dashboard-titles-before.xcresult` and `/tmp/dashboard-titles-after.xcresult`; all three Home UI tests pass before and after. Both runs used the same 14:00 local fixture anchor. The review includes matched queue crops with the status-bar clock excluded.
- Rechecked 30 Home source contracts, project generation, drift, gap inventory, and whitespace gates: all pass. No TypeScript runtime, API, schema, or deployment changes belong to this slice.
- Existing `ios-home-trade-board-context.test.ts` failure expects `PostTradeSheet(myShifts: myShifts)` while committed HEAD already uses `wrapsInNavigationStack: false`; left untouched.
- Release acceptance and area changelog promotion remain pending visual acceptance of this local first pass. The current Mobile action-first contract is preserved.
