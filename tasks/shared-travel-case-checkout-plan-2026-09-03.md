# Shared Travel Case Checkout Plan - 2026-09-03

## Goal
- Let Staff/Admin designate a reservation such as `Football Travel Case` as shared operational custody at creation time, with no person presented as its owner, and carry that identity into the checkout created at kiosk pickup.
- Keep the existing active-checkout custody correction for Staff/Admin.
- Keep everything packed in the case or equipment truck on that single manifest, including pooled batteries.
- Require gear carried outside the case to remain on separate person-scoped checkouts.

## Route
- Owner area: Checkouts / unified Booking lifecycle.
- Secondary areas: Kiosk, Dashboard, Accountability, Notifications, Reports, and native iOS.
- Ledger: this plan plus `docs/AREA_CHECKOUTS.md`, `docs/DECISIONS.md`, and `docs/GAPS_AND_RISKS.md`.
- Supersedes: `tasks/event-checkout-assignments-plan-2026-09-02.md` and the assignment portions of `tasks/event-checkout-assignments-plan-2026-09-03.md`.

## Source Checks
- Migration `0141_event_checkout_assignments` is already applied in production. It added `Booking.custodyScope` with `PERSON`/`EVENT` and nullable serialized-item assignee columns, but no application mutation or UI uses either feature.
- `Booking.requesterUserId` must remain required for compatibility with existing lifecycle, audit, and historical records. For `SHARED` custody it is implementation metadata, not a displayed owner or personal accountability target.
- Kiosk scans, allocations, numbered bulk-unit bindings, and return evidence remain the physical custody authority.
- The current user direction does not include item-level assignees. Deployed nullable assignment columns remain dormant until a separately approved cleanup can prove they contain no data.

## Stop Conditions
- Stop if a Student or Collaborator can create or mutate shared custody.
- Stop if shared custody can be set on a completed or cancelled record.
- Stop if reservation creation exposes the retained compatibility requester as the owner of shared gear.
- Stop if kiosk pickup fails to copy the reservation custody scope to the linked checkout.
- Stop if a Student or Collaborator can set shared custody or mutate a shared checkout through hidden requester/creator ownership.
- Stop if converting custody changes equipment, allocations, requester history, scans, events, location, or lifecycle state.
- Stop before destructive cleanup of deployed columns, production data conversion, commit, push, deployment, or live migration application without separate authorization.

## Slices
- [x] Slice 1: Rename the deployed unused `EVENT` enum value to `SHARED` with a follow-up migration; keep nullable assignee persistence dormant and document the correction.
- [x] Slice 2: Add a Staff/Admin-only, serializable, snapshot-guarded, audited custody-scope mutation for active checkouts.
- [x] Slice 3: Present shared custody on web detail/list surfaces with package identity, no personal owner, no transfer-owner, and no borrower nudge.
- [x] Slice 4: Exclude shared checkouts from personal My Gear, accountability, badges, and requester notification attribution while retaining operational visibility.
- [x] Slice 5: Make shared checkout return discoverable and executable through kiosk scan custody with an identified operational actor rather than a personal owner.
- [ ] Slice 6: Native presentation and docs/codemaps are complete; authenticated visual proof and a clean WisconsinKiosk XCTest run remain open.
- [x] Slice 7: Add a Staff/Admin-only `Shared travel case` choice to reservation creation, persist it on the reservation, carry it through normal and force checkout, and keep the retained requester field hidden from personal ownership surfaces.

## Verification
- [x] Focused migration, policy, route/service, dashboard/accountability/notification, kiosk, and UI source-contract tests: 115 passed across the custody and dashboard suites.
- [x] `npx prisma format` and `npx prisma validate`.
- [x] `npm run db:migrate:check`: 149 migrations, no prefix collisions or malformed SQL. Production migration `0143_shared_checkout_custody` is applied and checksum-matched.
- [x] `npx tsc --noEmit --pretty false --incremental false`.
- [x] `npm run lint`.
- [x] `npm run codemap` and `npm run verify:docs`.
- [x] `git diff --check`.
- [x] `npm run build:app` after stopping any dev server sharing `.next`.
- [x] Reservation-to-checkout custody, permission, notification, consolidation, kiosk-operator, draft, transfer, and iOS pickup contracts: 156 tests passed across 11 focused suites.
- [x] `WisconsinKiosk` simulator app target builds successfully on the available iPad Air 11-inch (M4), iOS 26.5 destination.
- [ ] Authenticated desktop and narrow-width browser proof for personal and shared checkout detail/list states, or a recorded runtime blocker.
- [ ] The `WisconsinKiosk` XCTest run remains blocked by the pre-existing missing `KioskHIDBurstDetector` symbol in `KioskFlowRoutingTests.swift`; the app target itself builds.

## Review
- Shipped: Production migration `0143_shared_checkout_custody` is applied. Compatible app source remains local, and no real checkout has been converted.
- Verified: Current direction, applied `0141` history, dormant assignee state, Prisma gates, TypeScript, lint, codemaps/docs, diff hygiene, production-shaped app build, iOS drift/project audits, the `WisconsinKiosk` app build, and 156 focused reservation/custody/kiosk tests. Neon rehearsal produced `{PERSON,SHARED}` with 301 personal and zero shared rows. Production read-back matches, the exact checksum receipt is present, and the sorted 149-name production/local migration hashes match.
- Deferred: Destructive removal of deployed nullable assignee columns; item-level assignment has no product behavior.
- Blocked: Local browser automation returns `ERR_BLOCKED_BY_CLIENT` for localhost and LAN URLs, so authenticated visual proof could not be captured without mutating production. Physical kiosk acceptance still requires the managed iPad. The kiosk XCTest target also has an unrelated, pre-existing missing `KioskHIDBurstDetector` test symbol; the app target builds.
- Proof artifacts: Command and Neon read-back evidence in this task. No matched capture is claimed because compatible app code is not deployed and no isolated authenticated runtime with a shared fixture exists; constructing a fake before/after would violate the UI-review contract.
- Next slice or stop: Deploy compatible app code, then convert and verify the real Football Travel Case checkout only when those separate actions are explicitly authorized.
- Product correction: The live reservation creator still requires `Reserved for` and offers no shared-custody choice. The user cancelled the mixed Notre Dame reservation and directed that a case-only reservation be ownerless from creation; Slice 7 supersedes the earlier checkout-only restriction.
- Next slice or stop: Commit, push, deploy, and create the real Football Travel Case reservation only when those separate actions are explicitly authorized; then perform authenticated visual and managed-iPad acceptance.
