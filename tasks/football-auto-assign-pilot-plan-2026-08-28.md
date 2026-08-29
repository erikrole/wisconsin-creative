# Football Auto-Assign Pilot Plan - 2026-08-28

## Goal

- Establish the bounded operating contract for safe Schedule auto-assignment, beginning with the legacy per-event authority gap and sequencing Football as the first product pilot.
- Preserve the existing preview-first, review-first, working-copy, audit, and publication boundaries while leaving external sheet data and production data untouched.

## Route

- Owner area: Schedule / Shift Calendar & Scheduling
- Primary surfaces: `/schedule`, `/schedule/assign`, Shift Detail, and the Schedule auto-assignment APIs.
- Plan status: Active; Slices 1-4 are implemented and verified locally. Authenticated runtime, migration deployment, production proof, and later product-model work remain open.
- Ledger destination: this new root active plan. No existing task ledger or completed plan is rewritten in Slice 0.
- Existing references: `docs/AREA_SHIFTS.md`, `docs/BRIEF_STUDENT_AVAILABILITY_V1.md`, `docs/DECISIONS.md` (D-006, D-007, D-042, D-046, D-055), `docs/GAPS_AND_RISKS.md`, `tasks/event-shift-working-schedule-plan.md`, `tasks/bulk-event-assignment-plan.md`, and `tasks/api-hardening-schedule-assign.md`.

## Source Checks

- The current bulk path is the accepted safe boundary: `AutoAssignDialog` calls `/api/schedule/bulk-assignment/preview` and `/api/schedule/bulk-assignment/apply`; the apply service re-reads scope and policy, validates candidates, stages a versioned working copy, uses `SERIALIZABLE`, and records audit evidence. Sources: `src/components/schedule/AutoAssignDialog.tsx`, `src/app/api/schedule/bulk-assignment/preview/route.ts`, `src/app/api/schedule/bulk-assignment/apply/route.ts`, and `src/lib/services/bulk-schedule-assignment.ts`.
- Before Slice 1, the Shift Detail path called `/api/shift-groups/[id]/auto-assign/preview` and `/api/shift-groups/[id]/auto-assign`; its legacy service wrote `ShiftAssignment` rows directly after a limited active-assignment check and did not share the bulk working-copy/fingerprint/revalidation/audit boundary. Sources: the pre-slice audit and the pre-slice files `src/components/ShiftDetailPanel.tsx`, `src/app/api/shift-groups/[id]/auto-assign/preview/route.ts`, `src/app/api/shift-groups/[id]/auto-assign/route.ts`, and `src/lib/services/auto-assign.ts`.
- Slice 1 removes those Shift Detail calls and direct-write service. The retained compatibility endpoints authenticate, enforce `shift.manage`, rate limit reads and writes, and return `410 Gone` without touching schedule state. The Schedule bulk preview/apply routes remain the only auto-assign authority.
- D-046 makes the versioned working copy, exact-version durable release, atomic reconciliation, consolidated notification, and past-event silent backfill the authoritative Schedule mutation model. D-055 keeps student claims approval-first and separate from staff auto-assignment.
- Current policy data seeds the Big Six partially: Football is `HOLD`; men's and women's basketball, men's and women's hockey, and Volleyball are `STAFF_ONLY`. All 23 sports still share one code list, and an unconfigured sport defaults to `FULL_CREW`. Sources: `prisma/migrations/0138_sport_auto_assign_policy/migration.sql`, `src/lib/sports.ts`, and `src/lib/sport-auto-assign-policy.ts`.
- Current Schedule models represent areas, Staff/Student staffing class, sport rosters, default travelers, shifts, assignments, and availability, but do not yet represent Football positions, semester/season primary ownership, or a durable candidate-opening lifecycle. Source: `prisma/schema.prisma` (`SportConfig`, `SportShiftConfig`, `Shift`, `ShiftAssignment`, `StudentSportAssignment`, `StudentAreaAssignment`, and `StudentAvailabilityBlock`).
- Slice 2 adds `ShiftAssignment.footballRoles` through migration `0139` while keeping `ShiftGroupWorkingCopy.payload` as the private draft boundary. `schedule-working-copy.ts` validates and audits the Admin-only role command in its existing `SERIALIZABLE` transaction, and `schedule-publication.ts` revalidates Football scope before reconciling role metadata onto live assignments.
- Existing availability is advisory for ordinary class/preference signals and blocking for approved time off; auto-fill exposes skip reasons rather than creating a replacement opportunity. Sources: `docs/BRIEF_STUDENT_AVAILABILITY_V1.md`, `src/lib/services/auto-fill-preview.ts`, and `src/lib/services/candidate-scoring.ts`.
- Existing Open Work supports published open Student shifts, competing `REQUESTED` claims, Admin approval, serializable revalidation, audit, and deadline-driven review. It is not yet a lifecycle for a season owner's vacancy. Sources: `src/lib/services/schedule-open-work.ts`, `src/lib/services/shift-assignments.ts`, `src/lib/claim-review-deadlines.ts`, and `src/workflows/pending-claim-review.ts`.
- The repository has no Football position catalog or external Football-sheet importer. The preserved untracked `scripts/seed-sport-rosters.mjs` is a dry-run/create-only JSON roster tool and is not a sheet importer or a live-data instruction.
- Slice 3 source evidence is the read-only Google Sheet `1BrASYKR3XZyE4_Hm6DiHTWIPZwP7NUv8iEuDmncZsZQ`, visible tab `Sheet1`, exact range `A1:M14` (14 rows, 13 columns). The app does not have an accepted server-owned Google credential/import contract, so the bounded preview surface accepts a pasted tab-separated snapshot while pinning that exact source identity and returning cell-level A1 provenance; it never writes to the sheet.
- The source contains date-plus-opponent column headers without a guaranteed year. Event resolution may use exact normalized opponent, local calendar date, and home/away evidence only; zero or multiple visible Football matches remain explicit review outcomes. Active visible users are exact normalized-name candidates only, with duplicates reported as ambiguous and no fuzzy guessing.
- Slice 4 reuses the existing working-copy service rather than creating a second assignment authority. That service already owns exact working-version checks, `SERIALIZABLE` mutation, active-user and scheduling-class validation, conflict and approved-time-off revalidation, Football-only role validation, unique working-copy conflict handling, audit, and timed release.
- The sheet does not identify a Schedule area or Staff/Student slot. A named direct-assignment candidate therefore requires the Admin to choose one exact existing open working slot; Slice 4 never infers a role-to-area or role-to-worker-class mapping. A named person already assigned to the matched event can receive the reviewed role on that assignment. An intentional dash can only remove that role metadata from current holders; it never removes a person or shift.

