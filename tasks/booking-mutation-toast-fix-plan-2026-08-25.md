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
- A Dia production reproduction on `Media Day - Kohl Center` showed a committed title change followed by `PATCH /api/bookings/cmt7dx26l0006l104a59mi5pj` returning HTTP 412. Application stale-write errors are HTTP 409, so the evidence places the 412 in the platform HTTP-precondition layer around the web client's standards-based `If-Unmodified-Since` header, before the booking route can apply its idempotent-stale handling.

## Stop Conditions

- Preserve non-2xx response handling and optimistic-lock conflicts.
- Do not infer success from an aborted or failed request whose response was never received.
- Do not weaken booking permissions, serializable mutation behavior, audit writes, or kiosk custody boundaries.

## Slices

- [x] Slice 1: Add source-contract regression coverage that committed booking responses leave the request error boundary before local callbacks run.
- [x] Slice 2: Apply the established owner-transfer pattern to shared booking detail and linked-event success handling.
- [x] Slice 3: Verify focused tests, TypeScript, lint, app build, diff checks, and authenticated browser behavior when the local signed-in runtime is available.
- [x] Slice 4: Sync Reservations and Checkouts changelogs and close this plan with exact proof and remaining runtime gaps.
- [x] Slice 5: Replace web booking `If-Unmodified-Since` requests with an application-owned snapshot header while retaining legacy-header parsing for native clients.

## Verification

- [x] `npx vitest run tests/booking-detail-mutation-freshness.test.ts tests/booking-events-route-contract.test.ts tests/update-booking.test.ts tests/update-booking-events.test.ts`
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run verify:docs`
- [ ] Production rename and linked-event acceptance after deployment
- [ ] `npm run build:app` (app compilation and typecheck passed; the clean-cache build then failed prerendering `/login` with `Cannot read properties of undefined (reading 'call')`)
- [x] `git diff --check`
- [ ] Authenticated booking-detail rename and linked-event smoke (local preview reached Login, then the browser connection reset on an active browser prompt before the controlled interaction)

## Review

- Shipped: Locally, booking writes use a 30-second mutation timeout, committed detail-sheet/event-link responses leave the request catch before local success callbacks run, and web mutation snapshots use `X-Booking-Updated-At` so Vercel does not evaluate them as HTTP preconditions.
- Verified: 61 focused booking tests plus the booking-list header regression, TypeScript, and lint pass. Dia confirmed the production booking is in the requested `Media Day - Kohl Center` final state and captured the false-error request as HTTP 412.
- Deferred: Deployment and production mutation acceptance were not requested and were not performed.
- Blocked: Post-fix authenticated acceptance requires deployment. `npm run build:app` previously compiled and typechecked, then failed during `/login` prerender after a clean `.next` retry.
- Proof artifacts: `tests/booking-detail-mutation-freshness.test.ts`; Vercel production logs were inspected read-only for the available one-hour window and contained no matching mutation failure.
- Next slice or stop: Deploy the header change, then repeat the title and linked-event interaction in Dia and confirm the mutation returns the application response without a 412.
