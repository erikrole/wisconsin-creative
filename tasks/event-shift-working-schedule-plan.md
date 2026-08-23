# Event Shift Working Schedule Plan

Status: Active
Owner area: Schedule
Started: 2026-07-21

## Outcome

Make the main web Schedule the event triage, crew-setup, and day-to-day crew-management surface, with Home, Away, and empty crew setup available from each staff event row. Schedule and Event detail both call the same staff/admin working-copy crew editor for assignment, removal, worker-class conversion, replacement, slot, call-window, and timed-release management; Schedule uses its compact presentation while Event detail adds deeper event, gear, and history context. Pending edits stay private and quiet until ten minutes have passed without another edit; then the newest version releases automatically to worker-facing Schedule reads and sends one consolidated notification. Existing iOS clients continue reading the last released schedule while current web and native staff surfaces expose the timer and recovery state without manual Draft or Publish actions.

## Product contract

> Superseding direction accepted 2026-08-07: the timed-release contract below replaces the earlier deliberate manual-publish contract wherever they conflict. D-046 records the accepted architecture; D-042 remains historical context for the staging data model.

- Web Schedule is the high-volume event triage, setup, and compact crew-management surface. Multiple events may stay expanded for day-to-day crew edits; Event detail keeps the same editor with deeper event context.
- Staff choose a Home, Away, or empty crew template from the Schedule event-row overflow menu. Once a group exists, Manage crew opens the shared compact editor in the expanded row, while Open Event detail remains available for deeper context.
- Staff/admin assignment, removal, conversion, replacement, slot, call-window, timed-release, and revert actions use one shared working-copy editor from both Schedule and Event detail. The compact and detail presentations must not introduce separate mutation paths.
- The last released relational schedule remains the worker-facing source for My Shifts, Dashboard, ICS, Open Work, Trade Board, collaborator Schedule, and existing iOS clients.
- Every staff edit writes a versioned pending copy and pre-enqueues a durable ten-minute release. Another edit creates a newer version and restarts the quiet period; an older workflow must no-op when it wakes.
- Automatic release validates and reconciles the newest pending copy atomically, increments the released version, and sends at most one event summary per affected worker. A permanent validation blocker becomes visible recovery state rather than an indefinitely silent pending copy.
- Draft, Publish, Republish, Discard draft, and Unacknowledged are retired as active product concepts. Pending changes may be reverted before release. Historical publication and acknowledgement fields remain for compatibility and audit history.
- Staff and Student are scheduling classes from `User.staffingType`, not permission roles.
- Active collaborators with published-Schedule access may be assigned to Staff slots. They do not participate in Student availability, open-work pickup, or Trade Board workflows.
- Only Student slots and Student assignments have call times. Staff and collaborator coverage does not expose a call-time value, event-time substitute, label, or editor; staff are expected to know when they need to arrive.
- An assigned slot cannot be converted to a class that conflicts with its assignee without an explicit replace or unassign choice. Active trades must be resolved explicitly.
- Every eligible future event receives configured default shifts. Home events use their sport Home template; Away and neutral-site games with an opponent use the sport Away template; events without an opponent use the Settings-owned Non-game template. Cancelled, hidden, and archived events are excluded.
- Default staffing changes apply to newly generated schedules and conservatively rebase upcoming pending or released schedules. Assigned and manually touched slots remain protected.
- An explicit event-level Student call-time action can set one shared window across Student slots, clearing Student personal overrides while keeping the change private until timed release. Staff and collaborator slots retain event-window storage for integrity but expose no call-time value or event-time substitute.

## Slices

### 1. Lifecycle decision and persistence foundation

- [x] Record the accepted working-copy/publication decision.
- [x] Add published and working version metadata plus one validated JSON working copy per shift group.
- [x] Add the incremental Prisma migration and schema contract tests.
- [x] Preserve current published read behavior while the additive editor service is wired.

### 2. Working-copy service and API

- [x] Define the server-owned working crew payload and Zod validation.
- [x] Materialize a working copy from the last published/live schedule on first edit.
- [x] Add Staff/Student slot count, convert, assign, unassign, call-window, discard, diff-preview, and publish operations.
- [x] Require `shift.manage`, rate-limit mutations, use `SERIALIZABLE`, enforce optimistic working-version checks, and write before/after audit entries.
- [x] Keep draft operations notification-free.

### 3. Publish reconciliation

