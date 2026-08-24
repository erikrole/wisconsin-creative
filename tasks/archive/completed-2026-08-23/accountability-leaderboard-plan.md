# Accountability Leaderboard Plan - 2026-07-23

## Goal
- Give admins a trustworthy academic-year view of repeated late checkout behavior without weakening the custody ledger.

## Route
- Owner area: Reports and Analytics
- Secondary areas: Users, Bookings, web navigation
- Ledger: `tasks/archive/completed-2026-08-23/accountability-leaderboard-plan.md`
- Existing reference: `/reports/overdue` remains the live open-overdue operational queue.

## Source Checks
- `Booking.endsAt` is the due time; `completedAt` records completed checkout return.
- Extending a booking overwrites `Booking.endsAt`; the current audit entry preserves the prior due date but expires after 90 days.
- The current overdue report includes only `CHECKOUT` + `OPEN` rows past `endsAt`.
- D-040 requires checkout records to remain the active and historical custody ledger.
- Reports are currently STAFF/ADMIN; this new surface and its API must be ADMIN-only.
- The worktree contains unrelated Schedule, codemap, task-ledger, test, and resource changes that this slice must preserve.

## Stop Conditions
- Stop if completed checkout rows cannot provide a trustworthy completion timestamp.
- Stop if the migration chain is no longer contiguous after `0100`.
- Stop if an exclusion would require deleting or rewriting custody evidence.
- Stop if authenticated browser proof cannot distinguish ADMIN and STAFF sessions; record the blocked proof instead.

## Slices
- [x] Slice 1: Add a reversible, audited booking-accountability exclusion model and ADMIN-only permission.
- [x] Slice 2: Add an accountability service and ADMIN-only API for academic-year summaries, evidence, exclusion, and restoration.
- [x] Slice 3: Add the admin-only sidebar destination and accountability UI with filters, methodology, evidence expansion, and CSV export.
- [x] Slice 4: Add focused schema, service, route, permission, and UI source-contract tests.
- [x] Slice 5: Sync Reports, Risks, codemaps, and closeout evidence.
- [x] Slice 6: Persist due-date changes, backfill retained extension audits, and count extensions made after the prior due time as distinct accountability incidents.

## Verification
- [x] Focused accountability and adjacent report/search tests: 37 passed
- [x] `npx prisma validate`
- [x] `npm run db:migrate:check`
- [ ] `npx tsc --noEmit --pretty false` - blocked only by pre-existing strictness errors in badge tests; `npm run build:app` type checking passes.
- [x] Focused lint
- [x] `npm run codemap`
- [x] `npm run verify:docs`
- [x] `npm run build:app`
- [x] `npm run build` after migration deploy
- [x] `git diff --check`
- [x] Authenticated ADMIN browser smoke, plus STAFF denial proof - ADMIN navigation, live metrics, configured grace period, ranking, and expanded checkout evidence passed after migration deploy; STAFF denial is covered by route and search tests.

## Review
- Shipped: ADMIN-only accountability ranking, filters, evidence, CSV, reversible exclusions, audit trail, navigation, search discovery, schema migration, and docs.
- Verified: 37 focused/adjacent tests, Prisma validation, 103-migration prefix check, focused lint, app-only and deploy-shaped production builds, codemap/docs, whitespace, authenticated ADMIN live-data proof, and post-deploy Neon health.
- Deferred: Public endpoint and identity policy, timestamp correction, notifications, disciplinary thresholds.
- Blocked: Full standalone TypeScript remains blocked by unrelated badge-test strictness errors.
- Proof artifacts: `0101_accountability_exclusions` applied through the Neon HTTP fallback; migration health reports 103/103 applied with no pending, failed, or DB-only rows. The deploy-shaped build found no pending migrations and compiled all 207 pages. Authenticated browser proof showed one resolved 21-hour late return and expanded booking evidence under the configured 0.5-hour grace period.
- Next slice or stop: Stop. Exclusion mutation behavior is covered by focused route/service tests; no production record was changed for browser proof.

