# Checkout Extension Upcoming Demand Plan - 2026-09-03

## Goal
- Let an active checkout be extended when gear has a later booking, provided the new due time does not actually overlap that next booking.

## Route
- Owner area: Checkouts
- Secondary area: Mobile Operations
- Ledger: this bounded active plan
- Existing references: `tasks/ios-booking-extend-concurrency-fix-plan.md`, `tasks/archive/completed-2026-07/booking-api-hardening-plan.md`

## Source Checks
- Native Booking Detail currently hides Extend whenever `/api/availability/check` reports any upcoming serialized commitment, regardless of the time requested.
- Shared availability applies a 60-minute serialized turnaround buffer by default, and `extendBooking` currently inherits that creation/edit policy.
- The dedicated extend route rechecks the visible booking snapshot, action permission, serialized conflicts, and bulk shortages inside a `SERIALIZABLE` transaction before moving the booking and allocation end times.
- PostgreSQL overlap protection and the active-allocation uniqueness boundary remain unchanged.
- No schema, migration, permission, audit, custody, or API response-shape change is required.

## Stop Conditions
- Stop if the relaxed extension path would permit a real serialized overlap, a bulk reservation shortage, or a stale-snapshot write.
- Stop if creation or reservation-edit availability would lose the existing 60-minute turnaround buffer.
- Stop if the iPhone 16 Pro Simulator destination is unavailable; do not substitute another model.

## Slices
- [x] Slice 1: Make the serialized turnaround buffer configurable at the availability-service boundary while retaining it by default.
- [x] Slice 2: Use overlap-only serialized checks for active-checkout extensions, including the dedicated Extend action and an equivalent later due-time edit.
- [x] Slice 3: Keep native Extend available with upcoming demand and replace the false unavailable copy with next-use guidance.
- [x] Slice 4: Add focused service and native source-contract coverage.
- [x] Slice 5: Produce matched before/after iPhone 16 Pro fixture captures and sync Checkouts/Mobile documentation.

## Verification
- [x] Focused availability, booking extension/update, and native source-contract tests: 94 passed.
- [x] `npx tsc --noEmit --pretty false --incremental false`
- [x] Full `npm run lint` (stronger than focused ESLint).
- [x] `npm run ios:project:check`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] iPhone 16 Pro Simulator build for `Wisconsin`, through the focused UI test.
- [x] Matched before/after `WisconsinPerformance` screenshot capture for an open checkout with upcoming demand.
- [ ] `npm run codemap` was not run because `docs/CODEMAPS/architecture.md` was already user-modified; regenerating it would overwrite unrelated work.
- [ ] `npm run verify:docs` reports pre-existing drift in `docs/CODEMAPS/architecture.md` and `docs/CODEMAPS/backend.md`.
- [x] `git diff --check`
- [x] `npm run build:app`

## Review
- Implemented locally: active `OPEN` checkout extensions use actual-overlap serialized checks; reservation creation/edit policy retains the 60-minute buffer; native Booking Detail keeps Extend visible and names the next need.
- Verified: 94 focused tests, TypeScript, full lint, Xcode project parity, iOS drift/gap audits, iPhone 16 Pro UI test/build, matched baseline/final captures, diff check, and `build:app`.
- Deferred: authenticated production mutation and deployment; neither was requested.
- Blocked: docs verification only, by unrelated existing codemap drift that was preserved.
- Proof artifacts: `tasks/archive/proofs/checkout-extension-upcoming-demand-2026-09-03/review.html` and its source captures/manifests.
- Next slice or stop: stop; the bounded behavior change is complete locally.