- [x] Reconcile the working copy into relational shifts and assignments atomically.
- [x] Preserve stable IDs and booking/trade history where possible; block destructive ambiguity for active trades or linked bookings.
- [ ] Reset acknowledgements only for changed worker-visible assignments.
- [x] Bundle publish delivery to one event summary per affected worker and make retry dedupe version-based.
- [x] Confirm My Shifts, Dashboard, ICS, Open Work, Trade Board, collaborator Schedule, and old iOS clients remain published-only.

### 4. Schedule triage and setup surface

- [x] Allow multiple expanded events.
- [x] Keep event rows grouped by date with coverage, crew summary, and row-level setup/manage actions.
- [x] Keep Home, Away, and empty crew setup in the staff Schedule row overflow menu.
- [x] Render the same versioned working-copy editor in a compact expanded Schedule row for day-to-day assignment, replacement, slot, call-window, timed-release, and revert actions.
- [x] Keep the compact Schedule editor and deeper Event detail editor on one shared component and command path.
- [ ] Verify the authenticated desktop route and narrow responsive behavior.

### 5. Default staffing hardening

- [x] Buffer edits per sport with explicit Save and Discard.
- [x] Replace the ten-column matrix with compact area rows and Home/Away totals.
- [x] Remove silent one-Student-per-area activation defaults.
- [x] Handle Neutral and Non-game events explicitly instead of silently treating unknown venue class as Home.
- [x] Automatically rebase eligible upcoming unpublished schedules after default saves, using generated-slot provenance to add, remove, or retime only safe openings.
- [x] Count occupied and manually touched slots toward the new target without removing or converting them.
- [x] Skip published schedules and active working copies so they remain deliberate review/publish changes.

### 6. Native iOS compatibility and quick actions

- [x] Keep existing models tolerant of additive publication metadata.
- [x] Keep student and old-client reads on the published schedule.
- [x] Add staff working-copy reads and the bounded quick actions appropriate on iPhone.
- [x] Keep bulk defaults, full diff review, and repair workflows web-only.
- [x] Run the affected source-contract tests, project consistency check, and Wisconsin simulator target build; authenticated device/runtime proof remains a rollout gate.

### 7. Local runtime recovery and explicit crew setup

- [x] Accept `localhost`, IPv4 loopback, and IPv6 loopback aliases on the same port for development-only CSRF checks while preserving strict production origin matching.
- [x] Make Set up crew use the saved Home/Away sport template for classified games and ask which template to use for Neutral or Non-game events.
- [x] Keep Start empty available when an event needs a fully custom crew.
- [x] Apply migration `0099_shift_group_working_copy`, verify Neon migration health, and prove authenticated Event detail and expanded Schedule behavior against the migrated runtime.

### 8. Draft assignment identity rehydration

- [x] Return a minimal assigned-user projection for every user referenced by the effective working schedule, including draft-only assignees outside the current picker page.
- [x] Resolve refreshed crew rows from that server-owned projection before falling back to published entry data or the active picker result.
- [x] Keep the stored working payload ID-only so user names and avatars remain current and are not duplicated into draft JSON.
- [x] Prove Ashley and Maddy remain named after refresh without publishing, with focused service/source tests and authenticated browser inspection.

### 9. Publish and assignment boundary repairs

- [x] Allow an assigned draft-only slot to reconcile into a new relational shift and assignment during publish.
- [x] Apply call-window edits at the assignment layer when a slot has a personal override, while preserving the slot fallback window.
- [x] Retry one serialization conflict around publish so concurrent schedule edits return a real stale/conflict response instead of an incidental server error.
- [x] Keep legacy Event detail and Schedule mutation controls read-only while a private working copy exists.
- [ ] Verify the repaired publish, assignment, and working-copy boundary behavior with focused tests and the required web gates.

### 10. Settings-owned current call-time synchronization

- [x] Make Sport settings offsets the source for upcoming timed shift coverage, including assigned and manually created slots, while preserving explicit slot and personal overrides.
- [x] Keep all-day and date-only events free of fabricated call times.
- [x] Synchronize active private working-copy payloads so a later publish cannot restore stale default times.
- [x] Add a reusable dry-run/apply repair path and wire future Sport settings changes through the same service.
- [x] Apply the current live correction and verify the settings, schedule, publication, and working-copy contracts.

### 11. Explicit assigned-slot convert-and-replace

- [x] Add one versioned `convertAndReplace` command that requires a target scheduling class and replacement user.
- [x] Reject active trades, linked bookings, inactive users, duplicate draft assignments, conflicts, and Student availability violations before changing the working copy.
- [x] Preserve assignment history while publishing the replacement by declining the old assignment and creating the new relational assignment.
- [x] Wire target-class replacement pickers into the web Schedule workstation and native Event detail flow.
- [x] Cover the command, publication reconciliation, web/native source contracts, TypeScript, lint, project check, drift check, and Wisconsin simulator build.

