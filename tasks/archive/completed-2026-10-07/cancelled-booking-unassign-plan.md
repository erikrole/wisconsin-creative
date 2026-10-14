# Canceled Booking Unassign Plan - 2026-08-07

## Goal

- Let staff remove or replace a worker in a Schedule working copy after the
  worker's linked reservation has been canceled, while continuing to protect
  active reservations and checkouts.

## Route

- Owner area: Schedule working copy and event-linked reservation lifecycle.
- Ledger: this plan; no unrelated task ledger changes.
- Contracts: D-042 versioned working copies and deliberate publish; D-044
  reservation-managed assignment lifecycle.

## Source Checks

- `src/lib/services/schedule-working-copy.ts` stores `bookingCount` in the
  working-copy payload and uses it for unassign/replace guards.
- `src/lib/services/schedule-publication.ts` reads assignment booking counts
  for publish blockers.
- `src/lib/services/bookings-lifecycle.ts` preserves canceled bookings and
  releases reservation-managed assignments when no working copy blocks it.
- `Booking.shiftAssignmentId` is nullable and `Booking.status` distinguishes
  active booking states from terminal `COMPLETED` and `CANCELLED` rows.

## Stop Conditions

- Stop if the current Prisma client cannot express filtered relation counts.
- Stop if the live assignment or booking lifecycle contract shows that a
  canceled row must continue blocking Schedule edits.
- Do not mutate or rebase a working copy from the reservation cancellation
  path; the working-copy isolation decision remains authoritative.

## Slices

- [x] Slice 1: Count only active linked bookings in working-copy and publish
  queries, and refresh live assignment metadata before working-copy guards.
- [x] Slice 2: Add regression coverage for a stale canceled-booking count and
  preserve active-booking protection.
- [x] Slice 3: Run focused and repository verification; record runtime proof
  boundaries.

## Verification

- [x] Focused working-copy, publication, reservation-lifecycle, and cancel
  booking tests: 7 files, 92 tests passed.
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused ESLint and clean-worktree `npm run lint` passed.
- [x] `npm run codemap` and `npm run verify:docs`.
- [x] `git diff --check`
- [x] `npm run build:app`
- [x] Production release proof recorded: Vercel built commit `5096815b`, the
  deployment reached `READY`, and `https://wisconsincreative.com/login`
  returned HTTP 200.

## Review

- Shipped: Luna reviewed, committed, and pushed the isolated eight-file release
  as `5096815b8aa7d560c0dc80efa958db9cd01e678d`; Vercel deployment
  `dpl_HsoXGMypw83dswvJFH8f1FJdYLiP` is production `READY` on the canonical
  aliases.
- Verified: focused tests (7 files, 92 tests), clean full tests (454 files,
  2960 tests), migration-prefix check, TypeScript, full ESLint, codemaps/docs,
  diff check, local app build, Vercel build, canonical HTTP 200, and no error or
  5xx logs after deployment.
- Deferred: an authenticated reproduction of the exact August 15 unassign flow;
  no authenticated preview session was available in this release turn.
- Blocked: none for release. The behavioral browser proof remains deferred.
- Proof artifacts: local verification output, Luna `SHIP` review, commit
  `5096815b`, Vercel build logs, deployment inspection, canonical HTTP check,
  and post-deploy runtime log queries.
- Next slice or stop: stop. Ask the reporter to retry removing themselves from
  the August 15 shift; capture authenticated evidence if the error persists.
