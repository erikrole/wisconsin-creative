# Event Checkout Assignments Recovery Plan - 2026-09-03

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
- [ ] Commit and deploy the additive schema/migration without the application feature bundle.
- [ ] Verify production migration health and old-code booking compatibility.
- [ ] Restore, verify, commit, and deploy the reservation web/iOS feature bundle.
- [ ] Run authenticated `/api/me`, iOS Home dashboard, and Bookings acceptance checks.
- [ ] Preview Emma Hansen's exact records and mutate only if the shipped eligibility rules permit it.
- [ ] Add a release guard for physical schema changes without migration SQL.

## Stop Conditions
- Stop if live migration history and local migration folders cannot be reconciled exactly.
- Stop if temporary-branch schema or old-code booking reads fail.
- Stop before production migration completion until the prepared SQL and branch proof are reviewed.
- Stop before Emma cleanup if requester, event set, location, window, booking kind, or lifecycle state differs.

## Proof
- Passed locally: Prisma format/validate and client generation, migration prefix check, 15 focused migration tests, TypeScript, lint, app build, docs verification, and `git diff --check`.
- Temporary Neon branch: all 297 existing bookings defaulted to `PERSON`; nullable assignee fields, indexes, foreign key, and representative booking reads passed. The rehearsal branch was deleted without applying production changes.
- Restored history: local checksums for `0139_football_game_day_roles` and `0140_varsity_season_ownership` exactly match the applied production rows.
- Pending: production migration health, iOS build, deployment status, authenticated API/native acceptance, and merge preview.