### 12. Event-level call-time controls and one-time current repair

- [x] Add the versioned `setCallWindowForAll` command to the shared working-copy contract, preserving assignment notes and clearing personal call-time overrides.
- [x] Add web Schedule and native Event detail controls with paired-window validation, conflict checks, and explicit private-until-publish copy.
- [x] Keep ordinary settings synchronization conservative while exposing an explicit override mode for a one-time repair.
- [x] Run the override dry run, apply it to the authorized active future-event scope, and verify relational rows, private working copies, publication versions, and audit records.

### 13. Assignment-scoped acknowledgement integrity

- [x] Treat a non-null assignment acknowledgement as current until publication explicitly clears that assignment.
- [x] Keep unchanged coworkers acknowledged when another worker's assignment, call window, or slot changes.
- [x] Align Schedule summaries, Event detail, and My Shifts on the assignment-scoped acknowledgement contract.
- [x] Add focused regression coverage and run the web and documentation verification gates.
- [ ] Complete authenticated browser proof against an isolated non-production identity.

### 14. Ten-minute automatic release foundation

- [x] Amend D-042 with the superseding timed-release decision and retire manual Draft/Publish terminology from active contracts.
- [x] Persist the pending release due time, durable workflow run identity, and actionable release error on the versioned staging row.
- [x] Pre-enqueue the version-specific Workflow run before committing each edit so a saved pending version cannot exist without a timer.
- [x] Sleep for ten minutes, release only when the stored version still matches, and let superseded runs no-op safely.
- [x] Preserve atomic reconciliation, history, conflict, booking, trade, audit, notification-dedupe, and old-client boundaries.

### 15. Web and API timed-release workflow

- [x] Return pending-release timing and failure state from the editor response.
- [x] Remove manual Publish/Republish/preview controls and Draft/Published/Changed labels from Schedule and Event detail.
- [x] Show quiet pending copy with the release time, restart feedback after edits, Revert pending changes, and actionable blocked-release recovery.
- [x] Keep all mutations permission-checked, rate-limited, version-checked, serializable, and audited.

### 16. Defaults for every eligible event

- [x] Add a Settings-owned Non-game template with per-area Staff and Student counts plus Student call-time offsets.
- [x] Route events without an opponent through that template and neutral games with an opponent through the sport Away template.
- [x] Generate an event's configured slots and call times on sync and manual creation, and backfill missing upcoming Non-game schedules after Settings changes.
- [x] Keep cancelled, hidden, archived, assigned, history-bearing, and manually touched records protected.

### 17. Student-only call times

- [x] Keep Staff coverage stored on the event window for scheduling integrity while exposing no Staff call-time value or event-time substitute; Student slots use configured call-time offsets.
- [x] Reject Staff/collaborator call-time overrides at the working-schedule API boundary and normalize obsolete overrides during synchronization/release.
- [x] Hide call-time labels and controls for Staff/collaborators across web, notifications, exports, ICS, Schedule, Event detail, and iOS.
- [x] Rename event-wide call-time actions to Student call time and apply them only to Student slots/assignments.

### 18. Collaborator assignment support

- [x] Treat an active collaborator with `PUBLISHED_SCHEDULE_VIEW` as eligible for manual Staff-slot assignment.
- [x] Include eligible collaborators in staff pickers without broadening collaborator directory, contact, availability, Trade Board, or Open Work access.
- [x] Give an assigned collaborator worker-facing event visibility and consolidated assignment notifications through the existing sanitized released Schedule contract.
- [x] Keep collaborator reservation-to-schedule inference out of scope unless separately authorized.

### 19. Retire acknowledgements from active scheduling

- [x] Remove acknowledge actions, Unacknowledged filters/readiness counts, and acknowledgement-dependent copy from active web and iOS scheduling surfaces.
- [x] Keep historical fields and tolerant response decoding during rollout; release state reports zero acknowledgement counts.
- [ ] Remove acknowledgement columns from active exports and remaining legacy reporting vocabulary after compatibility review.

### 20. Native iOS adoption and comprehensive verification

