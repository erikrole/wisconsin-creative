# Reservation Event Gear Plan - 2026-09-02

## Goal
- Treat one requester's ordinary event-linked reservation as one living personal gear plan across web, native iOS, Schedule/Event entry points, kiosk pickup, notifications, history, and staff cleanup.
- Keep ownerless event custody out of requester-based consolidation; shared travel loads and per-item people assignments are owned by `tasks/event-checkout-assignments-plan-2026-09-02.md`.
- Consolidate exact duplicate reservation intent automatically and provide an audited repair path for existing duplicates such as Emma Hanson's two reservations.
- Reduce repeat entry, dead-end conflict errors, and event-day scanning friction without moving physical custody outside the kiosk.

## Route
- Owner area: Reservations / unified Booking lifecycle.
- Secondary areas: Events and Schedule gear readiness, kiosk pickup, notifications, native iOS, and Bookings staff controls.
- Ledger: this plan plus the Reservations area changelog and active risks ledger.
- Existing references: `tasks/bookings-search-qol-plan-2026-08-30.md`, `tasks/booking-flow-followup-plan.md`, `docs/AREA_RESERVATIONS.md`, `docs/AREA_CHECKOUTS.md`, and D-002/D-003/D-040 in `docs/DECISIONS.md`.

## Source Checks
- `Booking` already owns requester, title, window, pickup location, lifecycle, equipment, primary event, and ordered `BookingEvent` links; no new persistence model is required for consolidation.
- Reservation creation already enters the serializable `createBooking` service and uses a consumed draft as an actor-scoped idempotency key, but it does not consolidate separately submitted matching reservations.
- The existing duplicate route copies the source dates and event links unchanged, which can create a second reservation for the same event.
- Reservation detail already supports audited edits; kiosk pickup already supports partial fulfillment and must preserve prior pickup state.
- Bookings list already has row selection, URL-owned filters, and shared action-policy helpers, but no staff bulk mutation controls.

## Stop Conditions
- Stop if a proposed merge would combine different requesters, booking kinds, non-`BOOKED` states, different exact event sets, different pickup locations, or incompatible time windows.
- Stop if consolidation would rebind picked-up equipment, alter an `OPEN` checkout, or replace kiosk scan evidence.
- Stop if a client proposal requires a response shape that the current route does not return.
- Stop if production data repair would require database access or mutation not explicitly authorized by the user; implementation may ship without mutating Emma's live rows.
- Stop if requester-based consolidation encounters an event-custody booking; event-owned manifests use their dedicated assignment path and must not be folded into a personal reservation.

## Slices
- [x] Slice 1: Add a canonical reservation-match key and serializable create-time consolidation with unique serialized equipment, additive bulk quantities, compatible notes/window handling, notification/audit evidence, and structured response metadata.
- [x] Slice 2: Add an audited staff/admin merge-preview and merge mutation for existing exact candidates, plus Bookings bulk-action wiring.
- [x] Slice 3: Replace same-context Duplicate with Reuse gear for a required new event/window, and add add-to-existing detection from reservation, Event, Schedule, and item entry points.
- [x] Slice 4: Add duplicate-candidate warnings and guided conflict recovery with existing-plan and remove-or-adjust-blocker actions; availability remains server-authoritative.
- [x] Slice 5: Add personal-reservation gear-readiness read models and one-row-per-requester summaries to Event operations; the consolidated shared reservation record remains the kiosk/Schedule source of truth, while event-owned checkout manifests stay distinct.
- [x] Slice 6: Add persistent user pickup-location defaults, richer reservation revision history, actionable lifecycle notifications, and staff event-day bulk actions.
- [x] Slice 7: Bring native iOS creation, detail, reuse, preferred-location, and consolidation-result handling to parity with the shared API contracts.
- [x] Slice 8: Add focused tests, sync docs/risks/codemaps, and produce local web plus simulator proof where the environment permits; authenticated and physical-device gates are recorded below.

## Verification
- [x] Focused reservation lifecycle, merge, route, list-action, event-readiness, notification, kiosk, and native source-contract tests.
- [x] `npx tsc --noEmit --pretty false --incremental false`.
- [x] `npm run lint`.
- [x] `npm run codemap` before docs verification when generated ownership maps change.
- [x] `npm run verify:docs`.
- [x] `npm run db:migrate:check`.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [ ] Authenticated browser smoke for create-time consolidation, existing-record merge, reuse, Event readiness, conflict recovery, and bulk actions, or record the exact blocker.
- [x] `npm run drift:ios`, `npm run audit:ios:gaps`, `npm run ios:project:check`, affected native source-contract tests, and an iPhone 16 Pro simulator build.
- [ ] WisconsinKiosk build plus simulator proof for grouped event/person pickup; physical scanner/iPad acceptance remains separate when hardware is required.

## Review
- Shipped: Implemented locally only; not committed, pushed, deployed, or applied to production data.
- Verified: 78 focused tests, TypeScript, ESLint, app build, docs/codemap/migration checks, native drift/project checks, iOS test-target compilation, and the required iPhone 16 Pro build pass.
- Deferred: Production cleanup of Emma Hanson's records until an authenticated, explicitly targeted mutation path is available.
- Blocked: Authenticated browser proof stopped at sign-in because no test credential or fixture-backed session was available. Physical kiosk/scanner acceptance still requires hardware.
- Proof artifacts: `tasks/reservation-event-gear-review-2026-09-02/review.html` and its source `spec.json`.
- Next slice or stop: Stop at local completion. Deploy first, then use the previewed staff merge on Emma's exact rows and verify the event/kiosk experience with an authenticated operator.