## Follow-up: overdue extensions
- Schema: add durable booking due-date-change evidence with booking and actor relations, cascade booking cleanup, actor `SetNull`, and indexes for booking history and time-window reporting.
- Migration: backfill bounded retained `booking/extended` audit rows without changing or depending on the 90-day audit retention policy.
- Mutation: write the due-date change in the same SERIALIZABLE transaction as `extendBooking`.
- Report: classify an extension as late when its change timestamp is after the prior due time plus the configured grace period. Preserve later late-return incidents as separate episodes.
- UI/API: expose `extended` as an incident state with prior due time, extension time, and new due time.
- Tests: cover transaction persistence, academic-year attribution, grace-period behavior, filtering, and source contracts.
- Deploy: migration `0102_booking_due_date_history` was explicitly approved and applied to Neon through the repository HTTP fallback.
- Recovery: `migrate dev` could not create its shadow-database workflow and direct PostgreSQL port 5432 was unavailable. After wrapper-backed health confirmed 103/103 live/local parity, Prisma generated `0102_booking_due_date_history` by diffing the pre-change and updated datamodels locally. The retained-audit backfill was then added to that new, unapplied migration.
- Verification: 29 focused accountability, extension, route, and discovery tests passed. Prisma validation, the 104-migration prefix check, focused lint, standalone TypeScript, codemaps/docs, and the 207-page app build passed.
- Deploy proof: post-deploy migration health reports 104/104 local migrations applied, with no pending, failed, or database-only rows. `0102_booking_due_date_history` is the newest applied migration.

## Follow-up: team-visible Accountability dashboard - 2026-08-23

### Goal
- Promote Accountability into the primary sidebar for every internal role and turn the existing report into a polished, lightly playful leaderboard people want to avoid.

### Route
- Owner area: Reports and Analytics
- Secondary areas: Users, web navigation, authorization
- Ledger: this plan
- Existing live queue: `/reports/overdue` remains the staff/admin operational view of gear that is out right now.

### Source Checks
- The existing `/accountability` route, API, sidebar entry, global-search entry, CSV export, and exclusion workflow are ADMIN-only.
- `getAccountabilityReport` already supplies the academic-year ranking, filter dimensions, incident evidence, and configured grace-period semantics needed by the new dashboard.
- Current product direction supersedes the older ADMIN-only read contract for internal users. `ADMIN`, `STAFF`, and `STUDENT` receive read access; `COLLABORATOR` remains default-deny under D-041 and does not inherit this internal cross-user view.
- The named leaderboard and expandable checkout evidence are the team-visible read model. CSV export, excluded-record metadata, exclusion notes, and exclusion/restore mutations remain ADMIN-only.
- The worktree contains unrelated Scoreboard, Reports, typography, iOS, globals, codemap, test, and task changes. This slice must not rewrite or revert them, including the existing edits to `/reports/overdue`.

### Stop Conditions
- Stop if non-admin reads cannot omit exclusion metadata and export without forking the custody/ranking calculation.
- Stop if the route would require adding `COLLABORATOR` to inherited role permissions or exposing collaborator-restricted cross-user booking history.
- Stop if the existing report response no longer contains stable incident, person, or ranking fields needed by the leaderboard.
- Record authenticated browser proof as blocked rather than substituting build output if no isolated signed-in runtime is available.

### Slices
- [x] Slice 7: Promote Accountability into primary internal navigation and global search; grant `accountability.view` to ADMIN, STAFF, and STUDENT while keeping collaborators denied.
- [x] Slice 8: Split the read payload by server-owned capability so Admin retains export and cleanup metadata/actions while Staff and Student receive the named read-only leaderboard only.
- [x] Slice 9: Replace the report-first presentation with a responsive top-three spotlight, full leaderboard, gentle jeer/all-clear copy, avatars, and reduced-motion-safe state transitions while retaining trustworthy filters and evidence.
- [x] Slice 10: Add focused RBAC, route-redaction, export-denial, navigation, search, and UI source-contract tests.
- [x] Slice 11: Complete web verification, matched before/after review proof, Reports-area sync, and closeout evidence.

### Verification
- [x] Focused Accountability, RBAC, sidebar, search, and UI contract tests
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused ESLint for touched source/tests
- [x] `npm run build:app`
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [x] Authenticated ADMIN and STUDENT browser smoke at desktop and tablet widths, including clean console/network and Admin-only control denial, or an exact blocker
- [x] Matched before/after captures and `gt-ui-review` page