- [x] Replace Publish/Discard controls with pending-release timing, revert, and blocked-release recovery in native staff Schedule authoring.
- [x] Keep student and collaborator reads on the last released relational/snapshot schedule and preserve additive rollout tolerance.
- [x] Run focused services/routes/workflow/defaults/collaborator/call-time/trade tests, TypeScript, focused lint, Prisma gates, `build:app`, codemap/docs checks, and diff hygiene.
- [x] Run iOS source contracts, project/drift checks, and the Wisconsin iPhone 16 Pro simulator build; authenticated web/native runtime proof remains open.

### 21. Notification policy disclosure

- [x] Explain the timed-release notification recipients, delivery channels, cadence, and quiet-period boundary in the Event detail Crew and Schedule shift-detail notices.
- [x] Reuse one shared notice so staff see the same policy from both read-only crew surfaces without changing notification behavior.
- [x] Add source-contract coverage for the disclosure and verify the authenticated Event detail route.

### 22. Stateful pending-release notice

- [x] Return the staff-only release timestamp and blocked-release error from Event detail shift-group reads.
- [x] Show the shared notice only while a working copy is pending, with a live countdown and a quiet refresh loop until release.
- [x] Link blocked releases back to Schedule for review or revert, and reuse the countdown formatter across Schedule and Event detail.

### 23. All-day expanded crew row call-time suppression

- [x] Hide per-slot Student call-time labels and editors in the expanded web Schedule rows when the owning event is all-day, matching the existing event-level control guard and published Schedule display contract.
- [x] Preserve working-copy/API storage and release semantics; this is a presentation-only correction for all-day event rows.
- [x] Add a focused source-contract regression and run the web and docs verification gates.
- [ ] Authenticated browser smoke of the expanded `/schedule` row; blocked by the local missing `SESSION_COOKIE_NAME` environment variable.

### 24. Schedule setup and Event detail crew ownership

- [x] Keep crew setup available from staff Schedule row overflow menus, with Home, Away, and empty template choices.
- [x] Establish the initial Schedule setup and Event detail working-copy ownership split; expanded-row authoring was superseded by Slice 25's shared compact editor.
- [x] Move the versioned working-copy crew editor into Event detail as the first full staff/admin workstation, then reuse it from Schedule in Slice 25.
- [x] Preserve the existing timed-release, permission, rate-limit, audit, and worker-facing publication boundaries.
- [x] Add focused source contracts; authenticated Schedule/Event detail browser proof remains gated by an available local browser session.

### 25. Shared Schedule and Event detail crew editor

- [x] Make the working-copy crew editor self-contained for picker loading and call it from both Schedule and Event detail.
- [x] Open the compact shared editor from the Schedule row dropdown while retaining a direct Open Event detail action.
- [x] Remove the unused legacy direct-assignment path from expanded Schedule rows so staff mutations have one helper and one versioned command boundary.
- [x] Preserve worker read-only rows, Student-only call-time rules, timed release, optimistic versions, permissions, audit entries, and publication boundaries.

### 26. Shared editor hardening and interaction polish

- [x] Review the shared helper and both integrations for duplicate mounting, stale async responses, version-conflict recovery, and parity gaps without adding another mutation path.
- [x] Improve compact and detail hierarchy, keyboard/focus behavior, responsive wrapping, loading/empty/error recovery, and pending-action feedback with existing primitives.
- [x] Preserve server-owned optimistic versions, permissions, audit, timed release/revert, worker read-only rows, and Student-only call-time boundaries.
- [x] Stop if a proposed polish change requires a new API or conflicts with D-046; keep this slice to the existing working-copy contract.
- [x] Verify focused source/working-copy tests, TypeScript, targeted lint, app build, docs/codemap checks, and authenticated desktop browser smoke without mutating schedule data.
- [ ] Complete narrow-width visual browser smoke when the in-app browser exposes viewport resizing.

### 27. Approval and assignment gate closure

- [x] Make Trade Board area eligibility use the user's complete area membership, including secondary assignments, and fail closed when no matching area exists. Keep list claimability and the claim mutation on one helper and add primary, secondary, missing-area, and mismatch regressions.
- [x] Revalidate active state, scheduling class, area membership, conflicts, approved time off, poster ownership, and slot occupancy at the final open-slot or trade approval boundary so both human and automatic review reject stale eligibility.
- [x] Give human and automatic approvals one service-owned, transactionally consistent audit path. Preserve the route actor for staff decisions, use the supported system audit identity for deadline decisions, and deliver the normal worker approval notification after an automatic open-slot approval.
- [x] Retire live per-cell assignment, removal, slot, and call-window mutations from `/schedule/assign`. Preserve its month-level conflict/open/clean review and working-copy bulk preview, and route individual crew changes to the canonical Event-detail working-copy editor.
- [x] Replace remaining instant-pickup/swap product copy with approval-first consequences across web payloads and visible Trade Board/shift-detail surfaces without changing the native response envelope.
- [x] Add focused API/service/web/native source-contract coverage, matched before/after visual proof for the web copy/assignment handoff, and authenticated browser/native runtime proof where the available session permits it.
- [x] Sync `docs/AREA_SHIFTS.md`, `docs/AREA_MOBILE.md`, `docs/GAPS_AND_RISKS.md`, the current audits, and this review with shipped behavior and exact proof boundaries.

