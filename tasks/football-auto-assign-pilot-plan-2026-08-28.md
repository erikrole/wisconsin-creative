# Football Auto-Assign Pilot Plan - 2026-08-28

## Goal

- Establish the bounded operating contract for safe Schedule auto-assignment, beginning with the legacy per-event authority gap and sequencing Football as the first product pilot.
- Preserve the existing preview-first, review-first, working-copy, audit, and publication boundaries while leaving external sheet data and production data untouched.

## Route

- Owner area: Schedule / Shift Calendar & Scheduling
- Primary surfaces: `/schedule`, `/schedule/assign`, Shift Detail, and the Schedule auto-assignment APIs.
- Plan status: Active; Slices 1-4 are committed locally at `a40bad42`, Slice 5 and the bounded Auto assign/roster interface checkpoints are complete locally but uncommitted. Slice 6 still awaits its product decisions. Migration deployment, production proof, and later product-model work remain open.
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
- Slice 5 uses a code-owned Big Six set (`FB`, `MBB`, `WBB`, `MHKY`, `WHKY`, `VB`) while the operating model is piloted; every other canonical sport code is varsity. Durable ownership is independent from roster membership and applies only to Student scheduling-class users in `PHOTO`, `VIDEO`, or `GRAPHICS`.
- Multiple co-primary owners may overlap for one varsity sport/area. Ownership rows are immutable effective intervals with inclusive `startsOn` and `endsOn` dates; Admin handoff closes every active interval for the selected sport/area and creates the replacement rows atomically, preserving history rather than rewriting identities.
- Bulk assignment considers only current owners for a varsity Student slot in an owned coverage area. It deterministically chooses among eligible co-owners after the existing roster, travel, scheduling-class, area, availability, approved-time-off, conflict, and workload checks. If no current owner is eligible, the slot remains unproposed with an explicit owner-unavailable reason; the engine never silently falls back to another roster member.
- The bounded travel-readiness follow-up uses only the app's saved away staffing template and sport roster. The Football sheet was re-read as a read-only reference on 2026-08-29 and still resolves to the single visible `Sheet1!A1:M14` range; its position rows do not identify Schedule area or Staff/Student class and therefore cannot be used to calculate roster readiness.
- The ordinary sport-roster follow-up remains on the existing `StudentSportAssignment` authority. The current wizard already loads scheduling class and primary coverage area for every roster member, so a full-roster area/class overview and filters require no schema, API, or writer change.

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
- Stop Slice 5 before creating candidate openings, notification fanout, fallback assignment outside the current owner set, Big Six ownership, ownership outside Photo/Video/Graphics, non-Student owners, or a second schedule mutation/release boundary.
- Stop the roster-management follow-up before adding a second roster writer, changing travel eligibility, applying schedules, inferring missing areas, or turning immediate audited roster changes into unaudited client state. Bulk addition may use the existing permissioned and audited roster endpoint; removal must require explicit confirmation.
- Stop the bulk travel-roster follow-up before changing the accepted empty-travel-roster fallback, deriving event impact that the current read contract cannot prove, or fanning out client-side writes that could leave a partially updated travel roster. The existing roster route must remain the sole permissioned, validated, atomic, and audited writer.
- Stop the travel-readiness follow-up before treating template coverage as event-specific availability, inferring a Football position-to-area/class mapping, reading or writing the Football sheet from the app, or adding another roster writer. The panel is an advisory comparison of saved away minimums to the effective travel pool only.
- Stop the ordinary sport-roster follow-up before assigning a coverage area, inferring secondary-area eligibility, changing sport membership outside the existing audited roster endpoints, or treating roster composition as a live event assignment. This is an adjustment workspace for the full sport pool only.
- Stop Slice 3 before adding an apply route, durable import snapshot, assignment/working-copy mutation, Google write, fuzzy identity match, inferred event year, inferred blank-cell meaning, or interpretation of the literal `Role` row/cell.
- Stop before any external-sheet read, live import, migration deployment, production schedule mutation, notification send, or release action without separate explicit user authorization and a read-back plan.
- Preserve the pre-existing untracked `scripts/seed-sport-rosters.mjs`; never broaden staging, cleanup, or generated-file work around it.

## Implementation Slices

