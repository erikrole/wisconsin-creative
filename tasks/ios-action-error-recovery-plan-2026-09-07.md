# iOS action error recovery — 2026-09-07

## Goal and ownership
Mobile: failures from booking extension, event actions (including shift claims), and call-window saves remain visible without scrolling or competing modal presentations. Preserve inputs and server authorization/concurrency contracts.

## Source checks
- ExtendBookingSheet renders its error after the graphical picker.
- EventDetailView presents action errors as an alert following confirmationDialog; Trade Board already uses a pinned recovery banner.
- Booking extension sends X-Booking-Updated-At and installs the returned Booking. Pickup uses /api/shift-assignments/pickup; claims remain approval-first.
- Existing Schedule/dashboard edits are unrelated and must be preserved.

## Slice
- Reuse the existing banner component file for an accessible, untruncated action-error surface.
- Pin extension, event-action, and call-window errors above scroll content; retain drafts. Event recovery refreshes authoritative state instead of replaying uncertain mutations.
- Verify source contracts, project/drift/gap checks, iPhone 16 Pro build, and matched fixture UI review where available.

## Stop conditions
No API, schema, permission, publication, or custody changes. Do not commit, push, or deploy. Record independent runtime/build blockers.

## Verification / review
- [x] Implemented locally: shared ActionErrorBanner, pinned booking-extension and call-window failures, and event-action Refresh/Dismiss recovery. Server messages and draft dates are retained; no API, schema, permissions, or custody edits.
- [x] Wisconsin build for `platform=iOS Simulator,name=iPhone 16 Pro` passed. Xcode resolved this name to iOS 27.0 for these runs.
- [x] Two `ActionErrorRecoveryUITests` passed, including a second final run after restoring the fixed source from baseline capture. Extension dismissal retains the chosen date and another rejection is shown; event removal failure is visible after confirmation.
- [x] Six focused regression checks passed. Related suite: 126 passed / 8 failed across 22 files. Existing failed expectations concern app build version, picker quarter-hours/location refresh, staff editor extraction, PostTradeSheet navigation arguments, roster-load spelling, and personal-dashboard source spelling. The same failing test cases appear during pre-change-view replay; the call-window test now passes its updated error assertion and then fails on unchanged AddShift quarter-hour source.
- [x] `npx tsc --noEmit --pretty false`, ESLint for the two changed test files, `ios:project:check`, `drift:ios`, `audit:ios:gaps`, `verify:docs` after codemap regeneration, and `git diff --check` passed.
- [x] Visual review: [review.html](archive/proofs/ios-action-errors-2026-09-07/review.html). Both captures inspected. Same device/theme/actions and exact pre-task source; clock/relative booking timestamps differ by one minute. Extension baseline comes from the failed UI-test recording because the off-screen error did not enter the visible accessibility hierarchy. The baseline event alert did appear, so modal suppression is not claimed as reproduced.
- [ ] Physical-device, authenticated production claim/extension, and VoiceOver runtime acceptance. No upload, commit, push, or deployment performed.

## Closeout
The bounded local fix is complete. The Trade Board already pins action failures and was left unchanged. Call-window presentation is source/build checked; no runtime call-window capture or real student claim mutation is claimed. Generated codemaps include concurrent repository work and were not staged. A hosted Artifact publishing tool is unavailable; the review page is a self-contained local HTML artifact. Stop here until release work or investigation of a specific server rejection is requested.