#### Stop conditions

- Stop if the current audit model has no supported system actor representation; do not invent a fake staff identity for deadline approvals.
- Stop if preserving `/schedule/assign` review or bulk-assignment behavior would require a second working-copy mutation contract; individual changes must hand off to the existing editor.
- Stop if a shared API response shape would require a breaking native decode; keep the server correction additive or shape-preserving.
- Stop before any production schedule mutation, migration, deployment, upload, or release action without separate explicit approval.

## Review: Slice 27 (2026-08-23)

- Shipped: Trade Board list, claim, and approval now share complete primary/secondary area eligibility and fail closed without membership; human and automatic approvals revalidate worker, ownership, occupancy, time-off, and conflict state inside the final serializable transaction; approval audits and notifications are service-owned; collaborator assignment eligibility requires active Published Schedule access; and `/schedule/assign` is a review/bulk-preview surface whose retired live-cell mutation routes now return the Event working-copy handoff.
- Product behavior: web and iOS trade language is approval-first. Claiming or proposing a trade no longer promises an immediate pickup or swap, while approved assignment changes retain their existing response envelopes.
- Verified: 73 focused schedule/shift/trade test files with 520 passing tests, TypeScript, lint, `npm run build:app`, iOS project/drift checks, an iPhone 16 Pro Simulator Xcode build, `git diff --check`, authenticated Preview browser proof, and a matched 1440x900 before/after review showing 115 legacy table mutation buttons reduced to zero while Event handoff links remained available. `docs/AREA_MOBILE.md` and `docs/GAPS_AND_RISKS.md` were reviewed and required no truth change.
- Proof artifacts: `tasks/event-shift-approval-gates-review/`, focused tests under `tests/schedule-*`, `tests/shift-*`, and `tests/ios-schedule-edit-times-post-trade-redesign.test.ts`, plus the updated Schedule/Trade service and route contracts.
- Remaining boundary: `npm run verify:docs` still reports only pre-existing unrelated drift in `docs/CODEMAPS/architecture.md`; the expected backend codemap counts are synchronized. No production schedule mutation, migration, deployment, upload, or release was performed.

## Review: Slice 26 (2026-08-18)

- Shipped: the shared helper now aborts superseded editor reads, cleans up in-flight picker/editor requests on unmount, filters already-assigned candidates, exposes retryable editor and user-picker failures, confirms pending-change reverts, preserves replacement context after a failed mutation, refreshes parent release metadata after successful reconciliation, and wraps compact call-time/dialog surfaces for narrow screens. Schedule and Event detail continue to call one versioned mutation path.
- Verified: 46 focused crew/Schedule source and mutation-contract tests, all 498 Vitest files / 3,258 tests, `npx tsc --noEmit --pretty false`, targeted ESLint, `npm run lint` (one pre-existing warning in `scripts/backfill-signature-artifacts.ts`), `npm run build:app`, codemap/docs verification, `git diff --check`, and authenticated desktop browser smoke of Schedule row actions, compact assignment picker, Event detail replacement picker, and 200 responses from the exercised API reads. No schedule data was mutated.
- Deferred: narrow-width visual browser smoke because the current in-app browser binding does not expose viewport resizing, and real assignment/release mutation proof remains intentionally deferred to avoid changing shared schedule data.

## Review: Slice 25

- Shipped: `WorkingCrewEditor` now owns picker loading plus assignment, replacement, slot, Student call-window, timed-release, revert, and conflict-refresh actions. Schedule opens its compact instance from the row menu and keeps a direct Event detail link; Event detail calls the same helper with deeper gear/history context.
- Verified: 8 focused source-contract tests, all 498 Vitest files / 3,257 tests with a process-local placeholder `DIRECT_URL`, `npx tsc --noEmit --pretty false`, `npm run lint` (one pre-existing warning in `scripts/backfill-signature-artifacts.ts`), `npm run build:app`, codemap/docs verification, `git diff --check`, and authenticated desktop browser smoke of the Schedule menu, compact editor, Event detail editor, and replacement actions. No schedule data was mutated.
- Deferred: narrow responsive visual acceptance and exercising a real assignment/release mutation in the shared editor; source and read-only browser proof cover the command surface without changing the shared schedule data.

