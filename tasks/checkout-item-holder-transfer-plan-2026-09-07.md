# Checkout Item Ownership Transfer Plan - 2026-09-07

## Goal
- Move one active serialized item and its existing active allocation atomically to the actual custody owner's personal checkout. Booking ownership remains the source of truth for My Gear, accountability, reminders, overdue work, and returns.
- Preserve original scans, photos, handoff/creator evidence, source reservation, asset identity, allocation dates, and prior audit history.

## Route
- Owner area: Checkouts; secondary consumers: Dashboard/My Gear, Accountability, Notifications, Kiosk, native reads.
- Ledger: this plan and GAP-78. Supersedes the earlier inline-holder plan by explicit user direction on 2026-09-07.

## Source Checks
- Existing holder service only writes assignedUserId/assignedAt; existing readers use Booking.requesterUserId.
- BookingSerializedItem and AssetAllocation can change bookingId without new rows or a migration. Scans/photos reference their original booking and asset; audit entries on both checkouts link the transfer.
- Reuse an open personal checkout with matching location, due date, event set, purpose/title, and source reservation context; retain allocation start/end. If none exists, create a personal checkout carrying the source context and a CO reference. Never merge unrelated custody.
- Clear the transferred line's legacy assignee override; receiving requester is authoritative. Do not mutate pooled bulk custody.
- If no outstanding serialized/bulk custody remains, retain the source as CANCELLED with a transfer audit, without fabricating a return or awarding a return badge. Prior scans and completed sessions remain unchanged.

## Stop Conditions
- Reject non-staff/admin, stale snapshots, non-open checkouts, inactive/non-visible targets, non-active lines, missing/duplicate active allocations, excluded custody, and in-progress return sessions.
- No commit, push, deployment, or production data correction is authorized in this slice.

## Slices
- [x] Reconcile D-061 and area contract with accepted ownership transfer.
- [x] Implement serializable transfer, compatible destination reuse/create, atomic item/allocation movement, source closure, two-sided audit, and post-commit reminder scheduling.
- [x] Update route/client response, transfer wording, destination link and both-checkout cache invalidation.
- [x] Verify service/route conflicts, transactional error propagation, evidence-preserving writes, downstream canonical contracts and rendered fixture behavior. Actual PostgreSQL rollback/concurrent-session proof remains a rollout gate.
- [x] Sync docs and review proof with honest runtime/deployment limits.

## Verification
- Focused Vitest service/route/source tests, TypeScript, lint, npm run build:app, npm run codemap, npm run verify:docs, npm run db:migrate:check, git diff --check.
- Matched desktop/narrow fixture screenshots via Playwright and gt-ui-review page; actual DB custody/physical kiosk and notification delivery are separate gates.

## Review
- Shipped: Local implementation complete; not committed, pushed, or deployed.
- Verified: 64 focused Vitest tests; TypeScript; ESLint; app-only production build; docs/codemaps; 149 migration prefixes; git diff --check. Authenticated Playwright passed personal/shared transfers at desktop and 390px (4 cases plus sign-in), and the saved pre-change baseline passed the same fixture flow. Selected matched captures visually inspected.
- Deferred: Deployment, explicitly approved real record correction and database transfer/read-back/concurrency proof, recipient notification delivery, and physical kiosk return acceptance. No schema migration or native model change is required.
- Blocked: None for local work. Chromium required approved execution outside the macOS sandbox; cold-start sign-in exceeded 30 seconds, then passed with the warm server and a 120-second test budget.
- Proof artifacts: `tasks/archive/proofs/checkout-item-transfer-2026-09-07/review.html` and its spec, screenshots, and baseline source snapshots. The review is a local HTML artifact because no Artifact publishing tool is available. Booking/mutation responses are fixture-backed, not live database evidence.
- Next slice: Deploy compatible code when explicitly requested, then verify one approved real transfer and its receiving-owner notification/return path.