## Product Contract

### Sport operating model

- Big Six means Football, men's basketball, women's basketball, men's hockey, women's hockey, and Volleyball.
- Big Six coverage is generally student request-pool-driven with Admin approval. Admins may directly assign known people when appropriate.
- Other varsity sports are season-primary coverage: named student owner(s) cover photo, video, and graphics across a semester or season.
- A class conflict or approved time off for a varsity owner must become visible student opportunity work that requires Admin approval, with pending, released, and approved outcomes and explicit decision deadlines. It must not remain a hidden unassigned gap.

### Football pilot

- Football-only positions are exactly `SLOW1`, `SLOW2`, `BENCH`, `ROAM1`, `ROAM2`, `ROAM3`, `ROAM4`, `PHOTO1`, `PHOTO2`, `PHOTO3`, `PHOTO4`, and `SOCIAL`.
- Positions are metadata on a person's shift and render as a quiet subline. One person may carry multiple positions at one game, and one position may have multiple people.
- Slice one must not introduce coverage segments.
- The external Football sheet is a reference/import source, not a live seed. Named people are candidate direct assignments; `Student` is a student opportunity; a dash is intentionally unstaffed; slash-separated names remain deferred ambiguous alternatives; the literal `Role` cell meaning is unresolved until a user decision is recorded.
- Preview/import must preserve source rows and provenance, resolve exact User identity, and leave unknown or ambiguous names reviewable. No live apply occurs without explicit approval.

## Stop Conditions