## Review: Slice 24

- Shipped: Schedule row overflow menus now create Home, Away, or empty crew; Manage crew links to Event detail; expanded Schedule crew rows are read-only; staff/admin Event detail renders the versioned working-copy editor; legacy direct assignment and auto-fill controls were removed from the Event detail read table; automation auto-fill review links now open the first affected Event detail instead of `/schedule/assign`.
- Verified: 36 focused source-contract tests, all 497 test files / 3,252 tests with a process-local placeholder `DIRECT_URL`, `npx tsc --noEmit --pretty false`, `npm run lint` (one pre-existing warning in `scripts/backfill-signature-artifacts.ts`), `npm run build:app`, codemap/docs verification, and `git diff --check` pass.
- Deferred: Authenticated visual/browser acceptance of Schedule row setup and Event detail assignment/manage.
- Blocked: Local development now starts cleanly with the documented `SESSION_COOKIE_NAME`, but both connected browser surfaces reach the sign-in page without an authenticated local session. No schedule data was mutated.
- Proof artifacts: `tests/event-crew-setup-source.test.ts`, `tests/schedule-ui-polish-source.test.ts`, `tests/crew-row-standardization-source.test.ts`, `tests/schedule-source-truth-smoke-contract.test.ts`, `tests/schedule-working-copy-route-source.test.ts`, and `tests/schedule-working-copy-mutation-guard.test.ts`.
- Next slice or stop: Sign in to the prepared local browser tab, then run the desktop and responsive Schedule/Event detail smoke before shipping.

## Review: Slice 23 (2026-08-18)

- Shipped: The expanded Schedule working-crew editor now suppresses both assigned and open Student call-time controls when the owning event is all-day. Staff/collaborator rows remain call-time-free, and timed events retain their existing Student call-time behavior.
- Boundary: This is a presentation-only guard. Working-copy/API storage, timed release, publication, audit, and calendar sync semantics are unchanged.
- Verified: 34 focused tests across Schedule source contracts, working-copy route contracts, call-window helpers, and date helpers; targeted ESLint; TypeScript; full lint with one pre-existing warning; `npm run build:app`; codemap/docs verification; and `git diff --check` pass.
- Deferred: None for this bounded UI correction.
- Blocked: Authenticated browser proof is unavailable because local dev fails closed on missing `SESSION_COOKIE_NAME`; the Schedule route returned Error ID `2165316873`. No schedule data was mutated.
- Proof artifacts: `tests/schedule-ui-polish-source.test.ts` asserts the all-day guard is applied to both row call-time render paths; server logs captured the missing environment variable and recovery digest.
- Next slice or stop: Stop implementation here; repeat the authenticated Schedule smoke when the local session configuration is restored.

## Review: Slice 22 (2026-08-18)

- Shipped: Event detail Crew and the read-only Shift detail panel now show the actual `Affected users notified in …` countdown only while a working copy exists. The notice refreshes on the existing 15-second operational cadence, disappears after release, and exposes a Schedule recovery link when the release is blocked.
- Boundary: Release authority, affected-user selection, notification delivery, and worker-facing published reads are unchanged. The timestamp and error are staff-gated at both shift-group read routes.
- Verified: focused notification/source contracts (30 tests), full Vitest (3,243/3,244; one existing bootstrap environment failure), ESLint (three unrelated warnings), codemap/docs checks, and authenticated Schedule browser proof with the Assignee changes preview open and no console errors.
- Deferred: `npm run build:app` compiles successfully but its type-check is currently blocked by unrelated dirty-worktree assignment `source` omissions in `src/lib/schedule-working-copy.ts` and existing fixtures. Exact external push/email receipt remains open under GAP-60.

## Review: Slices 14–20 (2026-08-07)