- [x] Slice 0: Create this active bounded plan and operating contract. No implementation, sheet import, seed, production mutation, or deployment.
- [x] Slice 1: Safely retired the legacy Shift Detail auto-assign path. Shift Detail keeps its Staff/Admin/read-only guard and hands staff back to Schedule; retained legacy endpoints are rate-limited permission-checked `410 Gone` tombstones, the direct-write service is removed, and regression coverage proves the canonical bulk/working-copy authority remains intact.
- [x] Slice 2: Built the Football role foundation. The exact Football-only position catalog is enum-backed assignment metadata carried through the existing versioned working-copy/release boundary, with an Admin-only validated role-selection command and audited before/after state. Shared positions and multi-position people are supported without overloading `ShiftArea` or adding coverage segments; existing generated area slots and role-less assignments remain compatible. No external sheet was read and no data was seeded or applied.
- [x] Slice 3: Add a preview-only Football reference-sheet parser/import review. Parse a pasted read-only snapshot of the pinned `Sheet1!A1:M14` source deterministically with A1 cell provenance; normalize the exact Football role rows; classify named-person, `Student`, dash, blank, slash-ambiguity, note/instruction, unknown, and literal-`Role` states; resolve only unique exact normalized active-visible User matches; and match only unique visible Football events by local date, normalized opponent, site, and explicit year when present. Expose an Admin-only, rate-limited Schedule review surface with categorized blockers and no apply action, database write, Google write, or coverage segment.
- [x] Slice 4: Added explicit Football apply and change handling. Apply re-runs the exact pasted source, requires matching source/review fingerprints, and accepts only explicit Admin selections backed by one exact event and one exact active-visible identity. Existing assignees may receive the reviewed role; new direct assignments require an explicitly selected compatible open working slot; an intentional dash clears only that role metadata from current holders. The result stages through the existing permissioned, validated, `SERIALIZABLE`, exact-version, audit, and timed-release working-copy boundary. Blocked Slice 3 states remain non-applicable and role eligibility is not inferred.
- [x] Slice 5: Added durable varsity season-primary ownership for multiple co-primary Students in Photo, Video, and Graphics. Effective handoff history, owner-first bulk preview, apply-time revalidation, and explicit no-fallback gaps preserve the existing roster/travel/class/availability/time-off/conflict/working-copy/audit boundaries without changing Big Six behavior.
- [x] Interface checkpoint: Refined the existing Auto assign dialog hierarchy, responsive layout, copy, and preview handoff without changing scope semantics, API payloads, preview/apply authority, permissions, rate limits, or data behavior. Authenticated Preview proof covered desktop and 390 px layouts without submitting preview/apply mutations.
- [x] Sport roster / travel roster interface checkpoint: Made the existing roster authority legible before preview and faster to operate without changing assignment policy or adding another writer. Sport setup now shows full-roster and travel-roster counts, explains whether away events use an explicit travel roster or fall back to the full roster, provides searchable All/Travel person rows with an explicit travel action, and surfaces travel readiness in the Auto assign sport summary. Immediate audited writes, permissions, the travel-subset rule, and away-only eligibility behavior are unchanged.
- [x] Sport roster management follow-up: Improved the existing Sport setup workspace without mockups by adding filtered multi-person roster addition, clearer person/area context, safer confirmed removal, and faster direct sport navigation. The UI reuses only the existing permissioned, audited roster endpoints; policy, travel eligibility, assignment behavior, schema, and migration state are unchanged.
- [x] Bulk travel-roster operations follow-up: Added explicit roster-row selection and one atomic Add to travel / Remove from travel action through the existing roster authority. Clearing every traveler requires confirmation and explains the full-roster fallback; individual travel toggles remain, permission/rate-limit/audit behavior is preserved, and missing-area rows route to the existing person profile rather than guessing an area. No unproven event-impact claims were added.
- [x] Travel readiness interface follow-up: Compared each sport's saved away Staff/Student area minimums with its effective travel pool, distinguished explicit-travel and full-roster-fallback modes, surfaced actionable area/class gaps inside Sport setup, and kept Football sheet positions in their separate review workflow. This read-only advisory does not schedule, import, or mutate roster/data state.
- [x] Full sport-roster coverage follow-up: Re-centered ordinary roster work around full-pool coverage by area and Staff/Student class, added direct class/area filters into the existing member rows, and kept travel as secondary metadata. The existing roster writers and profile links remain authoritative; eligibility and schedule state are unchanged.
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

### Slice 5

