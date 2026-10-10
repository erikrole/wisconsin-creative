# Reservation-created schedule assignments

- Status: Lifecycle hardening implemented locally; authenticated runtime proof and migration application pending
- Date: 2026-08-04
- Owner: Reservations with Schedule integration
- Scope: Event-linked internal reservations only

## Goal

When an active internal user reserves gear for a scheduled event, treat that reservation as evidence that the requester is working the event. Reuse an existing active assignment when possible, otherwise assign the requester to a safe open or cloned slot, and persist the assignment on the booking in the same serializable transaction.

## Route

- Primary surface: `src/lib/services/bookings-lifecycle.ts`
- Schedule integration: `src/lib/services/reservation-schedule.ts`
- Entry route: `src/app/api/reservations/route.ts`
- Relink path: `updateBookingEvents()` also infers an assignment when an existing reservation gains its first event link.
- Lifecycle paths: `updateReservation()`, `updateBookingEvents()`, `transferBookingOwner()`, `cancelReservation()`, generic booking cancellation, no-show expiry, and requester deactivation reconcile reservation-managed assignments.
- Notification path: committed auto-assignments dispatch the existing schedule-assignment notification workflow after the booking transaction.
- Detail read model: `getBookingDetail()` exposes `scheduleStatus` and `scheduleStatusReason`; the shared header renders the outcome.
- Regression coverage: `tests/reservation-schedule.test.ts`, `tests/create-booking.test.ts`, `tests/update-booking-events.test.ts`, `tests/booking-detail-status-read-model.test.ts`, and lifecycle regression suites.

## Source checks

- `Booking.eventId` and `BookingEvent[]` keep the earliest linked event as the primary event.
- `Booking.shiftAssignmentId` is the existing booking-to-assignment link and an explicit value remains authoritative.
- Internal Schedule reads are assignment-backed. `ScheduleEventFollow` is reserved for collaborator published-schedule follows.
- D-042 requires worker-facing relational schedule truth and protects active working copies. A reservation may update a published snapshot transactionally, but never mutates a working copy.
- Assignment safety reuses the existing active-status, time-conflict, and student availability rules.
- Reservation-managed assignment provenance is stored on `ShiftAssignment`; cancellation and relinking must not remove or move a manual assignment.

## Assumptions and stop conditions

- Only `RESERVATION` creation with at least one linked event triggers this behavior. Multi-event reservations use the chronologically earliest event as the schedule event, matching the primary booking contract.
- An explicit `shiftAssignmentId` wins and is not replaced.
- Collaborators keep the existing event-follow behavior and are never added to internal staffing assignments.
- The requester’s `staffingType` selects FT or ST slots. `primaryArea`, then primary student area assignments, select an area when available. Without an area, an existing open slot is used rather than guessing a new area.
- A missing ShiftGroup, an active working copy, or no safe slot/template leaves the reservation valid without inventing an event crew setup. The booking remains event-linked and the limitation is documented.
- Approved time-off or an overlapping active assignment aborts the reservation atomically, because the reservation now asserts that the requester is working.
- A reservation-managed assignment may be released only when no other active reservation still points at it; completed custody keeps the assignment as historical work evidence.

## Slices

1. [x] Add a transaction-scoped reservation schedule helper that reuses or creates one direct assignment, updates a published snapshot when needed, and returns the assignment ID.
2. [x] Call the helper during booking creation and first event relinking, then write the resulting assignment ID to `Booking.shiftAssignmentId`.
3. [x] Add focused tests for reuse, matching open slots, new matching slots, collaborator/working-copy/missing-group no-ops, conflicts, and booking integration.
4. [x] Update reservation and Schedule area docs plus the accepted decision log; do not touch unrelated kiosk edits.
5. [x] Add durable reservation provenance, explicit assignment validation, and a reconciliation result for stale or blocked schedule links.
6. [x] Reconcile reservation edits, event changes, owner transfer, cancellation, no-show expiry, requester deactivation, and no-op review states without touching manual assignments.
7. [x] Dispatch schedule assignment notifications after commit and expose the schedule outcome in booking detail.

## Verification

- [x] Focused lifecycle suite across reservation schedule, booking create/edit/relink/transfer/cancel, expiry, deactivation, and detail status (146 tests passed)
- [x] `npx tsc --noEmit --pretty false` (passed after the lifecycle hardening changes)
- [x] `npm run lint`
- [x] `npm run build:app`
- [x] `git diff --check`
- [x] `npm run codemap` then `npm run verify:docs`
- [x] `npm run db:migrate:check` and `npx prisma generate` for migration `0107_shift_assignment_source`
- [ ] Authenticated browser proof remains pending because no authenticated runtime session was available.
- [x] Full `npm test` (447 files, 2,879 tests passed)

## Review

- Shipped: Transactional event-linked reservation scheduling and first-event relinking.
- Shipped locally: Reservation-managed provenance, lifecycle reconciliation, explicit assignment validation, outcome visibility, and post-commit notifications.
- Verified: Full test suite, focused lifecycle tests, typecheck, lint, production app build, migration prefix check, Prisma client generation, codemap/docs verification, and whitespace.
- Deferred: Authenticated browser confirmation and production behavior proof.
- Blocked: No local code or test blocker. Authenticated browser proof and migration application remain external rollout gates.
- Final diff review: Unrelated kiosk changes and the parallel `tasks/archive/completed-2026-10-06/booking-rename-transfer-fix-plan.md` remain untouched.
