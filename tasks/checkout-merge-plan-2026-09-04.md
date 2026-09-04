# Checkout merge plan — 2026-09-04

## User request

Allow staff to merge two or more accidental same-event checkouts, such as a
second checkout containing three batteries, while preserving custody and audit
history.

## Current source truth

- Reservation consolidation already exists at `/api/reservations/merge` and is
  limited to `BOOKED` reservations.
- Direct checkout creation remains kiosk-owned. The web checkouts list is the
  staff/admin read-and-repair surface.
- A checkout's physical custody, numbered bulk-unit allocations, stock
  movements, scan history, return activity, and reports are all keyed to the
  checkout booking.

## Bounded slice

1. Add an explicit staff/admin preview and merge mutation for 2–25 compatible
   `OPEN` checkouts.
2. Require the exact same event set, title, location, pickup/return window,
   source reservation, custody scope, and requester compatibility metadata.
   `SHARED` checkouts remain custodian-neutral; the required requester field is
   not presented or treated as the owner.
3. Reject missing event context, duplicate serialized assets, started/returned
   items, accountability exclusions, and non-open/completed checkouts.
4. Move custody-linked rows to the oldest checkout inside one `SERIALIZABLE`
   transaction, cancel only the now-empty source checkouts, and write before/
   after audit entries for the canonical and each source.
5. Add selection and confirmation to the staff/admin Checkouts list. Keep the
   existing reservation bulk actions unchanged.

## Explicit non-goals / stop conditions

- Do not auto-merge at checkout creation; physical custody needs an explicit,
  attributable repair decision.
- Do not merge completed, partially returned, different-event, different-person,
  different-location, or incompatible-window checkouts.
- Do not change kiosk checkout, pickup, return, or item-scan behavior.
- Stop before deployment or live authenticated acceptance unless those gates are
  explicitly requested and available.

## Verification

- Focused service, route-contract, and list-source tests.
- `git diff --check`, `npx tsc --noEmit --pretty false`, focused lint, and
  `npm run build:app`.
- Authenticated browser proof and the required before/after UI review page if
  the local runtime is available; otherwise report that gate separately.
- Sync `AREA_CHECKOUTS`, `GAPS_AND_RISKS`, task index/codemaps only for facts
  changed by this slice; do not overwrite concurrent documentation work.

## Verification status — 2026-09-04

- [x] Focused service, route, and UI/source-contract suite: 11 tests pass.
- [x] `npx tsc --noEmit --pretty false --incremental false` passes.
- [x] Targeted ESLint, full ESLint, `npm run build:app`, `npm run codemap:check`, and `git diff --check` pass.
- [x] Review page built at `tasks/checkout-merge-ui-review-2026-09-04/review.html`; it records why matched captures are unavailable rather than fabricating a before/after pair.
- [ ] Authenticated browser proof and controlled same-event fixture merge: blocked because the local environment has no `DATABASE_URL` or `DIRECT_URL`; production was not changed.
- [ ] Deployment and post-deploy custody/audit/kiosk read-back remain open under GAP-77.

The full repository suite was also attempted. 589 test files passed, but 33
existing worktree failures remain in unrelated iOS, schedule, availability,
reservation, and system-hardening areas; the checkout merge suite is green.