- Slice 0 stopped at this plan artifact; no sheet import, seed, production data, or deployment operation is part of Slice 1.
- Stop Slice 1 if any Shift Detail or retained legacy endpoint can still reach a schedule mutation outside the canonical bulk preview/working-copy boundary.
- Stop future implementation if any Shift Detail mutation can still bypass the canonical bulk/working-copy safety boundary, or if routing it there would require a second competing mutation contract.
- Stop before changing a shared API response shape that could break native Codable consumers; use an additive or shape-preserving rollout.
- Stop before a schema or migration decision is needed but the role multiplicity, Football-only namespace, season/effective-date scope, or opening lifecycle is unresolved. Slice 2 resolves only the first-release Football role catalog and assignment metadata shape; season/effective-date and opening lifecycle remain future decisions.
- Stop before applying any sheet row when identity is unknown or ambiguous, the `Role` cell semantics are unresolved, or a slash-separated alternative would be silently chosen.
- Stop Slice 4 before applying `Student`, blank, note/instruction, unknown/duplicate identity, slash-alternative, literal-`Role`, invalid event, or ambiguous event outcomes. Those remain review-only.
- Stop Slice 4 before inferring a Football role's Schedule area, worker class, travel eligibility, or other role-specific eligibility. An Admin must select an exact compatible open slot, while existing assignment validation remains authoritative.
- Stop Slice 4 before creating durable import snapshots, a second mutation model, role-specific vacancy schema, assignment segments, direct Google reads/writes, or any synchronous worker notification outside the existing working-copy release contract.
- Stop Slice 3 before adding an apply route, durable import snapshot, assignment/working-copy mutation, Google write, fuzzy identity match, inferred event year, inferred blank-cell meaning, or interpretation of the literal `Role` row/cell.
- Stop before any external-sheet read, live import, migration deployment, production schedule mutation, notification send, or release action without separate explicit user authorization and a read-back plan.
- Preserve the pre-existing untracked `scripts/seed-sport-rosters.mjs`; never broaden staging, cleanup, or generated-file work around it.

## Implementation Slices

- [x] Slice 0: Create this active bounded plan and operating contract. No implementation, sheet import, seed, production mutation, or deployment.
- [x] Slice 1: Safely retired the legacy Shift Detail auto-assign path. Shift Detail keeps its Staff/Admin/read-only guard and hands staff back to Schedule; retained legacy endpoints are rate-limited permission-checked `410 Gone` tombstones, the direct-write service is removed, and regression coverage proves the canonical bulk/working-copy authority remains intact.
- [x] Slice 2: Built the Football role foundation. The exact Football-only position catalog is enum-backed assignment metadata carried through the existing versioned working-copy/release boundary, with an Admin-only validated role-selection command and audited before/after state. Shared positions and multi-position people are supported without overloading `ShiftArea` or adding coverage segments; existing generated area slots and role-less assignments remain compatible. No external sheet was read and no data was seeded or applied.
- [x] Slice 3: Add a preview-only Football reference-sheet parser/import review. Parse a pasted read-only snapshot of the pinned `Sheet1!A1:M14` source deterministically with A1 cell provenance; normalize the exact Football role rows; classify named-person, `Student`, dash, blank, slash-ambiguity, note/instruction, unknown, and literal-`Role` states; resolve only unique exact normalized active-visible User matches; and match only unique visible Football events by local date, normalized opponent, site, and explicit year when present. Expose an Admin-only, rate-limited Schedule review surface with categorized blockers and no apply action, database write, Google write, or coverage segment.
- [x] Slice 4: Added explicit Football apply and change handling. Apply re-runs the exact pasted source, requires matching source/review fingerprints, and accepts only explicit Admin selections backed by one exact event and one exact active-visible identity. Existing assignees may receive the reviewed role; new direct assignments require an explicitly selected compatible open working slot; an intentional dash clears only that role metadata from current holders. The result stages through the existing permissioned, validated, `SERIALIZABLE`, exact-version, audit, and timed-release working-copy boundary. Blocked Slice 3 states remain non-applicable and role eligibility is not inferred.
- [ ] Slice 5: Add varsity season-primary ownership. Define sport/area ownership, semester/season effective windows, backups, handoffs, class conflicts, approved time off, and direct-admin override semantics without changing Big Six request-pool behavior.
- [ ] Slice 6: Add the candidate-opening lifecycle. Turn eligible varsity owner gaps into visible Student opportunities with candidate-pool rules, Admin queue ownership, pending/released/approved/declined/expired outcomes, decision deadlines, escalation, and safe terminal behavior.
- [ ] Slice 7: Operational rollout. Reconcile Big Six/varsity policy classification, travel roster authority, role eligibility, user identity mapping, notification/read-back behavior, authenticated runtime proof, deployment, and production adoption only after the earlier slices are independently verified.

## Decisions Required Before Future Implementation