- [x] Added ownership schema and migration `0140` with effective intervals, co-owner support, creator/owner relations, and current-resolution indexes.
- [x] Added Admin-only, validated, rate-limited ownership read/handoff service and route with `SERIALIZABLE` audit ownership, overlap rejection, and historical interval closure.
- [x] Added the smallest Settings/Sports ownership workflow using existing shadcn and sport setup patterns; Big Six has no ownership control.
- [x] Made bulk preview deterministically owner-first for non-Big-Six Student Photo/Video/Graphics slots, report owner-unavailable without fallback, and preserve apply-time preview/fingerprint/working-copy revalidation.
- [x] Added focused classifier, interval, service/route, UI/source, bulk-preview/apply-revalidation, permission, audit, and migration tests.
- [x] Ran focused Vitest (76 tests), TypeScript, Prisma validate/format, migration checks (145 clean migrations), full lint, `build:app`, codemap/docs verification, and `git diff --check`.
- [ ] Authenticated browser and matched `gt-ui-review` proof were unavailable because the connected in-app browser had no open authenticated tab. No login, deployment, migration application, or data mutation was attempted.

### Interface checkpoint

- [x] Kept the dialog preview-first and retained the existing scope fields, roster context, full-crew guard, preview selection, cancellation window, and apply confirmation.
- [x] Improved the setup hierarchy and responsive wrapping using installed shadcn primitives and current Schedule design language; request bodies, endpoints, permissions, and lifecycle behavior are unchanged.
- [x] Added focused source/UI contracts for stable safety copy and controls; focused Vitest (21 tests), TypeScript, focused lint, `build:app`, docs/codemap checks, and `git diff --check` pass.
- [x] Captured matched authenticated before/after UI proof at desktop and a 390 px phone-width smoke without calling Build preview or Apply against Preview data. The review page is `/Users/role/.codex/visualizations/2026/08/29/01a04b3e-e16e-7991-bd91-3febf937bfa0/auto-assign-ui-review.html`.
- [x] Refined the setup into an explicit Scope → Review → Apply lifecycle, prioritized the safety checks, and made a built review collapse configuration to a compact scope summary with Change scope and Refresh review controls. Every endpoint, payload, policy, permission, and mutation boundary is unchanged; repeated matched desktop and 390 px proof without submitting Preview or Apply.
- [x] Added a bounded roster/travel follow-up: explicit counts and fallback state, searchable All/Travel views, labeled 40px travel actions, a wider desktop workspace, and a compact mobile footer. Auto assign now names the travel crew or fallback before preview.
- [x] Verified the roster/travel follow-up with focused Vitest (21 tests), TypeScript, full lint, `build:app`, codemap/docs checks, `git diff --check`, authenticated desktop rendering, search/filter interaction, and 390 px responsive proof. Verification did not submit a roster or schedule mutation.
- [x] Verified the roster-management follow-up with 27 focused source/UI tests covering bulk-add authority, picker filters/context, direct sport navigation, and confirmed removal; TypeScript, full lint, and `build:app` pass. Authenticated desktop and 390 px interaction proof exercised filtering, local selection, direct navigation, and a canceled removal without submitting a roster or schedule mutation.
- [x] Verified the bulk travel-roster follow-up with 44 focused service/route/source tests, TypeScript, focused and full lint, `build:app`, codemap/docs checks, `git diff --check`, authenticated desktop selection and final-traveler fallback confirmation, and 390 px no-overflow proof. The confirmation was canceled; no roster or schedule mutation was submitted during browser verification.
- [ ] A new matched `gt-ui-review` page remains unavailable for this follow-up because its exact before state is part of the preserved uncommitted interface checkpoint rather than a source-control baseline. Existing local work was not overwritten to reconstruct one. The authenticated after-state and interaction proof are current.
- [x] Verified the travel-readiness follow-up with 30 focused pure/source tests, TypeScript, focused and full lint, `build:app`, docs/codemap checks, `git diff --check`, and final diff review. The read-only Google source was rechecked at the metadata and exact-range layers only; no sheet/app/data write occurred.
- [ ] Authenticated desktop/mobile and matched `gt-ui-review` proof remain unavailable for this follow-up because the in-app browser's localhost URL policy blocked local-page control. The preview server is running for user review; no roster or schedule mutation was submitted.
- [x] Verified the full sport-roster coverage follow-up with 34 focused pure/source tests, TypeScript, focused and full lint, `build:app`, docs/codemap checks, `git diff --check`, and final diff review.
- [ ] Authenticated desktop/mobile proof remains blocked by the previously recorded in-app browser localhost policy. The preview server is running for user review; no roster or schedule mutation was submitted.

## Review