- Shipped to production 2026-08-07: every working-schedule edit pre-enqueues an exact-version durable Workflow release ten minutes out. Newer edits supersede sleeping runs, permanent validation blockers persist on the pending version, and the old manual release endpoint returns `410`.
- Defaults and people: Settings owns Non-game Staff/Student counts and Student offsets; sync, backfill, and manual event creation generate missing schedules. Neutral-site games with an opponent use the sport Away template. Active collaborators with published-Schedule access may be selected for Staff slots only.
- Timing and visibility: Staff/collaborator slots retain event-window storage for schedule integrity but expose no call-time value or event-time substitute across notifications, exports, ICS, web, and iOS. Only Student slots expose call-time controls. Active acknowledgement controls and readiness state are retired while historical fields remain compatible.
- Verified: 67 focused scheduling/notification/native source tests, TypeScript, focused ESLint, `npm run build:app`, codemap/docs checks, iOS project/drift checks, and the exact iPhone 16 Pro simulator build pass after the neutral/Staff-timing correction. The full repository suite passes 2,974 tests and retains three unrelated failures from concurrent App Store, login-domain, and Social-area work; repository-wide lint still stops in `.tmp/call-time-sync-bundle.mjs`.
- Production evidence: migration health reports 114/114 local migrations applied with no pending, failed, or database-only rows. Vercel deployment `dpl_7oiHWXm3s2A7q3jkTbebXUq2RcN9` is READY and aliased at `https://gear.erikrole.com`; public deploy smoke passed. Authenticated ten-minute release and consolidated notification proof on web/native remains open.

## Review: Slice 21 (2026-08-18)

- Shipped: Event detail Crew and the read-only Shift detail panel now share one notification-policy notice. It names affected active workers and event-following collaborators, separates in-app/email/push delivery, states the one-summary-per-released-version cadence, and explains the ten-minute quiet-period restart behavior.
- Boundary: This is explanatory UI only. Release timing, worker/collaborator selection, notification preferences, dedupe keys, and publication authority are unchanged.
- Verified: focused source-contract coverage, schedule notification-policy tests, pending-release tests, focused ESLint, TypeScript, and authenticated Event detail browser inspection pass.
- Deferred: exact ten-minute release and external delivery acceptance remain open under GAP-60; this slice does not claim push or email receipt proof.
- Next slice or stop: stop unless a separate notification-delivery or release-timer failure is selected.

## Review: Slice 6 Native working-copy adoption

- Shipped: Staff Event detail now loads the additive working-schedule editor and routes Add Shift, Assign Person, unassign, duplicate, delete, and call-window actions through optimistic expected-version commands. Native Publish and Discard dialogs explain the private draft boundary and keep worker visibility on the last published crew until release.
- Preserved: Student open-shift pickup, collaborator Schedule, worker-facing reads, Trade Board, ICS, Dashboard, and existing old-client schedule reads remain published-only. Full diff and the one-time repair remain web-only; the native all-assigned call-time action is covered in Slice 12. Assigned-slot replacement is covered in Slice 11.
- Verified: The focused native working-copy source contracts, TypeScript, project consistency check, and Wisconsin simulator target build pass. Authenticated native runtime/device proof and production rollout remain open.

## Review: Slice 8

- Shipped: the editor read model batches current user identity fields for every assignee referenced by the effective working schedule.
- Verified: focused working-copy tests pass, and an authenticated reload of Volleyball vs Alumni shows Maddy Pehler and Ashley Steltenpohl with no `Assigned worker` fallback.
- Preserved: working-copy JSON remains ID-only, and no publish, notification, relational schedule, or iOS read contract changed.
- Remaining: the broader plan still tracks narrow responsive proof and authenticated native runtime proof.

## Review: Slice 9

- Shipped: publish now accepts assigned draft-only slots, persists personal call-window overrides on assignments, retries one serialization conflict, and prevents legacy live schedule mutations from racing a private working copy.
- Verified: focused publication, working-copy, assignment, call-window, open-work, trade, auto-fill, and source-contract tests pass; TypeScript passes.
- Remaining: authenticated browser proof of the guarded legacy surfaces and authenticated native runtime proof remain open.

## Review: Slice 10

- Shipped: `sportDefaultShiftWindow` is the single fallback calculation for timed and all-day generation, regeneration, rebase, manual slots, template review, settings mutations, and current schedule synchronization. Settings call-time changes update future relational fallbacks and active working-copy payloads, refresh published snapshots, recalculate assignment conflicts, and preserve explicit slot or personal overrides.
- Preserved: all-day events retain date-only boundaries; assignment and slot call-window override fields are not overwritten; native and worker-facing reads remain published-only.
- Live correction: the shared dry-run/apply path corrected 35 fallback shift windows across 9 groups, 3 private working copies, and 1 published snapshot. The post-apply dry run reported zero remaining updates, zero invalid working copies, and zero missing configurations.
- Verification: focused default, generation, rebase, sync-service, TypeScript, and lint gates pass. Authenticated browser proof of the Settings save and published schedule notification surface remains open with GAP-60.

## Review: Slice 11

