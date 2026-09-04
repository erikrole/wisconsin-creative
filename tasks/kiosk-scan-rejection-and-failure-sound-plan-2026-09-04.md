# Kiosk Scan Rejection and Failure Sound Plan - 2026-09-04

## Goal

- Make scan feedback truthful during an assembly-line checkout: an item with a reservation or other blocking availability conflict is rejected before it enters the visible cart or count.
- Add a short audible failure cue for rejected/failed scan feedback while preserving the existing haptic, visual, VoiceOver, and final transactional safeguards.

## Route

- Owner area: `docs/AREA_KIOSK.md`
- Surface: native `WisconsinKiosk` checkout, reservation pickup, and return scan feedback.
- Existing plan: `tasks/kiosk-actionable-availability-plan-2026-09-04.md` — its recovery row remains useful for conflicts that appear after a previously accepted scan or after the return window changes, but the initial conflict scan must not be staged as accepted.

## Source Checks

- `src/app/api/kiosk/checkout/scan/route.ts` rejects missing, retired, maintenance, and actively allocated items, but future reservation/window conflicts are owned by `/api/kiosk/checkout/availability`.
- `KioskCheckoutView.handleScan` currently inserts a successful scan into `KioskStore` before the availability preflight returns, so a future conflict appears in the cart even though completion is later blocked.
- The checkout completion path already repeats availability and the server transaction remains authoritative for races.
- The dedicated kiosk target keeps its `Haptics` shim in `ios/Wisconsin/KioskOnly/KioskOnlyApp.swift`; no existing audible kiosk feedback helper or audio asset is present.

## Stop Conditions

- Stop if a rejected candidate can still increment the visible cart count, produce a success receipt, or reach checkout completion.
- Preserve the final availability check and server-side transactional rejection; the client preflight is an early UX gate, not a custody authority.
- Do not alter reservation, allocation, API, schema, permission, or audit semantics to add the sound.
- Do not make the failure cue fire for successful scans or non-blocking warnings; duplicate/rejected scans count as failures and should be audible.
- Keep rapid scanner input ordered so candidate availability is checked against the current cart before the next candidate is admitted.

## Slices

- [x] Slice 1: Serialize rapid checkout scan candidates, preflight before cart insertion, reject blocking/unverified candidates, and retain the final completion guard.
- [x] Slice 2: Add a short procedural kiosk failure cue and wire it to rejected/failed scan feedback in checkout, pickup, and return without adding a binary asset.
- [x] Slice 3: Add source-contract coverage, sync the Kiosk area docs and plan, and create matched UI review proof for the rejected-scan state.

## Verification

- [x] Focused Kiosk scan/rejection/sound source-contract tests plus existing Kiosk availability and custody contracts.
- [x] `npm run ios:project:check`.
- [x] `npm run drift:ios:warn` and `npm run audit:ios:gaps`.
- [x] `WisconsinKiosk` Debug and Release simulator builds on the available iPad Air 11-inch (M4), iOS 26.5 destination.
- [x] `git diff --check`.
- [x] Matched before/after Kiosk visual review with a fixture that shows a rejected conflict absent from the cart and the failure feedback visible; captures inspected.
- [x] `npm run verify:docs` (codemaps current).
- [ ] Record physical managed-iPad speaker/scanner acceptance and deployment as separate gates.

## Review

- Shipped: Candidate checkout scans now serialize, preflight the full candidate cart, and reject blocking or unverifiable candidates before cart admission. Rejection copy names the conflict and explicitly says the scan was rejected/not added. A procedural 180ms failure cue is wired to checkout, pickup, and return error/duplicate feedback without a bundled asset or custody/API/schema change.
- Verified: 17/17 focused contracts; XcodeGen parity; iOS drift and gap audits; diff check; `WisconsinKiosk` Debug and Release builds for iPad Air 11-inch (M4), iOS 26.5; `npm run verify:docs`; installed simulator capture inspected.
- Deferred: Physical speaker loudness/audibility with the real HID scanner, managed-iPad scan replay, and deployment.
- Blocked: None for local source/build/simulator proof. Physical and deployment gates require the managed kiosk environment.
- Proof artifacts: `tasks/archive/proofs/kiosk-scan-rejection-sound-review-2026-09-04/review.html` plus its matched `before/checkout.png` and `after/checkout.png` captures.
- Next slice or stop: Stop this slice; perform managed-iPad speaker/scanner acceptance and deployment when the kiosk rollout window is available.