- Shipped: Slice 1 local hardening. Shift Detail no longer exposes or calls auto-assign; legacy preview/apply endpoints are permission-checked, rate-limited, and retired with `410 Gone`; the direct-write service is removed; Schedule bulk preview/apply remains canonical.
- Shipped locally: Slice 2 Football-only role foundation. Exact enum-backed assignment metadata is carried through the existing working-copy/release boundary, with Admin-only role mutation, audited before/after state, and quiet Football-only display. No sheet import, seed, or live apply is part of this slice.
- Shipped locally: Slice 3 preview-only Football sheet review against the pinned read-only source snapshot. The accepted route is paste-to-preview with exact cell provenance, exact identity/event resolution, and explicit blockers; no apply authority is included.
- Shipped locally: Slice 4 explicit reviewed apply/change handling. Exact named-person and intentional-dash outcomes can be staged only after fresh source/review fingerprint, event, identity, Football scope, slot, conflict, approved-time-off, working-version, and current-state checks; provenance remains in the existing working-copy audit and standard release boundary.
- Baseline: Slices 0-4 are committed locally at `a40bad42`; the post-commit worktree retained only unrelated `scripts/seed-sport-rosters.mjs`.
- Shipped locally: Slice 5 durable non-Big-Six varsity ownership. Multiple current Student owners per Photo, Video, or Graphics area are effective-dated and handed off with audited history; bulk preview/apply uses only current eligible owners and explicitly refuses roster fallback.
- Verified: Slice 5 focused Vitest (76 tests), TypeScript, Prisma validation, full lint, `build:app`, `npm run db:migrate:check` (145 clean migrations), `npm run codemap`, `npm run verify:docs`, `git diff --check`, and final source/path review pass. The pre-existing untracked `scripts/seed-sport-rosters.mjs` remains preserved.
- Interface checkpoints complete: the Auto assign dialog now guides Admins through Scope → Review → Apply, groups Events and Crew rules, names the eligibility checks before the primary action, uses a semantic complete-crew checkbox, and collapses configuration after review so proposals own the screen. Review assignments remains the only forward action before proposals exist, without changing the safe authority boundary.
- Roster interface complete locally: the selected-sport summary names travel readiness before preview, while Sport setup separates full and travel pools, states fallback behavior, supports search and travel-only filtering, and exposes explicit per-person travel controls without changing its audited immediate-save writer.
- Roster workflow follow-up complete locally: Admins can jump directly between sports, filter available people by Staff/Student and area, select several people before one audited bulk-add request, and review the exact consequence before removing a roster member.
- Bulk travel workflow complete locally: Admins can select visible roster members and update travel status in one serializable audited request; removing the last traveler requires an explicit full-roster-fallback confirmation, and missing areas lead to the person profile for correction.
- Travel readiness complete locally: Sport setup now shows whether the effective away pool covers each saved away Staff/Student area minimum and provides an area-focused recovery path. It states that event readiness is still determined later and keeps Football position rows entirely separate from the Schedule area/class model.
- Full roster coverage complete locally: ordinary sport membership now leads with a primary-area Staff/Student overview and explicit filters into the current member rows. Missing profile areas remain visible, travel remains secondary, and all membership changes still use the existing audited authority.
- Verified UI checkpoint: authenticated matched desktop before/after and 390 px smoke, no browser warnings, focused Vitest (21 tests), TypeScript, focused lint, `build:app`, codemap/docs verification, and `git diff --check` pass. Build preview and Apply were intentionally not submitted.
- Open gates: Preview-result runtime proof remains unavailable because the Preview database is behind preserved local migrations `0139` and `0140`; automated local visual proof is additionally blocked by the in-app browser localhost policy. Migration deployment, production read-back, notification delivery, and live release timing remain unclaimed under GAP-60.
- Deferred: Durable import snapshots, direct Google ingestion, role-specific travel/area eligibility, candidate openings, notifications, and operational rollout remain later slices. No live data was imported or seeded and the app did not write to the external sheet.
- Blocked: Slice 6 remains at its documented product-decision gate. Migration deployment and production read-back remain external proof gates and were not attempted in this checkpoint.
- Proof artifacts: `tasks/football-auto-assign-pilot-plan-2026-08-28.md`, the focused route/source-contract tests, current Schedule docs, and synchronized codemaps.
- Next slice or stop: Return to the unresolved Slice 6 candidate-opening product decision. Candidate openings, notifications, operational rollout, and every live-data operation remain deferred until separately authorized.