- Shipped: staff can explicitly replace an assigned person while converting the slot between Staff and Student. The versioned command chooses the target class and person together, clears stale personal call overrides, and keeps the draft private until publish. Active trades and linked bookings require explicit cleanup first; conflicts, inactive users, duplicate draft assignments, and Student availability are revalidated server-side.
- Published: an explicit replacement declines the prior relational assignment and creates the new assignment, preserving assignment history and worker-facing publication boundaries.
- Verified: focused working-copy, route-source, publication, and native source-contract tests pass; TypeScript, focused ESLint, `npm run ios:project:check`, `npm run drift:ios:warn`, and the Wisconsin simulator build pass. Authenticated browser/native runtime proof remains a rollout gate under GAP-60.

## Review: New-slot call-time fallback follow-up (2026-08-05)

- Shipped: the first new working-copy slot for an area and scheduling class now uses the same Sport settings default window as direct shift creation. The editor response exposes that window so native Add Shift shows and seeds from the configured call time.
- Preserved: an existing same-class peer remains the inheritance source, explicit call-window overrides remain explicit, and all-day events retain date-only boundaries.
- Verified: focused working-copy, editor, route-source, native source-contract, and default-window tests pass; TypeScript, focused ESLint, iOS project consistency, iOS drift, `npm run build:app`, and the generic iOS simulator build pass. The named iPhone 16 Pro destination remains unavailable from the local CoreSimulator service, so device/runtime proof is still open.

## Review: Slice 12 (2026-08-05)

- Shipped: web and native staff authoring can set one call/coverage window for every slot in an event. The action clears personal call-time overrides, validates all assigned users against conflicts and Student availability, and remains private until publish.
- Live correction: with explicit authorization, the settings-owned override inspected 145 active future events across 118 groups, changed 2 groups and 2 shifts, cleared 2 shift overrides and 6 assignment overrides, rebased 1 private working copy, refreshed 1 published group, preserved 83 all-day events as date-only, skipped 5 missing configurations, and wrote two audit records. A post-apply read found no remaining targeted drift.
- Verified: focused call-time, working-copy, route-source, and native source-contract tests pass. Production data verification confirmed the current Women's Soccer group uses 17:00Z–21:00Z and the already-published Volleyball group has its working-copy version and publication version rebased. Authenticated browser and native runtime proof remain open under GAP-60, and these code changes are not deployed from this worktree.

## Review: Slice 13

- Shipped: acknowledgement validity is now assignment-scoped across Schedule summaries, Event detail, and My Shifts. A later group publish no longer makes an unchanged coworker appear unacknowledged; publication continues clearing acknowledgement fields for changed or replaced assignments.
- Verified: 29 focused publication/source-contract tests pass, including the older-acknowledgement regression; focused ESLint, TypeScript, `npm run build:app`, codemap/docs verification, and `git diff --check` pass.
- Preserved: no schema, publication transaction, notification, permission, working-copy, or native response shape changed. Existing unrelated Schedule, iOS, kiosk, schema, and documentation work remains in place.
- Blocked: repository-wide lint still reports two pre-existing errors in `.tmp/call-time-sync-bundle.mjs`; authenticated browser proof is unavailable because the required isolated target and Playwright identity are not configured.
- Next slice or stop: stop after this integrity repair unless an isolated browser identity becomes available or another concrete Schedule failure is selected.

## Verification

- Focused service and route tests for validation, authorization, stale versions, draft privacy, publish atomicity, notification dedupe, class conversion, trade safety, and compatibility reads.
- `npx prisma format`, `npx prisma validate`, `npm run prisma:generate`, and `npm run db:migrate:check` for every schema slice.
- `npx tsc --noEmit --pretty false`, focused lint, `npm run build:app`, and authenticated browser proof for web slices.
- iOS source-contract tests, drift check, project check, and affected Xcode builds for native slices.
- `git diff --check`, docs/codemap verification, relevant area-doc acceptance/changelog updates, and a final diff audit.

## Stop conditions

- Stop before applying a live migration or deploy-shaped build unless the environment is explicitly controlled for migration work.
- Stop before applying migration `0099_shift_group_working_copy` to the shared Neon database without explicit user approval.
- Stop rather than delete or sever a shift, assignment, trade, or booking relationship that the working payload cannot reconcile safely.
- Stop if current iOS contracts require a breaking response change; ship an additive server contract first.
- Stop if restoring draft identity would require persisting user profile fields in the working JSON; the editor read model must hydrate current user data by ID instead.
- Preserve the unrelated kiosk work already present in the worktree.
