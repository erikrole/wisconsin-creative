# Booking Rename and Ownership Transfer Fix - 2026-08-04

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

## Goal

- Booking detail rename and ownership transfer should not show an error when a
  request has already committed and the client retries with its prior snapshot.
- Real competing edits must continue to return a stale-write conflict.
- Preserve booking permission checks, audit history, and kiosk custody boundaries.

## Route

- Owner area: Bookings / native booking detail
- Ledger: this plan; the completed owner-transfer plan remains historical
- Related source: `src/app/api/bookings/[id]/route.ts`,
  `src/app/api/bookings/[id]/transfer-owner/route.ts`,
  `ios/Wisconsin/Core/APIClient.swift`

## Source Checks

- Booking PATCH already compares `If-Unmodified-Since` at second precision and
  returns idempotent success only when every submitted field matches current
  state.
- Owner transfer uses the same optimistic-lock header but currently returns
  `409` for every stale request, including an exact retry of a transfer whose
  target is already the current requester.
- Web and iOS detail clients use the booking snapshot timestamp; iOS PATCH
  handles status manually while iOS transfer decodes the enriched booking.
- No schema or custody change is required. `Booking.requesterUserId` remains
  the transferred owner while `createdBy` and audit history remain unchanged.

## Stop Conditions

- Stop and preserve the conflict if a stale rename payload differs from the
  current booking in any submitted field.
- Stop and preserve the conflict if a stale transfer targets a different user
  than the current requester.
- Do not weaken `requireBookingAction`, target-user validation, or transaction
  isolation.
- Do not touch the existing kiosk working-tree changes.

## Slices

- [x] Slice 1: Add regression coverage for the full-page booking mutation
  freshness contract and stale committed owner-transfer retries. Existing
  booking PATCH coverage already pins stale duplicate rename success and true
  stale conflicts.
- [x] Slice 2: Make web booking saves apply the server-returned snapshot and
  make stale owner-transfer retries idempotent without bypassing permissions.
  Native iOS sources were unchanged because they already refresh or decode the
  authoritative booking response on these paths.
- [x] Slice 3: Sync the reservation and checkout changelogs and closeout notes.
- [x] Slice 4: Make the compact booking detail surface apply authoritative
  mutation responses, and keep post-success transfer UI callbacks outside the
  request error path so a committed mutation cannot be reported as a failure.

## Verification

- [x] Focused booking route/service and web source-contract tests (8 files,
  71 tests), plus the follow-up freshness tests (2 files, 6 tests)
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] Clean deploy-tree `npm run build:app` (216 pages)
- [x] `npm run verify:docs` (codemaps were already current)
- [ ] `npm run drift:ios` and `npm run audit:ios:gaps` (not applicable because
  native sources did not change)
- [x] `npm run db:migrate:check` (111 migrations checked; no schema change)
- [x] `git diff --check`
- [x] Authenticated browser proof: created RV-0137 under Creative Admin,
  renamed it, transferred it to Erik Role, renamed it again, and reloaded the
  booking detail page to verify the final title and requester persisted.
- [x] Canonical public smoke against `https://wisconsincreative.com`; auth
  smoke was skipped because no production credentials were supplied.
- [ ] Full suite has one unrelated failure in
  `tests/auto-assign-preview-commit.test.ts`: the parallel auto-assign change
  adds `source: "AUTO_FILL"` while that test still expects the older payload.

## Review

- Shipped: Full-page and compact booking saves now apply the server's fresh
  booking snapshot, including `updatedAt`. Transfer UI now separates the
  committed response from post-success callbacks, and owner-transfer retries
  are idempotent only when the requested target is already current.
- Verified: focused tests, TypeScript, lint, clean deploy-tree build,
  migration-prefix check, docs verification, diff checks, canonical public
  smoke, and the authenticated booking sequence described above.
- Deferred: authenticated deploy smoke remains skipped because production
  credentials were not supplied; the browser sequence used the signed-in
  session already provided by the user.
- Blocked: None.
- Proof artifacts: `tests/booking-detail-mutation-freshness.test.ts` and
  `tests/booking-transfer-owner-route-contract.test.ts`.
- Next slice or stop: Stop. Production deployment and canonical public smoke
  are complete.
- Deployment: Vercel production deployment `dpl_FnXXCVZ731Qsyuc4qrKRr5YWGea9`
  reached `READY` at
  `https://gear-tracker-cd7kpw0ox-erikrole.vercel.app` and was aliased to
  `https://gear.erikrole.com` and `https://wisconsincreative.com`. The deploy
  tree was `HEAD` plus only the six booking source files; unrelated dirty work
  was not included.
- Production smoke passed with `DEPLOY_SMOKE_BASE_URL=https://wisconsincreative.com npm run smoke:deploy`, covering all public checks and the unauthenticated redirect. Authenticated smoke was skipped because no production credentials were supplied.
