# Five Linked Events for Bookings Plan - 2026-08-24

## Goal

- Allow reservations and checkout records reached through shared creation, handoff, or relinking to retain up to five scheduled events while preserving the existing `Booking.eventId` primary-event and `BookingEvent` junction contracts. Direct kiosk entry remains the intentional single event-or-purpose custody path.

## Route

- Owner area: Reservations, shared with Checkouts, booking creation, drafts, relinking, and native reservation creation.
- Ledger: this active plan; no current plan owns the cap expansion.
- Scope: enforcement constants, shared service/API validation, web/native selection affordances, focused tests, and area documentation.

## Source Checks

- The source audit identified the old three-link cap in `bookings-lifecycle.ts`, `validation.ts`, `/api/drafts`, `WizardStep1`, `EditBookingEventsDialog`, and native `CreateBookingViewModel`.
- `BookingEvent` already supports ordered junction rows without a schema cardinality constraint; no migration is expected.
- `Booking.eventId` remains the chronologically primary event and all existing read paths remain unchanged.
- The current dirty worktree contains unrelated dashboard, settings, profile-completion, codemap, and iOS performance changes; those files are out of scope.

## Stop Conditions

- Stop if any source contract requires a database cardinality change or if five links cannot be represented by the existing junction model.
- Stop if the current API response, draft payload, or native request model does not carry an ordered `eventIds[]` list.
- Do not broaden dashboard/report grouping, post-creation window derivation, or booking lifecycle behavior beyond the requested cap expansion.

## Slices

- [x] Slice 1: Centralize the five-event limit and update shared service, validation, draft, web, native, and focused contract coverage.
- [x] Slice 2: Sync the brief, decisions, Events, Reservations, Checkouts, and Mobile area documentation with the new limit.

## Verification

- [x] Focused booking create, validation, relinking, draft, and iOS source-contract tests, including five accepted and six rejected event IDs: 121 tests passed across six files.
- [x] `npx tsc --noEmit --pretty false`
- [x] `npm run lint`
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`: codemaps were regenerated and the current maps pass the repository check.
- [x] `git diff --check`
- [ ] Authenticated browser smoke: no authenticated local runtime was available in this turn; source and build gates passed, and native UI proof is captured below.
- [x] iOS drift/source-contract coverage and the required iPhone 16 Pro / iOS 26.5 simulator build.
- [x] Matched native UI review capture: baseline and current picker states both passed on iPhone 16 Pro / iOS 26.5.

## Review

- Shipped: reservations and shared checkout handoff/relinking accept up to five linked events; sixth links remain rejected/disabled. Primary-event, junction, lifecycle, and direct kiosk custody contracts are unchanged.
- Verified: focused Vitest, adjacent web source suites, TypeScript, lint, build:app, iOS drift check, native build, and matched UI review.
- Deferred: authenticated browser smoke and live five-link interaction acceptance; the source, native review, and production deployment gates are complete.
- Blocked: none.
- Production deployment: `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE` from commit `c48dd43d`; public production smoke passed.
- Proof artifacts: `tasks/multi-event-five-cap-review-2026-08-24/index.html` and the matched PNGs in its `before/` and `after/` directories.
- Next slice or stop: stop implementation here; authenticated production booking interaction proof remains a separate acceptance pass.
