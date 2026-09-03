# Event Checkout Assignments Recovery Plan - 2026-09-03

> Product-direction note (2026-09-03): the migration recovery and deployment proof below remain historical truth. The proposed event-level/item-assignee behavior is superseded by `tasks/shared-travel-case-checkout-plan-2026-09-03.md`: travel-case/truck gear uses custodian-neutral shared custody, personally carried gear uses separate personal checkouts, and item-assignee columns remain dormant.

## Goal
- Ship additive event-owned checkout persistence without taking booking APIs ahead of the production database.
- Preserve the rollback until database compatibility and authenticated booking reads are proven.
- Restore the reservation quality-of-life release only after the additive migration is live and healthy.

## Contracts
- Keep `Booking.requesterUserId` required; event custody is an additive scope.
- Keep kiosk pickup, return, scan evidence, availability, allocations, and `sourceReservationId` authoritative.
- Assign only serialized booking items to people; bulk and numbered-family quantities remain event-shared by default.
- Do not merge completed checkouts, different locations, incompatible windows, or already-started custody.

## Ordered Release
- [x] Keep rollback `aa19dc8b` live while preparing the repair.
- [x] Restore exact applied migration history missing from `main`.
- [x] Add and validate migration `0141_event_checkout_assignments` on a temporary Neon branch.
- [x] Commit and deploy the additive schema/migration without the application feature bundle.
- [x] Verify production migration health and old-code booking compatibility.
- [x] Restore, verify, commit, and deploy the reservation web/iOS feature bundle.
- [ ] Run authenticated `/api/me`, iOS Home dashboard, and Bookings acceptance checks.
- [x] Preview Emma Hansen's exact records and mutate only if the shipped eligibility rules permit it.
- [x] Add a release guard for physical schema changes without migration SQL.

## Stop Conditions
- Stop if live migration history and local migration folders cannot be reconciled exactly.
- Stop if temporary-branch schema or old-code booking reads fail.
- Stop before production migration completion until the prepared SQL and branch proof are reviewed.
- Stop before Emma cleanup if requester, event set, location, window, booking kind, or lifecycle state differs.

## Proof
- Passed locally: Prisma format/validate and client generation, migration prefix check, 15 focused migration tests, 78 focused reservation tests, TypeScript, lint, app build, iOS drift/audit/project checks, an iPhone 16 Pro simulator build, docs verification, and `git diff --check`.
- Temporary Neon branch: all 297 existing bookings defaulted to `PERSON`; nullable assignee fields, indexes, foreign key, and representative booking reads passed. The rehearsal branch was deleted without applying production changes.
- Restored history: local checksums for `0139_football_game_day_roles` and `0140_varsity_season_ownership` exactly match the applied production rows.
- Production migration: Vercel applied only `0141_event_checkout_assignments`; post-deploy health reported 147/147 applied with no pending, failed, or database-only migrations. Both the primary and App Review deployments succeeded.
- Application deployment: commit `482ff29b` is Ready in primary deployment `dpl_5jVRPtbcMRyqxfQM44qbYFTJy7HD` and App Review deployment `dpl_CmjWMpjBaJx15eT6hd6bNFYqfDYr`.
- Authenticated production browser: Dashboard and Bookings rendered as the admin user with live booking rows and no console errors. Direct raw JSON route navigation was blocked by the browser surface, so exact `/api/me` and native iOS Home acceptance remain open.
- Emma Hansen: the two Florida records are completed checkouts with different normalized titles, pickup locations, and time windows. The merge stop conditions apply, so no production record was mutated.
- Release guard: CI now performs an offline Prisma schema diff against the base commit and requires migration SQL only when the diff contains physical DDL; 11 focused guard/prefix tests, TypeScript, and lint pass.
- Repository-wide test inventory: 4,205 tests passed and 29 unrelated source-contract tests failed; the focused reservation slice passed 78/78.
- Pending: direct authenticated `/api/me` and native iOS Home acceptance on a signed-in app/device.
