# Event Checkout Assignments Plan - 2026-09-02

## Goal
- Let a large travel checkout belong to its linked event instead of a person.
- Show the people carrying serialized gear as item-level assignees with avatars while leaving batteries and other pooled quantities shared by the event.
- Preserve kiosk-owned physical custody, exact scan evidence, derived availability, and a complete audit trail.

## Route
- Owner area: Checkouts / unified Booking lifecycle.
- Secondary areas: Reservations, Events, Kiosk, Accountability, Notifications, Reports, and native iOS.
- Ledger: this plan plus `docs/AREA_CHECKOUTS.md`, `docs/AREA_RESERVATIONS.md`, `docs/DECISIONS.md`, and `docs/GAPS_AND_RISKS.md`.
- Existing references: `tasks/reservation-event-gear-plan-2026-09-02.md`, D-002, D-003, D-007, D-011, D-031, D-032, and D-040.

## Source Checks
- `Booking.requesterUserId` is required and currently drives ownership checks, kiosk identity, notifications, reports, badges, and accountability; making it nullable would create unsafe implicit behavior.
- `Booking.eventId` and ordered `BookingEvent` links already supply the event identity for a travel manifest.
- `BookingSerializedItem` is the durable serialized line and has no assignee today; `BookingBulkItem` and numbered-unit allocations already represent pooled quantity and exact battery custody.
- Shared booking detail already owns the web manifest and uses the canonical `UserAvatar`; mutations must return the enriched `/api/bookings/[id]` response shape.
- Existing requester consolidation remains valid only for personal reservations. Event-custody bookings must not consolidate into requester-owned plans.

## Stop Conditions
- Stop if event custody would bypass kiosk pickup, return, availability, or scan evidence.
- Stop if an event-custody booking has no linked event.
- Stop if a mutation can assign gear outside the booking, to an inactive/hidden user, or to a user without internal roster visibility.
- Stop if changing custody scope would erase requester, creator, reservation linkage, allocations, scans, or audit history.
- Stop before deployment, live migration application, production data conversion, commit, or push without separate user authorization.

## Slices
- [ ] Slice 1: Add additive `Booking.custodyScope` and serialized-item assignee persistence with safe defaults, indexes, relations, and migration SQL.
- [ ] Slice 2: Add a staff/admin-only serializable service and route to switch eligible linked bookings between personal and event custody and atomically update serialized assignments with audit evidence.
- [ ] Slice 3: Extend booking detail/list read models and web detail UI with event-owned identity, assignee avatars, grouped assigned/shared gear, and shared bulk-family presentation.
- [ ] Slice 4: Remove requester attribution from event-custody accountability, badge, reminder, report, dashboard, and personal-gear reads; route operational alerts and assigned-item visibility deliberately.
- [ ] Slice 5: Carry event custody and assignments through reservation pickup, partial pickup, active-checkout edits, return, and kiosk read models without changing scan truth.
- [ ] Slice 6: Add Event/Schedule entry and native iOS/kiosk presentation plus assignment controls where the physical workflow needs them.
- [ ] Slice 7: Sync docs, risks, codemaps, and matched authenticated visual proof; define any production conversion for existing large travel checkouts separately.

## Verification
- [ ] Focused schema, service, route, read-model, permission, audit, accountability, notification, kiosk, and UI source-contract tests.
- [ ] `npx prisma format` and `npx prisma validate`.
- [ ] `npm run db:migrate:check`.
- [ ] `npx tsc --noEmit --pretty false --incremental false`.
- [ ] `npm run lint`.
- [ ] `npm run codemap` and `npm run verify:docs`.
- [ ] `git diff --check`.
- [ ] `npm run build:app` after stopping any dev server sharing `.next`.
- [ ] Authenticated browser proof for personal and event checkout detail at desktop and narrow widths, including assignment, shared-pool, failure, and refresh states.
- [ ] `npm run drift:ios`, `npm run audit:ios:gaps`, `npm run ios:project:check`, affected native source-contract tests, and iPhone 16 Pro plus WisconsinKiosk builds when native/kiosk slices begin.

## Review
- Shipped: Not yet.
- Verified: Product direction and current source/schema dependency audit completed.
- Deferred: Case/container packing groups; pooled bulk items remain event-shared unless a later operational need justifies unit-to-person assignment.
- Blocked: None for local schema/service/web implementation.
- Proof artifacts: Pending.
- Next slice or stop: Implement the additive schema and staff web vertical slice without mutating live data.