- Classification: whether Big Six/varsity is a persisted classification or a maintained policy map; defaults for every other varsity sport; and whether Football remains `HOLD` until the pilot is live.
- Authority: whether Shift Detail is retained as a handoff into the bulk preview or removed until a functional equivalent exists; which route owns preview, apply, release, and audit.
- Football roles resolved for Slice 2: enum-backed assignment arrays use the exact catalog in stable catalog order; multiple roles per person and shared holders are allowed; quiet subline copy and Football-only enforcement are implemented; coverage segments remain out of scope. Eligibility and role-change notification semantics remain Slice 4/7 decisions.
- Sheet semantics: what the literal `Role` cell means, whether slash alternatives can ever be resolved in-app, and the exact direct-assignment versus opportunity treatment for each source state.
- Identity and provenance: exact normalized-name matching, unknown/ambiguous review, source snapshot retention, reviewer ownership, and how a later sheet revision changes an already reviewed assignment.
- Varsity ownership: one or multiple primary owners per sport/area, season versus semester boundaries, backups, effective dates, handoff, owner unavailability, and staff/admin override policy.
- Openings: whether a vacancy is a new Student shift, a separate opportunity linked to a shift/role, or both; candidate-pool membership; Admin queue ownership; terminal outcomes; deadlines; escalation; and whether a pending opening affects published coverage.
- Travel and eligibility: whether sport default travelers, event travel members, or a merged precedence rule govern away-game role eligibility; how Staff, Student, collaborator, area, and role eligibility interact.
- Release and notification: how role changes and approved opportunities enter the existing private ten-minute release, past-event backfill, audit, and consolidated-notification contract.

## Verification Gates

### Slice 0

- [x] Read `AGENTS.md`, `docs/NORTH_STAR.md`, `tasks/README.md`, `tasks/INDEX.md`, `tasks/todo.md`, `tasks/lessons.md`, `docs/AREA_SHIFTS.md`, `docs/BRIEF_STUDENT_AVAILABILITY_V1.md`, `docs/DECISIONS.md`, `docs/GAPS_AND_RISKS.md`, relevant Schedule plans, current routes/services/components, schema references, and current focused tests.
- [x] Confirm `git diff --check` and a reference/path sweep after creating this plan.
- [x] At Slice 0 close, the worktree showed this single new plan plus the pre-existing untracked roster-seed script, with no source/schema/test/data changes.

### Slice 1

- [x] Focused route/service/source-contract tests cover authentication, `shift.manage`, rate limits on legacy and canonical preview/apply routes, no legacy bypass, live fingerprint/working-copy revalidation, SERIALIZABLE staging, exact release version, audit ownership, and safe retirement responses: 40 tests pass.
- [x] `npx tsc --noEmit --pretty false`, focused ESLint, full `npm run lint`, and `npm run build:app` pass locally.
- [x] No schema or migration work is part of Slice 1; `npm run db:migrate:check` passes, and the migration-capable `npm run build` remains intentionally out of scope.
- [x] Ran `npm run codemap` and `npm run verify:docs`; codemaps are current.
- [ ] Authenticated browser proof for Schedule, Shift Detail handoff/preview, Event detail, and Open Work as applicable; builds and source tests do not substitute for this gate.
- [ ] Matched `gt-ui-review` captures for the Shift Detail surface; no authenticated browser tab/session was available in this task, so no visual claim is made.
- [ ] Keep deployment, production read-back, notification delivery, external-sheet access, live import, and physical/native acceptance as separate explicitly reported gates.

### Later web/API and rollout slices

- [ ] Re-run the relevant API/schema, authenticated browser, deployment, production read-back, notification, external-sheet, live-import, and physical/native gates for Slices 2-7.

### Slice 2

- [x] Confirm the Prisma enum and nullable-safe/default-empty assignment representation with create-only migration `0139`; existing assignments remain valid without roles. The migration was generated offline from the schema diff because the historical chain cannot shadow-replay from migration `0001`; no database connection was used.
- [x] Confirm the working-copy payload and command schema reject duplicate/unknown role labels, reject non-Football role mutation, and preserve the existing `SERIALIZABLE`, exact-version, ten-minute release, and audit boundary.
- [x] Confirm only Admins can select or mutate Football roles; Staff can still manage ordinary crew through the existing Schedule permission while seeing role metadata where authorized.
- [x] Confirm Football roles render as a quiet subline in expanded crew/event surfaces, with a subtle Admin-only Add/Edit role affordance and no role controls/labels in non-Football or collapsed default schedule surfaces.
- [x] Focused role/schema/working-copy/publication/UI verification passes (77 tests), along with TypeScript, focused/full lint, `npm run build:app`, Prisma validation, `npm run db:migrate:check` (144 clean migrations), docs/codemap verification, and `git diff --check`.
- [ ] Authenticated browser and matched UI-review proof remain separate gates; report unavailable sessions honestly. No deployment, production read-back, notification-delivery, sheet, seed, or live-import proof is claimed in Slice 2.

### Slice 3

