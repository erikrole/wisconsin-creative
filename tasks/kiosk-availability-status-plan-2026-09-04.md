# Kiosk Availability Status Plan - 2026-09-04

## Goal

- Make Kiosk checkout availability name serialized items that are already reserved or checked out instead of collapsing them to generic unavailable/conflict copy.

## Route

- Owner area: `docs/AREA_KIOSK.md`
- Secondary contract: native iOS Kiosk checkout availability and shared server availability service.
- Ledger: this plan; preserve unrelated active task ledgers and dirty worktree changes.

## Source Checks

- `docs/NORTH_STAR.md`, `docs/AREA_KIOSK.md`, `docs/DECISIONS.md`, and `docs/GAPS_AND_RISKS.md` establish the native Kiosk as the custody boundary and `BOOKED`/`OPEN` as reservation/active-checkout states.
- `src/lib/services/availability.ts` now returns optional requester name, booking kind, and booking status alongside conflict title and time; its allocation query still filters the blocking booking statuses.
- `/api/kiosk/checkout/availability` returns the shared availability result directly.
- `ios/Wisconsin/Kiosk/KioskModels.swift` and `KioskCheckoutView.swift` now carry the optional metadata and render state-specific conflict rows plus actionable scan feedback; older payloads still decode through the existing fallback copy.

## Stop Conditions

- Stop if the allocation query cannot provide booking kind/status without changing the reservation-first or kiosk-only custody contract.
- Stop if the native Codable payload cannot remain tolerant of an older server response during rollout.
- Do not alter checkout authorization, allocation ownership, or final transactional availability enforcement.

## Slices

- [x] Slice 1: Add optional blocking-booking requester, kind, and status metadata to the shared availability result and carry it through the Kiosk Codable model.
- [x] Slice 2: Replace generic Kiosk conflict labels/messages with `Reserved`, `Checked Out`, and `Pending Pickup` copy, including accessibility and rejected-scan feedback.
- [x] Slice 3: Add service/source-contract coverage and a DEBUG-only fixture for matched visual review.
- [x] Slice 4: Sync the Kiosk area changelog and record verification evidence.

## Verification

- [x] Focused availability and Kiosk contract tests: 48/48 passing.
- [x] `npx tsc --noEmit --pretty false --incremental false`.
- [x] `npm run lint` and `npm run build:app`.
- [x] `npm run ios:project:check`, `npm run drift:ios:warn`, and `npm run audit:ios:gaps`.
- [x] Kiosk Xcode Debug simulator build and Release compile for the touched native target; only the existing `UIRequiresFullScreen` deprecation warning remains.
- [x] `git diff --check`.
- [x] Matched before/after Kiosk visual review with the same fixture and inspected captures on the available iPad Air 11-inch (M4) simulator.
- [x] Record that physical managed-iPad/scanner acceptance and deployment are separate gates.

## Review

- Shipped: local source changes only until deployment is explicitly requested.
- Verified: local implementation, focused web tests, web build/lint/type gates, iOS source audits, native Debug/Release compiles, and matched simulator captures.
- Deferred: physical iPad/scanner acceptance and production deployment unless separately authorized and available.
- Blocked: repository docs verification still reports generated codemap drift in `docs/CODEMAPS/architecture.md`, `docs/CODEMAPS/backend.md`, and `docs/CODEMAPS/areas.md`; `docs/CODEMAPS/backend.md` was already dirty before this task, so it was not regenerated over parallel work.
- Proof artifacts: `tasks/archive/proofs/kiosk-availability-status-review-2026-09-04/review.html` and its inspected before/after captures.
- Next slice or stop: stop after local/native/visual evidence; hand off any external rollout gate separately.
