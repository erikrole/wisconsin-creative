# Booking Mutation False-Error Toast Fix - 2026-08-25

## Goal

- Booking title, schedule, notes, equipment, owner, and linked-event mutations must not report a network/save failure after the server has already returned a committed success.
- Real network, validation, permission, and stale-write failures must keep their current error feedback.

## Route

- Owner area: Reservations and Checkouts shared booking detail
- Ledger: this plan
- Existing references: `tasks/booking-rename-transfer-fix-plan.md` and `tests/booking-detail-mutation-freshness.test.ts`

## Source Checks

- Shared booking PATCH and event-link routes return the refreshed authoritative booking after a successful commit.
- The title/detail-sheet and linked-event clients apply that response, then run local refresh, close, and change-signal callbacks inside the same `try` block as the network request.
- A callback-side exception can therefore fall into the request catch and emit a false server/network error after the mutation succeeded.
- Owner transfer already separates the committed request result from post-success UI callbacks; the other shared booking mutation surfaces do not consistently follow that pattern.
- All affected clients used the shared eight-second fetch timeout. The Vercel UI showed no failing booking mutation in the available one-hour log window, so the exact reported request duration remains unobserved.

## Stop Conditions

- Preserve non-2xx response handling and optimistic-lock conflicts.
- Do not infer success from an aborted or failed request whose response was never received.
- Do not weaken booking permissions, serializable mutation behavior, audit writes, or kiosk custody boundaries.

## Slices

- [x] Slice 1: Add source-contract regression coverage that committed booking responses leave the request error boundary before local callbacks run.
- [x] Slice 2: Apply the established owner-transfer pattern to shared booking detail and linked-event success handling.
- [x] Slice 3: Verify focused tests, TypeScript, lint, app build, diff checks, and authenticated browser behavior when the local signed-in runtime is available.
- [x] Slice 4: Sync Reservations and Checkouts changelogs and close this plan with exact proof and remaining runtime gaps.

## Verification

- [x] `npx vitest run tests/booking-detail-mutation-freshness.test.ts tests/booking-events-route-contract.test.ts tests/update-booking.test.ts tests/update-booking-events.test.ts`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run verify:docs`
- [ ] `npm run build:app` (app compilation and typecheck passed; the clean-cache build then failed prerendering `/login` with `Cannot read properties of undefined (reading 'call')`)
- [x] `git diff --check`
- [ ] Authenticated booking-detail rename and linked-event smoke (local preview reached Login, then the browser connection reset on an active browser prompt before the controlled interaction)

## Review

- Shipped: Locally, booking writes use a 30-second mutation timeout and committed detail-sheet/event-link responses leave the request catch before local success callbacks run.
- Verified: 59 focused booking tests, TypeScript, lint, docs/codemap verification, and diff checks pass. The React best-practices review found no new hook, rendering, accessibility, or structure issue.
- Deferred: Deployment and production mutation acceptance were not requested and were not performed.
- Blocked: Authenticated visual/browser proof was interrupted by the browser connection reset. `npm run build:app` compiled and typechecked, then failed during `/login` prerender after a clean `.next` retry.
- Proof artifacts: `tests/booking-detail-mutation-freshness.test.ts`; Vercel production logs were inspected read-only for the available one-hour window and contained no matching mutation failure.
- Next slice or stop: Stop locally. Re-run the authenticated rename/event-link interaction and app build from a stable browser/build environment before shipping.