- [x] Confirm the parser requires the pinned Football source identity and exact 14-by-13 snapshot, maps only the accepted role labels, and returns deterministic A1 source provenance for every header, role row, and staffing cell.
- [x] Confirm `Student`, dash, blank, slash alternatives, literal `Role`, notes/instructions, unknown names, duplicate exact names, and missing/ambiguous events remain distinct review outcomes with no fuzzy or inferred resolution.
- [x] Confirm event matching is Football-only and requires a unique local date/opponent/site match; a missing year may resolve only when one visible candidate exists and otherwise remains blocking.
- [x] Confirm only Admins can call or open the rate-limited preview, and source/service tests prove the path contains no create/update/delete/upsert/transaction/audit/import-apply call.
- [x] Run focused parser/identity/event/provenance/route/UI tests, TypeScript, Prisma validation, full lint, `npm run build:app`, `npm run db:migrate:check`, docs/codemap verification, `git diff --check`, and final diff review.
- [ ] Authenticated browser/UI-review proof remains a separate gate. No assignment apply, sheet write, durable import, migration deployment, seed, shared-database mutation, notification, or production proof is claimed in Slice 3.

### Slice 4

- [x] Confirm preview returns deterministic source and review fingerprints plus explicit apply options for exact matched events/users without persisting a snapshot.
- [x] Confirm apply re-runs the parser/resolvers, rejects fingerprint drift and every blocked source state, and revalidates exact event, active-visible user, selected working slot, Football role, and expected working version.
- [x] Confirm existing-assignment role merges, explicit open-slot assignment plus role, and explicit intentional-role vacancy clearing all use the existing `SERIALIZABLE` working-copy transaction, audit ownership, unique-conflict handling, and timed release or silent past-event backfill.
- [x] Confirm the Admin-only, rate-limited UI requires an explicit per-row stage action and exact slot selection when needed, contains no Google read/write, and cannot apply `Student`, blank, literal `Role`, notes, slash alternatives, unknown/duplicate identities, or ambiguous events.
- [x] Focused parser/fingerprint/service/route/UI/working-copy/publication verification passes (172 tests), along with TypeScript, Prisma validation, full lint, `npm run build:app`, `npm run db:migrate:check` (144 clean migrations), docs/codemap verification, `git diff --check`, and final diff review.
- [ ] Run authenticated browser and matched `gt-ui-review` proof only if a valid authenticated session exists. No sheet write, durable import, migration deployment, seed, shared/production database mutation, notification delivery, or deployment proof is part of Slice 4.

## Review

- Shipped: Slice 1 local hardening. Shift Detail no longer exposes or calls auto-assign; legacy preview/apply endpoints are permission-checked, rate-limited, and retired with `410 Gone`; the direct-write service is removed; Schedule bulk preview/apply remains canonical.
- Shipped locally: Slice 2 Football-only role foundation. Exact enum-backed assignment metadata is carried through the existing working-copy/release boundary, with Admin-only role mutation, audited before/after state, and quiet Football-only display. No sheet import, seed, or live apply is part of this slice.
- Shipped locally: Slice 3 preview-only Football sheet review against the pinned read-only source snapshot. The accepted route is paste-to-preview with exact cell provenance, exact identity/event resolution, and explicit blockers; no apply authority is included.
- Shipped locally: Slice 4 explicit reviewed apply/change handling. Exact named-person and intentional-dash outcomes can be staged only after fresh source/review fingerprint, event, identity, Football scope, slot, conflict, approved-time-off, working-version, and current-state checks; provenance remains in the existing working-copy audit and standard release boundary.
- Verified: Slice 4 and inherited auto-assign/role focused Vitest (172 tests), TypeScript, Prisma validation, full lint, `build:app`, `npm run db:migrate:check`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and final source/path review pass. The pre-existing untracked `scripts/seed-sport-rosters.mjs` and Slice 0-3 work remain preserved.
- Open gates: Authenticated browser proof and matched UI review are unavailable because the connected browser had no open authenticated tabs/session. Deployment, production read-back, notification delivery, and live release timing remain unclaimed under GAP-60.
- Deferred: Durable import snapshots, direct Google ingestion, role-specific travel/area eligibility, varsity ownership, candidate openings, and operational rollout remain later slices. No live data was imported or seeded and the app did not write to the external sheet.
- Blocked: No implementation blocker. Authenticated browser/UI-review, migration deployment, and production read-back remain external proof gates and were not attempted in this slice.
- Proof artifacts: `tasks/football-auto-assign-pilot-plan-2026-08-28.md`, the focused route/source-contract tests, current Schedule docs, and synchronized codemaps.
- Next slice or stop: Stop after Slice 4. Role-specific eligibility, notifications, durable import, varsity ownership, candidate openings, and every live-data operation remain deferred to separately authorized later work.
