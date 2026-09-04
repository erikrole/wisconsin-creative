# Kiosk Actionable Availability Recovery Plan - 2026-09-04

## Goal

- When a scanned item is blocked by availability, make the next safe action visible at the item: remove the staged item, change the return time when timing can resolve the conflict, or scan another item/unit.
- Preserve the existing availability preflight, scanner ownership, local cart semantics, exact-unit custody, and transactional completion gate.

## Route

- Owner area: `docs/AREA_KIOSK.md`
- Surface: native `WisconsinKiosk` checkout scan list and availability feedback.
- Ledger: this plan; preserve unrelated dirty worktree and the completed availability-status and reservation-battery plans.

## Source Checks

- `ios/Wisconsin/Kiosk/KioskCheckoutView.swift` already renders item-local availability issues, removes staged cart groups locally, edits checkout details through the existing setup step, and exposes HID/camera scanning.
- `KioskCheckoutView` re-runs availability after cart, due-time, and scan changes; completion remains disabled while blocking issues exist.
- No API, schema, permission, allocation, or audit change is required for these recovery actions.

## Stop Conditions

- Stop if an action would bypass the existing availability refresh or final transactional completion check.
- Stop if changing the return time would discard the scanned cart or alter the stored checkout before completion.
- Do not introduce a direct checkout mutation or a new physical-unit binding path.

## Slices

- [x] Slice 1: Add explicit recovery actions to blocking item rows with accessible labels and scanner re-arm feedback.
- [x] Slice 2: Add focused native source-contract coverage and a DEBUG fixture state that demonstrates the actions.
- [x] Slice 3: Sync the Kiosk area acceptance/changelog and create matched before/after UI review proof.

## Verification

- [x] Focused Kiosk source-contract tests (10/10 across availability, battery grouping, and reservation pickup coverage).
- [x] `npm run ios:project:check`.
- [x] `npm run drift:ios:warn` and `npm run audit:ios:gaps`.
- [x] `WisconsinKiosk` Debug and Release simulator builds on the available iPad Air 11-inch (M4), iOS 26.5 destination.
- [x] `git diff --check`.
- [x] Matched before/after Kiosk visual review with the same `availability-conflicts` DEBUG fixture and inspected captures.
- [ ] `npm run verify:docs`; blocked by pre-existing generated-codemap drift in dirty parallel files (`docs/CODEMAPS/architecture.md` and `docs/CODEMAPS/areas.md`); do not overwrite it.
- [ ] Record physical managed-iPad/scanner acceptance and deployment as separate gates.

## Review

- Shipped: Local native kiosk recovery controls in `KioskCheckoutView`: conflict rows now offer Remove, Change return time, and Scan another item/unit; other blocking states offer the applicable safe subset. Changing the return time preserves the cart and refreshes availability before scanning resumes; Scan another leaves the blocked row staged for explicit removal.
- Verified: 10/10 focused Vitest source contracts; `ios:project:check`; iOS drift warning scan; iOS gap audit; `git diff --check`; `WisconsinKiosk` Debug and Release builds on the iPad Air 11-inch (M4), iOS 26.5 simulator; matched captures inspected.
- Deferred: Physical managed-iPad interaction with the real scanner/camera and production deployment remain unverified.
- Blocked: `npm run verify:docs` still reports generated codemap drift in `docs/CODEMAPS/architecture.md` and `docs/CODEMAPS/areas.md`, which were preserved because they are unrelated dirty worktree/parallel changes.
- Proof artifacts: `tasks/archive/proofs/kiosk-actionable-availability-review-2026-09-04/review.html` plus the paired `before/checkout.png` and `after/checkout.png` captures.
- Next slice or stop: Stop this bounded slice. The next QoL candidate is undo-last-scan or wrong-person recovery, pending product prioritization and a separate plan.