### Review
- Shipped: Primary internal Accountability discovery; capability-split read API; responsive wrong-leaderboard spotlight with avatars, gentle jeers, all-clear copy, and reduced-motion-safe transitions; full expandable evidence; Admin-only export/exclusion controls; local Creative Admin smoke credentials.
- Verified: 57 focused tests; TypeScript; focused ESLint; codemap/docs; whitespace; 238-page app build; real Creative Admin login/page/API 200; authenticated Admin desktop/tablet render with zero horizontal overflow, no error overlay, and no console warnings/errors; Volume-to-Time motion and ranking change; matched HEAD/current captures at 1440x1000 and 1024x900.
- Deferred: Public/unauthenticated accountability publishing and any production deployment remain separate decisions/actions. The existing live Overdue report is unchanged.
- Blocked: No STUDENT browser smoke was run because the requested and available smoke identity is ADMIN; Student read access/redaction, CSV denial, and Collaborator denial are covered at route/RBAC level. The review Artifact publisher is not available in this tool set, so the built self-contained HTML remains a local workspace artifact.
- Proof artifacts: `tasks/accountability-leaderboard-review-2026-08-23/index.html` with matched captures and measured layout differences; ignored mode-600 `.env.smoke.local` for the Creative Admin smoke identity.
- Next slice or stop: Stop locally. The requested slice is complete; deployment and a dedicated Student smoke identity are optional follow-ups.

## Follow-up: shared jeer rotation - 2026-08-23

### Goal
- Replace the three fixed podium lines with a reviewed 50-line deck that gives every viewer the same three unique jeers and keeps them stable until the visible leaderboard meaningfully changes.

### Source Checks
- `AccountabilitySpotlight.tsx` currently derives one fixed line from rank and active-overdue state, so repeat visits always show the same copy.
- ADMIN, STAFF, and STUDENT receive the same ordered `leaderboard` rows; ADMIN-only capability and exclusion metadata do not need to participate in copy selection.
- The shared state can be derived without a write path: use ordered user ids, late-event counts, active-overdue counts, and last-incident timestamps as the leaderboard fingerprint. Exclude continuously increasing late-hour values unless they change the ranking order.
- The 50 reviewed lines are source-owned. No runtime model call, per-user seed, browser storage, or server-side mutation is needed.

### Stop Conditions
- Stop if the deck is not exactly 50 distinct, all-state-safe lines.
- Stop if identical leaderboard input can produce different copy across users, reloads, roles, or render environments.
- Stop if an unchanged leaderboard rotates because the current clock or a background refresh changed.

### Slices
- [x] Slice 12: Add the 50-line reviewed deck plus a deterministic seeded shuffle that deals three unique lines from the shared leaderboard fingerprint.
- [x] Slice 13: Pin deck size, uniqueness, fingerprint stability/sensitivity, visible wiring, and browser behavior; sync the Reports contract and review evidence.

### Verification
- [x] Focused jeer-deck and Accountability UI tests: 64 passed
- [x] `npx tsc --noEmit --pretty false`
- [x] Focused ESLint for touched source/tests
- [x] `npm run build:app`: 238 pages generated
- [x] `npm run codemap` and `npm run verify:docs`
- [x] `git diff --check`
- [x] Authenticated browser proof that reloads retain the same set and a leaderboard-sort change rotates to a distinct three-line set without console errors

### Review
- Shipped: A GPT-5.6 Luna Max-generated and reviewed 50-line source deck; deterministic server-side selection of three unique jeers from stable ordered leaderboard state; one shared API set for ADMIN, STAFF, and STUDENT; client rendering of the API-owned draw.
- Verified: 64 focused/adjacent tests; TypeScript; focused ESLint; codemap/docs; whitespace; 238-page app build; authenticated Admin desktop/tablet render; exact same Volume draw after reload; distinct Time-sort draw after the board reordered; original Volume draw restored; zero horizontal overflow and no console warnings/errors.
- Deferred: Production deployment remains a separate action. A never-revisit-across-all-future-board-states guarantee would require durable shared draw history; this slice guarantees 50 unique source lines and no duplicate within each visible set.
- Blocked: None for the requested behavior. STAFF/STUDENT set equality is pinned at the route contract rather than separate browser identities.
- Proof artifacts: `tasks/archive/proofs/accountability-jeer-rotation-2026-08-23/index.html`, matched 1440×1000 before/after captures, and a 1024×900 responsive after capture.
- Next slice or stop: Stop locally. The shared, sticky-until-board-change rotation is complete and deployment was not requested.
