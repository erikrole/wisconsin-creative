# Kiosk Reservation Battery List Plan - 2026-09-04

## Goal

- Show numbered-battery reservation pickup as a quantity to fulfill, not a list of required unit numbers.
- Keep actual scanned physical unit numbers visible after scanning for custody and audit.

## Route

- Owner area: `docs/AREA_KIOSK.md`
- Primary native surface: `ios/Wisconsin/Kiosk/KioskPickupView.swift`
- Supporting DEBUG fixture: `ios/Wisconsin/KioskOnly/KioskOnlyApp.swift`
- Ledger: this plan; preserve unrelated dirty worktree and the prior availability slice.

## Source Checks

- `KioskCheckoutDetail` exposes one placeholder row per numbered unit when a reservation has remaining quantity; unscanned placeholders are labeled `#1`, `#2`, and so on.
- `stageKioskReservationPickupBulkUnit` accepts any available unit from the reserved `BulkSku` family and records the actual unit number in scan evidence; the list is presentation, not a required-unit contract.
- `KioskPickupView` currently renders every numbered placeholder through `KioskChecklistRow`, while `KioskBatteryScanStatus` already tracks quantity and scanned unit tags.

## Stop Conditions

- Stop if grouping would change the set of IDs used for confirmation or scroll-to-last-scan behavior.
- Stop if any copy implies a different custody rule than “scan any available physical unit from this family.”
- Do not change the pickup scan or confirmation API, or exact-unit allocation semantics.

## Slices

- [x] Slice 1: Group numbered-battery placeholder rows into one quantity row in native reservation pickup, with actual scanned unit tags shown after scans.
- [x] Slice 2: Strengthen quantity wording in the battery status card and side-rail explanation.
- [x] Slice 3: Add DEBUG reservation fixture, source-contract coverage, and matched visual review.
- [x] Slice 4: Sync Kiosk area docs and close the plan with proof and deferred gates.

## Verification

- [x] Focused iOS reservation-pickup and numbered-battery contract tests (6/6).
- [x] `npm run ios:project:check`
- [x] `npm run drift:ios:warn`
- [x] `npm run audit:ios:gaps`
- [x] `git diff --check`
- [x] `WisconsinKiosk` Debug and Release builds on iPad Air 11-inch (M4), iOS 26.5 simulator.
- [x] Matched before/after iPad visual captures inspected.
- [ ] `npm run verify:docs` — blocked by pre-existing generated codemap drift; dirty codemap work was preserved.
- [x] Physical managed-iPad/scanner and deployment gates recorded separately.

## Review

- Shipped: local source only until deployment is explicitly requested.
- Verified: source, focused contracts, Debug/Release native builds, project parity, drift/gap audits, and matched simulator captures.
- Deferred: physical managed iPad/scanner acceptance and deployment.
- Blocked: repository docs verification remains blocked by pre-existing generated codemap drift in architecture, backend, and areas; do not regenerate over parallel dirty work.
- Proof artifacts: `tasks/archive/proofs/kiosk-reservation-battery-list-review-2026-09-04/`.
- Next slice or stop: stop after local, native, and visual proof; hand off external rollout separately.
