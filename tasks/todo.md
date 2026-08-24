# Task Queue

Last updated: 2026-08-24

---
## In progress: Scoreboard soccer tie result (2026-08-24)

Plan: `tasks/scoreboard-tie-result-plan-2026-08-24.md`.

- [x] Confirm the Aug 23 Oakland win and Marquette tie in the source-backed Preview rows and reproduce the missing `[T]` record in authenticated Scoreboard.
- [x] Add W/L/T parsing, persistence, aggregates, profile filters, web/native rendering, W–L–T meter order, and backward-compatible native decoding.
- [x] Add split enum/backfill migrations `0132` and `0133`, keeping the source marker in `rawSummary`.
- [x] Pass focused/full Scoreboard/calendar/source-contract tests, TypeScript, migration-prefix validation, lint, web build, and matched iPhone 16 Pro visual proof.
- [ ] Apply migrations, deploy server/web, read back the repaired row, and complete authenticated production/native visual proof.

**Local result:** the missing Marquette `[T]` event is now represented as `TIE`; ties count as resolved games and half a win for rate. The Oakland `[W]` event was already present in Nolan Kromke's signed-in personal Scoreboard, so the evidence does not support it being absent from that personal list.

**Boundary:** no production database or deployment was performed in this task. Batched commits `c493e0b7` and `aa1ad1a8` were pushed to `origin/main`; production migration/read-back and authenticated production/native proof remain open.

---
## Completed: API and native Items default sort is Most popular (2026-08-23)

- [x] Default omitted `/api/assets?sort` to the existing popularity ranking.
- [x] Open native Items on Most popular and treat that as the resting sort control.
- [x] Keep picker-search on asset-tag order.

- **Shipped locally:** unlabeled `/api/assets` lists and native Items now match web Most popular. Choosing Asset tag still requests `sort=assetTag`. Equipment picker-search stays tag-ordered.
- **Boundary:** no schema, popularity-scoring, pagination-cap, or picker-search change. Family bulk mutations are still skipped.
- **Verification:** focused Items/API/iOS source contracts (67 tests), TypeScript, ESLint on touched files, `git diff --check`, and `drift:ios`. `xcodebuild` for iPhone 16 Pro / iOS 26.5 compiled `ItemsView.swift` and failed in unrelated `StatusPill.swift` (`some View` helper missing `return`). Authenticated Items runtime was not re-run.

---
## Completed: Photo Mechanic-first Software page (2026-08-23)

- [x] Make Photo Mechanic the default `/licenses` landing; Shared logins is `?tab=shared-logins`.
- [x] Extract `PhotoMechanicLicenses.tsx` and lead with the holder's code or a claim prompt.
- [x] Quiet Shared logins chrome so it no longer restates the tab or treats Photo Mechanic as a footnote.
- [ ] Authenticated local browser proof of `/licenses` after the shared Next process is available.

- **Shipped locally:** Software now opens on Photo Mechanic. The holder's code is the first action; Shared logins stays a second tab. Claim, masking, two-slot, and vault encryption contracts are unchanged.
- **Boundary:** no API, schema, permission, or iOS change. Collaborators still cannot see Photo Mechanic.
- **Verification:** focused Software/licenses UI contracts (54 tests across 7 files), `tsc`, eslint on touched files, `git diff --check`, `npm run verify:docs`, and `npm run build:app`. `/licenses` is in the production compile table at 29 kB.

---
## Completed: Items list sort snap and select-all matching (2026-08-23)

- [x] Snap empty column sort back to Most popular so the toolbar, URL, query, and row order stay aligned.
- [x] Send `item_type` on Select all matching and return item-family ids as `bulk-{id}`.
- [x] Allow item-family row selection; keep bulk mutations serialized-only with a skip message.

- **Shipped locally:** clearing a column sort no longer pretends to be Most popular while listing by Asset tag, and Select all matching follows the visible item kind including families.
- **Boundary:** API default sort remains Asset tag for iOS Items and pickers. Family bulk mutations are still skipped.
- **Verification:** focused Items source contract plus `/api/assets?ids_only` item-kind tests.

---
## Completed: Items list default sort is Most popular (2026-08-23)

- [x] Default `/items` to the existing Most popular sort when no `sort` query is present.
- [x] Keep `/items` URLs clean for the default, and write `sort=assetTag` when Asset tag is chosen.
- [x] Leave native Items on its current Asset tag default.

- **Shipped locally:** opening the Items page now shows gear in Most popular order instead of Asset tag order.
- **Boundary:** no API, schema, popularity-scoring, pagination, or iOS default-sort change.
- **Verification:** focused Items source contract plus TypeScript/docs checks in this slice.

---
## Completed: Manual event date/time correction (2026-08-23)

- [x] Add start/end editing to Event detail for manually authored events while keeping imported event times source-owned.
- [x] Preserve timed and inclusive all-day date semantics and reject incomplete or inverted windows.
- [x] Move related crew shifts, slot and personal call overrides, working copies, published snapshots, conflicts, acknowledgements, and notifications with the event.
- [x] Keep linked gear reservation windows independent and say so in the editor.
- [x] Add focused route, schedule-propagation, and UI source-contract coverage.
- [ ] Complete matched authenticated before/after browser captures and publish the UI review page.

- **Shipped to production:** a manual event entered on the wrong day can be corrected from its existing edit dialog without rebuilding the event or leaving crew work behind on the old date. Commit `6d8960f2` is on `main`; Vercel deployment `dpl_9HSgPdM922goE1Pm7AbvqFi6mxD1` is Ready at `wisconsincreative.com`.
- **Boundary:** no schema, calendar-sync, imported-event lock, booking/reservation window, permission, or custody behavior changed.
- **Verification:** 41 focused route/service/UI-contract tests plus the full 3,622-test suite, `npx tsc --noEmit --pretty false`, zero-warning `npm run lint`, `npm run verify:docs`, migration-prefix validation, `git diff --check`, and a production-scoped `npm run build` pass. Production reported all 135 migrations applied. The live public smoke suite passed every route and CSP check; an authenticated production admin session loaded Dashboard and opened the manual Packers vs. Cardinals event editor with start/end date controls and the crew/reservation boundary copy. No event data was saved or changed, and the browser logged no warnings or errors. Matched manual-event before/after captures remain open as the separate visual-review artifact gate.

---
## Completed: Approval-first student shift claims (2026-08-22)

Decision: [D-055](../docs/DECISIONS.md). Supersedes `tasks/schedule-mvp-end-to-end-plan.md`.

- [x] Hold a Trade Board claim as `CLAIMED` for staff review instead of swapping on the spot, keeping the poster assigned until approval.
- [x] File an open-slot claim as a `REQUESTED` assignment that holds no slot, allowing several students to compete for one slot and blocking a duplicate self-request.
- [x] Keep the poster-no-longer-holds-it and already-refilled guards at claim time after they stopped riding inside `executeSwap`.
- [x] Escalate an unreviewed claim and then auto-approve it on a per-claim durable workflow, standing down for a human when the approval itself reports a blocker.
- [x] Give web and native a Staff Review queue and a student-facing Waiting on Staff state, and retire the "legacy request" and "assigned immediately" copy those surfaces still carried.
- [x] Add native Trade Board area filtering and paging (both deferred P2s in `tasks/audit-trade-board-ios.md`).
- [x] Add Schedule swipe-to-post, closing the reachable half of `tasks/shift-trade-actions-plan.md` slice 4.
- [ ] Authenticated web and native runtime proof of a claim held for review and an approval completing the swap.

- **Shipped locally:** student claims are approval-first on both paths again, the review surface that had been left orphaned since 2026-07-02 is live rather than half-removed, and no claim can sit unreviewed into its own shift.
- **Boundary:** no schema migration, permission, published/working-copy authority, notification-channel, transaction-isolation, or kiosk custody change. `REQUESTED` stays outside `ACTIVE_ASSIGNMENT_STATUSES`, so a pending request still holds no slot and raises no conflict.
- **Not done, deliberately:** the event-detail `List` conversion in `shift-trade-actions-plan.md` slice 4 conflicts with the 2026-08-16 Event detail rebuild onto the shared `ScrollView { LazyVStack }` detail pattern. Recorded in that plan rather than silently dropped or silently forced.
- **Verification:** full `npx vitest run tests/` at 3597/3597 across 533 files, `npx tsc --noEmit` clean, `npm run build:app`, `xcodebuild` for `Wisconsin` on iPhone 16 Pro by UDID, `npm run drift:ios`, `npm run audit:ios:gaps`, `npm run ios:project:check`, `npm run codemap`, `npm run verify:docs`, and `git diff --check`.

---
## Completed: License expiry local-calendar correction (2026-08-18)

Plan: `tasks/archive/completed-2026-08-18/license-expiry-date-only-plan.md`

- [x] Confirm the annual license expiry contract is a date-only value encoded at UTC midnight.
- [x] Use one local-calendar helper for table display, expiry status, renewal scope, admin inspection, date inputs, and CSV filenames.
- [x] Add regression and source-contract coverage for Central-time date decoding and the 30-day boundary.
- [x] Reconcile the Photo Mechanic Licenses area documentation and preserve the separate Plan 053 claim-eligibility policy gap.
- [ ] Complete authenticated browser proof of `/licenses` after the local shared Next development process is stopped or isolated.

### Review

- **Shipped locally:** A renewal entered as 8/18/27 now renders as Aug 18, 2027; expiry-day and 30-day status calculations use the local calendar date, and date-input storage remains explicit and stable.
- **Boundary:** No schema, API, claim-eligibility, notification, or production data behavior changed. The existing UTC-midnight representation remains a date-only storage encoding, not a displayed instant.
- **Verification:** Focused license tests (9 tests), focused ESLint, `npx tsc --noEmit --pretty false`, full `npm run lint`, `npm run build:app`, and `git diff --check` pass. The build passed before the pre-existing dev process invalidated the shared `.next` runtime directory.
- **Blocked proof:** Authenticated browser proof could not complete: the existing port-3000 Next process returned 500, and a separate port-3001 process stalled while sharing `.next`; the agent did not stop the unrelated process or mutate any license data.

---
## Completed: Schedule activity counts audit coverage (2026-08-18)

Plan: `tasks/archive/completed-2026-08-18/schedule-activity-counts-plan.md`

- [x] Audit changed ICS calendar events transactionally for created and updated activity, including imported cancellations.
- [x] Include private working-copy assignment and slot edits in staff/admin event-scoped history while keeping student reads published-only.
- [x] Add focused regression coverage for imported calendar activity and draft assignment history.
- [x] Reconcile the Schedule and Events area docs with the verified local behavior.
- [ ] Complete authenticated browser proof of `/schedule` with real recent activity data.

### Review

- **Shipped locally:** Schedule activity cards now read real recent calendar-sync and assignee/schedule changes from the existing audit history contract instead of silently omitting sync and working-copy writers.
- **Boundary:** No schema or migration, timed-release authority, worker-facing published read, permission matrix, notification policy, or schedule mutation contract changed. Working-copy history is explicitly opt-in for staff/admin surfaces.
- **Verification:** 120 focused tests, focused ESLint, `npx tsc --noEmit --pretty false`, `npm run build:app`, and `git diff --check` pass. `npm run codemap` and docs verification are recorded after the final docs sync.
- **Deferred:** Authenticated browser proof remains open because the local preview redirected to `/login` and no approved authenticated browser session was available; no schedule data was mutated.

---
## Completed: Schedule MVP Trade Board and instant-pickup hardening (2026-08-10)

Plan: `tasks/schedule-mvp-end-to-end-plan.md`

- [x] Make the legacy request route an instant-pickup compatibility alias and label surviving approval controls as legacy-only.
- [x] Return server-owned trade claimability and availability context to web and native clients.
- [x] Keep Open Work and trade data independently recoverable without false empty or all-clear states.
- [x] Centralize post-commit trade push/email fanout while preserving transactional durable notifications.
- [x] Verify focused Schedule contracts, TypeScript, production web build, and the Wisconsin iPhone 16 Pro Simulator build.
- [ ] Complete authenticated web and native Trade Board runtime inspection without creating production Schedule data solely for proof.

### Review

- **Shipped locally:** the daily open-slot pickup and trade loop now uses one instant-assignment contract, explains server-owned blockers before action, and remains useful when either Trade Board source fails.
- **Boundary:** no schema, published/working-copy authority, role permission, assignment/trade lifecycle, audit, notification preference, or kiosk custody contract changed.
- **Verification:** 148 focused Schedule tests, focused ESLint, iOS drift/audit/project checks, the Wisconsin iPhone 16 Pro Simulator build, codemap/docs, whitespace, and authenticated local Trade Board reads pass. The production web build and TypeScript check passed before later concurrent Settings escalation edits introduced an unrelated type error. The full run recorded 3046/3053 before the stale six-area Schedule assertion was repaired; six unrelated App Store, booking notification, kiosk, and Settings failures remain. Native runtime proof remains blocked at Login.

---
## Active: Event shift working schedule and quick crew actions (2026-07-21)

Plan: `tasks/event-shift-working-schedule-plan.md`

- [x] Add the accepted versioned working-copy and published-version decision, schema, and migration.
- [x] Add private optimistic slot, conversion, assignment, unassign, discard, diff, and publish APIs with serializable reconciliation and audit evidence.
- [x] Bundle first-publish and affected-worker notifications to one version-deduped event summary per person.
- [x] Make the expanded web Schedule list a multi-event crew workstation with one concise row per real slot, contextual Staff and Student additions, conversion, assignment, removal, and publish review.
- [x] Buffer default staffing changes behind Save/Discard, reorganize the matrix by area, remove silent Student defaults, stop guessing Home for Neutral/Non-game generation, and safely rebase upcoming unpublished schedules without removing occupied or manually touched slots.
- [x] Repair local loopback CSRF handling and make Event detail crew setup apply saved defaults, with an explicit Home/Away/empty chooser for Neutral and Non-game events.
- [x] Apply migration `0099_shift_group_working_copy`, verify 101/101 live migration health, and complete authenticated desktop proof for Event detail plus the expanded Schedule workstation.
- [x] Add private inline Call/Release editing to every expanded crew slot, include call changes in publish review, revalidate conflicts and availability, and reset acknowledgement only for affected assignments on publish.
- [x] Simplify Schedule triage and inline assignment: promote Sport, remove Next call, align crew beside coverage, move Assign into row actions, and rank a scrollable working-copy picker by sport fit and workload.
- [x] Normalize the expanded Schedule crew editor onto one stable right-side action grid with consistent spacing and 40px controls.
- [x] Reduce expanded crew density by removing passive publication chrome and nested borders, collapsing repeated add controls, and moving destructive and conversion actions into row overflow menus.
- [x] Rehydrate every draft-only assignee from the working-copy read model so names and avatars survive refresh without publishing.
- [x] Make Sport settings the shared source for future timed call-time fallbacks, synchronize active working copies and published snapshots, preserve explicit overrides, and repair current live drift.
- [ ] Complete narrow responsive browser proof for the expanded Schedule workstation.
- [x] Move native staff quick actions and publish review from legacy live mutation routes to the additive working-copy contract; run source contracts and Xcode builds.
- [ ] Complete authenticated native Event detail draft/publish proof against an isolated runtime before rollout.
- [x] Add the explicit assigned-slot convert-and-replace flow.
- [x] Carry the settings-owned default call window through new working-copy slots and native Add Shift while preserving peer and explicit overrides.
- [x] Preserve unchanged worker acknowledgements when a later publish changes only another assignment.
- [x] Add one shared Event detail/Shift detail notice explaining notification recipients, channels, cadence, and the ten-minute release boundary.
- [x] Make the shared notice pending-only and show the staff-only release countdown/error state from shift-group reads.

### Current verification

- Prisma format/validate/generate and migration shape checks pass.
- Focused working-copy and publication tests cover private call-window staging, publish review counts, conflict and availability revalidation, acknowledgement reset, and explicit assigned-slot replacement; focused ESLint and TypeScript pass.
- The explicit replacement slice covers class conversion, active-trade and linked-booking guards, target selection, publication reconciliation, and native/web source contracts; the focused 29-test run passes.
- Authenticated desktop browser proof confirms the Football vs Notre Dame Neutral chooser and the expanded row's Call/Release editor without mutating or publishing schedule data.
- Authenticated refresh proof confirms Maddy Pehler and Ashley Steltenpohl remain named in the unpublished Volleyball vs Alumni working copy, with no `Assigned worker` fallback and no console errors.
- `npm run build:app` compiles the production app, and live migration health reaches Neon with no pending, failed, or DB-only rows.
- Migration `0099_shift_group_working_copy` is applied and Neon reports 101/101 local migrations with no pending, failed, or DB-only rows. Native rollout proof remains tracked as GAP-60.
- Native working-copy source contracts, `npm run ios:project:check`, and the Wisconsin iOS simulator target build pass. Authenticated native runtime/device proof remains blocked by the absence of isolated credentials/auth state in this checkout.
- Assignment-scoped acknowledgement regression coverage passes across Schedule summaries, Event detail, and My Shifts. Focused ESLint, TypeScript, `npm run build:app`, codemap/docs verification, and whitespace checks pass; authenticated browser proof remains blocked by the missing isolated Playwright target and identity.
- The 2026-08-18 follow-up verified the pending-only notice and authenticated Schedule change preview locally. The focused 30-test slice passed; the full suite recorded 3,243/3,244 with the existing `DIRECT_URL` bootstrap failure. The app compiled before type-checking stopped on unrelated dirty-worktree assignment `source` omissions.

---
## Deferred: Kiosk identified-person hub terminology (2026-08-07)

- [ ] Rename the internal `.studentHub`, `KioskStudentHubView`, and `KioskStudentContext` names to person/user terminology so the shared kiosk flow accurately represents staff, students, admins, and eligible collaborators.
- [ ] Keep `/api/kiosk/student/[userId]` compatible during rollout, or add a compatibility alias before changing the native client endpoint.
- [ ] Update Xcode project references, audit inventory, source contracts, route maps, docs, and task links; run native/API tests plus iOS drift, gap, and project gates.
- **Reason deferred:** the current idle behavior is role-neutral. Renaming the endpoint is an API migration, and local Xcode target proof is currently blocked by CoreSimulatorService and kiosk provisioning issues.

---
## Completed: Web booking detail iOS hierarchy alignment (2026-07-21)

- [x] Carry the native title, timing, requester, location, gear, and event hierarchy into the shared web booking header.
- [x] Preserve the web's inline editing, staff actions, equipment manifest, sync health, and activity history.
- [x] Keep checkout and reservation detail shared without changing API, lifecycle, permission, or kiosk custody contracts.
- [x] Add focused source contracts and sync Reservations and Checkouts documentation.
- [x] Verify authenticated checkout and reservation details at desktop and tablet widths.

### Review

- **Shipped:** Shared checkout and reservation detail now names the requester beside booking identity and exposes the live handoff time, pickup location, physical gear count, and linked event context as one compact summary.
- **Boundary:** No API, schema, permission, action policy, booking lifecycle, equipment mutation, or custody behavior changed.
- **Verification:** 22 focused booking detail/status/freshness tests, focused ESLint, TypeScript, docs/codemap verification, whitespace checks, and `npm run build:app` passed. Authenticated local browser proof passed on an open checkout and a multi-event reservation at desktop and 900px tablet widths with no console warnings or errors.

---
## Completed: Native collaborator Published Schedule redesign (2026-07-18)

- [x] Limit the bounded published first page to current and upcoming snapshot-backed events.
- [x] Rebuild collaborator Schedule around date groups, classification rails, venue lines, crew previews, and resilient loading.
- [x] Add full-screen read-only Published Event detail with operational area groups.
- [x] Keep Follow capability-driven, server-authoritative, retryable, and safe against duplicate requests.
- [x] Route event notifications through the sanitized published detail endpoint.
- [x] Preserve every collaborator privacy boundary and add focused contracts.

### Review

- **Shipped:** Published Schedule now feels like part of the same native Schedule product while remaining a deliberately smaller, read-only collaborator surface.
- **Boundary:** No draft Schedule state, notes, contact details, availability, trades, acknowledgements, candidate scores, gear, publication metadata, or staffing controls are exposed.
- **Verification:** 37 focused collaborator/native contracts and all 262 native source contracts pass. TypeScript, Simulator and generic-device builds, iOS drift, and audit coverage pass. Authenticated collaborator runtime proof remains blocked by the reset Simulator session, and project consistency still reports the pre-existing checked-in XcodeGen drift.

---
## Completed: Native Schedule filters and Shift Calendar management (2026-07-18)

- [x] Separate Neutral games from opponent-free Non-game events in List and Calendar.
- [x] Rebuild Filters around scope, event type, sport, live results, Clear, and one purple Show Events action.
- [x] Replace the one-shot Calendar handoff with an honest private-feed status and management sheet.
- [x] Record only the locally observable Apple Calendar handoff, explain refresh authority, and keep failures retryable.
- [x] Protect private-link rotation with a consequence warning while preserving server rate limits and audit history.
- [x] Add focused contracts and sync Mobile, Shifts, gaps, audit, and task ledgers.

### Review

- **Shipped:** Schedule filtering is easier to scan, Neutral and Non-game scopes are correct, and Shift Calendar setup has visible status, recovery, and link-security controls.
- **Boundary:** No schema, API envelope, assignment visibility, scheduling policy, token security, canonical-host, or collaborator Published Schedule behavior changed.
- **Verification:** 28 focused and 256 full native source contracts pass. Simulator and unsigned generic-device builds pass, along with iOS drift, audit coverage, codemap/docs, and whitespace gates. Authenticated sheet proof remains blocked at Login in the reset Simulator session, and project consistency still reports the pre-existing checked-in XcodeGen drift.

---
## Completed: Native Schedule edit times and post trade redesign (2026-07-18)

- [x] Rebuild Edit Call Window around event and crew-slot context with 15-minute Call and End choices.
- [x] Keep current-year dates compact, validate ordering inline, retain failed input, and use one purple Save action.
- [x] Replace Event detail's bare trade confirmation with the reusable Post to Trade Board sheet.
- [x] Keep owner, shift, date, consequence, optional note, discard, retry, and VoiceOver selection context explicit.
- [x] Preserve all existing posting permissions, assignment ownership, claim and approval policy, audit, and notification behavior.

### Review

- **Shipped:** Staff get a focused call-window editor, and students or staff posting a student shift now get one consistent Trade Board flow from either Schedule entry point.
- **Boundary:** No schema, API route, permission, trade lifecycle, assignment, notification, or scheduling-policy behavior changed.
- **Verification:** 25 focused and 252 full native source contracts pass. Simulator and unsigned generic-device builds pass, along with iOS drift and audit checks. The simulator launches to Login, but authenticated sheet inspection is blocked by the reset simulator session. Project consistency remains blocked by pre-existing checked-in XcodeGen drift.

---
## Completed: Native Schedule staff authoring redesign (2026-07-18)

- [x] Rebuild Add Shift around event context, explicit area and worker class, inherited timing, and optional 15-minute custom timing.
- [x] Bring the existing staff candidate recommendations into native Assign Person.
- [x] Rank Best Fits first, disable hard conflicts, and confirm advisory overrides.
- [x] Preserve search pagination, loading geometry, retry, duplicate-submit guards, accessibility, and server authority.
- [x] Add focused contracts and sync Mobile, Shifts, gaps, audits, and task ledgers.

### Review

- **Shipped:** Staff can create a clear open slot and choose a candidate with the event, call window, fit, and risk context still visible.
- **Boundary:** No schema, backend route, permission, assignment rule, approved-time-off policy, audit, or notification behavior changed.
- **Verification:** 43 focused and 248 full native source contracts pass, along with Simulator build/run, generic-device build, iOS drift and audit checks, codemap/docs verification, and whitespace checks. Direct sheet inspection is deferred because simulator automation did not navigate despite successful element-ref actions; project consistency remains blocked by pre-existing checked-in XcodeGen drift.

---
## Completed: Native Schedule availability and Trade Board redesign (2026-07-18)

- [x] Make the recurring availability week directly selectable and keep one-time exceptions separate.
- [x] Add native availability editing through the existing PATCH route with 15-minute time choices.
- [x] Expose My Availability from Schedule for Student scheduling-class workers while retaining Profile access.
- [x] Rebuild Trade Board around claimable work, quiet My Posts scope, compact blocked/history context, and Schedule-style cards.
- [x] Guard duplicate mutations and remove the accidental cancel action from available trade rows.
- [x] Add focused native contracts and sync Mobile, Shifts, gaps, audit, and task ledgers.

### Review

- **Shipped:** Availability is now a weekly planning surface rather than a form list, and Trade Board now reads as an actionable Schedule queue rather than trade history.
- **Boundary:** No schema, backend route, availability meaning, time-off approval, trade eligibility, or scheduling policy changed.
- **Verification:** Focused and full native source contracts pass (244 tests), along with Simulator and generic-device builds, iOS drift and audit checks, codemap/docs verification, and whitespace checks. Project consistency remains blocked only by pre-existing checked-in XcodeGen drift; the full appearance and accessibility visual matrix remains recorded in the closeout plan.

---
## Completed: Native Schedule core redesign (2026-07-18)

- [x] Keep List as the default all-events scope and give personal assignments a distinct blue treatment without changing event classification rails.
- [x] Reuse one event-row hierarchy across List and selected-day Calendar results.
- [x] Separate calendar classification dots from personal-assignment indicators.
- [x] Replace sheet-based Event detail with parent-stack navigation from Schedule, Home, and event pushes.
- [x] Add role-adaptive assignment, gear, open-shift, and staffing actions without a persistent bottom bar.
- [x] Preserve crew management, trade, all-day, multi-day, permission, and API contracts.
- [x] Add focused source contracts, sync area/audit/gap docs, and run native verification.

### Review

- **Shipped:** Schedule now reads as one consistent native operational flow from agenda or month selection into full-screen Event detail and back to the preserved Schedule state.
- **Behavior:** Students see their call, area, gear readiness, linked bookings, and eligible open shifts before passive crew detail. Staff/admin retain coverage and Add Shift. The collaborator Published Schedule is unchanged.
- **Boundary:** No API, schema, scheduling policy, permission, Trade Board, My Availability, or staff authoring-sheet redesign is included in this slice.
- **Runtime proof:** Production-backed Event detail passed light, dark, and Accessibility Large inspection. List and Calendar screenshots remain tracked in `tasks/ios-schedule-core-redesign-plan.md` because the Mac locked before the final tab sweep.

---
## Completed: Native booking surface alignment (2026-07-17)

- [x] Use the accepted Item Detail custody card as the native booking-row hierarchy reference.
- [x] Keep Bookings search, scope controls, sections, pagination, freshness, and navigation unchanged.
- [x] Order each booking row as title, live timing, then requester and operational context.
- [x] Remove timing glyph repetition and the redundant `Checked Out` pill from normal open checkouts.
- [x] Preserve status rails and explicit pills for overdue, reserved, pickup, and other distinct lifecycle states.
- [x] Add focused source-contract coverage and verify the production-backed Bookings screen in Simulator.

### Review

- **Shipped:** Bookings and Item Detail now present the same booking with a consistent reading order and calmer state treatment while retaining surface-specific controls.
- **Verification:** All 214 iOS source-contract tests pass across 52 files, iOS drift is clean, the Wisconsin Simulator build and launch pass, and production-backed runtime proof confirms requester, location, and item context with no redundant active-checkout pill.
- **Boundary:** No API shape, ordering, booking action, role policy, or kiosk custody behavior changed.

---
## Completed: Native Item Detail hierarchy refresh (2026-07-17)

- [x] Compact the static image-and-identity hero, remove photo expansion, and preserve Dynamic Type stacking.
- [x] Remove duplicate navigation/status chrome and render the asset name in Gotham Bold.
- [x] Move holder, live due timing, and booking navigation directly beneath identity.
- [x] Show `Available` or `Available until [next reservation]` beneath identity when custody is inactive.
- [x] Use `Reserve for Later` when the item is unavailable and retain retired-item gating.
- [x] Use Gotham Black for web-matched identity weight and the semantic purple reservation tone for both reservation CTA labels.
- [x] Decode the existing item history payload and add a visible Bookings route with Upcoming Reservations and Previous Bookings.
- [x] Place the plain location name under a quieter product subtitle, use natural comma-separated due copy, collapse secondary metadata, omit empty upcoming chrome, and nest Attachments under Details.
- [x] Surface upcoming reservations on Item Detail and keep newest-first previous records behind Bookings with 10-row incremental reveal.
- [x] Keep a visible Upcoming Reservations empty state, reduce history to a neutral one-line Previous Bookings route, and order active custody as title, due time, then requester.
- [x] Keep the QR badge tappable to copy without showing a redundant copy glyph.
- [x] Move Edit, QR copy, and product-link actions into the native overflow menu.
- [x] Add focused source-contract coverage and verify the real production-backed FX3 1 screen in Simulator.

### Review

- **Shipped:** One first-screen operational story now answers what the item is, where it lives, the booking title, when it is due, who has it, what is reserved next, what the user can do, and where to inspect previous item bookings without changing server behavior or custody policy.
- **Verification:** All 211 iOS source-contract tests pass across 51 files; iOS drift is clean; the XcodeBuildMCP simulator build and launch pass; and production-backed proof confirms title/due/requester order, a visible zero-reservation state, neutral Previous Bookings, stronger location contrast, a quieter product caption, and a non-actionable photo. The original audit covered 51/51 surfaces.
- **Boundary:** The pre-existing Xcode project and generated architecture-codemap drift remain owned by unrelated work; this slice did not regenerate or rewrite either artifact.

---
## Completed: Gear Tracker skill-system consolidation (2026-07-17)

- [x] Make `gt-page`, `gt-audit-web`, and `gt-audit-ios` the canonical page and audit owners.
- [x] Convert the three legacy page/audit workflows into explicit-invocation compatibility aliases.
- [x] Rework `improve` around current task-ledger routing while preserving explicit branch, plan, execute, reconcile, and issue variants.
- [x] Replace generic UI doctrine with Gear Tracker-specific design-language and installed-component workflows.
- [x] Normalize API, iOS, deployment, merge-cleanup, doc-sync, planning, and shipping guidance against `AGENTS.md` verification and authorization boundaries.
- [x] Remove unreferenced generic skill reference material and migrate shadcn UI metadata to `agents/openai.yaml`.
- [x] Validate all 18 skills, YAML metadata, whitespace, stale references, and cold routing behavior.

### Review

- **Routing:** Broad page, web-audit, and iOS-audit requests now have one canonical owner each; legacy slash commands route without loading a competing workflow.
- **Safety:** Audit-only requests no longer imply task-file writes, and implementation no longer implies branch, delegation, commit, push, PR, deploy, upload, or release authority.
- **Verification:** All 18 skill folders and shadcn UI metadata validate; whitespace, stale-reference, alias-routing, audit-verdict, and `improve execute` cold tests pass. `npm run verify:docs` remains blocked by pre-existing `docs/CODEMAPS/frontend.md` drift from active application changes; `.agents` is excluded from codemap generation.
- **Boundary:** No application source, active plan registry, or unrelated dirty documentation was changed by this maintenance slice.

---
## Completed: Student year and anticipated graduation profiles (2026-07-16)

- [x] Ask Student accounts for an explicit academic year in profile completion.
- [x] Ask Student accounts for a personal phone only, without work-phone prompts or classification.
- [x] Capture anticipated graduation as one term/year choice.
- [x] Expose the same fields to authorized profile editors and profile summaries.
- [x] Preserve non-student completion behavior and existing student year data.
- [ ] Apply migration `0097_student_graduation_term` after reviewing the pending `0095` and `0096` collaborator migrations.

### Review

- **Shipped in source:** Student profiles use `Freshman`, `Sophomore`, `Junior`, `Senior`, or `Grad`, plus choices such as `Spring 2027` and `Winter 2027`.
- **Boundary:** This is profile metadata, not automatic role or offboarding logic.
- **Deployment:** Held until the shared pending migration chain can be applied together intentionally.

## Completed: Users roster labels and Add users polish (2026-07-16)

- [x] Derive Student roster titles from primary area and Student status.
- [x] Rename invitation commands to Add users and remove the Users subtitle.
- [x] Strengthen the shared invite-first dialog hierarchy without changing submission behavior.
- [x] Confirm Missing photos remains Staff/Admin-only and Live Production remains globally selectable.
- [x] Complete repository gates and record final dev-server handoff.

### Review

- **Shipped:** William and other Video students now read `Video Student` in the roster, with the equivalent shared area label used for Photo, Graphics, Communications, and Live Production students. The dialog now separates Paste a roster from Add one person with clearer access guidance and a count-aware submit label.
- **Boundary:** This is display derivation only. It does not overwrite stored profile titles or change user roles, permissions, invitation APIs, or the Staff/Admin visibility gate for roster cleanup metrics.
- **Browser proof:** Authenticated localhost verified the derived William row, concise Users header, Add users dialog, and Live Production option without submitting data.
- **Verified:** 28 focused Users/onboarding tests, focused ESLint, TypeScript, all 96 migration prefixes, codemap/docs checks, whitespace, and `npm run build:app` passed. The dev server was restarted cleanly at `http://localhost:3001` for follow-up work.

## Completed: Annotated web profile-data standardization (2026-07-15)

- [x] Standardize Personal and Work phone input and storage formatting.
- [x] Hide Slack profile fields without removing their schema columns.
- [x] Separate Wiscard card number and issue code while preserving the combined kiosk lookup.
- [x] Add standardized clothing and shoe size systems plus birthday month/day and nullable year.
- [x] Add Live Production to assignment areas and every exhaustive area contract.
- [x] Apply profile-page hierarchy, completion-notice, direct-report badge, and password-action feedback.
- [x] Add focused validation, API, and source-contract coverage.
- [x] Refine apparel sizing, birth-year privacy, one-row Wiscard editing, and profile-photo cropping from authenticated browser feedback.

### Review

- **Shipped:** The web profile now uses the person's name, masks both phone inputs into `(XXX) XXX-XXXX`, keeps the ten-digit Wiscard number and one-digit issue code together on one desktop row, standardizes top and bottom apparel sizes, assumes US for visible shoe sizing, protects birth year from other viewers, lets authorized users crop and reposition profile photos, hides stored Slack fields, removes redundant completion and direct-report badges, and routes password changes through the top profile menu.
- **Data:** Migration `0094_user_birthday_and_live_production` adds birthday month/day/year columns and the `LIVE_PRODUCTION` area enum. Existing combined Wiscard lookup values and Slack data are retained.
- **Verified:** 58 focused profile, Users, Resources, and Schedule tests passed with focused ESLint, TypeScript, Prisma validation, all 96 migration prefixes, codemap/docs checks, whitespace checks, and `npm run build:app`.
- **Deployment:** `0094_user_birthday_and_live_production` was applied to Neon through the repository's HTTP fallback on 2026-07-15. Live health reports all 96 local migrations applied, no pending migrations, no unresolved failures, and no database-only migrations. Authenticated localhost browser proof now covers the refined profile layout and selectors; automated file selection remained unavailable for the crop dialog.

---
## Completed: Booking and Schedule title normalization (2026-07-15)

- [x] Preserve canonical UW sport codes such as `MBB` and `WBB` in uppercase.
- [x] Normalize ordinary booking-title words across reservation, draft, shared edit, and kiosk write paths.
- [x] Keep title connectors lowercase and intentional camel-case names intact.
- [x] Add focused utility, persistence, and audit regression coverage.
- [x] Apply the same rule to manual, edited, restored, and ICS-synced scheduled events while retaining raw source summaries.
- [x] Correct the event boundary: keep normalization for manual titles, but preserve source casing for ICS sync and calendar-title restore so external acronyms remain intact.
- [x] Canonicalize known abbreviated team names such as `TCU`, `USC`, and `UCLA` in new/edited titles plus dashboard, booking, and structured-opponent read models.
- [x] Extend abbreviated-team display correction to native kiosk API projections and the GearOps companion projection, with regression coverage for legacy values.

### Review

- **Shipped:** New and edited booking titles plus titles on manual event records store one normalized display value. Imported events retain source casing through sync, staff title edits, and calendar-title restore, so acronyms such as `USC`, `UCLA`, and `TCU` remain uppercase. Examples for manual input: `MBB practice` becomes `MBB Practice`; `MBB GOLF` becomes `MBB Golf`; `MBB vs IOWA` becomes `MBB vs Iowa`.
- **Boundary:** Existing stored bookings and events are not silently rewritten by a read. Known team abbreviations are corrected in display/read projections, while a separate reviewed backfill would still be required to rewrite all historical records in bulk.
- **Follow-up shipped:** Native kiosk dashboard, event, student, scan, inferred-custody, and checkout-detail projections plus the GearOps companion projection now correct legacy `TCU`, `USC`, and `UCLA` casing without rewriting stored values, raw source summaries, or audit history.
- **Verified:** 84 focused kiosk and companion tests passed, along with full ESLint, TypeScript, codemap/docs verification, whitespace checks, and `npm run build:app`.

## Completed: Native iOS Guides repair, reader polish, and Licenses polish (2026-07-15)

- [x] Restore full guide reading after the Resources list-payload slimming.
- [x] Preserve bounded client-side guide body search without restoring heavy list Markdown.
- [x] Replace the web-like guide reader chrome with a compact native header, typography, step, and callout treatments without repeating the generated body excerpt.
- [x] Improve native Licenses capacity, active-code, occupancy, and status hierarchy.
- [x] Add focused contract coverage and sync Mobile, Resources, Licenses, and iOS audit docs.
- [x] Pass focused Vitest, iOS drift/gap/project checks, docs verification, whitespace checks, and the Wisconsin simulator build.

### Review

- **Shipped:** Native Guides now fetches full Markdown by slug with loading, retry, and refresh states while the guide list remains compact. The reader uses a compact metadata header, native Dynamic Type hierarchy, a cardless article canvas, and clearer operational steps. Generated body excerpts and leading Markdown rules no longer duplicate article content in the header transition. Licenses now surfaces shared capacity first, highlights the active code, keeps student occupancy neutral, and uses blue for in-use states.
- **Boundaries preserved:** Guides remains read-only; license create, renew, retire, export, occupant, and full-history administration remains web-owned.

## Completed: Apple-design pass — iOS settings pages (2026-07-11)

- [x] NotificationSettingsView: split mega-section into real sections (Status / Pause Alerts / Delivery / Notification Types); delete fake categoryHeaderRow
- [x] NotificationSettingsView: de-duplicate pause chip labels; drop saving-disable input lockout on toggles
- [x] AccountSecuritySettingsView: preserve focus on show/hide passwords; animate status messages
- [x] ProfileView SettingsRowIcon + notification icons: Dynamic Type scaling
- [x] Build iOS target (clean), update AREA_MOBILE.md changelog, commit + push

### Review

All four settings surfaces audited (SettingsView, NotificationSettingsView, AccountSecuritySettingsView, ProfileView hub). SettingsView itself needed nothing beyond the recent system-Settings redesign. The structural win was NotificationSettingsView's section hierarchy. Deliberately NOT changed: the SettingsRow (solid icon square) vs SettingsMenuRow (tinted icon) split — SettingsMenuRow is the app-wide row language (Browse, Licenses); unifying it is a bigger cross-app pass, out of scope here.


## Completed: Sidebar end-to-end ownership pass (2026-07-10)

Plan: `tasks/sidebar-ownership-pass.md`

- [x] Clarify desktop hierarchy, active state, badges, and quick actions.
- [x] Tighten collapsed, account, theme, logout, and mobile behavior.
- [x] Complete focused tests, docs, repository gates, and browser verification boundary.

### Review

- **Shipped:** The sidebar now resolves one active destination, labels Staff tools as Operations, restores collapse state, keeps collapsed badges visible, uses accessible targets and landmarks, closes its mobile drawer after navigation, and aligns the web bottom bar with unified Bookings.
- **Trust fixes:** Same-route booking changes refresh shell urgency, logout failures are visible, the conflicting Command-B shortcut is removed, and the unstable hover-only booking shortcut no longer disappears under urgent counts because creation remains owned by Bookings.
- **Verified:** 11 focused sidebar/navigation tests, focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs, whitespace, and `npm run build:app` passed.
- **Browser limitation:** Dia continues to block authenticated localhost app routes with `ERR_BLOCKED_BY_CLIENT`, so interactive expanded/collapsed/mobile runtime proof is not claimed.

## Completed: Sweeping Users ownership pass (2026-07-10)

Plan: `tasks/users-ownership-pass.md`

- [x] Unify roster hierarchy, filters, summary, and row identity.
- [x] Tighten onboarding, org chart, and profile handoffs.
- [x] Fix role, loading, empty, pagination, and action-state trust issues.
- [x] Complete focused tests, docs, repository gates, and record the browser boundary.

### Review

- **Shipped:** Users now has a clearer roster hierarchy, one primary onboarding action, grouped secondary tools, operational summary, canonical role badges, responsive onboarding status, direct invite handoff, and stronger empty/loading/action feedback.
- **Trust fixes:** Availability deletion confirms intent; legacy org-chart cycles stay visible; destructive deactivation cannot be bundled with profile edits; avatar blobs are deleted only after database success; profile-photo focus and sensitive clipboard failure feedback are explicit.
- **Verified:** 40 focused Users/onboarding/privacy tests, focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs, whitespace, and `npm run build:app` passed.
- **Browser limitation:** Dia continues to block authenticated localhost app routes with `ERR_BLOCKED_BY_CLIENT`, so interactive desktop/narrow runtime proof is not claimed.

## Completed: Notifications end-to-end ownership pass (2026-07-10)

Plan: `tasks/notifications-ownership-pass.md`

- [x] Clarify inbox hierarchy, preferences access, and role-aware operations.
- [x] Make counts, unread filtering, row actions, and pagination trustworthy.
- [x] Cover every notification family with useful labels and destinations.
- [x] Complete focused tests, docs, repository gates, and browser verification attempt.

### Review

- **Shipped:** Notifications now has a calmer action-inbox hierarchy, direct preferences access, All/Unread controls, complete generic destination actions, broader notification taxonomy, responsive row controls, and named recovery states.
- **Trust fixes:** Nullable timestamps fall back safely; unread mutations remove filtered rows, invalidate every inbox cache, synchronize the shell badge, and roll back cleanly. Pagination clamps invalid pages, and the API separates filtered totals from whole-inbox totals with deterministic ordering.
- **Verified:** 30 focused notification tests, focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs, whitespace, and `npm run build:app` passed.
- **Browser limitation:** Dia rejected the authenticated localhost route with `ERR_BLOCKED_BY_CLIENT`, so interactive desktop/narrow runtime proof is not claimed.

## Completed: Sweeping Settings ownership pass (2026-07-10)

Plan: `tasks/settings-sweeping-ownership-pass.md`

- [x] Remove the nested content rail and restore working width across every subpage.
- [x] Replace the flat mobile tab strip with grouped Settings discovery.
- [x] Rename implementation-shaped destinations without changing routes or RBAC.
- [x] Fix Booking extensions load honesty and notification pause persistence feedback.
- [x] Correct Appearance and Database diagnostics trust copy.
- [x] Complete repository gates and authenticated desktop/narrow browser verification attempt.

### Review

- **Shipped:** Settings now has a full-width shared page shell, grouped mobile discovery, intent-first destination labels, a quieter overview, named Booking extensions load recovery, persistence-aware notification pause/resume feedback, and honest Appearance/Database diagnostics copy.
- **Verified:** 40 focused Settings tests, focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs, whitespace, and `npm run build:app` passed.
- **Browser limitation:** Dia blocks `localhost`; `127.0.0.1` served the freshly compiled Settings route but could not reuse the localhost authentication cookie and redirected to login. Authenticated desktop and narrow visual proof is therefore not claimed.

## Completed: Resources end-to-end UI ownership pass (2026-07-10)

Plan: `tasks/resources-ownership-pass.md`

- [x] Restore visible URL-backed library filtering and preserve Quick find.
- [x] Add retryable guide, contact, and assignment failure states.
- [x] Protect unsaved new-guide work and stop failed/unauthorized edit sessions cleanly.
- [x] Add persistent authoring actions and visible Media Drive copy recovery.
- [x] Complete repository gates and authenticated desktop browser verification attempt.

### Review

- **Shipped:** Resources now has visible URL-backed filtering plus separate Quick find, named retryable guide/reference failures, partial-data honesty, protected new-guide work, edit load/ownership recovery, persistent authoring actions, and visible Media Drive copy failure recovery.
- **Verified:** 26 focused Resources tests, focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs, whitespace, and `npm run build:app` passed.
- **Browser limitation:** Authenticated Chrome rendered the updated toolbar with no console errors, but the local runtime kept guide/API data in its loading shell and did not commit filter input to the URL after debounce or Enter. Browser interaction stopped after two attempts, so result filtering and narrow layout are not claimed as authenticated runtime proof.
- **Deferred:** Reader verification-vs-update semantics and mobile table-of-contents navigation need separate product/design contracts.

## Completed: Licenses end-to-end UI ownership pass (2026-07-10)

Plan: `tasks/licenses-ownership-pass.md`

- [x] Simplify page hierarchy and role-aware administration controls.
- [x] Make claim, inspect, retired-history, and custody actions explicit.
- [x] Polish every create, renew, claim, return, history, and detail overlay.
- [x] Redact other holders' personal details from student responses.
- [x] Sync docs and complete repository and browser verification.

### Review

- **Shipped:** Licenses now uses a compact admin toolbar, blue active-use semantics, explicit Claim/Inspect actions, inspectable retired records, stable pending labels, inline recovery states, retryable personal history, editable labels, and server-side student holder redaction.
- **Verified:** 11 focused tests, focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs, whitespace, and `npm run build:app` passed. Authenticated Chrome smoke covered the loaded admin route, Add license dialog, explicit row actions, and detail sheet with no console errors.
- **Blocked proof:** The authenticated port-3001 preview stopped serving `/licenses` before the narrow-width reload. Narrow layout remains build/source verified with table overflow containment, but is not claimed as authenticated runtime proof.
- **Deferred:** Plan 053 remains blocked on expired-code claim eligibility and timezone policy. This UI pass did not change expiry behavior.

## Completed: Operational status rail page migrations (2026-07-10)

Plan: `tasks/archive/completed-2026-06/operational-status-rail-page-migrations-plan.md`

- [x] Migrate Dashboard, Inventory Hygiene, Battery Ops, and Notifications.
- [x] Migrate Kits, Licenses, Onboarding Status, and Allowed Emails.
- [x] Preserve expanded metrics, filters, links, notices, and analytical card exclusions.
- [x] Add contracts, sync owner docs, and complete repository verification.

### Review

- **Shipped:** Eight remaining page-level operational summary strips now share one action-first status system. The custom Dashboard `StatCard` helper was removed. Reports, import outcomes, badges, item insights, Resources references, and entity details stay card-based because they are analytical or navigational rather than operational queues.
- **Verified:** Seven focused test files passed with 21 tests; focused ESLint, TypeScript, all 93 migration prefixes, codemap/docs checks, whitespace, and `npm run build:app` passed.
- **Blocked:** Authenticated visual smoke could not start because the installed in-app Browser plugin is missing its required browser runtime file. No fallback browser mechanism was used.

## Completed: Items operational status rail (2026-07-10)

Plan: `tasks/archive/completed-2026-06/items-status-rail-plan.md`

- [x] Replace the page-local inventory summary grid with the shared `OperationalStatusRail`.
- [x] Preserve every status count, multi-select filter action, selected state, and page reset.
- [x] Sync docs and complete focused, type, migration, docs, whitespace, build, and protected-route browser checks.

### Review

- **Shipped:** `/items` now presents active inventory plus prioritized nonzero custody/attention states in the shared compact rail. All six status counts remain pressed-state-aware filters under Details, and partial-control recovery stays separate.
- **Verified:** Focused Vitest (3 tests), focused ESLint, TypeScript, migration-prefix guard, codemap/docs checks, whitespace, and `npm run build:app` passed. Local browser smoke compiled `/items` and reached the expected `/login` redirect; authenticated visual proof remains session-blocked.
- **Follow-up:** Metric-card links/buttons and their nested cards now fill the grid row, so wrapped helper copy no longer produces uneven card tops or heights. A focused source contract guards both wrapper and card `h-full` behavior.

## Completed: iOS push notification reliability (2026-07-10)

Problem: Erik receives no push notifications on iOS.

Root cause (verified in prod DB): Xcode dev builds get *sandbox* APNs tokens; `src/lib/push/apns.ts` only talks to the production APNs host in production. Prod APNs returns `BadDeviceToken` for sandbox tokens and the code permanently revokes them -- revocation timestamps line up exactly with send timestamps (Jul 9 17:41:20 notification → 17:41:25 revocations of tokens `80b91556`/`fb9fa335`). Every reinstall repeats: register → first push → revoked → silence. Prefs are default (push on); APNs env vars all present in Vercel prod.

Secondary hazards: `void sendPushToUser(...)` fire-and-forget can be frozen when the serverless response returns before the APNs round-trip completes; no JWT re-mint on `ExpiredProviderToken`/`InvalidProviderToken`; non-revoking APNs errors are only visible in 1h-retention logs; no end-to-end delivery test.

Plan:
- [x] 1. `apns.ts`: send alerts via production host; tokens rejected with `BadDeviceToken`/`Unregistered` are retried on the sandbox host; revoke only if both environments reject. Log per-reason outcomes.
- [x] 2. `apns.ts`: on 403 `ExpiredProviderToken`/`InvalidProviderToken`, invalidate the cached JWT and retry the batch once with a fresh token.
- [x] 3. `notifications.ts`: route deferred pushes through `after()` (next/server) with an awaited fallback so serverless freeze can't drop sends; replace bare `void sendPushToUser` call sites (notifications.ts, firmware-watch.ts).
- [x] 4. New `POST /api/devices/test`: sends a test push to the caller's active tokens and returns per-token outcome (env used, reason) for self-serve verification.
- [x] 5. Build + unit tests; docs sync (AREA_NOTIFICATIONS.md change log, GAPS_AND_RISKS if applicable); commit + push.

---

## Active rollout: Big Ten Network collaborator access (2026-07-16)

- [x] Ship a fixed default-deny `COLLABORATOR` role with presentational BTN affiliation and server-owned `BTN_STANDARD` profile.
- [x] Limit BTN authorization to gear borrowing and read-only published Schedule with no per-user exceptions.
- [x] Carry BTN metadata through admin invite, registration, login, `/api/me`, web, native iOS, and kiosk.
- [x] Enforce sanitized catalog, own-reservation mutations, own-booking reads, profile privacy, global kiosk roster, published snapshots, persistent unfollow, and changed-republish notifications.
- [x] Add reduced web/iOS surfaces and focused authorization/onboarding/privacy/Schedule/kiosk tests.
- [x] Replace the fixed registry with database-backed affiliation policies, nine validated capabilities, revisions, risky-change previews, and the admin Collaborator Access editor.
- [x] Apply migrations `0095` through `0098`; migration health is 100/100 with no pending, failed, or database-only rows.
- [x] Preserve BTN access and seed Learfield suspended with no grants.
- [ ] Deploy the dual-read server/web and native clients in that order.
- [ ] Smoke-test a temporary external BTN account across every approved and denied surface, then deactivate it and verify session revocation.
- [ ] Invite Trey only after production authorization checks pass.
- Learfield invitations remain blocked until an admin configures, reviews, and activates its policy. Brand Communications Schedule management remains deferred. Do not authorize from affiliation or grant an internal role as a shortcut.

---

## Completed: Global search and text filtering typing stability (2026-07-10)

Problem: fast typing hitches and loses field focus while pages "update" the filter.

Root causes (verified):
- /items: `useItemsQuery` lacks `placeholderData: keepPreviousData` → every debounced search change flips `isLoading` → whole DataTable + ItemsToolbar (with the focused input) unmounts into a skeleton. Zero-result branch also unmounts the input.
- /kits: full-page `if (query.loading) return <KitsLoadingState/>` + no keepPreviousData → same focus loss.
- /labels, /search: input stays mounted but results wipe to skeletons on every debounce (flash, untrustworthy).
- All pages: keystrokes update page-level state → full page/table re-render per keystroke (the hitch).

Plan:
- [x] 1. New shared `src/components/DebouncedSearchInput.tsx` with local echo state (instant keystrokes, no parent re-render), debounced commit (250ms), instant commit on clear/Enter/Escape, adoption of external value changes (clear-all, URL nav), ref-forwarding shadcn Input with search icon + clear button.
- [x] 2. /items: `placeholderData: keepPreviousData` in use-items-query; collapsed search/debouncedSearch in use-url-filters (debounce lives in the input now); toolbar + bulk bar hoisted out of the loading/error/empty conditional so the input never unmounts; DebouncedSearchInput in ItemsToolbar; page resets on committed search change only; removed dead toolbar/bulkBar props from DataTable.
- [x] 3. /kits: `keepPreviousData: true` in useKitsQuery's useFetch; DebouncedSearchInput; full-page skeleton now first-load-only.
- [x] 4. /labels: `keepPreviousData: true`; DebouncedSearchInput.
- [x] 5. /search (global): DebouncedSearchInput committing straight to the `q` URL param (three query states collapsed to one); previous results stay visible dimmed with an Updating spinner while the fan-out is in flight; skeletons only when there are no prior results.
- [x] 6. /users: left as-is on purpose. UserFilters already implements the local-draft + 150ms debounce pattern with keepPreviousData and its own searching spinner; converting it would be churn, not improvement.
- [x] 7. Verify (see review).

### Review

- **Shipped:** Shared `DebouncedSearchInput` plus keep-previous-data wiring across Items, Kits, Labels, and global Search. Root cause was twofold: query-key changes flipped `isLoading` and swapped the results surface (including the focused input, on Items and Kits) for a skeleton, and per-keystroke page-level state re-rendered the whole table while typing. Both are fixed structurally: keystrokes never leave the input component, and result surfaces never unmount their search field.
- **Verified:** `npx tsc --noEmit` clean; ESLint clean on all touched files; full vitest suite 319 files / 1931 tests passing including new `tests/search-input-focus-stability.test.ts` (13 source-contract guards); `npm run build:app` passes (`npm run build` blocked locally by the known Neon 5432 restriction on the prisma migrate step). Live browser proof via a temporary unauthenticated scratch route: 10 keystrokes at 40ms apart produced 0 commits mid-typing, exactly 1 commit after settling, focus held throughout; external clear adopted silently without a spurious commit; Escape cancelled a pending commit; Enter and field-clearing committed instantly. Scratch route deleted after verification.
- **Deferred:** Authenticated browser proof on /items itself (typing over live data) remains session-blocked, same as prior sessions; the Plan 056 Playwright harness is the right future home for that journey. The mechanism is covered by the scratch-route proof plus source-contract tests.

## Completed: UI launch hardening Plans 052, 054, and 055; Plan 056 runtime proof blocked (2026-07-10)

- [x] Plan 052: Gate restricted Settings routes before mounting their controls.
- [x] Plan 054: Make Items reference-data bootstrap failures visible and recoverable.
- [x] Plan 055: Preserve trustworthy Dashboard totals when fast-count refreshes fail or return partial data.
- [x] Plan 056: Add the business-data-safe authenticated Playwright harness, isolated-target contract, and fail-closed CI/release mode.
- [ ] Plan 056 runtime proof: Run the 27 discovered tests with a dedicated non-production identity against an isolated target.
- [ ] Plan 053: Define expired-license claim eligibility and its timezone boundary before implementation.

### Review

- **Shipped:** Settings direct-route rendering now follows the canonical `SETTINGS_SECTIONS` role matrix, keeps Personal settings available to all authenticated roles, and recovers from forbidden or unknown routes without mounting child controls. Items now models initial, refresh, and named partial bootstrap failures, preserves healthy or stale options, handles auth expiry, exposes retry/partial alerts, and keeps edit actions fail-closed. Dashboard fast-count partial/error states preserve trustworthy operational totals, scope shift-only failures narrowly, expose stale/retrying status, and provide manual dual-query refresh. The Playwright harness covers Dashboard, Bookings, Items, Search, Schedule, Settings, and Profile on desktop and narrow mobile, with request-intercepted recovery states and release-mode credential enforcement. The prior `BookingEquipmentTab` exhaustive-deps warning is also corrected.
- **Verified:** The focused hardening and harness set passed 61 tests. `npm test` passed 320 files and 1,939 tests; full ESLint passed with `--max-warnings=0`; `npx tsc --noEmit --pretty false` passed; `npm run db:migrate:check` passed all 93 migrations; `npm run codemap` regenerated the codemaps and `npm run verify:docs` passed; `npm run build:app` passed; and `npx playwright test --list` discovered 27 tests. CI without credentials exited 1 as intended, while focused safety coverage proved isolation opt-in, production-host rejection, partial-credential rejection, and the strict non-admin role contract.
- **Deferred:** The 27 browser tests have not run through authenticated routes. No dedicated non-production credentials or isolated target were available, so this work does not claim STUDENT, STAFF, or ADMIN runtime proof.
- **Blocked:** Plan 053 is blocked on product policy. `docs/AREA_LICENSES.md` treats expiry as informational and does not define whether an expired code may receive a new claim or which timezone/date boundary controls eligibility. No license behavior or policy was changed.
- **Proof:** Source and regression artifacts are `src/app/(app)/settings/layout.tsx`, `src/lib/nav-sections.ts`, `tests/settings-route-role-gate.test.ts`, `src/app/(app)/items/hooks/use-filter-options.ts`, `src/app/(app)/items/page.tsx`, `tests/items-filter-options.test.ts`, `tests/items-page-init.test.ts`, `src/hooks/use-dashboard-data.ts`, `src/app/(app)/page.tsx`, `src/app/(app)/dashboard-types.ts`, `tests/dashboard-fast-count-truth.test.ts`, `playwright.config.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/launch-smoke.spec.ts`, and `tests/schedule-source-truth-smoke-contract.test.ts`.
- **Next:** Provision a dedicated STUDENT or STAFF identity on an isolated local/review target and run the documented `PLAYWRIGHT_RELEASE=1 PLAYWRIGHT_TARGET_ISOLATED=1 ... npm run test:e2e:smoke` command with the required base URL and credentials. Resolve the license expiry policy before resuming Plan 053.

## Completed: Schedule event edit hardening (2026-07-09)

Plan: `tasks/archive/completed-2026-06/schedule-event-edit-hardening-plan.md`

- [x] Keep event classification valid after Event detail edits.
- [x] Let operators repair missing sport context from Event detail.
- [x] Add regression coverage, sync docs, and complete verification.

### Review

- 2026-07-09: Follow-up audit found that create is strict but Event detail still sends independent `isHome` and `opponent` patches and cannot edit sport. That leaves a path to an incomplete game and makes the data-quality queue's missing-sport recovery incomplete. Calendar sync already preserves the locked classification pair, so this remains a no-migration web/API hardening slice.
- 2026-07-09: Shipped sport repair and coupled event-classification editing on Event detail. PATCH now derives venue state, rejects incomplete games and uncoupled opponent changes, restores sport/opponent/venue together from the source, and calendar sync preserves the locked triple. Manual events remain Manual and never show calendar-restore actions. Verified with 288 Schedule/calendar/Dashboard tests, focused ESLint, TypeScript, migration guard, codemap/docs, whitespace, and app build; authenticated local visual proof remains session-blocked.

## Completed: Schedule event classification and list rails (2026-07-09)

Plan: `tasks/archive/completed-2026-06/schedule-event-classification-plan.md`

- [x] Harden manual event creation around explicit game and non-game classifications.
- [x] Restore distinct Home, Away, Neutral, and Non-game list rails.
- [x] Add regression coverage, sync Schedule docs, and complete verification.

### Review

- 2026-07-09: Root cause confirmed. The shared venue helper labels every nullable `isHome` event as Neutral even though Event detail and manual-event behavior already use `opponent = null` as the Non-game contract. The creation API also accepts independent sport, venue, and opponent values, allowing an incomplete game payload to become indistinguishable from Non-game. This slice preserves the existing schema and makes that contract explicit at the form and API boundary.
- 2026-07-09: Shipped explicit Home game, Away game, Neutral-site game, and Non-game creation semantics with server-derived venue state; games require sport/opponent while sport-tagged media days remain Non-game. Shared list/week/calendar/assign/dashboard tones and filters now distinguish Non-game, desktop/mobile List rows restore the left rail, and data quality no longer flags the valid media-day shape. Verified with 164 focused Schedule/Dashboard tests, focused ESLint, TypeScript, migration guard, codemap/docs checks, whitespace, and `npm run build:app`. Authenticated local visual proof remained blocked by host-scoped sessions; no production mutation was attempted.

## Completed: Shared operational status rail (2026-07-09)

Plan: `tasks/archive/operational-status-rail-plan.md`

- [x] Audit Schedule, Fix Today, peer operational surfaces, and the installed shadcn layer.
- [x] Add the shared rail and migrate Schedule plus Fix Today.
- [x] Add contracts, sync docs, and complete web verification.

### Review

- 2026-07-09: Added a shared shadcn-backed operational status rail with bounded priority items, overflow accounting, calm all-clear copy, orientation, and collapsed details. Schedule keeps its queue math and details while using the rail presentation; Fix Today replaces its duplicate health badge, summary card, and all-clear card, and its section cards now use semantic tokens plus shadcn separators/footer composition. Focused Vitest (6 files, 26 tests), ESLint, TypeScript, migration guard, codemaps/docs, whitespace, and `npm run build:app` passed. The build retains the unrelated `BookingEquipmentTab.tsx` warning. Local route smoke reached the expected login redirect, but authenticated visual proof was unavailable because localhost had no signed-in session. Dev server: `http://localhost:3001`.

---

## Completed: Schedule list triage UI (2026-07-09)

Plan: `tasks/archive/completed-2026-06/schedule-list-triage-ui-plan.md`

- [x] Compress the Schedule command and readiness surfaces without removing operational queues.
- [x] Give event rows stable staffing columns, clearer publication/venue language, and direct open-slot action.
- [x] Restore mobile date grouping and Hide event access.
- [x] Add focused contracts, sync docs, and run web verification.

### Review

- 2026-07-09: `/schedule` now keeps all active filters visible, moves source status under readiness Details, scopes crew gaps by affected events, aligns My calls today count/copy/routing, and prevents partial health reads from showing all-clear. Desktop rows use stable Time/Event/Coverage/Status/Crew/Actions columns with direct Assign N actions, explicit venue labels, and Unpublished changes copy; desktop and mobile share compact date groups, and smaller layouts retain Hide event access. Focused Vitest (4 files, 21 tests), ESLint, TypeScript, migration-prefix guard, docs/codemaps, whitespace, and an initial `npm run build:app` passed. Authenticated visual smoke remains unavailable because localhost redirects to login and the production Chrome session is host-scoped. The final build rerun is blocked by a concurrent unrelated licenses `releaseCode` argument mismatch, which this slice leaves untouched.

---

## Completed: Booking history item identity (2026-07-09)

Plan: `tasks/archive/booking-history-item-identity-plan.md`

- [x] Persist the exact kiosk-added and returned equipment names in audit payloads.
- [x] Render those names through the shared booking-history timeline with legacy fallbacks.
- [x] Run closeout verification and document the result.

### Review

- 2026-07-09: New kiosk history writes now carry serialized asset or numbered-unit identity, and completed kiosk returns carry their returned item names. This removes generic `Added an item` and `Returned gear` summaries for new activity while keeping historical records readable. Focused Vitest (12 tests), TypeScript, migration-prefix guard, docs/codemaps, whitespace, and `npm run build:app` passed. The build retains the unrelated `BookingEquipmentTab.tsx` exhaustive-deps warning; no authenticated browser session was available for runtime proof.

---

## Completed: Kiosk iOS 26 platform baseline (2026-07-09)

Plan: `tasks/archive/completed-2026-06/kiosk-ios26-platform-baseline-plan.md`

- [x] Retire the kiosk target's iOS 17 deployment floor.
- [x] Preserve the dedicated target while allowing iOS 26 and Liquid Glass APIs.
- [x] Update contracts/docs and run kiosk verification.

### Review

- 2026-07-09: `WisconsinKiosk` now targets iOS 26.0 in XcodeGen and the generated project while remaining a separate iPad-only native target. Current Kiosk/Mobile docs identify the managed M2 iPad Air fleet, the target-split contract pins both apps to iOS 26, and legacy fixed-device comments no longer describe the retired 10.5-inch/iPadOS 17 baseline. Verification passed: focused Vitest (3 files, 8 tests), TypeScript, XcodeGen project check, iOS drift/gap audit, docs/codemaps, whitespace, and escalated `npm run ios:xcode:verify:kiosk` simulator plus generic-device builds. Liquid Glass is now available unconditionally for future kiosk visual slices. `UIRequiresFullScreen` deprecation and the HID scanner Swift 6 warning remain documented follow-ups.

---

## Active: Kiosk windowing and compiler cleanup (2026-07-09)

Plan: `tasks/kiosk-windowing-cleanup-plan.md`

- [x] Replace the deprecated full-screen compatibility mode with adaptive kiosk scenes.
- [x] Remove the scanner Swift 6 default-argument warning.
- [x] Add contracts, documentation, and complete target verification.
- [ ] Confirm compact-scene resizing and orientation on the managed M2 iPad Air.

### Review

- 2026-07-09: Removed the deprecated full-screen compatibility mode, added all iPad orientations and a 640×540 scene minimum, and made the remaining fixed kiosk splits responsive. Both `WisconsinKiosk` and `Wisconsin` compile warning-free; full Vitest, docs/codemaps, and production app builds pass. Hardware resize/orientation confirmation remains open.

---

## Active: Kiosk active-checkout item editing (2026-07-09)

Plan: `tasks/kiosk-active-checkout-item-editing-plan.md`

- [x] Replace text-field-plus-Add equipment entry with direct HID scan submission.
- [x] Make each active serialized asset and numbered bulk unit removable by touch.
- [x] Add focused contracts, sync docs, and run kiosk verification.
- [ ] Confirm the workflow on the managed M2 iPad Air kiosk with its paired scanner.

### Review

- 2026-07-09: Existing-checkout equipment editing is now scanner-first. The detail sheet automatically owns HID capture, submits each completed scan directly, pauses capture for title editing/mutations/removal confirmation, and renders exact active serialized assets and numbered units with native destructive Remove actions. Verification passed: focused Vitest (3 files, 21 tests), full Vitest (308 files, 1,866 tests), TypeScript, iOS drift/gap audits, docs/codemaps, whitespace, `npm run build:app`, and escalated `npm run ios:xcode:verify:kiosk` simulator plus generic iOS builds. The full suite also exposed and corrected three stale pending-pickup owner-transfer expectations without changing product behavior. Managed M2 iPad Air hardware confirmation remains open.

---

## Active: Booking owner transfer (2026-07-09)

Plan: `tasks/booking-owner-transfer-plan.md`

- [x] Add staff/admin-only transfer ownership API and lifecycle audit.
- [x] Wire the shared booking detail page and sheet action.
- [x] Add focused coverage, sync docs, and run verification.
- [x] Correct transfer-owner to allow student owners/creators, not staff/admin only.
- [x] Add a reservation event-link mutation for changing or clearing linked scheduled events after creation.
- [x] Wire event-link editing into the shared booking detail page and sheet.
- [x] Add focused policy/service/route coverage, sync docs, and rerun verification.
- [x] Extend event-link editing to existing editable checkouts without changing custody or return behavior.
- [x] Harden event relinking with idempotent stale handling, sharper validation coverage, stale UI copy, and checkout custody invariants.

### Review
- 2026-07-09: Event relink hardening shipped locally. Stale duplicate event-link saves now return success when the requested event set already matches current booking state, matching the idempotent booking PATCH pattern. Route coverage now rejects duplicate and over-cap `eventIds` before service dispatch; service coverage now rejects over-cap and missing event ids, blocks terminal bookings, proves active checkout support, and asserts checkout relinking only updates event context rows. The dialog now uses clearer stale-conflict copy. Verification passed: `npx vitest run tests/booking-events-route-contract.test.ts tests/update-booking-events.test.ts tests/booking-transfer-owner-route-contract.test.ts tests/transfer-booking-owner.test.ts tests/decision-contracts.test.ts`.
- 2026-07-09: Existing checkout event relinking shipped locally. `POST /api/bookings/[id]/events` now supports editable active bookings, including `OPEN` and `PENDING_PICKUP` checkouts, while still rejecting completed/cancelled bookings. The shared linked-events dialog appears on checkout details whenever `allowedActions` includes `edit`; relinking only updates event context and audit history, not gear window, item custody, kiosk return execution, or allocation records.
- 2026-07-09: Follow-up correction shipped locally. Student requesters/creators can transfer their own active bookings while staff/admin keep transfer access across active bookings. Editable active bookings now have `POST /api/bookings/[id]/events` plus a shared dialog to link, change, or clear up to 3 scheduled events after creation; the service preserves `Booking.eventId` as chronological primary and rewrites `BookingEvent` rows transactionally with `events_updated` audit history. Verification passed: `npx vitest run tests/booking-events-route-contract.test.ts tests/update-booking-events.test.ts tests/booking-transfer-owner-route-contract.test.ts tests/transfer-booking-owner.test.ts tests/decision-contracts.test.ts`, `npx tsc --noEmit --pretty false`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Build still reports the pre-existing `BookingEquipmentTab.tsx` exhaustive-deps warning.
- 2026-07-09: Booking owner transfer is implemented locally with `transfer-owner` policy gating, `POST /api/bookings/[id]/transfer-owner`, transaction-scoped `owner_transferred` audit, and a shared transfer dialog on full detail and sheet surfaces. Verification passed: `npx vitest run tests/booking-transfer-owner-route-contract.test.ts tests/transfer-booking-owner.test.ts tests/decision-contracts.test.ts`, `npx tsc --noEmit --pretty false`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, `npm run build:app`, and `npm run db:migrate:check`. Browser smoke started `npm run dev` and reached `/bookings`, but Chrome redirected to `/login` because no authenticated browser session was available.

---

## Active: Optional Wiscard registration (2026-07-08)

Plan: remove the Wiscard requirement for newly invited accounts while keeping optional profile capture and kiosk identity lookup intact for later scanner parsing work.

- [x] Confirm current onboarding, schema, and kiosk contracts.
- [x] Make register form Wiscard capture optional at the browser layer.
- [x] Let Staff and Student invitations register without a Wiscard.
- [x] Add focused route coverage for optional Wiscard invite behavior.
- [x] Sync Users/Gaps docs and record verification.

### Review
- 2026-07-08: Scope corrected from Staff-only to all new invited accounts. Wiscard scans currently resolve as card number plus issue code, so registration no longer blocks on the field while later capture/parsing work remains open.
- 2026-07-08: Registration now treats `wiscardNumber` as optional in the browser and API schema, normalizes and saves it when supplied, and writes audit metadata based on whether a value was linked. Focused coverage proves both Student and Staff invitations can register without Wiscard values and that a provided scanned value is preserved. Verification passed: `npx vitest run tests/register-route.test.ts`, `npx vitest run tests/public-route-abuse-contract.test.ts tests/api-route-wrapper-contract.test.ts`, `npx tsc --noEmit --pretty false`, `npm run verify:docs` after `npm run codemap`, `git diff --check`, and `npm run build:app`.

---

## Active: App Review demo data isolation (2026-07-08)

Plan: remove the current App Review demo records from production, then only reseed them into an isolated App Review data target.

- [x] Verify the current App Review seed is not fake-only in production.
- [x] Add a delete-only cleanup mode for the guarded App Review demo script.
- [x] Run cleanup against the current production Neon target after explicit approval.
- [x] Decide isolated target: separate Neon branch plus separate review API deployment, or delay App Review until that target exists.
- [x] Add native iOS API-host routing so only the App Review email targets the isolated review host.
- [x] Seed and verify the App Review account only in the isolated target.
- [ ] Update App Store Connect notes/PDF with the final review host and credentials.

### Review
- 2026-07-10: Created a separate empty Neon project for App Review instead of a child branch that would clone production data. The new project has no tables or production rows. Review Vercel deployment, DNS, migrations, and seeding remain blocked because the connected Vercel team scope returns 403 and `review.wisconsincreative.com` has no DNS record. The seed now requires an explicit 16+ character password plus an exact expected database host and no longer prints the reviewer password.
- 2026-07-11: Closed the App Review deployment/data-isolation blocker without touching production. Vercel access was restored; `gear-tracker-app-review` now deploys as a separate Next.js project at `review.wisconsincreative.com` with Review-only secrets and a standalone recreated Neon project. The guarded atomic empty-database bootstrap reconciled 93/93 migrations, the fictional seed completed, and authenticated live smoke returned 200 for login/current-user/users/events with only five `demo-user-*` users and two `demo-*` events visible. The reviewer password is stored in macOS Keychain service `gear-tracker-app-review`, not in the repository or logs.
- 2026-07-17: Advanced the isolated review deployment through migration `0098` and added exact native routing for `jordan.lee.demo@wisc.edu` and `alex.rivera.demo@wisc.edu`. Both disposable accounts retain the Keychain-held review password, authenticate with 200 responses, and return role-correct incomplete profile-completion states; the Student response excludes work phone. The updated simulator build is installed and ready for interactive Welcome testing without production data.
- 2026-07-08: Production verification showed the seeded App Review account can log in and see demo records, but broad staff-visible endpoints can also expose production-backed rows. Schedule returned 103 total rows with 2 demo rows, so seeded data alone is not an isolated demo mode.
- 2026-07-08: Added `APP_REVIEW_DEMO_MODE=cleanup` support to `scripts/seed-app-review-demo.mjs` and exposed `npm run demo:cleanup:app-review`. Ran the cleanup against the configured Neon target with `APP_REVIEW_DEMO_SEED=confirm`; follow-up verification found no App Review demo account, allowed email, users, location, assets, bulk SKU, bookings, events, or notifications in production.
- 2026-07-08: Chose the isolated launch path. The main iOS app now routes only `appreview@wisconsincreative.com` API traffic to `review.wisconsincreative.com`, persisted for session restore; normal users stay on `wisconsincreative.com`, and kiosk/public web links remain canonical. The review host still needs a Vercel deployment wired to an isolated Neon branch before App Review credentials can be submitted.
- 2026-07-08: Verification passed for the native review-host routing slice: `npx vitest run tests/ios-domain-cutover-source.test.ts`, `npm run drift:ios`, `npm run audit:ios:gaps`, `npm run ios:project:check`, `npm run verify:docs`, `git diff --check`, and escalated `npm run ios:xcode:verify`.

---

## Active: Kiosk idle all-day event day buckets (2026-07-08)

Plan: fix the idle Today/Tomorrow event sections so all-day events use their encoded calendar date, not the raw timestamp instant after iPad timezone conversion.

- [x] Confirm the current idle row/detail code path and prior all-day date-math decision.
- [x] Add shared kiosk display-day helpers for all-day and midnight-span events.
- [x] Route idle Today/Tomorrow buckets and event detail labels through the helper.
- [x] Add focused kiosk all-day regression coverage.
- [x] Sync kiosk/mobile docs and lessons.
- [x] Run focused tests and iOS verification gates.

### Review
- 2026-07-08: Fixed kiosk idle Today/Tomorrow bucketing for all-day events. `KioskEvent` now exposes shared display-day helpers that read true all-day timestamps as encoded UTC calendar dates before converting to local display days, while timed events keep local day behavior. `KioskIdleView` filters Today/Tomorrow through that helper, and `KioskEventDetailSheet` uses it for the header and all-day date label. Verification passed: `npx vitest run tests/ios-kiosk-all-day-contract.test.ts`, `npm run drift:ios`, `npm run audit:ios:gaps` (0 missing audits; existing 7 unregistered extracted Swift files still reported), `npm run ios:project:check`, `npm run verify:docs` after `npm run codemap`, `git diff --check`, and escalated `npm run ios:xcode:verify:kiosk`.

---

## Active: iOS build 18 prep (2026-07-07)

Scope: Prepare the main `Wisconsin` iOS app for the next TestFlight/App Store upload. Kiosk remains separate.

- [x] Confirm local `main` is clean and matches `origin/main`.
- [x] Bump main app and Live Activities build number from `17` to `18`.
- [x] Regenerate the Xcode project from `ios/project.yml`.
- [x] Run focused iOS/project verification.
- [x] Upload build 18 to App Store Connect/TestFlight.
- [x] Summarize upload steps and any blockers.

### Review
- 2026-07-10: Prepared build 19 from current `main` after the final release-hardening and APNs registration work. `Wisconsin` and `WisconsinLiveActivities` are build 19; kiosk remains build 1. Project consistency, iOS drift, 47/47 audit coverage, focused source tests, simulator and generic-device builds, signed Release archive, App Store export, TypeScript, docs/codemaps, migration-prefix, whitespace, and `build:app` pass. The signed IPA is `/private/tmp/Wisconsin-19-export/Wisconsin Creative.ipa` with SHA-256 `8e504752c234903eeb016aadeaebf6819f8764cdbd6eb480175ce725e7907feb`. App Store Connect upload was not performed because the external-action approval gate requires explicit upload authorization; real-device APNs, camera/scanner, network, and accessibility QA remain open.
- 2026-07-07: Build 18 uploaded to App Store Connect and is processing. Local `main` matched `origin/main` before the bump. Main `Wisconsin` app and `WisconsinLiveActivities` build numbers moved from 17 to 18; kiosk stayed build 1. XcodeGen regenerated `ios/Wisconsin.xcodeproj`. Verification passed: `npm run ios:project:check`, `git diff --check`, escalated `npm run ios:xcode:verify`, Release archive to `/private/tmp/Wisconsin-18.xcarchive`, App Store Connect export to `/private/tmp/Wisconsin-18-export/Wisconsin Creative.ipa`, and App Store Connect upload. Exported IPA metadata: version 1.0, build 18, display name `Creative`, bundle name `Wisconsin Creative`, production APNs, WeatherKit, `get-task-allow=false`, and packaged `PrivacyInfo.xcprivacy`. Noted cleanup: iOS audit inventory reports seven unregistered newer Swift surfaces, but the build and upload succeeded.

---

## Active: Main validate recovery (2026-07-06)

Plan: restore a green `main` after GitHub Actions `validate` failed on stale iOS tab-shell source-contract assertions.

- [x] Confirm local `main`, `origin/main`, and GitHub `refs/heads/main` point at `be2446e3cb91d8b19f904fbc120224f40c8f314a`.
- [x] Inspect the GitHub Actions failure annotations for the current main commit.
- [x] Confirm current docs and source say the compact directory tab is `More`, not `Browse`.
- [x] Patch only the stale iOS source-contract expectations.
- [x] Run focused Vitest and closeout checks.
- [x] Commit the fix locally.
- [ ] Push the fix to `main`.
- [ ] Confirm the remote `validate` check recovers.

### Review
- 2026-07-06: Recovery in progress. The seven screenshot commits are already on remote `main`; the only current GitHub Actions failure is `validate`, caused by three source-contract files still expecting `Tab("Browse", systemImage: "square.grid.2x2", value: 2)` after the shipped iOS tab polish renamed the compact directory tab to `More` with `ellipsis.circle`.
- 2026-07-06: Local recovery verification passed: focused Vitest for the three failing files, full `npm test` with 299 files / 1,790 tests, `npm audit --audit-level=high` with only one low-severity advisory, `npm run build:app`, `npm run verify:docs`, and `git diff --check`. Local `npm run build` could not safely complete because its migration-deploy preflight needs Neon network access and the approval reviewer rejected the escalated run due remote migration mutation risk.

---

## Active: Vercel Hobby cron deploy unblock (2026-07-03)

Plan: make production deployable on Vercel Hobby by removing sub-daily cron schedules while keeping protected route code available for Pro/manual execution.

- [x] Confirm the deployment failure against current Vercel cron limits.
- [x] Remove the Hobby-incompatible `/api/cron/live-activities` schedule from `vercel.json`.
- [x] Add a source-contract guard so future scheduled cron expressions stay daily-or-slower on Hobby.
- [x] Sync Mobile, Decisions, Gaps, and task notes.
- [x] Run focused cron/source tests, TypeScript, whitespace, docs/codemap, and app build verification.

### Review
- 2026-07-03: Implementation in progress. The deploy-breaking expression was `/api/cron/live-activities` at a sub-daily cadence. The protected route remains in source for manual invocation, Vercel Pro, or an external scheduler, while Hobby keeps native app-opened Live Activity reconciliation as the fallback.
- 2026-07-03: Verification passed with focused cron/source Vitest, TypeScript, codemap regeneration and docs check, whitespace, and `npm run build:app`. `vercel.json` now schedules only daily or weekly cron expressions on Hobby.

---

## Active: iOS push registration health (2026-07-09)

Plan: `tasks/notifications-ios-delivery-fix-plan.md`

- [x] Separate iOS permission state from server-side APNs token-registration state.
- [x] Retry APNs registration for authorized, provisional, and ephemeral permission states.
- [x] Surface a recoverable registration failure in Settings > Notifications.
- [x] Add focused source-contract coverage and sync mobile/notification/risk docs.
- [ ] Complete production Vercel APNs env/log verification and real-device push QA.

### Review
- 2026-07-09: Source audit found that token upsert failures were swallowed by `try?`, Settings only reported OS authorization, and foreground retry excluded provisional/ephemeral authorization. The native fix now reports token-registration truth without overstating APNs delivery. Connected Vercel project/deployment/runtime reads returned 403 for the linked team scope, so production env and runtime proof remain external blockers.

## Active: Notifications support hardening (2026-07-03)

Plan: `tasks/notifications-support-hardening-plan.md`

- [x] Audit notification docs, schema, services, web inbox, app shell badge count, iOS sheet/settings, and focused tests.
- [x] Route app-shell unread badge refresh through `/api/notifications/count`.
- [x] Make unread-count responses no-store so the bell does not replay stale private cache.
- [x] Align web checkout due/overdue row styling with current reseeded escalation type names.
- [x] Restore license notification sent timestamps and category-gated expiry push delivery.
- [x] Keep manual badge awards inbox-only per the documented badge notification contract.
- [x] Refresh the stale cron source assertion for the intentional live-activities cron route.
- [x] Add focused source-contract coverage and sync docs.
- [x] Reconcile stale D-009, cron timing, and active-risk notification documentation.
- [x] Run focused tests, TypeScript, docs/codemap check, whitespace, and app build.

### Review
- 2026-07-03: Audit found the shell used `/api/notifications?limit=0&unread=true`, but shared pagination treats `limit=0` as a default page request. The hardening slice moves chrome count refresh to the dedicated count route, removes short browser caching from that user-specific count, and makes checkout escalation row styling prefix-based so current `checkout_due_1h` / `checkout_overdue_*` rows do not fall back to generic Notice styling. Docs now reflect the current `EscalationRule` seed shape, 9:00 UTC Vercel cron timing, accepted D-009 admin fanout, and closed fatigue-control risk.
- 2026-07-03: Second audit wave folded in license and badge delivery fixes: license rows now carry `sentAt`, license-expiry push delivery respects the `licenseExpiry` category toggle, manual badge awards stay inbox-only, and the stale cron source assertion now allows the intentional live-activities cron route.
- 2026-07-03: Verification passed with focused Vitest, TypeScript, codemap regeneration, docs verification, whitespace, and `npm run build:app`. Follow-ups left intentionally separate: APNs timeout protection, iOS cold-start push buffering, generic `href`/badge/license/firmware push tap-through, low-stock item-family routing, and product direction for numeric iOS/app-icon unread badges.

---

## Active: iOS checkout return Live Activity push-to-start (2026-07-03)

Plan: let the server start due checkout-return Live Activities by APNs without requiring the iOS app to launch first, while keeping kiosk/admin return completion as the custody source of truth.

- [x] Add push-to-start token storage and an authenticated iOS registration/revocation API.
- [x] Add a cron-backed server trigger that starts due or recently overdue checkout-return Live Activities through APNs.
- [x] Teach iOS to register push-to-start tokens and observe APNs-started activities for per-activity update tokens.
- [x] Keep app-started Live Activity reconciliation as a fallback when the app is opened.
- [x] Verify Prisma, source contracts, TypeScript, docs, and Xcode beta iOS build.

### Review
- 2026-07-03: Implementation shipped locally, then reconciled for Vercel Hobby. Push-to-start tokens live separately from per-activity update tokens, remote start attempts are deduped per user/booking/activity, logout revokes start tokens, and the protected Live Activity route remains available for Pro/manual/external scheduling while Hobby relies on native app-opened reconciliation.
- 2026-07-03: Verification passed with Prisma generate, focused Live Activity source-contract Vitest, TypeScript, migration-prefix check, iOS drift, iOS audit gaps with the pre-existing seven unregistered extracted files and zero missing audits, codemap/docs verification, whitespace, `npm run build:app`, and an Xcode beta 27 generic iOS Simulator Debug build for `Wisconsin`.

---

## Active: iOS App Intents audit and improvement (2026-07-03)

Plan: `tasks/ios-app-intents-plan.md`

- [x] Add a central App Intent handoff so system invocations route through one app-owned surface.
- [x] Add open-app shortcuts for Scan Gear Code, Show My Gear, Show Today's Schedule, and Create Reservation.
- [x] Route Scan into the existing QR scanner cover and Create Reservation into the existing reservation sheet.
- [x] Add source-contract tests for shortcut metadata, handoff routing, and the no-mutation boundary.
- [x] Sync Mobile/Gaps docs and run focused iOS verification.

### Review
- 2026-07-03: Audit found no live App Intents code in the current source tree. The slice is intentionally open-app only: no background booking, checkout, return, custody, or shift mutations.
- 2026-07-03: Implemented four open-app shortcuts through `GearTrackerAppIntentHandoff` and `AppState.pendingAppIntentDestination`. Scan opens the existing QR scanner cover, My Gear opens the unified bookings list, Today's Schedule opens Schedule, and Create Reservation opens the existing reservation sheet.
- 2026-07-03: Verification passed: focused App Intents Vitest, touched-file whitespace check, iOS drift, iOS audit gaps with the pre-existing unregistered-file note and zero missing audits, XcodeGen project check, docs/codemap check, XcodeBuildMCP simulator build, and `npm run build:app`.

---

## Active: iOS all-pages screenshot audit (2026-07-03)

Record: `tasks/audit-all-pages-ios.md`

Scope: screenshot, runtime-snapshot, source-audit, and focused fixes for every native Wisconsin iOS page, pushed detail view, sheet, cover, confirmation flow, profile/settings drill-down, dev tool, and kiosk-only screen.

- [x] Inventory all current SwiftUI surfaces and existing audit records.
- [x] Home screenshot/audit/fix/verify.
- [x] Schedule list screenshot/audit/fix/verify.
- [ ] Bookings and booking mutation sheets.
  - [x] Bookings empty list.
  - [x] Create Reservation Details, event picker, pickup picker, Equipment, cart drawer, and Confirm.
  - [ ] Booking Detail, Edit Booking, Extend Booking, Cancel confirmation, QR scanner cover.
- [x] More directory and resource/detail destinations.
- [x] Search, scanner, notifications, profile/settings, and dev tools.
- [ ] Kiosk-only target screens and sheets.
- [ ] Final full verification sweep.

### Review
- 2026-07-03: Settings/Profile and remaining Schedule sheet pass completed for reachable live surfaces. Fixed Availability delete safety by adding a destructive confirmation before removing student scheduling blocks, and fixed Add Shift all-day defaults so staff no longer see midnight call/end rows for all-day events unless custom timing is enabled. Runtime proof covered Profile/Settings, Account Security, Notification Settings, staff tools, Schedule calendar, Filters, Trade Board, Post Trade, Event Detail, and Add Shift. Current live account has no active bookings and is not Student-scheduling-class, so Booking Detail/Edit/Extend/Cancel and Availability runtime CRUD remain source/build verified rather than live-mutated.
- 2026-07-03: Create Reservation all-screens pass completed for the reachable Bookings/Event Detail creation flow. Fixed Details picker label wrapping, all-day linked-event headers for selected and prefilled event paths, full-row picker hit targets, attachment-category filtering in Equipment, and all-day Review copy. Verified with XcodeBuildMCP screenshots, warning-clean simulator build/run, `npm run test -- tests/ios-create-booking-picker-parity.test.ts`, `git diff --check`, `npm run drift:ios`, `npm run audit:ios:gaps`, and `npm run verify:docs`.
- 2026-07-03: User corrected the scope from primary-page passes to all pages/screens/sheets. Master checklist is now `tasks/audit-all-pages-ios.md`; the lesson log records that future all-app screenshot audits must include pushed details, sheets, covers, confirmations, dev tools, and kiosk-only screens.

---

## Active: Backend foundation hardening (2026-07-03)

Plan: `tasks/backend-foundation-hardening-plan.md`

Goal: strengthen the backend and app/website foundation in auto-advancing, independently verifiable slices.

- [x] Slice 1: API contract gate refresh.
- [x] Slice 2: Mutation safety sweep.
- [x] Slice 3: Public route abuse pass.
- [x] Slice 4: Freshness framework pass.
- [x] Slice 5: Vercel timeout and bounded-read audit.
- [x] Slice 6: Migration and production drift guard.
- [x] Slice 7: Cron observability and idempotency.
- [x] Slice 8: Auth, session, and onboarding hardening.
- [x] Slice 9: Kiosk boundary proof.
- [x] Slice 10: Data quality repair cockpit.
- [x] Slice 11: iOS API response-shape contracts.
- [x] Slice 12: Release verification pipeline.

### Review
- 2026-07-03: Plan logged from the backend-strengthening checklist. Start with Slice 1 unless a more urgent backend issue appears in current source or production evidence.
- 2026-07-03: Slice 1 shipped locally. Static API inventory covers 223 route files and 301 exported HTTP methods, resolves alias exports, requires every method export to resolve to `withAuth`, `withKiosk`, `withCron`, or `withHandler`, and pins public/kiosk/cron route-family boundaries plus public abuse controls. The gate found and fixed two wrapper drifts: Live Activity checkout-return registration now uses `withAuth`, and the tokenized shift ICS feed now uses `withHandler` with its token/IP rate controls allowlisted. Verification passed focused Vitest, TypeScript, whitespace, and `npm run build:app`.
- 2026-07-03: Slice 2 shipped locally on shared booking lifecycle mutations. `updateReservation`, `updateCheckout`, and `extendBooking` now share the same SERIALIZABLE/allocation-race 409 mapping already used by booking creation, so edit/extend commit races return controlled booking conflict feedback instead of internal errors. Focused regressions cover reservation edit, checkout edit, and extension races. Verification passed focused Vitest, TypeScript, whitespace, docs sync, and `npm run build:app`.
- 2026-07-03: Slice 3 shipped locally as a public-route abuse source-contract pass. `tests/public-route-abuse-contract.test.ts` now has an explicit control ledger for login, register, forgot/reset password, kiosk activation, seed, and shift ICS routes, pinning rate limits, token scope, seed production safety, generic reset responses, registration allowlist behavior, reset-token/session cleanup, kiosk activation expiry/single-use behavior, and ICS no-cache/token controls. Verification passed focused Vitest, TypeScript, whitespace, and `npm run build:app`; stale generated `.next` artifacts were cleared before the clean build proof.
- 2026-07-03: Slice 4 shipped locally on Schedule freshness. Schedule was the next operational surface after bookings/items because it inherited the global 60-second React Query stale window and disabled focus refetch; `/schedule` reads now use a local fresh-query policy with no-store fetches, `staleTime: 0`, always-refetch-on-mount, and window-focus refetch while preserving visible rows during background refresh. Verification passed focused Vitest, TypeScript, docs, whitespace, and `npm run build:app` after clearing stale generated `.next` artifacts.
- 2026-07-03: Slice 5 shipped locally on bounded image rehosting. The audit picked the current documented BulkSku CDN gap: `/api/cron/rehost-images` only drained serialized asset images. The cron now stays within the same serverless budget while processing 16 asset candidates and 8 active item-family candidates per run, mirrors reachable `BulkSku.imageUrl` values to Vercel Blob, increments retry attempts for unreachable family URLs, and returns separate asset/item-family backlog counters. Verification passed focused Vitest, TypeScript, docs, whitespace, and `npm run build:app`.
- 2026-07-03: Slice 6 shipped locally on migration and production drift guardrails. The pass restored `BulkSku.imageRehostAttempts` to the Prisma model to match the existing `0077_add_bulk_sku_image_rehost_attempts` migration, regenerated the Prisma client, and pinned migration/schema/cron alignment with source-contract coverage. `npm run db:migrate:check` now also validates migration folder shape and required `migration.sql` files, not just prefix collisions. Verification passed focused Vitest, Prisma validation, TypeScript, docs, whitespace, `npm run build:app`, and read-only Neon `npm run db:migrate:health` with 92/92 local migrations applied and no pending, failed, or DB-only migrations.
- 2026-07-03: Slice 7 shipped locally on cron observability and idempotency. All live cron routes remain behind `withCron` and D-035 still keeps daily scheduling maintenance in `morning-refresh`; the concrete fix was `audit-archive`, which now caps audit deletion to five 1,000-row batches per run, reports backlog/batch metadata, and isolates audit-log and expired-session purge failures through `partialFailures`/`errors` without dropping successful work from the other segment. Verification passed focused cron Vitest and TypeScript.
- 2026-07-03: Slice 8 shipped locally on auth/session/onboarding hardening. Existing coverage already pinned forced password changes, reset-token transactions, role escalation, hidden-user visibility, hidden cleanup, allowed-email invite-first onboarding, and kiosk sessions. The new fix hardens self-service session revocation: `/api/me/sessions` and `/api/me/change-password` with `revokeOtherSessions` must re-identify the current cookie-backed session before bulk-deleting other sessions, and otherwise return 401 with no session deletion. Verification passed focused auth/session/onboarding Vitest and TypeScript.
- 2026-07-03: Slice 9 shipped locally on kiosk boundary proof. Existing boundary tests already pin app/web custody blocks and reservation-first UI; the concrete hardening was kiosk direct checkout location scope. `/api/kiosk/checkout/availability` and `/api/kiosk/checkout/complete` now ignore client-supplied `locationId` and use the authenticated kiosk session location for availability, booking creation, asset updates, and pickup kiosk evidence while preserving payload tolerance for older native clients. Verification passed focused kiosk boundary Vitest and TypeScript.
- 2026-07-03: Slice 10 shipped locally on data-quality repair safety. Current source already keeps Inventory Hygiene and Admin Fix Today read-only, and hidden-user cleanup already has dry-run/apply coverage; the concrete fix was stale battery custody repair. `POST /api/bulk-skus/batteries/repair-stale` now defaults to dry-run preview with `plannedCount` and candidate units, skips updates/audit writes unless `dryRun: false`, and Battery Ops explicitly sends `dryRun: false` only from the confirmed repair dialog. Verification passed focused Battery Ops/Fix Today/hidden-cleanup Vitest, TypeScript, codemap/docs verification, whitespace, and `npm run build:app`.
- 2026-07-03: Slice 11 shipped locally on iOS API response-shape contracts. Existing `ios-api-contract` coverage already pinned the known decode-breaking routes; the new hardening targets native Trade Board Open Work. `OpenWorkResponse` now defaults missing `openShifts` or `pickupRequests` to empty arrays so a partially omitted `/api/schedule/open-work` payload does not blank the whole sheet, and the contract test pins the route envelope, service keys, API client decode, and tolerant Swift decoder. The pass also refreshed a stale kiosk checkout source assertion to current component names. Verification passed focused iOS/Schedule Vitest, TypeScript, iOS drift, codemap/docs verification, whitespace, `npm run build:app`, and XcodeBuildMCP simulator build for `Wisconsin`; the native build reported one unrelated existing `CreateBookingSheet.swift:118` warning.
- 2026-07-03: Slice 12 shipped locally on release verification pipeline. Added `docs/RELEASE_VERIFICATION.md` as the canonical closeout guide: default local backend/web gates, safe `npm run build:app`, deploy-shaped `npm run build` migration-deploy caveat, migration health/deploy gates, authenticated browser proof triggers, `npm run smoke:deploy`, iOS drift/audit/Xcode gates, and release-candidate escalation guidance. Linked it from `README.md`, refreshed the Prisma/Neon runbook wording, and recorded the no-gap documentation update in `docs/GAPS_AND_RISKS.md`. Verification passed docs/codemap check and whitespace.

---

## Active: iOS Users list + User Detail redesign pass (2026-07-02)

Scope: bring UsersView and UserDetailView onto the established Brand design language (brandCard rows on grouped canvas, StatusRail, Gotham titles, toned uppercase section headers, nested tertiary tiles) matching the Items/Bookings/ItemDetail pass. UI-only; no API or model changes.

- [x] UsersView: card rows on grouped background — StatusRail role tone (gray when inactive), 44pt avatar with role-toned fallback, gothamBold name, explicit chevron, card-shaped skeletons, clear listRow backgrounds on pagination footers.
- [x] UserDetailView: hero profile card (64pt avatar, gothamBlack name, Inactive pill, joined date), toned icon section headers for Badges / Active Checkouts / Recent Reservations, booking rows in nested tertiary tiles with chevrons, quiet one-line empty card, redacted loading skeleton.
- [x] Verify: xcodebuild Wisconsin scheme BUILD SUCCEEDED + `npx vitest run tests/`, doc sync in AREA_MOBILE.md, commit + push.

### Review
- 2026-07-02: UI-only slice. No API/model changes; UsersViewModel, pagination, debounced search, and the role/inactive filter menu are untouched. New signals surfaced from existing data: Inactive pill and Joined date on detail (`AppUserDetail.active`/`createdAt` were decoded but never rendered).
- 2026-07-02: Vitest run is green except pre-existing `tests/ios-api-contract.test.ts` kiosk assertions (stale `KioskCheckoutContextCard`/`KioskCheckoutTimeCard` pins from the uncommitted kiosk rework — flagged as a separate task, not part of this slice).
- 2026-07-03: Follow-up polish shipped locally. User Detail profile heroes no longer show location metadata, the compact native tab order is now Home, Schedule, Bookings/My Gear, More, Search, and the old Browse directory presents as More while retaining Items, Guides, Licenses, and Users. Verification passed focused tab/student contract Vitest, whitespace, iOS drift, iOS gap audit with zero missing audits, docs verification, XcodeBuildMCP simulator build/run, and simulator snapshots for tab order plus profile metadata.
- 2026-07-03: Second follow-up polish shipped locally. Search now auto-presents the native search field/keyboard when the Search tab appears, Home's profile avatar uses a plain 44pt toolbar tap target instead of a glass circle, and the More directory keeps only the navigation title instead of repeating a section header.
- 2026-07-03: Third follow-up polish shipped locally. Native Items and typed Search tab results now hide parented accessories by default; direct QR/scan lookup still resolves child accessories for recovery. Verification passed focused API/iOS contracts, whitespace, iOS drift, iOS gap audit with zero missing audits, docs verification, and XcodeBuildMCP simulator build/run.

---

## Active: Attachment internal tag intake (2026-07-02)

Scope: let parented Standard attachments use a quiet generated internal tag when the printed label only needs the QR code and a nearby parent number.

- [x] Audit item identity docs, prior attachment decisions, Prisma required fields, and current Standard intake source.
- [x] Generate an internal asset tag only when a Standard item is marked as an attachment and the visible tag field is blank.
- [x] Keep normal Standard items requiring a typed asset tag and keep QR code required for this slice.
- [x] Add focused coverage, sync item docs, and run targeted verification.

### Review
- 2026-07-02: The narrow slice keeps `Asset.assetTag` and `Asset.qrCodeValue` required in storage. The user-facing change is attachment-only: a parented Standard accessory can leave the visible tag blank, while the submit helper creates a quiet internal tag from the parent, attachment identity, and QR code.
- 2026-07-02: Standard form validation now makes the visible asset tag optional only while `Item is an attachment` is enabled. Explicit attachment tags are still preserved, and standalone Standard item validation remains unchanged.
- 2026-07-02: Verification passed focused Vitest, TypeScript, docs/codemap verification, whitespace, and `npm run build:app`.
- 2026-07-02: Follow-up screenshot showed the generated internal tag leaking into the parent attachment row title. Detail rows now lead with the attachment display name and use that label for detach copy while keeping the generated tag as storage/search identity only.

---

## Active: Kiosk checkout details clean redesign (2026-07-02)

Scope: rebuild the dedicated kiosk checkout details step before Start Scanning as one focused native kiosk panel.

- [x] Re-audit the kiosk checkout source, shared kiosk components, kiosk/mobile docs, decisions, schema context, and HIG control direction.
- [x] Replace the prior quick-select setup with reservation-style Context and Details windows.
- [x] Make checkout context explicit: ad hoc by default, or linked to a selected event with auto-filled booking name.
- [x] Remove the checkout start-date field and the unexplained green header checkmark.
- [x] Make the ad hoc booking-name/details text field prominent and required when no event is linked.
- [x] Replace segmented/Custom return presets with an always-visible native return DatePicker.
- [x] Update source-contract coverage, kiosk/mobile docs, walkthrough, and lessons.
- [x] Run focused tests, iOS drift/audit, docs verification, whitespace, and Xcode verification for kiosk plus main app.
- [x] Follow-up: move booking name into Context, make Return the lower card, remove ad hoc explainer copy, and reduce missed tap/long-press behavior in the setup controls.
- [x] Follow-up: tune Checkout Details for the fixed iPad Pro 10.5 kiosk target with Context left, Return right, Start Scanning pinned, and UIKit-backed date/time pickers so calendar taps do not require a long-press.
- [x] Correction: force the fixed landscape layout to render Context and Return side by side below the full-width hero, not as a stacked fallback.
- [x] Correction: replace the return date grid with `UICalendarView` and move kiosk inactivity tracking off SwiftUI global gestures so calendar taps are not delayed by the shell.
- [x] Correction: after ad hoc details entry, Start Scanning must force-release the text field and reacquire HID scanner focus before scans start.
- [x] Polish: rebalance Context/Return column widths so the Return calendar and time wheel do not overlap.

### Review
- 2026-07-02: Ad hoc scanner handoff and picker polish verification passed focused kiosk checkout/scanner source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit still exits clean with 44/44 surfaces covered while reporting the seven pre-existing unregistered extracted iOS files.
- 2026-07-02: Live hardware correction in progress. After an ad hoc checkout, the scanner beeped but the iPad did not receive input because ad hoc typing left the scanner focus gate suppressed and the protected UIKit text field could refuse first-responder resignation. Follow-up adds an explicit `allowScannerFocusNow()` gate reset, force-resigns the visible field on app-driven focus clear, and delays enabling HID capture until the next run loop after Start Scanning.
- 2026-07-02: Picker polish in progress. The two-column layout worked, but Return was too narrow for the `UICalendarView` plus wheel, so the wheel visually overlapped the calendar. Follow-up shifts width from Context to Return and clips the calendar to its assigned frame.
- 2026-07-02: Calendar tap correction verification passed focused kiosk checkout/scanner source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit still exits clean with 44/44 surfaces covered while reporting the seven pre-existing unregistered extracted iOS files.
- 2026-07-02: Live hardware still logged `System gesture gate timed out` and ignored normal calendar taps. Follow-up replaces the date half of Return with `UICalendarView` plus `UICalendarSelectionSingleDateDelegate`, keeps the time half on a wheel `UIDatePicker`, and replaces shell-level SwiftUI `simultaneousGesture` tap/drag tracking with non-cancelling UIKit window recognizers.
- 2026-07-02: User correction noted the previous two-column pass still rendered as stacked cards on the live screen. Follow-up removes the setup-level horizontal `ViewThatFits` fallback, fixes Context at 424pt and Return at 600pt in one row, and narrows the inline date picker to stay inside the Return column.
- 2026-07-02: iPad Pro 10.5 follow-up verification passed focused kiosk checkout/scanner source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit still exits clean with 44/44 surfaces covered while reporting the seven pre-existing unregistered extracted iOS files.
- 2026-07-02: Device correction in progress. The live iPad still required a long-press on calendar dates, so the fix moved Return off the normal scroll path when the fixed iPad layout fits and replaced SwiftUI `DatePicker` rendering with UIKit `UIDatePicker` wrappers for inline date plus wheel time.
- 2026-07-02: Follow-up verification passed focused kiosk checkout/scanner source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit still exits clean with full coverage while reporting the seven pre-existing unregistered extracted iOS files.
- 2026-07-02: Follow-up in progress after device feedback. The requested shape is `Context` with `Link to event` plus either a booking-name field or linked event list, then a separate `Return` card with only the native return date/time picker. Press handling will stay local to setup controls rather than changing the global kiosk inactivity gesture.
- 2026-07-02: Reservation-sheet correction verification passed focused kiosk checkout/scanner source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit still exits clean with full coverage while reporting the seven pre-existing unregistered extracted iOS files.
- 2026-07-02: Reservation-sheet correction shipped locally. The kiosk checkout setup now uses explicit Context and Details windows, defaults to ad hoc checkout, gates event payloads behind `Link to event`, removes the green header checkmark and start-date UI, and shows Return as an always-visible native date/time picker instead of segmented presets plus Custom.
- 2026-07-02: User correction asked for a from-scratch Checkout Details rebuild. Current pass removes the older step-card/chip structure, keeps scan-mode custody logic untouched, and makes the pre-scan state one centered panel using existing kiosk tokens plus native Picker/DatePicker controls.
- 2026-07-02: Clean redesign verification passed focused kiosk checkout/scanner source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit exits clean but still reports seven pre-existing unregistered extracted iOS files in `scripts/ios-audit-inventory.sh`.
- 2026-07-02: Started from the current kiosk checkout source after the physical iPad confirmed the scanner-keyboard fix. This slice stays client-only: no API payload changes, no server contract changes, and no changes to kiosk custody boundaries.
- 2026-07-02: Checkout Details now centers the pre-scan form, hides the empty scanned-items rail until scan mode, uses native bordered return-time quick selects with an inline wheel picker behind Custom, shows selectable upcoming-event cards with a More menu fallback, and keeps return quick-selects for 2 hr, 4 hr, Tonight, Tomorrow AM, 24 hr, and Event End.
- 2026-07-02: Verification passed focused kiosk/source-contract Vitest coverage, XcodeGen project check, iOS drift, iOS gap audit, docs verification after codemap refresh, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The audit still reports the pre-existing unregistered `CreateBooking/CreateBookingEquipmentPicker.swift` warning while keeping 44/44 audit-worthy surfaces covered.
- 2026-07-02: User correction rejected the custom return-time sheet and noisy purpose quick labels. Follow-up removed the sheet, shifted the setup phase to a focused centered form, converted quick choices to native bordered controls, removed Repair/Test, Game Prep, and Walk-up, and added Event as the no-event quick-purpose option.
- 2026-07-02: Follow-up verification passed focused kiosk checkout/source-contract tests, XcodeGen project check, iOS drift, iOS gap audit, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`.

---

## Active: Kiosk HID scanner keyboard recovery (2026-07-02)

Scope: keep native iPad software keyboard typing usable while a Bluetooth HID scanner is connected and awake.

- [x] Trace focus ownership between the hidden HID scanner sink and visible kiosk text fields.
- [x] Add a shared scanner focus gate so visible UIKit text fields can suppress scanner re-focus while editing.
- [x] Add source-contract coverage for the focus gate and native keyboard field behavior.
- [x] Run focused tests, iOS drift/audit, docs verification, whitespace, and kiosk Xcode verification.

### Review
- 2026-07-02: Root cause found in `HIDScannerField` auto-reacquiring first responder after every focus loss. On iPadOS with the scanner paired as a keyboard, that steals focus back from visible text fields after each typed character. The local fix gates scanner focus while `KioskNativeTextField` is actively editing.
- 2026-07-02: Verification passed focused Vitest, XcodeGen project check, iOS drift, iOS audit gaps, docs verification, whitespace, and unsandboxed Xcode verification for both `WisconsinKiosk` and `Wisconsin`. The iOS audit still reports the pre-existing unregistered `CreateBooking/CreateBookingEquipmentPicker.swift` warning while keeping 44/44 audit-worthy surfaces covered.
- 2026-07-02: Screen-recording review showed the keyboard collapse happens in checkout details before Start Scanning, so the scan-phase HID field is not the only path. The first visible-field fix reasserted SwiftUI focus on every edit, but live logs showed AttributeGraph cycles. `KioskNativeTextField` now avoids the SwiftUI focus loop and instead uses a UIKit text-field subclass that rejects only immediate post-keypress resign attempts, while still allowing explicit Return/Done and unprotected focus changes.

---

## Active: Main iOS app kiosk removal (2026-07-02)

Scope: remove kiosk mode from the main `Wisconsin` app now that `WisconsinKiosk` is the dedicated kiosk build.

- [x] Remove main-app kiosk state, root-view routing, and `wisconsin://kiosk` handling.
- [x] Remove the DEBUG Settings -> Tools Kiosk Mode launcher.
- [x] Exclude `Wisconsin/Kiosk/**` from the main app target while preserving the `WisconsinKiosk` target.
- [x] Sync docs and verify source contracts, project drift, iOS drift/audit, and Xcode builds.

### Review
- 2026-07-02: Main app kiosk mode removed locally. `WisconsinApp` no longer injects `KioskStore`, routes to `KioskShellView`, or handles `wisconsin://kiosk`; Profile no longer shows the DEBUG Kiosk Mode launcher; AppDelegate no longer locks orientation for kiosk state; and the full `Wisconsin` target excludes `Wisconsin/Kiosk/**`. The reusable HID scanner sink moved to `Shared/HIDScannerField.swift` so the main app Scanner Debugger and `WisconsinKiosk` can share it without compiling kiosk screens into the main app. Verification passed focused Vitest, XcodeGen project check, iOS drift, docs/codemap check, whitespace, and unsandboxed Xcode verification for both `Wisconsin` and `WisconsinKiosk`. The iOS audit inventory remains 44/44 covered with the pre-existing unregistered `CreateBooking/CreateBookingEquipmentPicker.swift` warning.

---

## Active: iOS Snow Leopard release polish (2026-07-02)

Plan: `tasks/ios-snow-leopard-release-plan.md`

- [x] Ground release scope in current mobile docs, decisions, gaps, lessons, iOS audits, and current source.
- [x] Run baseline iOS drift and audit inventory.
- [x] Slice 1: Home polish and release-proofing.
- [x] Slice 2: Booking Detail action polish.
- [x] Slice 3: Bookings tab freshness and queue clarity.
- [ ] Slice 4: Create Booking equipment recovery check.
- [ ] Slice 5: Search and scan recovery sweep.
- [ ] Slice 6: Foundation hardening and final verification.

### Review
- 2026-07-02: Snow Leopard scope started as a native iOS polish/foundation release, not a desktop-parity expansion. Baseline `npm run drift:ios` and `npm run audit:ios:gaps` passed. Current Home source already closes the old P0/P1 dashboard audit issues, so Slice 1 is limited to release-proofing and low-risk polish.
- 2026-07-02: Slice 1 shipped locally. Home stat tiles now use raised tile surfaces with active-only tone shadow, the all-clear CTA now says Search or Scan to match the Search-tab scanner contract, and source-contract tests guard against reintroducing the old DEBUG kiosk shortcut on Home. Verification passed with focused Vitest, TypeScript, iOS drift, iOS audit gaps, docs check, whitespace, and unsandboxed `npm run ios:xcode:verify`.
- 2026-07-02: Home all-day event follow-up shipped locally. The Next Up event-work row now treats all-day events as date-only, suppresses call-time sublines, and avoids midnight gear-prep times while keeping the existing dashboard payload shape.
- 2026-07-02: Home header follow-up removed the AFM/deterministic summary subline entirely. The header now varies the local greeting by day and time while leaving urgency in the stat strip and Next Up queue.
- 2026-07-02: Slice 2 started from current Booking Detail source, reservation/kiosk docs, and the Snow Leopard plan. Scope is metadata/detail editing only: title, pickup/return window, reservation pickup location, and notes. Equipment changes stay out of normal app detail because kiosk owns custody.
- 2026-07-02: Slice 2 shipped locally. Booking Detail now groups editable metadata into a clean Details section, exposes Edit Details from both the toolbar and section action, allows reservation pickup-location edits through the existing optimistic-lock PATCH path, and states that item custody changes stay in kiosk workflows. Verification passed with focused Vitest, iOS drift, iOS audit gaps, docs verification, Xcode project check, whitespace check, and unsandboxed `npm run ios:xcode:verify`.
- 2026-07-02: Slice 3 started after a native Bookings tab bug report. Scope is the list surface only: prevent old cached rows from flashing on tab entry/refresh, replace the Mine/All toolbar toggle with a native scope control, add Needs Attention, surface last-sync state, improve row scanning, and keep New Reservation wording explicit under the kiosk-only custody contract.
- 2026-07-02: Slice 3 shipped locally. Native Bookings no longer renders `GearStore` cached booking rows as normal content, so tab entry, refresh, search, and scope changes wait for live API results or preserve current rows during explicit refresh. The tab now uses a native `Mine / All / Attention` segmented scope, synthesizes Attention from existing overdue/due-today/active reads, shows a quiet updated/refreshing footer, leads rows with live operational timing, and labels creation as `New Reservation`. Verification passed with focused Vitest, iOS drift, iOS audit gaps, docs verification, whitespace, and unsandboxed `npm run ios:xcode:verify`.

---

## Active: Remove premier events (2026-07-02)

Plan: `tasks/remove-premier-events-plan.md`

- [x] Audit Schedule docs, Prisma schema, services, web, iOS, and contract tests for premier-event dependencies.
- [ ] Drop premier schema fields through the Prisma migration workflow. Schema fields are removed; migration generation is blocked until the remote Neon `migrate dev` risk is explicitly approved or a safe local/shadow database path is provided.
- [x] Make every Open Work pickup an instant `DIRECT_ASSIGNED` claim.
- [x] Remove approval-required Trade Board and iOS copy/grouping.
- [x] Update docs and run focused verification gates.

### Review
- 2026-07-02: Premier-event code and active docs removed locally. `ShiftGroup.isPremier` and `ShiftTrade.requiresApproval` are gone from Prisma schema usage, web Schedule/Open Work, native iOS models and Trade Board, exports, service branches, and pinned source contracts. New open-work pickups now direct-assign and trade claims immediately complete swaps. Verification passed: Prisma format/validate, focused Vitest, TypeScript, iOS drift, iOS audit inventory, migration-prefix check, codemap/doc checks, whitespace check, and `npm run build:app`. Migration generation is still blocked because the repo command targets remote Neon through `prisma migrate dev`; do not hand-create a migration directory.

---

## Active: Contract test recovery pass (2026-07-02)

Scope: Fix the 12 pre-existing Vitest contract failures reported across calendar sync health, iOS item identity, iOS Schedule dynamic type/UI cleanup, item info sidebar hardening, Schedule source/export/role/source-truth tests, and user PII scope.

- [x] Reproduce `npx vitest run tests/` and capture the exact current failure output.
- [x] Triage `tests/user-pii-scope.test.ts` first because student form-options user directory scope is security-relevant.
- [x] Classify each remaining failure as stale assertion versus source regression against current shipped docs and code.
- [x] Patch the minimal source or test contract needed for each failure.
- [x] Sync docs if any shipped behavior changes. No AREA doc change was required because shipped behavior did not change.
- [x] Verify the recovered contract files with focused tests and build proof before commit handoff. Current full `npx vitest run tests/` is blocked by unrelated remove-premier worktree failures.

### Review
- 2026-07-02: Pass started from the reported pre-July-2 failure set. Current docs confirm `/api/form-options` must not expose email or a full active-user directory to Student callers, so that failure is being treated as a likely real regression until source and tests prove otherwise.
- 2026-07-02: All 12 failures were stale contract assertions against current shipped behavior. The PII scope source already limited Student form-options users to self, excluded hidden roster users, and selected only id/name/avatar. Other stale assertions covered hidden admin notification fanout, Schedule readiness automation placement, `Export CSV`, iOS Schedule coverage visibility and Dynamic Type sizing, shared `FieldGroup`, shared iOS item-list identity text, and removed Schedule draft/needs-list clutter. Verification passed for the focused 10-file Vitest set and `npm run build:app`. Full `npm run build` was attempted but blocked because its Prisma migrate-deploy step needs external Neon access and can apply migrations; the escalated rerun was rejected. Current full `npx vitest run tests/` is blocked by 15 unrelated failures in the concurrent remove-premier worktree changes: `tests/schedule-open-work-source.test.ts`, `tests/schedule-open-work.test.ts`, `tests/shift-assignments.test.ts`, and `tests/shift-trades.test.ts`.

---

## Active: Unlisted iOS App Store launch readiness (2026-07-01)

Scope: App Store submission readiness for the main `Wisconsin` iOS app only. Kiosk remains separate and off the App Store.

- [x] Make the App Store app appear as `Wisconsin Creative` while the iOS Home Screen label stays `Creative`.
- [x] Switch checked-in APNs entitlement metadata from development to production for the App Store launch target.
- [x] Add the iOS privacy manifest for first-party required-reason API usage.
- [x] Add the public privacy page at `/privacy` for `wisconsincreative.com/privacy`.
- [x] Add an idempotent App Review demo seed script with fake users, fake gear, fake bookings, fake notifications, and reviewer credentials.
- [x] Verify focused source checks, iOS project consistency, TypeScript/build as feasible, and document user-run real-device tasks.
- [x] Declare export compliance (`ITSAppUsesNonExemptEncryption: false`) so App Store Connect stops prompting the encryption question on every build upload.

### Review
- 2026-07-08: Added `ITSAppUsesNonExemptEncryption: false` to `ios/project.yml`'s `Wisconsin` target Info.plist properties — the app only talks to its own API over standard HTTPS/TLS via `URLSession`, no custom or non-exempt encryption, so this qualifies for the standard exemption. Regenerated via `xcodegen generate` (confirmed the key landed in the checked-in `ios/Wisconsin/Supporting/Info.plist`). Verified `ios:project:check`, `tsc --noEmit`, `drift:ios` (71 files), `audit:ios:gaps` (47/47), `verify:docs`, `git diff --check`.
- 2026-07-02: Follow-up hardening aligned `ios/Wisconsin/Supporting/PrivacyInfo.xcprivacy` with App Store Connect privacy disclosures for account, contact, identifier, usage, and diagnostic data, kept tracking disabled, and omitted user coarse location because iOS only uses fixed venue coordinates for WeatherKit. Verified plist syntax and iOS project membership.
- 2026-07-01: Launch-readiness slice completed for the main App Store app only. App Store product naming is set up as `Wisconsin Creative`, the installed label stays `Creative`, checked-in APNs entitlement metadata is production, the first-party privacy manifest is present, `/privacy` builds as a static public page, and `npm run demo:seed:app-review` now creates a guarded fictional App Review dataset only when `APP_REVIEW_DEMO_SEED=confirm` is set. Verified: `plutil -lint`, `node --check scripts/seed-app-review-demo.mjs`, guarded seed refusal without confirmation, `npm run ios:project:check`, `npm run drift:ios`, `npm run audit:ios:gaps`, `npx tsc --noEmit --pretty false`, `npx vitest run tests/public-showroom-content.test.ts`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, `npm run build:app`, and escalated `npm run ios:xcode:verify`. Manual external tasks remain in Apple Developer, App Store Connect, DNS, archive/signing proof, and real-device QA.

---

## Active: Public showroom /about improvement pass (2026-07-01)

Scope: `/about` route set only. Fixes two shipped bugs and raises share/SEO/accessibility/navigation quality without touching auth, APIs, or app-shell behavior.

- [x] Fix dark-theme breakage: system-dark visitors get dark tokens on the fixed-light showroom (white-on-white text). Pin showroom subtree to light tokens via `[data-theme="light"]` selector alias + wrapper attribute.
- [x] Fix invisible gray tone chips: `toneClasses.gray` is white-on-white on light cards (Overview/Features/Field Work). Split light/dark gray styling.
- [x] Fix heading hierarchy: `ProductMockup` renders h3/h4 before any h2 on hero page; demote to styled `p` and wrap mockup in `figure`.
- [x] Add skip-to-content link in showroom layout + `id="showroom-content"` on each page main.
- [x] Add share/SEO metadata: `metadataBase` (wisconsincreative.com), Open Graph, Twitter card, and a generated `opengraph-image` for the `/about` segment.
- [x] Add "Keep exploring" cross-page section using the previously unused nav descriptions; wire into all five pages.
- [x] Make `StakeholderCta` primary link configurable so `/about/tech-stack` stops linking to itself.
- [x] Footer polish: copyright year + tightened copy.
- [x] Copy tweak: security page H1.
- [x] Reduce marketing language across public about copy while keeping the existing route set and static-data boundary.
- [x] Extend `tests/public-showroom-content.test.ts` for light-pinning, metadata, and nav descriptions.
- [x] Verify: focused vitest, tsc, build:app, browser proof (light + dark emulation).
- [x] Doc sync: `docs/AREA_PUBLIC_SHOWROOM.md` change log; commit + push.

### Review
- 2026-07-02: Copy-tone follow-up shipped locally. `/about` and subpages now use more direct language for the hero, page intros, CTAs, mockups, nav descriptions, metadata, footer, feature cards, stack cards, security controls, and field-work cards. Route structure, styling, mockup data rules, authentication boundary, and public data boundary were unchanged.
- 2026-07-01: Improvement pass shipped. Two shipped bugs fixed: (1) visitors with dark system theme got dark tokens on the fixed-light showroom, producing white-on-white text in every light band and the footer; fixed by aliasing the light token block to `[data-theme="light"]` in globals.css and pinning the showroom wrapper. (2) The gray tone icon chip used white-on-white styling on light cards; now `bg-muted` on light with a dark-band override. Added: skip link + main targets, `metadataBase`/OG/Twitter metadata with a generated 1200x630 opengraph-image, "Keep exploring" cross-links from the previously unused nav descriptions, configurable stakeholder CTA (Tech Stack no longer links to itself, Overview keeps stack CTA since the hero covers features), mockup headings demoted into a `figure` for valid heading order, footer copyright, security H1 rewrite. Verified: 8/8 content-contract Vitest, clean `tsc`, `npm run build:app` (all five routes + hashed opengraph-image emitted), codemaps regenerated, `git diff --check`, and browser proof under `data-theme="dark"` (light bands render dark-on-light, gray chips visible, no console errors, OG image serves 200 image/png, no horizontal overflow at 375px).

---

## Active: Public CSP and deploy smoke hardening (2026-07-02)

Plan: `tasks/public-csp-smoke-hardening-plan.md`

- [x] Restore nonce-based CSP for rendered HTML routes.
- [x] Add deploy smoke automation for public pages and seeded-login checks.
- [x] Sync docs and close GAP-60 if verification passes.
- [x] Run focused tests, TypeScript, docs, whitespace, build, and smoke gates.

### Review
- 2026-07-02: Slice started after production `/about` recovery. Goal is to replace the emergency production inline-script CSP allowance with request nonces and add a reusable deploy smoke command that can exercise public pages plus a seeded login path.
- 2026-07-02: Slice shipped locally. Middleware now owns nonce CSP for rendered HTML routes, the root layout attaches the request nonce to first-party boot scripts, production `script-src` no longer allows `unsafe-inline`, and `npm run smoke:deploy` verifies public pages, `/privacy`, `/login`, protected redirect, login, and authenticated `/` rendering. Local production smoke passed on `http://localhost:3003` with the seeded admin login.

---

## Active: Public stakeholder showroom (2026-07-01)

Plan: `tasks/public-showroom-plan.md`

- [x] Confirm public route and content strategy.
- [x] Add typed static content, public layout, `/about` route set, and reusable showroom components.
- [x] Add public showroom area doc and content contract coverage.
- [x] Run focused tests, TypeScript, docs/codemap checks, whitespace check, app build, and browser smoke.

### Review
- 2026-07-01: Public showroom implementation started for `/about`, `/about/features`, `/about/tech-stack`, `/about/security`, and `/about/field-work`. The route set is intentionally static and unauthenticated: no API reads, no schema changes, no AppShell changes, and no live user/item/booking/audit data in mockups. Verification is pending.
- 2026-07-01: Public showroom V1 shipped locally. The route set lives outside the authenticated app shell, uses typed static content and fictional mockup data, exposes stakeholder navigation and Sign in, and keeps `/` plus `/login` behavior unchanged. Focused content Vitest, TypeScript, codemap/docs verification, whitespace check, `npm run build:app`, and Chrome desktop/mobile smoke passed. Browser proof found no console errors, no horizontal overflow, no showroom `/api` calls, keyboard-reachable nav, and unauthenticated `/` redirecting to `/login`.
- 2026-07-02: Production blank-page recovery shipped locally after live deploy proof showed CSP blocking Next App Router inline bootstrap/RSC scripts on `https://wisconsincreative.com/about`. Updated production CSP to `script-src 'self' 'unsafe-inline'` until nonce wiring exists, added source-contract coverage, and tracked the residual hardening item as GAP-60.

---

## Active: Wisconsin Creative domain cutover readiness (2026-07-01)

Plan: `tasks/wisconsincreative-domain-cutover-plan.md`

- [x] Confirm plan boundary before implementation.
- [x] Slice 1: Centralize native production host constants and add source-contract coverage.
- [x] Slice 2: Sync web env/docs/runbook references for `wisconsincreative.com`.
- [x] Slice 3: Confirm kiosk transition strategy before App Store submission.
- [ ] Slice 4: Run live Vercel/Cloudflare/browser/iOS/kiosk cutover proof after DNS is ready.

### Review
- 2026-07-01: Slices 1-2 shipped locally. Native app and kiosk production host usage now flows through `AppEnvironment` with `wisconsincreative.com` as canonical and `gear.erikrole.com` retained only as an explicit legacy transition constant. Main API, kiosk API/cookie host, login recovery/register links, Profile manage-account, Licenses web management, and Schedule webcal subscription were moved to the shared host config, and `WisconsinKiosk` now compiles the shared source folder. `.env.example`, iOS README, Mobile, Kiosk, and Notifications docs now name the new canonical host and production `APP_URL`/`EMAIL_FROM` expectations. Focused Vitest source-contract proof passed for 5 files and 22 tests. Live Vercel/Cloudflare/browser/iOS/kiosk proof remains pending until DNS and production env are configured.
- 2026-07-01: iOS migration proof passed. The rollout strategy is to ship the first App Store build against `wisconsincreative.com`, keep `gear.erikrole.com` aliased during rollout, and reactivate development kiosk devices if needed instead of adding dual-cookie migration code. Focused iOS domain source-contract Vitest, TypeScript, iOS drift, iOS gap audit, Xcode project consistency, whitespace, and XcodeBuildMCP simulator builds for both `Wisconsin` and `WisconsinKiosk` passed. Public production route smoke outside sandbox DNS returned 200 for `/login`, `/register`, and `/forgot-password`; `/bookings` correctly redirected to `/login`. Remaining Slice 4 proof is authenticated browser smoke, native sign-in plus one mutating request, and kiosk activation/session proof.
- 2026-07-01: Runtime smoke advanced. In-app browser loaded `https://wisconsincreative.com/login`, `/register`, and `/forgot-password` with no console errors, and protected `/bookings` redirected to `/login`. XcodeBuildMCP `build_run_sim` installed and launched the migrated `Wisconsin` app; runtime UI snapshot showed the Wisconsin Creative sign-in screen with email/password fields and invitation-only copy. Remaining Slice 4 proof is credentialed: authenticated browser smoke, native sign-in plus one mutating request, and kiosk activation/session proof.
- 2026-07-01: Native sign-in proof passed after user signed into the simulator. XcodeBuildMCP runtime UI snapshot showed the authenticated Home dashboard for Erik with live operational counts and `Dashboard synced now` on the `wisconsincreative.com` build. I did not perform a non-login production mutation because the available native actions would alter real data without explicit approval.
- 2026-07-01: User confirmed the migrated app builds and runs with real production data, closing the native authenticated read-path side of Slice 4. Remaining migration proof is now archive/signing readiness, authenticated browser smoke if needed, an approved non-login production mutation if we choose one, and kiosk activation/session proof.
- 2026-07-01: Cutover debt cleanup aligned `src/lib/env.ts`, `.env.example`, Notifications docs, Mobile docs, manual iOS walkthrough links, active iOS audit notes, and Slack planning docs with `wisconsincreative.com` and the server-side `APP_URL` contract. Remaining intentional debt is explicit: App Store archive/export signing proof, approved production mutation proof, kiosk activation/session proof, and eventual `AppEnvironment.legacyHost` plus legacy trusted-origin retirement after old links age out.
- 2026-07-01: Initial plan created after repo audit found legacy production literals in native API, kiosk, login/register/recovery links, manage-account/licensing links, and shift calendar subscription. That implementation pause is superseded by the completed host-centralization slices above.

---

## Active: Booking return-date stale duplicate save recovery (2026-07-01)

Plan: suppress false conflict toasts only when a stale repeat save exactly matches the booking state that already landed.

- [x] Trace the toast source, booking edit client, and shared booking PATCH route for return-date saves.
- [x] Add route handling for idempotent stale PATCH payloads after the first save moves `updatedAt`.
- [x] Add explicit regression coverage for stale duplicate return-date edits.
- [x] Sync area docs and capture the corrected diagnosis in lessons.
- [x] Run focused tests, TypeScript, docs/drift checks, whitespace check, and iOS verification as available.

### Review
- 2026-07-01: The visible toast came from the shared `BookingDetailsSheet` save path, which already sends `If-Unmodified-Since`. The remaining return-date failure was a stale duplicate PATCH edge: the first save moved `updatedAt`, then a repeat save carrying the old snapshot could return 409 even though the requested `endsAt` had already landed. `/api/bookings/[id]` now treats stale PATCH payloads as idempotent only when every submitted field matches the current booking state, returns the enriched booking detail without a second update or audit entry, and keeps true stale competing edits as 409 conflicts. Focused booking route/service Vitest, TypeScript, iOS drift/gap checks, docs check, whitespace check, `npm run build:app`, and unsandboxed `npm run ios:xcode:verify` passed.

---

## Active: iOS item-list asset-tag identity pass (2026-06-30)

Plan: make native iOS item rows follow the web Items list contract: operational asset tags are the primary header, with product/model copy secondary.

- [x] Audit current iOS item-list renderers across Items, booking detail, create-booking picker/review, kiosk checkout/pickup/return, search, scan, and utility pickers.
- [x] Add shared Swift item identity helpers so rows do not each decide their own primary label.
- [x] Update serialized item rows to render asset tags/tag names in Gotham as the primary header and move product names to subtitles.
- [x] Keep item-family/SKU rows name-first only when no asset/unit tag exists.
- [x] Add focused source-contract tests and sync area docs.
- [x] Run focused tests, iOS drift/gap checks, docs check, whitespace check, and iOS build verification as available.

### Review
- 2026-06-30: Native iOS item-list identity now follows the web Items list contract. Shared Swift helpers make `assetTag`, `tagName`, or numbered bulk unit tags the primary item header, while product/model/SKU names move to secondary copy. Updated surfaces include Items, booking equipment, create-booking picker and review rows, Search, kiosk checkout cart, kiosk pickup/return checklists, kiosk active checkout rows, flagged item alerts, and the link-sticker utility picker. Focused Vitest source contracts, TypeScript, iOS drift, iOS gap audit, docs/codemap verification, whitespace check, and unsandboxed `npm run ios:xcode:verify` passed.

---

## Active: iOS booking title edit conflict recovery (2026-06-30)

Plan: stop harmless native booking name edits from being blocked by availability conflict checks.

- [x] Audit the native screenshot, edit payload, shared booking PATCH route, checkout/reservation update services, and update-booking regression tests.
- [x] Patch checkout update so title/notes-only edits skip availability checks and equipment rebuilds while due-date/location/equipment edits still revalidate.
- [x] Patch reservation update with the same metadata-only behavior.
- [x] Add focused service coverage for metadata-only edits and timing edits.
- [x] Run focused tests, TypeScript, iOS drift/gap checks, docs check, whitespace check, and iOS build verification.

### Review
- 2026-06-30: Root cause was the shared booking update service treating metadata-only edits as availability-impacting edits. A native title save on an existing checkout could rerun availability against the current equipment/window and return conflict copy even though the title itself was harmless. Checkout and reservation updates now skip availability checks and equipment rebuilds for title/notes-only edits, while due-date, location, and equipment edits still revalidate and update allocation windows. Focused update-booking Vitest, optimistic-lock/source-contract tests, TypeScript, iOS drift, iOS gap audit, codemap/docs checks, whitespace checks, and unsandboxed `npm run ios:xcode:verify` passed.

---

## Active: Student availability scheduling contract (2026-06-30)

Plan: `tasks/student-availability-scheduling-contract-plan.md`

- [x] Slice 1: Align availability ownership and profile entry points with scheduling class.
- [x] Slice 2: Add profile availability impact summary and clearer buckets.
- [x] Slice 3: Improve auto-fill skipped-reason explanations.
- [x] Slice 4: Surface availability blockers and preferences earlier in Open Work and Trade Board rows.
- [x] Slice 5: Expand native iOS availability display and creation parity.
- [x] Slice 6: Recompute future active assignment conflict state after availability changes.
- [x] Add source-contract coverage for web, API, and iOS session behavior.
- [x] Add source-contract coverage for profile availability impact copy.
- [x] Sync Schedule, Users, Mobile, and Student Availability docs.
- [x] Run focused verification gates.

### Review
- 2026-06-30: Student availability now follows Scheduling class instead of app permission role. Staff-access users whose `staffingType` is Student can own availability blocks, see the web profile Availability tab, and reach native iOS My Availability; Staff-scheduling-class targets are rejected from availability creation. `/api/me` and login responses now include `staffingType` so native session state can apply the same contract. Focused Vitest, TypeScript, iOS drift, iOS gap audit, codemap/docs checks, whitespace, `npm run build:app`, and unsandboxed `npm run ios:xcode:verify` passed. Authenticated browser smoke remains blocked without an active local authenticated browser session.
- 2026-06-30: Profile Availability impact summary shipped locally. The tab now distinguishes blocking approved time off from advisory conflicts and preferred windows, names the next upcoming dated exception, skips denied time-off rows for that next-exception cue, and uses broader weekly/dated bucket labels for class conflicts, preferences, and time-off requests. Focused Vitest, TypeScript, codemap/docs check, whitespace, and `npm run build:app` passed. Authenticated browser smoke remains blocked without an active local authenticated browser session.
- 2026-06-30: Auto-fill skipped-reason explanations shipped locally. Preview skipped rows now carry stable reason codes and supporting counts for candidate pool size, scheduling-class match, area fit, approved time off, overlapping assignments, and candidates already proposed earlier in the same preview. Shift Detail and Event detail render the concise reason plus detail bullets before staff apply recommended assignments. Focused auto-fill Vitest, TypeScript, codemap/docs checks, whitespace check, and `npm run build:app` passed; the app build still reports the existing unused `kind` warnings in `src/lib/booking-status-display.ts`.
- 2026-06-30: Open Work and Trade Board availability context shipped locally. Open Student shift rows now show approved time off, advisory availability, pending time off, and preferred-window context before claim/request actions. Trade rows now include viewer and claimed-worker availability context, move approved-time-off blocked claims into Waiting or Blocked, and reject approved-time-off trade claims before staff review. Focused Open Work/Trade Board Vitest and TypeScript passed.
- 2026-06-30: Native iOS My Availability parity shipped locally. The screen now displays weekly and one-time availability records, preference, dislike, and time-off status; summarizes blocking time off, advisory signals, and preferred windows; and creates weekly or one-time records through the existing availability API while keeping decoded new fields optional for rollout safety. Focused source-contract Vitest, TypeScript, iOS drift, iOS gap audit, codemap/docs checks, whitespace check, and `npm run build:app` passed. Sandboxed Xcode exposed a Swift compile issue that was fixed; the unsandboxed rerun was blocked by approval rejection before it could execute.
- 2026-06-30: Availability conflict refresh shipped locally. Availability create, update, review, and delete now recompute future active assignment `hasConflict` and `conflictNote` from the worker's effective assignment call window. Approved time off approved after assignment now surfaces as a persisted Schedule conflict, and deleted/changed availability clears stale conflict notes. Focused availability route Vitest, TypeScript, codemap/docs checks, whitespace check, and `npm run build:app` passed; the app build still reports the existing unused `kind` warnings in `src/lib/booking-status-display.ts`.
- 2026-06-30 continuation proof audit: Combined availability-focused Vitest passed across route, source-contract, profile UI, auto-fill, Open Work, and Trade Board coverage (`87` tests), and `npm run drift:ios` plus `npm run audit:ios:gaps` passed. Native runtime proof passed through XcodeBuildMCP: simulator build succeeded with no diagnostics, build/install/launch succeeded on the configured iPhone 17 simulator, and a UI snapshot confirmed the launched Wisconsin Creative sign-in screen. Browser smoke remains blocked: sandboxed `npm run dev` failed with `listen EPERM`, and the unsandboxed dev-server request was rejected before execution. Keep this plan active until authenticated browser proof can run or source/build proof substitution is explicitly accepted.

---

## Active: Student availability experience (2026-08-21)

Plan: `tasks/student-availability-experience-plan.md`

- [x] Add rollout-safe inclusive one-off date ranges and all-day time-away fields without changing advisory or approved-time-off policy.
- [x] Make the web Availability tab lead with recurring class schedules and distinct one-off day/range actions.
- [x] Bring native iOS editing to the same range/all-day/optional-term contract.
- [x] Add focused route, conflict-helper, web-contract, and iOS-contract coverage.
- [x] Run Prisma generation/validation, migration-prefix, TypeScript, iOS drift/project, focused tests, `npm run build:app`, and the pinned iPhone 16 Pro iOS 26.5 build.
- [ ] Apply the additive migration, deploy compatible web/API code, and prove the authenticated web Availability tab in the intended environment.
- [ ] Inspect the authenticated native My Availability editor in-app; source/build proof is complete but does not replace runtime visual acceptance.

### Review

- 2026-08-21: Local implementation now makes weekly class windows the primary path on web and iOS, supports one-off single dates or inclusive ranges, and treats all-day ranges as unavailable at any call time on covered dates. Legacy single-date/timed rows remain valid, and new iOS fields decode optionally. Focused availability tests, Prisma validation/generation, TypeScript, migration-prefix, iOS drift/project checks, codemap/docs verification, `npm run build:app`, whitespace, and the iPhone 16 Pro iOS 26.5 build pass. The additive migration, authenticated browser proof, and authenticated in-app visual proof remain deferred by the repository's rollout gates.

---

## Active: Trade Board Open Work hardening (2026-06-30)

Plan: `tasks/trade-board-open-work-hardening-plan.md`

- [x] Audit current web Trade Board, open-work service, trade service, routes, schema, area docs, and source-contract tests.
- [x] Slice 1: upgrade canonical web Trade Board grouping and consequence copy.
- [x] Slice 2: harden trade/open-work API lifecycle consistency.
- [x] Slice 3: add web/iOS parity contracts.
- [x] Slice 4: update native iOS Trade Board.
- [x] Run full requested verification gates.

### Review
- 2026-06-30: Trade Board Open Work hardening shipped locally. The web Trade Board now groups rows by decision state instead of backend source: Staff Review, Available Now, Approval Required, My Posts, Waiting or Blocked, Posted Trades, and Resolved. Consequence copy now says whether a pickup assigns immediately, sends a staff request, or only removes a post while keeping the original assignment. Trade lifecycle and Open Work pickup checks now use effective personal call windows for posting, claiming, approving, listing, expiration, pickup visibility, and conflict checks. Native iOS now consumes `/api/schedule/open-work` alongside trade posts, decodes open shifts and pickup requests, passes role into the sheet, and mirrors the same section names and action consequence copy. Verification passed with focused Vitest, TypeScript, iOS drift, iOS gap audit, docs/codemap checks, whitespace check, `npm run build:app`, and XcodeBuildMCP simulator build. The app build still reports the existing unused `kind` warnings in `src/lib/booking-status-display.ts`.

---

## Active: Personal calendar subscription sync hardening (2026-06-30)

Plan: make subscribed worker calendars glanceable and state-trustworthy without carrying internal gear-prep noise into external calendar apps.

- [x] Audit the current ICS token/feed route, shift call-window fields, calendar event identity fields, and trade swap lifecycle.
- [x] Rename subscription events to `Area: SPORT vs/at Opponent` with fallback cleanup for non-game summaries.
- [x] Use the effective assignment call start/end window for subscribed event times.
- [x] Include a Gear Tracker event deep link, omit descriptions, and remove gear-prep copy from the feed.
- [x] Prefix active open/claimed trade-board posts with `🔁` and rely on active assignment status to remove completed swaps from the original worker feed.
- [x] Add focused ICS regression coverage and sync area docs.
- [x] Run focused verification.

### Review
- 2026-06-30: Personal shift calendar subscription sync now emits compact worker-facing titles like `Photo: MBB vs Iowa`, uses effective assignment/shift call windows for calendar event times, includes a Gear Tracker event URL, omits descriptions and gear-prep copy, prefixes active open/claimed trade posts with `🔁`, and leaves completed trade removals to the existing `SWAPPED` assignment lifecycle. Verification passed with focused ICS Vitest, whitespace check, docs verification, and `npm run build:app`; the build still reports the existing unused-parameter warnings in `src/lib/booking-status-display.ts`.

---

## Active: iOS Schedule tab badge today scope (2026-06-30)

Plan: keep upcoming-shift context available, but badge Schedule only for shifts on today's institution-timezone date.

- [x] Audit native tab badge source, dashboard stats API, shift date semantics, and existing contract tests.
- [x] Add a dedicated `myShiftsTodayCount` to `/api/dashboard/stats`.
- [x] Decode/store the today count in native `AppState` without replacing the broader upcoming `myShiftCount`.
- [x] Point the Schedule tab badge and accessibility label at the today-only count.
- [x] Update focused source-contract tests and area docs.
- [x] Run focused verification.

### Review
- 2026-06-30: Native iOS Schedule tab badge now uses a separate today-only count instead of the broader upcoming shift total. `/api/dashboard/stats` returns both `myShiftsCount` and `myShiftsTodayCount`; native `AppState` keeps both so Profile/Home-style context can still show upcoming shifts, while `AppTabView` badges Schedule only for today's assignments and names that correctly for VoiceOver. Focused Vitest, whitespace, iOS drift, iOS gap audit, docs verification, `npm run ios:xcode:verify` outside the sandbox, and `npm run build:app` passed. The sandboxed Xcode run failed only because CoreSimulator and the Swift macro plugin server were blocked.

---

## Active: iOS Browse tab native menu (2026-06-30)

Plan: `tasks/ios-browse-tab-plan.md`

- [x] Audit current mobile, items, users, resources, licenses, settings, schema, and iOS shell contracts.
- [x] Add a native SwiftUI `BrowseView` using system list and navigation patterns.
- [x] Wire `BrowseView` into `AppTabView` in the old Items tab slot.
- [x] Move regular-width Users into a non-admin Resources sidebar destination.
- [x] Keep Profile/Settings Directory as a fallback and ungate its Users row.
- [x] Add focused source-contract tests for Browse and update old tab/sidebar expectations.
- [x] Sync area docs, iOS patterns, audit inventory, and task review notes.
- [x] Run focused tests and iOS verification gates.

### Review
- 2026-06-30: Native Browse tab shipped locally. Compact iPhone now uses `Browse` in the old Items slot, opening a native grouped SwiftUI menu for Items, Guides, Licenses, and Users. Search remains the pinned trailing search tab with scan inside Search, so the tab shell stays at five compact destinations and avoids More. Users is visible to every authenticated role from Browse, Settings Directory, and regular-width Resources sidebar; edit/admin powers remain governed by existing Users permissions and APIs. Settings Directory remains a fallback path for Guides, Users, and Licenses. Verification passed with focused Vitest, XcodeGen project check, iOS drift, iOS gap audit, docs/codemap check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox. The first sandboxed Xcode run failed from CoreSimulator and Swift macro plugin restrictions; the approved unsandboxed rerun passed.

---

## Active: iOS native Guides page (2026-06-30)

Plan: `tasks/ios-guides-native-page-plan.md`

- [x] Audit current Resources docs, API shape, iOS shell, Settings directory, and source-contract tests.
- [x] Add Swift resource models and API client reads.
- [x] Build `GuidesView` with loading, error, empty, pull-to-refresh, native search, focus filtering, and read-only article rendering.
- [x] Replace Guides web fallbacks in `AppTabView` and `ProfileView`.
- [x] Add focused source-contract coverage for the native Guides route.
- [x] Sync Mobile and Resources area docs plus task review notes.
- [x] Run focused tests and iOS verification gates.

### Review
- 2026-06-30: Native iOS Guides shipped locally. `GuidesView.swift` now uses the existing read-only `/api/resources` contract to load Guides, search locally, filter by focus, sort, pull to refresh, and read guide Markdown with native SwiftUI rendering. Compact iPhone opens Guides from Settings > Directory, and regular-width iPad uses the sidebar-only Guides destination. Authoring, deletion, verification, image upload, Contacts, and sport-assignment reference tools stay web-owned. Verification passed with focused Vitest, XcodeGen project check, iOS drift, iOS gap audit, docs/codemap check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox. The first sandboxed Xcode run failed from CoreSimulator and Swift macro plugin restrictions; the approved unsandboxed rerun passed.

---

## Active: iOS Search tab with scan action (2026-06-30)

Plan: `tasks/ios-search-tab-scan-action-plan.md`

- [x] Audit current Scan tab, global search, Home shortcut, docs, and source tests.
- [x] Replace compact Scan tab content with the native global Search surface.
- [x] Keep QR scanning as an action inside Search.
- [x] Update tests, docs, and lessons for Search-tab ownership.
- [x] Run focused tests and iOS verification gates.

### Review
- 2026-06-30: Native Search tab shipped locally. The compact trailing tab is now `Search` with the magnifying-glass icon and `role: .search`, backed by `GlobalSearchSheet(showsCancelButton: false)`. Scan remains inside Search as the QR toolbar action, matching shopping-app behavior. Home's all-clear button routes to `presentSearch()`, while `presentScanLookup()` remains as a compatibility alias. Focused Vitest, iOS drift, iOS gap audit, whitespace, XcodeGen project check, docs verification, and `npm run ios:xcode:verify` passed. The first sandboxed Xcode run failed from CoreSimulator and Swift macro plugin restrictions; the approved unsandboxed rerun passed.

---

## Active: iOS native control cleanup (2026-06-30)

Plan: `tasks/ios-native-control-cleanup-plan.md`

- [x] Confirm accepted cleanup scope: Global Search, Items filters, Create Booking equipment search, and Booking Detail actions.
- [x] Replace accepted hand-rolled controls with native SwiftUI search, toolbar menu, and bordered button patterns.
- [x] Add focused source-contract coverage.
- [x] Sync relevant area docs and review notes.
- [x] Run focused tests, iOS drift/gap checks, docs checks, and Xcode verification as available.

### Review
- 2026-06-30: Native-control cleanup shipped locally for the accepted scope. Global Search now uses SwiftUI `.searchable` with a toolbar scanner action and keeps Return/submit recent-search behavior. Items filters now live in toolbar Favorites plus native Status/Sort menus instead of a custom horizontal pill strip. Create Booking's Equipment step uses native `.searchable`, and Booking Detail Extend/Cancel use SwiftUI bordered system buttons. Focused Vitest, iOS drift, iOS gap audit, whitespace, XcodeGen project check, docs verification, and `npm run ios:xcode:verify` passed. The first sandboxed Xcode run failed from CoreSimulator and Swift macro plugin restrictions; the approved unsandboxed rerun passed.

---

## Active: iOS native Licenses page (2026-06-30)

Plan: `tasks/ios-licenses-native-page-plan.md`

- [x] Audit licenses, mobile/settings, decisions, gaps, Prisma schema, API routes, and current iOS navigation.
- [x] Add Swift models and `APIClient` methods for the existing license APIs.
- [x] Build native `LicensesView` with loading, error, empty, active-license, pool, claim, return, copy, and admin web-link states.
- [x] Replace iOS Licenses web fallbacks with the native page in Profile/Settings and regular-width sidebar navigation.
- [x] Add focused source-contract tests.
- [x] Sync `AREA_LICENSES`, `AREA_MOBILE`, `AREA_SETTINGS`, and task review notes.
- [x] Regenerate Xcode project and run verification gates.
- [x] Screenshot follow-up: remove contradictory pool-row copy, make Copy Code neutral, keep Return destructive, and reduce active-license action weight.
- [x] App Store-style follow-up: use native SwiftUI text-only capsule buttons for Claim, Copy Code, and Return License without custom badge/icon styling.

### Review
- 2026-06-30 App Store-style native button follow-up: Real iPhone screenshots showed the icon-backed license actions still looked custom, and the App Store reference pointed toward text-only system capsules. Claim now uses SwiftUI's native bordered-prominent capsule with green tint, Copy Code uses a blue bordered capsule, and Return License uses a destructive bordered capsule. No custom badge view or action icon styling is used. Focused Vitest, iOS drift, iOS gap audit, XcodeGen project check, whitespace check, and docs check passed. The sandboxed `npm run ios:xcode:verify` failed before meaningful Swift diagnostics because CoreSimulator and Swift macro plugin services were unavailable; the required unsandboxed rerun was blocked by the Codex usage limit before approval.
- 2026-06-30 native-control follow-up: Real iPhone screenshots showed the green filled Claim capsules and active-license pills still felt custom, and Copy Code had a red icon despite the blue action label. The follow-up removes the custom capsule/background treatment from Claim, Copy Code, and Return License. Claim is now a text-only green borderless list action, Copy Code is a blue monochrome borderless action, and Return License stays borderless/destructive red. Verification passed with focused Vitest, iOS drift, iOS gap audit, XcodeGen project check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox.
- 2026-06-30 claim tint follow-up: Real iPhone screenshots showed Claim buttons and the claim confirmation action inheriting the app's red accent, which made claiming look destructive. Claim now uses the green status tint in both the pool row and the confirmation dialog; Return License remains the only red/destructive action. Focused source coverage pins the positive Claim tint. Verification passed with focused Vitest, iOS drift, iOS gap audit, XcodeGen project check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox.
- 2026-06-30 gating follow-up: Verified `/api/licenses` strips unheld code strings for students, then added a native defense-in-depth guard so `LicensePoolRow` only reveals row codes to staff/admin or the current holder. Students can still claim an available slot, but cannot see or copy a code before claiming it. Focused source coverage now pins both the API sanitizer and the native reveal guard. Verification passed with focused Vitest, iOS drift, iOS gap audit, XcodeGen project check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox.
- 2026-06-30 screenshot follow-up: Real iPhone screenshots showed pool rows displaying `Available` and `Already claimed` at the same time, and the active-license action row made Copy Code look destructive. The follow-up removes repeated unavailable copy from pool rows when the user already has an active license, keeps claim buttons only when `activeClaimId == nil`, makes Copy Code a small blue bordered capsule, and leaves Return License as the only destructive action. Verification passed with focused Vitest, iOS drift, iOS gap audit, XcodeGen project check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox.
- 2026-06-30: Native iOS Licenses shipped locally. `LicensesView.swift` now uses the existing license APIs to load the pool, show the signed-in user's active Photo Mechanic code, claim one open slot with confirmation, copy the active code, and return only the signed-in user's own active slot. Profile/Settings > Directory opens the native page for every authenticated role, and regular-width iPad exposes Licenses as a sidebar-only Resources destination. Staff/admin create, renew, retire, export, unknown occupant, and full-history workflows stay linked to the web Licenses page. Verification passed with focused Vitest, XcodeGen project check, iOS drift, iOS gap audit, docs/codemap check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox. The sandboxed Xcode run failed before useful compile output because CoreSimulator and Swift macro plugin services were blocked; the unsandboxed rerun passed.

---

## Active: iOS Schedule UI cleanup (2026-06-29)

Plan: `tasks/ios-schedule-ui-cleanup-plan.md`

- [x] Collapse venue, sport, My shifts, and Past events controls into one filter sheet with a compact active-filter summary.
- [x] Keep the List/Calendar segmented control visible and self-describing.
- [x] Calm toolbar actions so routine actions do not read as destructive.
- [x] Simplify date headers and event rows so cards do not look selected by default.
- [x] Add bottom scroll clearance above the native tab bar.
- [x] Apply screenshot follow-up: neutral Filters control, native sheet action order, calmer My shift rows, and calendar/list row alignment.
- [x] Remove the duplicated Event detail bottom-bar prep-gear action that overlapped Crew rows in the medium sheet.
- [x] Polish Event detail hierarchy: quiet section icons, lighter title, Crew-scoped Add shift, and one inline You cue.
- [x] Sync Mobile/Schedule docs, add focused source coverage, and run iOS verification gates.

### Review
- 2026-06-29: Native iOS Schedule cleanup shipped locally. The first viewport now keeps List/Calendar plus a compact filter summary and one Filters button instead of multiple chip rows. The Filters sheet owns My shifts, Past events, venue, and sport controls, and calendar day counts/dots now honor the same venue/sport/my-shifts filters as the list. Event rows use a neutral hairline card with a subtle My shift cue instead of blue selection-like outlines, multi-day copy uses secondary text, date headers are lighter, and both list surfaces reserve bottom scroll clearance above the native tab bar. Verification passed with focused Vitest, iOS drift, iOS gap audit, docs/codemap verification, focused whitespace check, and `npm run ios:xcode:verify` outside the sandbox. The first sandboxed Xcode run failed from CoreSimulator permission and Swift macro plugin service errors, then passed when rerun with approved unsandboxed access.
- 2026-06-29 screenshot follow-up: Real iPhone screenshots showed the first pass still overweighted filters and assigned-shift state. The follow-up makes the Filters control neutral, restores Clear/Done sheet placement, changes My shift from red fill/text to neutral row plus blue personal-scope label, keeps staff coverage chips in the calendar selected-day list, and uses clearer generic empty-state copy when multiple filters are active.
- 2026-06-29 detail follow-up: Event detail screenshots showed the bottom-bar Prep gear action duplicating the inline Reserve gear row and overlapping Crew content in the medium detent. The duplicate bottom toolbar action was removed, the inline Reserve gear row remains the prep path, and the sheet title was shortened to Event so the toolbar no longer repeats a truncated event title.
- 2026-06-29 detail polish follow-up: Event detail now uses secondary section-header icons, a lighter semantic event title, native toolbar Add shift, and one inline You capsule for the signed-in assignment instead of a row-wide highlight plus extra indicators. After screenshot feedback, Add shift was revised from a large bordered icon-only treatment to native SwiftUI toolbar chrome with a title-and-symbol label, matching recent sheet action patterns while keeping Crew focused on coverage. Verification re-ran with focused Vitest, iOS drift, iOS gap audit, docs/codemap check, focused whitespace check, and `npm run ios:xcode:verify`.

---

## Active: iOS booking action duplicate-submit recovery (2026-06-29)

Plan: stop successful native booking edits from showing a stale-write error when Save is tapped rapidly, and harden adjacent booking actions with the same handler-level guard.

- [x] Audit the native edit sheet, iOS API client, `/api/bookings/[id]` optimistic-lock route, schema, docs, and existing source-contract tests.
- [x] Patch the iOS edit-sheet Save handler with a self-guard before the optimistic-lock PATCH request.
- [x] Patch adjacent native Extend and Cancel handlers with self-guards before their booking mutation requests.
- [x] Add focused source-contract coverage for the duplicate-action guards.
- [x] Run focused tests, iOS drift/gap checks, docs check, whitespace check, and iOS build verification.

### Review
- 2026-06-29: Root cause was a native duplicate-submit race in the edit sheet. A rapid second Save could reuse the old `updatedAt` value after the first PATCH had already updated the booking, so the API correctly returned the stale-write "modified by someone else" message even though Ryan Dean's return-date change went through. `EditBookingSheet.save()` now exits immediately when `isSaving` is already true, before sending another optimistic-lock request. Adjacent native Extend and Cancel handlers now also self-guard before their booking mutation requests, so visual disabling is backed by handler-level race protection. Focused source coverage pins all three guards. Verification passed with focused Vitest, iOS drift, iOS gap audit, docs/codemap check, whitespace check, and `npm run ios:xcode:verify` outside the sandbox.

---

## Active: Kiosk active battery quantity display hotfix (2026-06-29)

Plan: show active checkout batteries in kiosk even when the checkout has bulk quantities but no exact numbered-unit allocation rows.

- [x] Patch `/api/kiosk/dashboard` checkout previews and Items Out fallback rows for active bulk quantities without unit allocations.
- [x] Patch `/api/kiosk/checkout/[id]` detail rows so active bulk quantities appear in the drawer.
- [x] Keep generic quantity rows read-only in the native drawer because they do not identify an exact removable unit.
- [x] Fix the root clobber path so detail-only checkout edits preserve numbered bulk allocation rows.
- [x] Add focused regressions and run kiosk/iOS verification.

### Review
- 2026-06-29: Root cause found in the general `/api/bookings/[id]` checkout update path, not the kiosk scanner path. `updateCheckout` rebuilt equipment rows on every detail edit because omitted equipment fields were defaulted from existing rows before delete/recreate. For numbered bulk, deleting `booking_bulk_items` cascaded `booking_bulk_unit_allocations`, leaving the web with a quantity-only Sony Battery row. The service now updates detail fields and allocation dates in place unless the request explicitly supplies equipment changes. Kiosk dashboard/detail payloads also show a read-only `bulk_quantity` fallback for already-damaged quantity-only data. Live DB inspection found checkout `CO-0053` / title `Chris Hall` with Sony Battery planned quantity 4 and zero allocation rows; Sony Battery units `#19`, `#27`, `#30`, and `#39` are the four units currently marked checked out and are the likely repair set. Verification passed with focused Vitest, TypeScript, iOS drift, iOS audit gaps, docs/codemap check, whitespace check, and `npm run ios:xcode:verify:kiosk` outside the sandbox.

---

## Active: iOS Bookings unified list polish (2026-06-29)

Plan: make native Bookings read as one operational list instead of two separated top tabs.

- [x] Remove the Reservations/Checkouts segmented top control.
- [x] Load active checkouts and reservations together, with Checkouts above Reservations and newest rows first inside each section.
- [x] Keep requester avatar photos wired from `requester.avatarUrl`.
- [x] Replace Confirmed/Booked/Open display copy with Reserved/Checked Out/Overdue status language.
- [x] Sync docs and focused source coverage.

### Review
- 2026-06-29: iOS Bookings unified list polish shipped locally. Native Bookings now searches one list, renders Checkouts first and Reservations second, sorts each section newest-first, keeps the Mine/All and New Reservation toolbar actions, and clears legacy sub-tab deep-link hints without reintroducing a top segmented control. Booking rows continue to use `UserAvatarView` with `booking.requester.avatarUrl`, and booking status display copy now maps `BOOKED` to `Reserved`, `OPEN` to `Checked Out`, and overdue open checkouts to red `Overdue`. Verification is recorded in the active turn notes.

---

## Active: iOS booking notes edit recovery (2026-06-29)

Plan: fix native booking note edits so clearing notes is a real save and multi-line editing avoids text-field layout churn.

- [x] Audit the pasted console log, native booking detail sheet, API update client, and `/api/bookings/[id]` patch contract.
- [x] Patch iOS update payload encoding to distinguish unchanged fields from an explicit cleared notes value.
- [x] Use a multi-line notes editor in the native booking edit sheet.
- [x] Add focused source coverage and sync docs.
- [x] Run focused tests, TypeScript if shared code changes, iOS drift/gap checks, whitespace check, and Xcode verification.

### Review
- 2026-06-29: Native Booking Detail notes edits now use a multiline `TextEditor` with an explicit placeholder and accessibility label. Clearing the notes field sends a trimmed empty string through the existing optimistic-lock `/api/bookings/[id]` PATCH path instead of omitting `notes`, so a cleared notes section persists and disappears after reload. The pasted console's text-prediction and alert layout lines are system UI noise around editing/confirmation controls, but this slice removes the vertical `TextField` from the notes path. Verification passed with focused Vitest, TypeScript, iOS drift, iOS gap audit, docs verification, focused whitespace, and `npm run ios:xcode:verify`.

---

## Active: iOS Home visual polish (2026-06-29)

Plan: remove noisy Home chrome from the screenshot while keeping the action queue and existing booking creation flows intact.

- [x] Remove the floating Home plus button and its sheet state from `HomeView`.
- [x] Strengthen the Due Today clock icon tile while preserving the orange text tone.
- [x] Improve the synced timestamp contrast so Home status is readable.
- [x] Add focused source coverage and sync Mobile/Dashboard docs.

### Review
- 2026-06-29: iOS Home visual polish shipped locally. Home no longer overlays a 58pt floating create button on top of Next Up. The orange text tone remains unchanged, while compact orange status icon tiles such as the Due Today clock now use a stronger light-mode fill (`#ffedd5`) so the icon box does not wash out. The Home synced timestamp uses secondary text instead of tertiary text. Source coverage now guards the no-floating-create Home contract and the stronger clock-tile fill. Verification is recorded in the active turn notes.

---

## Active: iOS console/runtime calming (2026-06-29)

Plan: reduce Xcode console noise and make native Home launch measurements match user-visible work without changing dashboard data contracts.

- [x] Split Home dashboard load timing from checkout-return Live Activity reconciliation.
- [x] Defer and gate Apple Foundation Models header generation so system Biome instrumentation noise stays out of normal launch runs.
- [x] Add disk-aware thumbnail caching for remote gear/person images while preserving decoded in-memory cache behavior.
- [x] Sync Mobile/Dashboard docs and run iOS verification gates.

### Review
- 2026-06-29: iOS console/runtime calming shipped locally. Home dashboard load now logs and clears the critical payload path before checkout-return Live Activity reconciliation, with reconciliation logged separately as `launch.home.liveActivityReconcile`. Apple Foundation Models header generation is now local opt-in via `WisconsinHomeGeneratedHeaderEnabled` and delayed 1.5 seconds after Home appears, so deterministic fallback copy is the normal launch path and Xcode console is not flooded by Apple Biome instrumentation on every launch. `CachedThumbnail` now keeps the decoded in-memory cache while adding a bounded `WisconsinThumbnailURLCache` disk cache for remote image bytes. Verification passed with focused Vitest, focused whitespace check, iOS drift, iOS gap audit, docs/codemap verification, and `npm run ios:xcode:verify`.

---

## Active: iOS isolated scan action (2026-06-29)

Plan: `tasks/ios-isolated-scan-tab-plan.md`

- [x] Audit current iOS tab crash history, mobile/scan/search docs, schema, and source.
- [x] Replace the custom bottom bar with SwiftUI's native value-based `Tab(...)` API.
- [x] Mark Scan as the native trailing search-role tab and keep the compact tab set to five destinations.
- [x] Route Home scan shortcuts through app state instead of hardcoding tab `3`.
- [x] Sync docs, add focused source coverage, and rerun iOS verification after the correction.

### Review
- 2026-06-29: Initial attempt was wrong: it made Scan a floating action/full-screen cover instead of the Apple HIG trailing search-tab pattern. Corrected locally by keeping Scan as stable tab tag `3`, hiding the system tab bar, and rendering a custom bottom bar with the main navigation grouped in one pill and Scan as the dedicated trailing circular tab. Home's all-clear shortcut uses `AppState.presentScanLookup()` instead of hardcoding tab `3`. Scan stays lookup-only and kiosk pickup/return custody routes did not change.
- 2026-06-29 follow-up: Tab-bar correction verified. Focused source coverage passes in `tests/ios-tabbar-stability.test.ts`, iOS drift and gap audits pass through `npm run ios:xcode:verify`, and both main-app and kiosk Xcode verification commands pass. The remaining proof to capture, if needed, is a fresh authenticated Simulator screenshot.
- 2026-06-29 native correction: User rejected the custom fallback and requested the built-in tab bar component. `AppTabView` now uses SwiftUI's native value-based `Tab(...)` API, removes the custom `AppTabBar`, removes `.toolbar(.hidden, for: .tabBar)`, marks Scan with `role: .search`, and keeps the compact iPhone tab set to five destinations so Scan does not fall into the system More tab. Staff-only Users is removed from the compact tab bar. Verification passed with focused Vitest, `npm run ios:xcode:verify`, `npm run verify:docs`, focused whitespace check, and iOS 27 simulator screenshot `/private/tmp/wisconsin-native-tabbar-final.png`.
- 2026-06-29 sidebar correction: Secondary native destinations now live behind `.sidebarAdaptable` regular-width sidebar sections instead of compact iPhone tabs. Guides and Licenses appear as sidebar-only web fallbacks, Users is a sidebar-only native staff/admin destination, and compact iPhone remains Home, Bookings/My Gear, Items, Schedule, and pinned Scan. Verification passed with focused Vitest and `npm run ios:xcode:verify`.
- 2026-06-29 compact access correction: The sidebar-only fix was incomplete on iPhone because compact width has no visible sidebar switcher. Profile/Settings now includes a Directory section so compact iPhone can reach Guides, Users, and Licenses without adding a sixth tab or hiding Scan behind More.

---

## Active: iOS Xcode debugging workflow (2026-06-29)

Plan: make the default native app debugging, testing, and review path repeatable from one command while keeping the manual Xcode and Simulator workflow documented.

- [x] Audit current iOS README, testing guide, package scripts, and Xcode project-check tooling.
- [x] Add a serialized Xcode verification script with isolated DerivedData.
- [x] Wire package scripts for main-app and kiosk target Xcode closeout.
- [x] Document the Xcode, Simulator, and Codex/XcodeBuildMCP workflow.
- [x] Run the new Xcode verification command and record results.

### Review
- 2026-06-29: Xcode workflow setup shipped locally. Added `scripts/ios-xcode-verify.sh`, package scripts for main app and kiosk closeout, and `docs/IOS_XCODE_WORKFLOW.md` covering Xcode, Simulator, and Codex/XcodeBuildMCP usage. The verification script serializes project drift, iOS drift, gap audit, simulator build, and generic iOS build with isolated DerivedData, quiet output by default, and a verbose escape hatch for build-system debugging. Also fixed `scripts/check-ios-project.mjs` so the XcodeGen drift check copies `WisconsinLiveActivities` before regenerating the temp project. Verification passed with `npm run ios:xcode:verify`, `npm run ios:xcode:verify:kiosk`, `npm run verify:docs`, and focused `git diff --check`.

---

## Active: iOS checkout return Live Activity (2026-06-28)

Plan: add a native Live Activity for the signed-in user's most urgent active checkout return countdown.

- [x] Add ActivityKit attributes, widget extension UI, and project wiring.
- [x] Add an iOS coordinator that starts one checkout return Live Activity, updates urgency/next-need state, and ends it when the booking is no longer open.
- [x] Reuse availability next-use data for smart early start, conflict-aware red treatment, and gated Extend deep link.
- [x] Route Live Activity taps to booking detail and open Extend only when no upcoming need blocks extension.
- [x] Sync Mobile/Checkout docs, add focused source-contract coverage, and run iOS verification.

### Review
- 2026-06-28: iOS checkout return Live Activity shipped locally. The native app starts one ActivityKit return countdown for the signed-in user's most urgent `OPEN` checkout when it is due within 30 minutes or earlier for near next-use gear, shows booking title, requester identity, listed return time, seconds on focused Dynamic Island surfaces, minutes on lock-screen glance surfaces, and a dark red gradient that intensifies through warning, critical, and overdue states. Next-use availability context gates the Extend deep link, and tapping the activity routes to booking detail with Extend opening only when no upcoming need blocks it. The app now registers Live Activity push tokens, the server stores them in `live_activity_tokens`, and checkout completion paths send APNs liveactivity end pushes so returned checkouts dismiss even when the phone is suspended. Verification passed with Prisma generate, XcodeGen, focused Vitest, TypeScript, iOS drift, iOS gap audit, migration-prefix check, codemap/docs checks, whitespace check, Next build, and a Wisconsin iOS Simulator Debug build.

---

## Active: web sidebar polish (2026-06-28)

Plan: improve the web sidebar only, leaving mobile bottom nav and native iOS surfaces untouched.

- [x] Audit sidebar roadmap, design language, Settings role rules, dashboard count source, and current shell code.
- [x] Keep Lookup out of the web sidebar, expose Settings to all authenticated roles, and keep admin tools role-gated.
- [x] Add user-scoped due-today badge support behind overdue priority.
- [x] Remove sidebar shortcut wiring and collapsed tooltip hints to avoid browser/system conflicts.
- [x] Sync sidebar/settings docs and add focused source-contract tests.
- [x] Run focused tests, TypeScript, docs/codemap checks as safe, whitespace checks, build, and protected-route/browser smoke as available.

### Review
- 2026-06-28: Web sidebar polish shipped locally. The desktop sidebar keeps Lookup out because laptop/desktop work uses text search, keeps Settings visible to all authenticated roles, keeps Admin role-gated, shows Bookings overdue first and then a user-scoped due-today badge, and removes sidebar Cmd/Ctrl+number shortcuts to avoid browser/system conflicts. Mobile bottom nav and native iOS views were not changed. Verification passed with focused Vitest, `npx tsc --noEmit`, focused `git diff --check`, and `npm run db:migrate:check`. `npm run verify:docs` remains blocked by pre-existing codemap drift in `docs/CODEMAPS/{architecture,backend,frontend}.md`; `npm run build:app` remains blocked by the existing `/resources` prerender failure in the dirty worktree. Runtime smoke was not completed because the sandbox blocked local Next.js port binding with `listen EPERM`, and the escalated retry was unavailable due the current Codex usage limit.

---

## Completed: iOS Home AFM header line (2026-06-28, superseded 2026-07-02)

Plan: use Apple Foundation Models on device only for the native Home header flavor line, with deterministic fallback and no API payload changes.

- [x] Verify current Home header and local FoundationModels SDK symbols.
- [x] Add bounded AFM generation behind `SystemLanguageModel` availability.
- [x] Keep dashboard counts and rows authoritative, with generated copy validated before display.
- [x] Add source-contract coverage and sync Mobile/Dashboard docs.
- [x] Run focused tests, iOS drift/gap checks, whitespace checks, and simulator build as available.

### Review
- 2026-06-28: Native Home now adds one optional Apple Foundation Models header flavor line from count-only dashboard signals. The deterministic fallback remains first-class when AFM is unavailable, generation fails, or output validation rejects the line. Verification passed with focused Vitest, `npx tsc --noEmit`, iOS drift, iOS gap audit, and focused whitespace checks. Xcode compilation reached Swift driver startup with no Swift diagnostics shown, but both simulator and generic iOS builds failed in `actool` because CoreSimulator runtimes were unavailable in the sandbox.
- 2026-07-02: Superseded by Snow Leopard Home header cleanup. Native Home no longer renders an AFM or deterministic summary subline, and `HomeView.swift` no longer imports Foundation Models for the header.

---

## Active: iOS launch and data loading (2026-06-28)

Plan: `tasks/ios-launch-data-loading-plan.md`

- [x] Add a lean iOS Home dashboard scope without changing the default web dashboard payload.
- [x] Make native Home request the scoped payload.
- [x] Add source-contract coverage and sync Dashboard/Mobile docs.
- [x] Run focused tests, TypeScript, iOS drift/gap checks, whitespace checks, and the iOS simulator build.
- [x] Fix the unrelated Resources page build blocker surfaced by the first slice.
- [x] Add native timing logs for session restore, app-state badge refresh, Home dashboard load/cache skips, and first useful Home render.
- [x] Re-run focused build and iOS verification for the timing slice.

### Review
- 2026-06-28: iOS Home launch/data-loading slice shipped locally. Native Home now requests `/api/dashboard?scope=ios-home`, and the API keeps the default web payload unchanged while skipping iOS-unused row-heavy sections in scoped mode. Verification passed with focused Vitest, TypeScript, iOS drift, iOS gap audit, codemap/docs checks, whitespace check, and a Wisconsin simulator build/run. `npm run build:app` is blocked by unrelated Resources page type errors in the existing dirty worktree.
- 2026-06-28 follow-up: Fixed the active Resources page type issue and confirmed `npm run build:app` passes. Added low-overhead `Launch` OSLog timing around native session restore, app-state badge refresh, Home dashboard loads, cache/in-flight skips, and first useful Home render so the next launch pass can use measured phase timings.

---

## Active: Resources landing cleanup (2026-06-29)

Plan: `tasks/resources-first-class-plan.md`

- [x] Capture corrected Resources direction: Guides first, server path as a compact copy utility, contacts and sport assignments as reference, buildings deferred.
- [x] User approves the cleanup plan before implementation.
- [x] Slice 1: Guide-first landing cleanup.
- [x] Slice 2: Server path utility.
- [x] Slice 3: Compact Contacts and Sport assignments reference modules.
- [x] Slice 4: Guide card/list polish.
- [x] Slice 5: Docs, focused tests, typecheck, build, and browser smoke as available.

### Review
- 2026-06-29: Resources landing cleanup Slices 1-5 shipped locally. `/resources` now leads with Guides, removes the Featured guides block and Guide collection tile wall, adds a compact copyable Media Drive server path header utility, keeps Contacts as a compact landing reference with the full directory behind the Contacts filter, adds `filter=assignments` for read-only sport assignments from user profiles, and exposes `/api/users` `sportAssignments` for that reference. Focused Resources/Users Vitest, TypeScript, docs/codemap verification, focused whitespace checks, and `npm run build:app` passed. Local built-route smoke confirmed protected Resources routes redirect to `/login`; full authenticated visual smoke still needs a localhost session.
- 2026-06-29: Rewrote the active Resources plan around the corrected landing-page IA. The next implementation should remove pinned/featured treatment, avoid empty taxonomy tiles, keep server path as a small top-right copy affordance, and keep contacts plus sport assignments as compact references behind the Guide library.
- 2026-06-28: Implemented the Resources first-class Guide library pass. Added typed `ResourceType` focus with migration/backfill, preserved legacy URL filters while adding `layout=cards/list`, rebuilt `/resources` around Guide collections, area lanes, cards/list results, and supporting live Contacts, and updated reader/create/edit to expose Guide focus. Verification passed with focused Resources Vitest, Prisma format/generate, migration-prefix check, TypeScript, codemap/docs checks, whitespace check, and `npm run build:app`. Authenticated browser smoke logged in locally and confirmed `/resources` renders the new shell, collection tiles, layout control, Contacts section, and empty All Guides state; full runtime smoke remains blocked until migration `0087_resource_type` is applied to the current Neon database because `/api/resources` returns Prisma P2022 for missing `resources.type`.

---

## Active: standardized partial-data visibility (2026-06-27)

Plan: normalize the next partial-result warning slice on the shared shadcn-backed alert primitive.

- [x] Audit partial-result drift and existing shared warning primitive.
- [x] Preserve named failed source labels in quick search and `/search`.
- [x] Replace route-local partial warnings with `OperationalPartialResultsAlert`.
- [x] Sync Search and design-language docs and add source-contract coverage.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and runtime smoke as available.

### Review
- 2026-06-27: Quick Search and `/search` now track named failed result types across Items, Checkouts, Reservations, and Users, then render the shared shadcn-backed `OperationalPartialResultsAlert` instead of route-local generic warning copy. The shared alert now accepts contextual failure labels and recovery copy while preserving existing defaults for admin queue/checklist uses. Verification passed with `npx vitest run tests/search-page-source.test.ts tests/app-shell-search-source.test.ts tests/action-result-copy-source.test.ts tests/pending-action-feedback-source.test.ts tests/operational-loading-state-source.test.ts tests/app-error-recovery-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Runtime smoke on `http://127.0.0.1:3079/search` returned `307` to `/login`; `/login` returned `200`.

---

## Active: standardized pending action feedback (2026-06-27)

Plan: normalize high-visibility save/upload/cancel/nudge pending affordances after the shared loading-state slice.

- [x] Audit pending-action drift and existing shadcn button/menu primitives.
- [x] Keep booking wizard and booking detail actions on stable labels with visible loading state.
- [x] Give image modal save/upload/remove actions action-specific pending state.
- [x] Sync design-language docs and add source-contract coverage.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and runtime smoke as available.

### Review
- 2026-06-27: Booking wizard draft/final submit, Booking detail dropdown actions, Booking edit save, and item image modal save/upload/remove now keep stable action labels while shadcn loading affordances show the active request. Booking header dropdown actions now use a local pending menu item with inline spinner and `aria-busy`; image mutations track the exact pending action so saving, uploading, and removing do not make unrelated buttons look active. Verification passed with `npx vitest run tests/pending-action-feedback-source.test.ts tests/operational-loading-state-source.test.ts tests/app-error-recovery-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Runtime smoke on `http://127.0.0.1:3077/reservations/new` returned `307` to `/login`; `/login` returned `200`.

---

## Active: standardized action result copy (2026-06-27)

Plan: normalize booking and trade failure copy so operational toasts and recovery states say what changed, what did not change, and where to recover.

- [x] Audit booking/trade result-copy drift against the design language.
- [x] Replace generic Trade Board claim/approve/decline/cancel/request failures with consequence-aware copy.
- [x] Replace booking-list extension and initial-load fallback copy with object-specific recovery language.
- [x] Sync design-language docs and add source-contract coverage.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and runtime smoke as available.

### Review
- 2026-06-27: Booking list extension and initial-load failures plus Trade Board claim, approve, decline, cancel, open-shift pickup, and pickup-request failures now use object-specific recovery copy that says what did not change and where to retry. Verification passed with `npx vitest run tests/action-result-copy-source.test.ts tests/pending-action-feedback-source.test.ts tests/operational-loading-state-source.test.ts tests/app-error-recovery-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Runtime smoke on `http://127.0.0.1:3078/bookings` and `/schedule` returned `307` to `/login`; `/login` returned `200`.

---

## Active: standardized loading and pending states (2026-06-27)

Plan: establish the first shared shadcn-backed loading-state pattern and wire it into the highest-visibility app shell and booking detail surfaces.

- [x] Audit loading/pending drift and existing shadcn primitives.
- [x] Add a shared operational loading-state component backed by shadcn `Skeleton`.
- [x] Replace AppShell boot/search loading and BookingDetailsSheet load/error/not-found states with shared primitives.
- [x] Sync design-language docs and add source-contract coverage.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and runtime smoke as available.

### Review
- 2026-06-27: AppShell boot loading, command-palette search loading, and Booking detail sheet initial loading now use `OperationalLoadingState`, a shadcn `Skeleton`-backed shared loading surface with announced busy state and stable placeholder rows. Booking detail load failure and missing-record states now use shared inline `EmptyState`, and the sheet's equipment-save/cancel pending actions use shadcn `Button loading` instead of swapping label text. Verification passed with `npx vitest run tests/operational-loading-state-source.test.ts tests/app-error-recovery-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Runtime smoke on `http://127.0.0.1:3076/settings` returned `307` to `/login`; `/login` returned `200`.

---

## Active: app recovery states cleanup (2026-06-27)

Plan: make the first site-wide recovery/action-feedback slice land at the app error-boundary layer.

- [x] Audit generic top-level error copy and recovery shells.
- [x] Add one shared shadcn-backed recovery panel for app error boundaries.
- [x] Replace root, app-shell, and global error boundaries with operational recovery copy.
- [x] Sync design-language docs and add source-contract coverage.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and protected-route smoke as available.

### Review
- 2026-06-27: Root, app-shell, and global error boundaries now share `ErrorRecoveryPanel`, a shadcn-backed recovery surface with retry plus dashboard/sign-in actions, operational caution copy, optional error IDs, and no generic "Something went wrong" or inline-styled fallback. Verification passed with `npx vitest run tests/app-error-recovery-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Runtime smoke on `http://127.0.0.1:3075/settings` returned `307` to `/login`; `/login` returned `200`.

---

## Active: Settings Audit command surface cleanup (2026-06-27)

Plan: move the next command-surface slice from status indicators into a bounded Settings Audit pass.

- [x] Confirm the route has a standard search/filter/clear pattern that fits `OperationalToolbar`.
- [x] Convert the filter surface to shared toolbar and active-filter chips.
- [x] Move local audit table and empty/error shells onto shared shadcn-backed primitives.
- [x] Sync Settings and design-language docs.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and protected-route smoke.

### Review
- 2026-06-27: Settings > Audit now uses the shared `OperationalToolbar` and `OperationalActiveFilterChips` for entity/action/date filters, keeps individual filter removal visible, and renders audit rows through shadcn `Table` plus shared `EmptyState` retry/empty states. `OperationalToolbar` now accepts standard div attributes so route-level command surfaces can carry labels. Verification passed with `npx vitest run tests/settings-audit-command-surface-source.test.ts tests/settings-audit-filters.test.ts tests/settings-audit-pagination.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Browser automation was blocked because the repo has no Playwright dependency and the bundled Playwright browser binary is not installed; HTTP protected-route smoke passed with `HEAD /settings/audit` returning `307` to `/login`.

---

## Active: shadcn operational status indicator (2026-06-26)

Plan: keep operational status indicators on shadcn `Badge` composition and Gear Tracker semantic status colors.

- [x] Refactor the shared status indicator away from raw colored spans.
- [x] Preserve existing Calendar Sources health behavior while moving stale health to orange.
- [x] Sync Settings docs and run focused verification.

### Review
- 2026-06-26: Shared status indicators now compose shadcn `Badge` variants instead of custom raw color spans. Calendar Sources health keeps the same active/error/disabled/never-synced behavior, maps stale feeds to the Gear Tracker orange warning tone, and uses gray for idle states. Verification passed with `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check -- src/components/ui/status-indicator.tsx docs/AREA_SETTINGS.md tasks/todo.md docs/CODEMAPS/architecture.md docs/CODEMAPS/backend.md docs/CODEMAPS/frontend.md docs/CODEMAPS/data.md docs/CODEMAPS/schema.md`, and `npm run build:app`. Browser smoke on `http://127.0.0.1:3071/settings/calendar-sources` redirected to `/login` because the Chrome context was unauthenticated; login rendered cleanly with no app console errors.

---

## Active: operational sync and device status indicators (2026-06-26)

Plan: wire the shared shadcn-backed status indicator into the remaining high-value places selected by the user.

- [x] Expose booking-change sync health from the shared booking sync hook.
- [x] Show booking sync health on Dashboard, `/bookings`, and full booking detail.
- [x] Replace Kiosk Devices route-local health dots/badges with the shared status indicator.
- [x] Sync Dashboard, Checkouts, Reservations, and Settings docs.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and browser smoke.

### Review
- 2026-06-26: Dashboard, `/bookings`, and full booking detail now show the shared booking-change sync health from `useBookingChangeSync` through the shadcn-backed `StatusIndicator`: live, retrying, offline, and paused states are visible while the existing cache invalidation remains unchanged. Settings > Kiosk Devices now uses the same status indicator for Online, Heartbeat stale, Offline, Pending activation, and Deactivated device health. Verification passed with `npx vitest run tests/booking-realtime-sync-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, quoted `git diff --check`, and `npm run build:app`. Browser smoke on `http://127.0.0.1:3072/`, `/bookings`, and `/settings/kiosk-devices` redirected to `/login` because the Chrome context was unauthenticated; login rendered cleanly with no console errors.

---

## Active: admin health status indicators (2026-06-27)

Plan: extend the shared shadcn-backed status indicator to the daily admin health surfaces.

- [x] Add a shared queue/checklist health mapper for critical, needs-work, partial-data, and clean states.
- [x] Wire Fix Today overall queue and section health through `StatusIndicator`.
- [x] Wire Inventory Hygiene checklist health through `StatusIndicator`.
- [x] Sync Dashboard and Items docs.
- [x] Run focused tests, typecheck, docs/codemap checks, build, and browser smoke.

### Review
- 2026-06-27: Fix Today and Inventory Hygiene now share one `summarizeOperationalHealth` helper that maps critical, needs-work, partial-data, and clean states into the shadcn-backed `StatusIndicator`. Fix Today shows queue health in the header/admin queue panel and per-section cards; Inventory Hygiene shows checklist health in the header and checklist health panel. Verification passed with `npx vitest run tests/admin-health-status-indicators-source.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, quoted `git diff --check`, and `npm run build:app`. Browser smoke on `http://127.0.0.1:3073/admin/fix-today` and `/items/hygiene` redirected to `/login` because the Chrome context was unauthenticated; login rendered cleanly with no console errors.

---

## Active: Items list and detail freshness (2026-06-26)

Plan: `tasks/items-freshness-plan.md`

- [x] Add item/catalog change polling for Asset and BulkSku updates.
- [x] Make `/items` verify server truth on mount instead of trusting a 60s fresh cache.
- [x] Invalidate item-family caches after serialized-item and bulk-SKU detail edits.
- [x] Refresh open detail views from committed item/catalog change signals.
- [x] Add tests and docs for the shipped freshness contract.
- [x] Run focused tests, docs checks, migration check, typecheck, and build.

### Review
- 2026-06-26: Items freshness shipped locally. `/items` now refetches on mount, serialized item and item-family detail mutations invalidate shared catalog caches, and `/api/items/changes` lets mounted Items surfaces converge from committed `Asset`, `BulkSku`, and audit-log changes. Verification passed with focused source-contract tests, TypeScript, codemap/docs checks, migration-prefix check, whitespace diff check, and `npm run build:app`.

---

## Active: Items list niceties (2026-06-26)

Plan: `tasks/items-list-niceties-plan.md`

- [x] Rename the default sort option from `Name` to `Asset tag`.
- [x] Add durable favorites for item-family rows and include them in the Favorites filter.
- [x] Normalize asset-tag search aliases so compact and hyphenated family tags find each other.
- [x] Keep unavailable row badges consistent with the holder-first status grammar.
- [x] Add valid item-family row actions without exposing serialized-only mutations.
- [x] Add focused tests, sync docs, and run verification.

### Review
- 2026-06-26: Items list niceties shipped locally. Added migration `0085_item_family_favorites` plus `/api/bulk-skus/[id]/favorite` so item-family favorites persist and mirror serialized favorite permission/audit behavior. `/api/assets` now returns item-family favorite state and includes favorited families in Favorites-only views. Items and picker search share compact/hyphenated asset-tag aliases, the sort selector now says `Asset tag`, and item-family menus expose valid actions only, including inventory management and numbered-unit label CSV export. Verification passed with focused tests, Prisma format/generate/validate, migration-prefix check, TypeScript, docs/codemap check, whitespace check, and `npm run build:app`. Live migration deploy/health was not run; the new migration is pending for deploy.

---

## Active: Reservation linked-event title cleanup (2026-06-26)

Plan: keep non-game/media-day event summaries visible in the shared booking wizard when events also carry sport metadata.

- [x] Patch linked-event row, chip, ARIA, and auto-fill title logic to prefer summary when no opponent exists.
- [x] Add focused regression coverage for media-day summary preservation.
- [x] Sync Reservations and Events docs.

### Review
- 2026-06-26: Reservation linked-event title cleanup shipped locally. Non-game events with sport metadata now display and auto-fill from `CalendarEvent.summary`; opponent-based games still use sport plus home/away matchup copy. Verification recorded after focused tests.

---

## Active: Reservation equipment future-return selection (2026-06-26)

Plan: align `/reservations/new` equipment selection with server availability windows so current holdings due back before the requested reservation can still be selected.

- [x] Read Reservations/Checkouts docs, schema, shared picker, availability service, and booking wizard entry points.
- [x] Patch serialized picker row and scan-to-add selection rules to distinguish terminal item states from time-bounded active holdings.
- [x] Add focused regression coverage for due-back-before-start selection and overlapping/terminal blocking.
- [x] Sync Reservations and Checkouts docs.
- [x] Run focused tests, TypeScript, docs, diff, and build verification.

### Review
- 2026-06-26: Reservation equipment future-return selection shipped locally. The shared picker and scan-to-add path now allow serialized gear currently held by someone else only when the holder's due-back time is at least 60 minutes before the requested reservation start; tighter handoffs, overlapping allocations, and terminal item states stay blocked. Server availability now applies the same 60-minute serialized turnaround buffer, so submit-time conflict checks match the picker. Verification passed with focused availability/picker/booking UX tests, TypeScript, docs/codemap check, whitespace diff check, and `npm run build:app`.

---

## Completed: Canonical battery families and Monitor products (2026-07-15)

Plans: `tasks/monitor-battery-product-family-plan.md` and `tasks/archive/completed-2026-07/battery-family-consolidation-plan.md`

- [x] Extend D-022 and the schema so one numbered family can contain multiple branded products.
- [x] Add audited product create/edit/archive and exact-unit product assignment routes.
- [x] Add product management, counts, add-unit product selection, and unit assignment to item-family detail.
- [x] Add a dry-run-first consolidation script with exact live-state guards, proof capture, and post-apply verification.
- [x] Add focused product, assignment, schema, QR, label, and item-family tests.
- [x] Apply migrations `0092` and `0093` in order.
- [x] Consolidate the live active catalog to Monitor Battery, Sony Battery, Gold Mount Battery, and FX6 Battery.
- [x] Preserve Sony units 1-52, current custody, and printed placeholders while consolidating Monitor to 18 units, Gold Mount to 10, and FX6 to 12.
- [ ] Physical follow-up: identify Monitor units 1-14 as Watson NP-F770 or GVM, assign their product records, and print labels `bdf15b57-1` through `bdf15b57-18`.

### Review
- 2026-07-15: Live consolidation completed through an exact-state-guarded serializable transaction attributed to Erik Role. The active battery catalog now contains exactly four unit-tracked families. Monitor units 1-14 are intentionally product-unassigned pending physical identification, while known Watson NP-F550 units moved intact to 15-18. History-bearing legacy rows were retired or deactivated; only history-free duplicates were hard-deleted. Independent read-only verification found 13 consolidation audit entries and no active serialized battery rows.

---

## Active: Item data cleanup (2026-06-25)

Plan: `tasks/item-data-cleanup-plan.md`

- [x] Write the execution prompt and slice plan.
- [x] Add a repeatable read-only item-data audit script.
- [x] Record audit output and decide the first mutation slice.
- [x] Normalize serialized and item-family category/department data.
- [x] Resolve serialized-vs-item-family duplicate scan identities.
- [x] Backfill safe missing primary scan codes.
- [x] Convert camera-tied accessories/fixed parts into attachments where operationally correct.
- [x] Align the Items list feed with cleaned data so default All excludes retired serialized rows and item-family categories display canonical taxonomy.
- [x] Normalize legacy item-family category text and harden future item-family writes against stale category fallbacks.
- [x] Disambiguate source-backed duplicate item-family names where the retired duplicate asset proves the model.
- [x] Sort the Items list by operational asset-tag family so department/team prefixes do not split related gear.
- [x] Harden asset-tag-family sorting against broad-prefix false positives and expand edge-case coverage.
- [x] Unify serialized and item-family pagination so unit/quantity rows do not splice into page 1 while page 2 resumes serialized rows.
- [x] Add a Most popular sort that ranks serialized assets and item families from recent operational usage.
- [x] Harden bulk item delete so it preserves booking history and matches single-item delete policy.
- [x] Align item CSV export with the Items list contract for active serialized rows and item families.
- [x] Propagate effective numbered-unit state to generic item-family list/detail read models.
- [x] Align numbered-unit mutations and picker form-options with effective unit state.
- [x] Consolidate duplicated item-family state read-model logic into one shared helper.
- [x] Add cross-surface item-family state-contract coverage for list/detail/export/form-options.
- [x] Align operational low-stock and battery report summaries with effective item-family state.
- [x] Fix item detail department edits for UUID-backed departments on Standard and item-family records.
- [x] Harden item detail organization/link/money fields with shared server-side validation.
- [x] Sync relevant area docs and run closeout verification after each shipped slice.

### Review
- 2026-06-25: Started goal-tracked item data cleanup. Live read-only audit showed 50 serialized assets missing category, 20 active item families missing category, 18 active item families missing department, 22 serialized assets missing `primaryScanCode`, 15 active item families missing image, 9 cross-table duplicate scan values, and 46 camera/body-like rows with no attachments. Added a plan and read-only audit script so later data mutation slices can be driven by repeatable evidence.
- 2026-06-25: Slice 1 verified with `npm run audit:item-data`, which reached Neon through the configured Prisma adapter and reproduced the baseline counts. Next mutation slice is taxonomy normalization: fill serialized and item-family category/department gaps before resolving scan collisions or attachments.
- 2026-06-25: Slice 2 discovery found exact or unique category suggestions for 23 of 50 serialized missing-category rows and 13 of 21 item-family rows. Explicit legacy mappings are needed for `Media Storage/Hard Drives`, `Cameras/Camera Accessories`, `Gimbals`, and `general`; `Recording Equipment` needs product-family splitting instead of one broad category.
- 2026-06-26: Full item-data cleanup applied and verified. `scripts/cleanup-item-data.mjs` retired 9 serialized duplicates in favor of item families, rewrote their scan identity to retired namespaces, normalized all serialized and item-family category/department gaps, backfilled 22 safe primary scan codes, and wrote system audit-log evidence. Final `npm run audit:item-data` reports 0 serialized missing categories, 0 serialized missing departments, 0 serialized missing primary scan codes, 0 active item-family missing categories, 0 active item-family missing departments, and 0 duplicate scan values. The cleanup dry-run now plans 0 data mutations; 9 cage/top-plate/lens-cap rows remain as physical attachment review rows because the database does not prove parent asset identity.
- 2026-06-26: Attachment follow-up applied one provable mapping: `a7 V 2 Grip` is now attached to `A7 V 2` with child checkout/reservation/custody disabled. Remaining physical mapping decisions are tracked in `tasks/item-attachment-mapping-review.md`.
- 2026-06-26: Item-family image follow-up copied 6 exact-match existing asset images onto active item families through the audit-logged cleanup script. Active item-family missing images dropped from 15 to 9; remaining rows are tracked in `tasks/item-family-image-sourcing.md` because they need sourced product images or identity decisions.
- 2026-06-26: Serialized metadata follow-up cleared unknown brand/model counts to 0 by fixing the Dell monitor and Monitor Battery from stored source evidence, and retired the active smoke-test asset with no history. Remaining serialized serial/image gaps are tracked in `tasks/serialized-metadata-review.md`.
- 2026-06-26: Items list feed follow-up fixed the Dia-visible cleanup gaps. `/api/assets` now excludes retired serialized rows from the default no-status list while preserving explicit `status=RETIRED`, keeps active item families out of Retired-only views, and returns item-family category labels from canonical `BulkSku.categoryRel` before falling back to the legacy text field. Focused route regression coverage passed.
- 2026-06-26: Legacy item-family category text follow-up applied 12 audit-logged `BulkSku.category` normalizations from canonical category rows, including the Dia-visible `Recording Equipment`, `Cameras/Camera Accessories`, and `general` cases. `POST /api/bulk-skus` and `PATCH /api/bulk-skus/[id]` now derive the legacy category text from `categoryId` so new writes cannot reintroduce stale labels. Cleanup dry-run now plans 0 data mutations.
- 2026-06-26: Source-backed item-family name follow-up renamed the unit-tracked `Sony Battery` family with bin `94e068d1` to `Sony NP-FZ100 Battery`, using the retired duplicate asset's former scan identity, model, and B&H source link as evidence. The remaining quantity-tracked `Sony Battery` row stays unchanged because stored data does not prove its exact model. Cleanup dry-run again plans 0 data mutations.
- 2026-06-26: Items list asset-tag sort follow-up shipped locally. Default Name/tag sorting now compares an operational asset-tag family key instead of the raw display tag, so department/team prefixes such as `FB` and `MBB` no longer push related gear into the F/M sections. Examples like `FB 70-200 1`, `MBB 28-75 1`, `FX3`, and `FX6` now sort by the underlying gear family while preserving the visible tag text.
- 2026-06-26: Asset-tag family grouping tightened the shared comparator. Items, export, and picker sorting now keep repeated equipment families together before operational prefixes, so `70-200 1`, `70-200 2`, `70-200 3`, compact `70200 4`, and `FB 70-200` copies render as one readable block instead of alternating by copy number.
- 2026-06-26: Asset-tag sort hardening follow-up made prefix stripping more conservative. Team/sport prefixes still group ordinary equipment tags such as `FB Wireless Flash`, but broad department words such as `Video` and `Photo` strip only when the remaining tag is clearly a known equipment family. Regression coverage now protects `Video Assist 1` from being mis-sorted as `Assist 1` while keeping `Video FX6 2` grouped with FX6 rows.
- 2026-06-26: Items pagination follow-up fixed split serialized/item-family paging. `/api/assets` now accepts the selected item kind and builds one asset-tag sorted page across serialized assets and active item families, so unit/quantity rows occupy real slots instead of being injected into page 1 while page 2 resumes serialized assets. Units and Quantity tabs now paginate from the API instead of client-side hiding.
- 2026-06-26: Bulk delete safety follow-up fixed a history-destroying mismatch between single-item delete and `/api/assets/bulk`. Bulk delete now checks booking history and active allocations inside a SERIALIZABLE transaction, blocks with Retire guidance when either exists, and no longer deletes `BookingSerializedItem` or `AssetAllocation` rows to make deletion pass.
- 2026-06-26: Export parity follow-up aligned `/api/assets/export` with the active Items list contract. Default export now excludes retired serialized rows, explicit retired status still works, item-family rows export under All/Units/Quantity when list filters allow them, and the Items page passes the selected item kind into the export request.
- 2026-06-26: Numbered item-family state follow-up propagated the shared effective unit-status rule to `GET /api/bulk-skus`, `GET /api/bulk-skus/[id]`, and the item-family PATCH response. Generic item-family list/detail views now count active unit allocations as checked out and orphaned raw checked-out flags as available, matching Battery Ops and `/items`.
- 2026-06-26: Numbered item-family mutation/picker follow-up aligned the remaining high-impact state surfaces. Per-unit status changes now block only true active checkout allocations, so stale raw `CHECKED_OUT` flags can be corrected with audited status changes and correct stock-balance deltas. `/api/form-options` now computes numbered-family availability from active allocation rows plus the shared effective unit-status rule, so booking pickers agree with `/items`, Battery Ops, and item-family detail reads.
- 2026-06-26: Item-family state consolidation follow-up extracted the shared `summarizeItemFamilyState` helper and adopted it in `/api/assets`, `/api/assets/export`, `/api/bulk-skus`, `/api/bulk-skus/[id]`, and `/api/form-options`. Focused contract coverage now pins the helper plus list, detail, export, and form-option behavior so future item-family routes do not reimplement divergent availability math.
- 2026-06-26: Operational state sweep follow-up moved Admin Fix Today low-battery checks, Inventory Hygiene low-stock item-family checks, and Missing Units battery summary totals onto effective item-family state. The shared unit-status helper now also preserves Missing/Retired as terminal states even if stale active allocation context exists, keeping custody reports honest while leaving raw-status reads in place only where they power stale-data warnings or missing-unit evidence.
- 2026-06-26: Item detail department-edit follow-up fixed the "Validation failed" path for Sony Battery and other records whose department/category/location IDs are UUID-shaped. Item-family create/update and serialized item create/update now share a database ID validator that accepts both CUID and UUID foreign keys, with focused route coverage for item-family and serialized department updates.
- 2026-06-26: Item detail field hardening follow-up moved URL normalization and money-scale checks into shared server validation, added reference preflight checks for location/category/department updates, and aligned item-family purchase links with Standard item behavior. Missing FK targets now return clear 400 errors instead of falling through to Prisma, product links accept missing schemes and normalize to `https://`, and money fields reject values that do not fit the stored `Decimal(10,2)` contract.
- 2026-06-26: Data cleanup follow-up moved every current `Video` department row to `Creative` across serialized assets and active item families, applied narrow category improvements for teleconverters, monitor arms, and flash/trigger rows, and repaired 11 lens primary scan codes where the real alphanumeric QR was already stored in `qrCodeValue`. The cleanup script now reports 30 remaining legacy QR rows that require physical/source lookup, tracked in `tasks/item-qr-physical-review.md`. Verification passed with `npm run audit:item-data` and a zero-action `npm run cleanup:item-data` dry run.
- 2026-06-26: Cheqroom CSV QR crosscheck follow-up repaired 22 of the 30 legacy QR review rows from `docs/archive/imports/cheqroom-items-2026-02-27.csv`, only where `Barcodes` matched the current legacy QR and `Codes` held one unique alphanumeric value. Eight camera/gimbal/flash rows remain because their CSV `Codes` values are blank. Verification passed with `npm run audit:item-data` and a zero-action `npm run cleanup:item-data` dry run.
- 2026-06-26: Items Most popular sort follow-up shipped locally. `/api/assets` now builds a mixed serialized/item-family page ordered by recent checkout/reservation weight and successful scans, with asset-tag family sorting as the deterministic tie-breaker. The Items toolbar exposes Most popular through the sort selector, and the client preserves the server-provided mixed row order so item families do not drift to the bottom. Verification passed with focused item-family route coverage, TypeScript, `npm run build:app`, live `npm run audit:item-data`, and a zero-action `npm run cleanup:item-data` dry run. Remaining cleanup is physical/source-driven: 9 active item-family images, 2 serialized images, 4 serialized serial numbers, 45 camera/body rows with no attachments, 12 attachment mapping review rows, and 8 legacy QR rows that the Cheqroom CSV cannot prove.
- 2026-06-26: Photo-less quantity-tracked `Sony Battery` family archived with audit evidence instead of hard-deleted because live verification showed 4 booking rows and 6 stock movements. This removes the duplicate from the active Items list while preserving history; active item families are now 20 and active item-family image gaps are now 8. The Items table also hides disabled selection checkboxes on item-family rows so the list no longer shows non-actionable controls beside Units/Quantity rows. Verification passed with live `npm run audit:item-data` and a zero-action `npm run cleanup:item-data` dry run.
- 2026-06-26: iOS Items visual polish follow-up tightened the screenshot-visible rough edges without changing API or data contracts. The native Items control strip now keeps default chips neutral, tints only active filters/non-default sort, item rows use the shared `brandCard` surface, compact metadata shows the bare current location name only when the item is available, item-family rows drop Unit-tracked/Units clutter, asset tags use restrained Gotham Bold instead of quiet mono, and the list reserves bottom scroll clearance above the floating tab bar.
- 2026-06-26: Equipment picker sorting now follows the same family-aware asset-tag order as Items. `/api/assets/picker-search` no longer applies hidden checkout-popularity priority to default picker rows, and bulk picker rows use the same comparator so operational prefixes such as `FB` do not separate related `FX3`, `a1`, or lens families.

---

## Completed: iOS Items web parity (2026-06-26)

Plan: `tasks/archive/completed-2026-06/ios-items-web-parity-plan.md`

- [x] Audit current docs, web API route, iOS models, API client, and Items view.
- [x] Add mixed item row modeling and `itemOrder` decoding.
- [x] Render item-family rows in the native list.
- [x] Add native sort selection wired to `/api/assets?sort=...`.
- [x] Align active status display with holder avatar where applicable.
- [x] Add focused iOS API contract coverage.
- [x] Sync docs and task review.
- [x] Run iOS drift, gap, whitespace, and build verification.

### Review
- 2026-06-26: Implementation complete before verification. `AssetsResponse` now decodes optional `itemOrder` and exposes ordered mixed rows, native Items renders serialized and item-family rows, item-family rows use Unit-tracked/Quantity-tracked naming with web-style availability counts, the list offers Asset tag and Most popular sort, and active serialized status badges pair `Checked Out`/`Reserved`/`Awaiting Pickup`/`Overdue` with the holder avatar.
- 2026-06-26: Verification passed with focused iOS/API contract coverage, TypeScript, iOS drift, iOS audit-gap inventory, docs/codemap checks, whitespace check, Wisconsin simulator build, and `npm run build:app`. Full `npm run build` was attempted first but the sandboxed run could not reach Neon, and escalation was rejected because the script can apply remote Prisma migrations; `build:app` was the safer compile gate.

---

## Active: Admin checkout force-complete exception (2026-06-25)

Plan: add an admin-only exception path for physically verified returns that cannot be scanned, without reopening app/web as the normal return surface.

- [x] Audit checkout, kiosk, scan, decision, schema, action-policy, detail-page, service, and route contracts.
- [x] Add the force-complete service and API route with required reason capture.
- [x] Wire the admin-only detail-page action through shadcn dialog/textarea controls.
- [x] Add focused service, route/source, policy, and custody-contract coverage.
- [x] Sync checkout/kiosk docs and record verification results.
- [x] Run focused verification and build gates.

### Review
- 2026-06-25: Admin checkout close-without-scan shipped locally. `POST /api/bookings/[id]/force-complete` is admin-gated through booking action policy, requires a 10+ character reason, completes only `OPEN` checkouts, marks active serialized allocations returned, restores outstanding bulk stock, marks verified numbered units available instead of lost, closes open check-in scan sessions, writes `OverrideEvent` plus audit evidence, and emits returned badge events. Booking detail exposes the action as "Close without scan" behind the existing actions menu with a shadcn dialog and reason textarea. Checkout, Kiosk, Decisions, Gaps/Risks, and codemaps are synced. Verification passed with `npx vitest run tests/mark-checkout-completed.test.ts tests/admin-force-complete-route.test.ts tests/booking-view-access.test.ts tests/booking-detail-custody-contract.test.ts tests/kiosk-only-custody-routes.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Initial `npm run verify:docs` failed because codemaps were stale, then passed after regeneration.

---

## Active: Battery custody trust hardening (2026-06-25)

Plan: `tasks/battery-custody-trust-hardening-plan.md`

- [x] Add shared allocation-aware effective numbered-unit status helper.
- [x] Adopt it in Battery Ops, `/api/assets`, kiosk pickup/reservation staging, generic scan recording, and scan lookup.
- [x] Add audited stale checked-out battery flag repair route and Battery Ops action.
- [x] Add partial unique migration for one active allocation per numbered unit.
- [x] Add focused regression coverage.
- [x] Run full closeout verification and record results.

### Review
- 2026-06-25: Battery custody trust hardening shipped locally. Focused tests passed for the helper, Battery Ops repair route, `/api/assets`, Battery Ops read model, kiosk numbered-unit scans, generic numbered scans, and migration source contract. Full closeout verification passed with TypeScript, migration-prefix check, whitespace check, codemap regeneration/docs check, iOS drift/gap checks, and `npm run build:app`.

---

## Completed: Hidden smoke users visibility (2026-06-24)

Plan: `tasks/archive/completed-2026-06/hidden-smoke-users-plan.md`

- [x] Add an additive `User.hiddenFromRoster` schema field and local migration.
- [x] Add shared server visibility helpers for hidden users and internal operators.
- [x] Gate `/api/users`, `/api/users/export`, form-options people pickers, kiosk user selection, and direct user lookup.
- [x] Add focused route/helper coverage.
- [x] Sync Settings docs and Gaps/Risks.
- [x] Run focused verification and record results.
- [x] Expose hidden-user visibility capability from `/api/me`.
- [x] Add owner-only `/users` "Show hidden test users" filter and export wiring.
- [x] Add focused API/source coverage and sync docs.
- [x] Run Slice 2 verification and record results.
- [x] Extract reusable user deactivation side effects.
- [x] Add internal hidden-user cleanup endpoint with dry-run default.
- [x] Add focused cleanup coverage and sync docs.
- [x] Run Slice 3 verification and record results.
- [x] Add shared active visible-user helper.
- [x] Sweep Schedule candidate/conflict/org-chart and notification-recipient reads.
- [x] Add focused operational-sweep coverage and sync docs.
- [x] Run Slice 4 verification and record results.
- [x] Check live Neon migration health for the hidden smoke users migration.
- [x] Inspect production hidden/active user counts and smoke/test candidates.
- [x] Configure production `INTERNAL_OPERATOR_EMAILS` after the exact owner email is explicitly approved.

### Review
- 2026-06-24: Hidden smoke user visibility slice shipped locally. Added `User.hiddenFromRoster` and migration `0083_hide_smoke_users`, plus shared hidden-user visibility helpers gated by comma-separated `INTERNAL_OPERATOR_EMAILS`. Default roster, user export, form-options people picker, kiosk user picker, and non-internal direct user profile reads now exclude hidden users, while a hidden signed-in user can still read their own profile. Settings docs and Gaps/Risks are synced. Verification passed with `npx vitest run tests/users-hidden-visibility.test.ts tests/sport-code-route-boundaries.test.ts`, `npx prisma format`, `npx prisma generate`, `npx prisma validate`, `npm run db:migrate:check`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`. Live migration health/deploy was not run; deploying the local migration is a separate database step.
- 2026-06-24: Owner-only roster opt-in shipped locally. `/api/me` now returns `canViewHiddenUsers`, `/users` renders "Show hidden test users" only for configured internal operators, and the same opt-in carries into the roster CSV export. Non-owners cannot force the client opt-in with a stale URL; the server also keeps rejecting hidden inclusion unless `INTERNAL_OPERATOR_EMAILS` matches. Verification passed with `npx vitest run tests/users-hidden-visibility.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`.
- 2026-06-24: Disposable hidden-user cleanup shipped locally. User deactivation side effects were extracted into `src/lib/services/user-deactivation.ts`, and `POST /api/users/hidden-cleanup` gives configured internal operators a dry-run-first cleanup path for active hidden users older than a requested TTL. The cleanup deactivates instead of deleting, preserves booking/audit history, clears sessions through the shared deactivation path, and writes cleanup audit entries when applied. Verification passed with `npx vitest run tests/api-route-wrapper-contract.test.ts tests/hidden-users-cleanup.test.ts tests/users-hidden-visibility.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`.
- 2026-06-24: Hidden-user operational sweep shipped locally. Added `visibleActiveUserWhere`, then used it for Schedule candidate scoring, auto-fill preview candidates, shift conflict maps, org chart rows, overdue admin escalation, item-report supervisors, low-stock admins, license-expiry recipients, calendar-sync-health admins, and firmware-watch admins. Historical report attribution and onboarding identity checks remain intentionally unchanged. Verification passed with `npx vitest run tests/users-hidden-visibility.test.ts tests/candidate-scoring.test.ts`, `npx tsc --noEmit`, `npm run codemap`, `npm run verify:docs`, `git diff --check`, and `npm run build:app`.
- 2026-06-24: Production rollout check passed. `npm run db:migrate:health` reported Neon has all 85 local migrations applied, including newest migration `0083_hide_smoke_users`, with no pending local migrations, no unresolved failed rows, and no applied DB-only migrations. Read-only production inspection found 10 active visible users, 4 inactive visible smoke/test users, and 0 active hidden users. After owner email confirmation, Vercel production `INTERNAL_OPERATOR_EMAILS` was configured for `role@wisc.edu` and verified present as an encrypted production variable.
- 2026-06-24: Follow-up cleanup fixed the remaining onboarding leak. Production rows for `admin@creative.local`, the two beta-smoke accounts, and the two legacy test accounts are now `hiddenFromRoster`; `/api/allowed-emails` also excludes rows claimed by hidden users by default so `/users/onboarding-status` and Settings > Allowed Emails no longer show claimed smoke/test access in daily review. Focused allowed-email and hidden-user tests passed.

Deferred: endpoint dry-run after a future production deployment if active hidden smoke users exist, and automatic scheduled cleanup.

---

## Active: selected workflow skill refresh (2026-06-24)

Plan: refresh the selected Gear Tracker skills so future doc sync, UI polish, shadcn, and migration work follow the current ledger, verification, and source-of-truth rules.

- [x] Read the selected skills and current repo contracts: task root, task index, package scripts, design language, shadcn config, and migration workflows.
- [x] Update `area-doc-sync` for current task-ledger routing, completed-plan archive buckets, codemap/docs verification, `build:app`, approved full build, and browser proof notes.
- [x] Update `make-interfaces-feel-better` with Gear Tracker design-language, shared operational primitives, status-color semantics, hit targets, and browser proof context.
- [x] Update `shadcn` with Gear Tracker project rules for existing primitives, installed components, lucide icons, semantic status colors, verification, and browser smoke.
- [x] Promote `gt-migrate` as the canonical Prisma/Neon workflow and fold in schema-first guardrails from `prisma-migrate-safely`.
- [x] Convert `prisma-migrate-safely` to a compatibility alias that delegates to `gt-migrate`.
- [x] Validate the changed skills and inspect the diff.
- [x] Record final review and verification.

### Review
- 2026-06-24: Selected workflow skills refreshed. `area-doc-sync` now routes through current task ledgers, completed-plan archive buckets, codemap/docs gates, `build:app`, approved full-build handling, and browser proof notes. `make-interfaces-feel-better` now includes Gear Tracker design-language context, shared operational primitives, status color semantics, hit targets, and authenticated browser proof expectations. `shadcn` now checks installed components/project config first, prefers Gear Tracker shared primitives, pins lucide/status semantics, and records docs/build/browser proof expectations; the stale unsupported `user-invocable` frontmatter key was removed. `gt-migrate` is now the canonical Prisma/Neon workflow, with schema-first audit, task-ledger, wrapper-backed health/deploy, codemap/docs, approval, and closeout guardrails. `prisma-migrate-safely` is now a compatibility alias that delegates to `gt-migrate` while preserving the key schema-safety warnings. Verification passed with `python3 /Users/erole/.codex/skills/.system/skill-creator/scripts/quick_validate.py` run individually for `area-doc-sync`, `make-interfaces-feel-better`, `shadcn`, `gt-migrate`, and `prisma-migrate-safely`; `git diff --check -- .agents/skills/area-doc-sync/SKILL.md .agents/skills/make-interfaces-feel-better/SKILL.md .agents/skills/shadcn/SKILL.md .agents/skills/gt-migrate/SKILL.md .agents/skills/prisma-migrate-safely/SKILL.md tasks/todo.md` also passed.

---

## Active: gt-plan skill hardening (2026-06-24)

Plan: update `.agents/skills/gt-plan/SKILL.md` in place so future Gear Tracker planning is smarter, ledger-aware, and more trustworthy.

- [x] Audit the existing `gt-plan` skill, task-root contract, package verification scripts, and relevant project lessons.
- [x] Patch `gt-plan` to route through current ledgers before creating new plan files.
- [x] Add source-of-truth reads, stop conditions, app/docs/browser/iOS verification guidance, and closeout rules.
- [x] Validate skill metadata and inspect the diff.
- [x] Record final review and verification.

### Review
- 2026-06-24: `gt-plan` now routes Gear Tracker work through current repo truth before implementation: North Star, task-root contracts, active ledgers, relevant area/brief/decision/gaps docs, schema when needed, source files, and tests. The workflow now distinguishes existing active plans, deferral ledgers, and new plan files; requires stop conditions; favors `npm run build:app` for app-only compile proof while keeping full `npm run build` for safe/approved shipping checks; adds docs/codemap, authenticated browser-smoke, and iOS drift/audit/build guidance; and requires closeout with shipped/verified/deferred/blocked/proof/next-slice notes. Verification passed with `python3 /Users/erole/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/gt-plan` and `git diff --check -- .agents/skills/gt-plan/SKILL.md tasks/todo.md`. The validator script is not directly executable, so the first direct invocation failed with `permission denied`; rerunning through Python passed.

---

## Active: North Star refresh (2026-06-24)

Plan: update `docs/NORTH_STAR.md` so the authoritative product direction matches the shipped native iOS, kiosk-only custody, reservation-first, schedule-source-of-truth, item-family, and maintenance reality.

- [x] Read the current North Star, decision log, gaps registry, task lessons, active task ledger, and current area docs for kiosk, checkouts, reservations, mobile, schedule, and bulk inventory.
- [x] Patch the North Star product shape, user modes, core workflows, principles, roadmap, planning gaps, and improvement suggestions.
- [x] Run doc verification and inspect the diff.
- [x] Record final review and verification.

### Review
- 2026-06-24: `docs/NORTH_STAR.md` now reflects the shipped operating model: app/web are reservation-first outside the counter, native kiosk owns custody, native iOS is a first-class product surface, web remains the control room, Schedule is a gear-linked source-of-truth workflow, and item-family/Battery Ops work is part of the baseline rather than future scope. The stale March roadmap, native-app exclusion, kiosk Phase C deferral, and resolved planning gaps were replaced with current shipped baseline, near-term focus, deferred scope, risks, planning gaps, and next planning docs. Verification passed with `npm run verify:docs` and `git diff --check -- docs/NORTH_STAR.md tasks/todo.md`.

---

## Active: Booking real-time sync planning (2026-06-24)

Plan: `tasks/booking-realtime-sync-plan.md`

- [x] Audit dashboard/checkouts/reservations docs, decisions, gaps, schema, and current React Query data flow.
- [x] Identify the current trust gap: dashboard stats can refresh ahead of stale dashboard rows, and persisted dashboard/detail cache can survive mount without a truth refresh.
- [x] Re-run through the updated `gt-plan` route contract: Dashboard owns the slice, Reservations/Checkouts/Mobile are secondary contract surfaces, the existing active plan remains the ledger, and stop conditions now gate implementation.
- [x] Slice 1: force fresh-on-mount behavior for operational booking surfaces.
- [x] Slice 2: add a lightweight authenticated booking-change signal API.
- [x] Slice 3: wire dashboard, bookings list, and booking detail cache invalidation to the signal.
- [x] Slice 4: sync area docs, record verification, and browser-smoke the no-manual-refresh path.

### Review
- 2026-06-24 `gt-plan` rerun: Dashboard is the daily action console, checkouts/reservations feed the shared Booking model, `/checkouts` and `/reservations` already redirect into `/bookings`, dashboard uses persisted React Query cache for the full payload, and booking list/detail data already use centralized React Query keys. API envelopes were checked before client planning: `/api/dashboard` and `/api/dashboard/stats` return `ok({ data, partialFailures })`, `/api/bookings` returns `ok({ data, total, limit, offset })`, `/api/bookings/[id]` returns `ok({ data: { ...detail, allowedActions } })`, and checkout/reservation lists return the shared list envelope. Recommended V1 is fresh-on-mount operational queries plus a bounded server truth cursor and React Query invalidation. WebSockets/SSE are out of scope for V1 unless the cursor strategy cannot meet the operational trust requirement under Vercel serverless constraints.
- 2026-06-24 Slice 1: Dashboard full payload, dashboard stats, booking detail, and shared booking-list queries now refetch on mount so reload/remount does not treat warm persisted cache as fresh. Added source-contract coverage in `tests/booking-realtime-sync-source.test.ts` and synced Dashboard/Testing docs. Verification passed with focused Vitest, TypeScript, codemap regeneration, docs check, migration-prefix check, whitespace check, and `npm run build:app`.
- 2026-06-24 Slice 2: Added bounded authenticated `GET /api/bookings/changes?since=<cursor>` for committed booking-change evidence. The route requires booking view permission, rate limits per signed-in user, returns `ok({ data: { cursor, changedBookingIds } })`, uses `Booking.updatedAt` plus indexed booking audit evidence, and scopes returned booking ids to the viewer. Verification passed with focused route/source Vitest, TypeScript, codemap regeneration, docs check, migration-prefix check, whitespace check, and `npm run build:app`.
- 2026-06-24 Slice 3: Added shared `useBookingChangeSync`, wired it into Dashboard and the shared booking list, and invalidates dashboard, dashboard stats, booking-list, and changed booking-detail query keys when `/api/bookings/changes` reports committed changes. The hook only polls while visible and online. Verification passed with focused route/source Vitest, TypeScript, codemap regeneration, docs check, migration-prefix check, whitespace check, and `npm run build:app`.
- 2026-06-24 Slice 4: Authenticated browser smoke created reservation `cmqs2rrjt000hkv9t8pp1kicm`, proved Dashboard Reserved 0 -> 1 and `/bookings?tab=reservations` convergence without manual refresh, caught the open-detail-sheet stale local-state bug, fixed it with a booking-change event bridge, proved the open sheet title/notes refreshed after a second mutation, cancelled the smoke reservation, and reloaded Dashboard with Reserved 0 and no stale smoke row. Remaining proof debt is checkout-specific list smoke and actual kiosk pickup fulfillment smoke, not code-blocking for this reservation/dashboard slice.

---

## Active: iOS kiosk idle sleep-mode hotfix (2026-06-23)

Plan: fix live iPad idle behavior after returning from a student hub.

- [x] Use the app timezone, not the server process timezone, for kiosk night-hours standby.
- [x] Preserve the wake/sleep-dismissal grace across navigation away from and back to idle.
- [x] Improve sleep overlay text contrast while keeping the burn-in-mitigation treatment.
- [x] Add focused route/source-contract coverage and run the iOS verification gates.
- [x] Defensively ignore stale server `night_hours` reasons on the iPad when the device clock is outside 10 PM-6 AM.

### Review
- 2026-06-23: Kiosk standby now classifies night hours using the configured app timezone instead of the server process timezone, so 6:38 PM Central no longer becomes Night Sleep Mode. The iOS kiosk stores the sleep-dismissal grace in `KioskStore`, so returning from student hub or success screens does not immediately snap back into sleep overlay, and the sleep overlay text opacity was raised for readability. Verification passed with focused kiosk dashboard/source-contract Vitest, docs/codemap check, iOS drift check, whitespace check, WisconsinKiosk simulator build, full Wisconsin simulator build, WisconsinKiosk generic iOS device build, signed build for the connected iPad Pro 10.5-inch, install, and launch. `npx tsc --noEmit` was also run but is currently blocked by the separate active Battery Ops worktree: `src/app/(app)/bulk-inventory/batteries/page.tsx` has a `BatteryCockpitData` fixture missing `integrity`.
- 2026-06-23 follow-up: Live iPad still showed Night Sleep Mode at 6:46 PM because the native app can receive a stale deployed `night_hours` response even after local API code is fixed. `KioskIdleView` now derives an effective sleep reason on-device: outside local 10 PM-6 AM, stale `night_hours` downgrades to `idle_window` when the dashboard is otherwise quiet, or `active_window` when work exists. The corrected build was signed, installed, and launched on the connected iPad.

---

## Active: Battery Ops booking context hotfix (2026-06-23)

Plan: fix checked-out battery units that show "Unknown" and "No booking context" even though they are linked to active checkout bookings.

- [x] Audit Battery Ops area docs, checkout/kiosk scan contracts, D-022, gaps, schema, page, API route, and peer allocation read models.
- [x] Patch the Battery Ops API to derive checked-out holder/booking context from active `BookingBulkUnitAllocation` rows, with a bounded fallback for orphaned checked-out unit rows.
- [x] Add focused route regression coverage for active allocation context, the live orphaned unit shape, and stale orphaned `CHECKED_OUT` statuses that should read available.
- [x] Sync Bulk Inventory docs and record verification results.
- [x] Run focused tests and closeout gates.

### Review
- 2026-06-23: Live read-only Neon evidence showed `CO-0048` has an open unit-tracked Sony Battery bulk item with planned quantity but no active `BookingBulkUnitAllocation` rows, while several Sony Battery units are marked `CHECKED_OUT`. Battery Ops now prefers active allocation rows, then falls back to matching open unit-tracked checkout bulk items for the same SKU, capped by outstanding planned quantity and assigned to the most recently updated orphaned checked-out units. Focused regression coverage added in `tests/battery-ops-route.test.ts`.
  Follow-up live evidence showed Sony Battery units #29 and #31 have stale `CHECKED_OUT` flags with no allocation rows, while Football Media Day is a future `BOOKED` reservation with quantity intent rather than exact unit links. Battery Ops now returns orphaned `CHECKED_OUT` units as Available when no active checkout context exists.
  Verification passed with focused Battery Ops route Vitest and TypeScript after the fallback patch. Earlier verification also passed docs/codemap check, migration prefix check, whitespace check, and `npm run build:app`. Full `npm run build` was attempted but stopped at the migration deploy preflight because sandboxed DNS to Neon failed; escalation was rejected because the script can apply migrations to the shared database.

---

## Active: iOS kiosk scanner phase focus hotfix (2026-06-23)

Plan: hotfix from live iPad testing on iPadOS 17.7.11 before Start Scanning.

- [x] Trace checkout detail focus ownership between visible native fields and the hidden HID scanner field.
- [x] Gate HID scanner capture behind an explicit scan-armed state set only by Start Scanning.
- [x] Disable scanner capture when editing checkout context, leaving checkout, or completing checkout.
- [x] Add source-contract coverage so the scanner cannot mount from checkout-context readiness alone.

### Review
- 2026-06-23: Checkout details no longer arm the hidden HID scanner just because event/purpose/return-time context is complete. `KioskCheckoutView` now uses explicit scanner-capture state that turns on only from Start Scanning and turns off for edit, disappear, and completion paths, so visible native text fields and date/time pickers keep keyboard/tap ownership before scan mode. Verification passed with focused scanner/API contract tests, docs check, iOS drift, iOS audit gaps, whitespace check, WisconsinKiosk simulator build, Wisconsin simulator build, and WisconsinKiosk generic iOS device compile. The physical 10.5-inch iPad was visible to CoreDevice but unavailable, so install/launch was not possible in this pass.

---

## Deferred: Kiosk extraction and consolidation debt (2026-06-22)

Status: Deferred by user. Do not start until explicitly resumed.

Plan: future slice should preserve the current `WisconsinKiosk` target split while reducing the debt created by recent kiosk velocity.

- [ ] Extract `KioskCheckoutDetailSheet` and its edit/item-row subviews out of `KioskIdleView.swift`.
- [ ] Move active checkout mutation logic from `/api/kiosk/checkout/[id]` into a focused kiosk checkout service.
- [ ] Add service-level tests for update details, scan-add serialized item, scan-add numbered bulk unit, remove serialized item, and remove numbered bulk unit.
- [ ] Keep `WisconsinKiosk` as a separate iOS 26 target, not a separate repo or product fork.
- [ ] Continue requiring both `WisconsinKiosk` and full `Wisconsin` builds before shipping kiosk changes.

### Rationale
- 2026-06-22: Extraction plan is sound as a target split, but not as a full fork. The next work should be consolidation rather than features: shrink the oversized kiosk idle/detail drawer file, move custody mutations out of the route handler, and pin behavior with service tests.

---

## Active: iOS kiosk input and student hub recovery (2026-06-22)

Plan: hotfix from live iPad testing on iPadOS 17.7.11.

- [x] Keep checkout detail text entry on the native iOS keyboard while removing the iPad shortcut/suggestion assistant bar.
- [x] Make student-context decoding tolerant of partial checkout/pickup/reservation rows.
- [x] Replace generic "check your connection" first-load copy with classified network/session/server/decode handling.
- [x] Run focused source-contract tests, iOS drift/audit gates, and kiosk/full-app builds.

### Review
- 2026-06-22: Live iPad hotfix installed on the connected iPad Pro 10.5. Checkout detail text entry now uses a native UIKit text field that keeps the iOS keyboard but clears the assistant/suggestion bar, including the hidden scanner field. Student hub loads now wait through brief connectivity loss, decode partial context rows lossily, route 401 back to activation, ignore cancellations, and show network/server/decode/not-found failures distinctly instead of always blaming the internet. Verification passed with focused iOS contract tests, drift check, iOS audit gaps, XcodeGen project check, kiosk simulator build, kiosk generic iOS build, full Wisconsin simulator build, signed device build, clean uninstall/install, and launch on the connected iPad.

---

## Active: Kiosk active checkout edits (2026-06-22)

Plan: `tasks/archive/kiosk-active-checkout-edit-plan.md`

- [x] Add kiosk-authenticated active checkout mutation routes.
- [x] Add native kiosk drawer controls for title/due-back edit, scan-add, and remove.
- [x] Add route/source contract coverage.
- [x] Sync docs and run verification.

### Review
- 2026-06-22: Active checkout edit slice shipped locally and installed on the connected iPad Pro 10.5. `/api/kiosk/checkout/[id]` now supports kiosk-scoped PATCH/POST/DELETE mutations for detail updates, scan-add, and remove-one-item, with availability checks, serializable transactions, allocation/bulk-unit updates, and audit entries. Native kiosk detail drawers expose title/due-back editing, scan-add, and remove controls using native input/date controls and refresh dashboard data after successful mutations. Verification passed with TypeScript, focused Vitest, docs/codemap check, iOS drift/audit gates, whitespace check, WisconsinKiosk simulator build, Wisconsin simulator build, WisconsinKiosk generic iOS device compile, signed device build, normal device install, and launch.

---

## Active: Kiosk Liquid Glass controls (2026-07-09)

Plan: `tasks/kiosk-liquid-glass-controls-plan.md`

- [x] Modernize shared kiosk header and completion controls with native iOS 26 glass styles.
- [x] Modernize active-checkout Done and Save hierarchy without glassing dense rows, scanner status, or inputs.
- [x] Preserve native accessibility behavior and explicitly re-arm scanner focus after title editing.
- [x] Add focused source contracts and sync docs.
- [x] Run final kiosk and main-app verification.

### Review
- 2026-07-09: Native iOS 26 glass now marks shared kiosk header/completion actions and active-checkout Done/Save while operational content remains opaque. Releasing the title field immediately re-arms HID capture. Full Vitest, docs/codemaps, production app build, iOS audits, and both kiosk/main Xcode schemes pass; managed M2 iPad Air visual/scanner confirmation remains open.

---

## Active: iOS kiosk counter/list skew hotfix (2026-06-22)

Plan: hotfix from live iPad testing on iPadOS 17.7.11.

- [x] Diagnose why dashboard counters can decode while Items Out / Checkouts / student active-checkout rows appear empty.
- [x] Make kiosk API date decoding accept server ISO timestamps with and without fractional seconds.
- [x] Run focused source-contract tests, iOS drift/audit gates, and kiosk/full-app builds.
- [x] Install and launch the rebuilt kiosk app on the connected iPad.

### Review
- 2026-06-22: Counter/list skew hotfix installed on the connected iPad Pro 10.5. Root cause was kiosk row models requiring `Date` fields while the default Swift ISO8601 decoder can reject server timestamps with fractional seconds, letting numeric counters decode while Items Out, Checkouts, and student hub rows decode to empty. `KioskAPIClient` now accepts ISO dates with and without fractional seconds. Verification passed with focused iOS contract tests, runtime warning contract, scanner focus, idle cancellation, all-day tests, iOS drift, iOS audit gaps, whitespace check, kiosk simulator build, kiosk generic iOS build, full Wisconsin simulator build, signed device build, clean uninstall/install, and launch on the connected iPad.

---

## Superseded: iOS 17 kiosk compatibility (2026-06-22)

Plan: `tasks/ios17-kiosk-compat-plan.md`

- [x] Back out the whole-app target downgrade and keep non-kiosk SwiftUI views untouched.
- [x] Add a native iOS 17 kiosk-only app target for the dedicated iPad.
- [x] Generate the Xcode project and build the kiosk target.
- [x] Sync mobile/kiosk docs and record verification.

### Review
- 2026-06-22: Native iOS 17 kiosk-only target shipped locally. `WisconsinKiosk` is an iPad-only app target that starts directly in kiosk mode, includes only kiosk source/resources, and builds for iOS 17.0. The full `Wisconsin` app and tests remain on iOS 26.0, with non-kiosk SwiftUI views untouched. Verification passed with XcodeGen project check, focused iOS source-contract Vitest, iOS drift, iOS audit gaps, docs codemap check, diff whitespace, kiosk simulator build, and full app simulator build.
- 2026-07-09: Superseded by the managed M2 iPad Air fleet upgrade to iOS 26. The separate `WisconsinKiosk` target remains, but its iOS 17 compatibility floor is intentionally retired.

---

## Active: Largest ownership files policy closeout (2026-06-22)

Plan: `tasks/largest-ownership-files-policy-plan.md`

- [x] Re-check current largest-file evidence in `docs/CODEMAPS/architecture.md`.
- [x] Confirm the touched hotspot, `EquipmentPicker.tsx`, received one stable render-only extraction.
- [x] Leave untouched ownership hotspots for future related work instead of splitting them speculatively.
- [x] Sync `DESLOPPIFY.md` and close the plan checklist.
- [x] Run documentation verification gates.

### Review
- 2026-06-22: Largest ownership files policy closed locally. The oversized-source watchlist in `docs/CODEMAPS/architecture.md` now keeps current hotspots visible, N4 already extracted one stable render-only responsibility from the touched `EquipmentPicker.tsx` hotspot, and the remaining large ownership files are explicitly left for future related area work rather than a speculative standalone split. Verification passed with docs/codemap check, migration prefix check, and diff whitespace check.

---

## Active: Equipment picker render split (2026-06-22)

Plan: `tasks/equipment-picker-render-split-plan.md`

- [x] Inspect `EquipmentPicker.tsx`, existing picker helpers, and N4 backlog guidance.
- [x] Keep the slice render-only: no search, scan, conflict-check, or data-hook changes.
- [x] Extract the selected-items shelf into a presentational component.
- [x] Add focused source-contract coverage.
- [x] Sync `DESLOPPIFY.md`, generated codemaps, and task ledger.
- [x] Run focused tests and closeout gates.

### Review
- 2026-06-22: Equipment picker render split shipped locally. The selected-items shelf moved into `src/components/equipment-picker/SelectedEquipmentShelf.tsx` as a presentational component, while `EquipmentPicker.tsx` still owns search, scan lookup, conflict checks, section data, and selection state. `tests/equipment-picker-render-split-source.test.ts` pins the split boundary. Verification passed with focused Vitest, TypeScript, codemap regeneration/docs check, migration prefix check, diff whitespace check, and `npm run build:app`.

---

## Active: Hook dependency escape hatch cleanup (2026-06-22)

Plan: `tasks/hook-dependency-escape-hatch-plan.md`

- [x] Inspect M4 target files and current `react-hooks/exhaustive-deps` / `as unknown as` usage.
- [x] Remove safe dependency suppressions from primitive-key cache update callbacks and URL/keyed effects.
- [x] Add rationale coverage for remaining derived-key suppressions.
- [x] Add focused source-contract coverage.
- [x] Sync `DESLOPPIFY.md`, generated codemaps if needed, and close the plan checklist.
- [x] Run focused tests and closeout gates.

### Review
- 2026-06-22: Hook dependency escape hatch cleanup shipped locally. Avoidable `react-hooks/exhaustive-deps` suppressions were removed from last-audit lookup, booking detail cache patching, booking list background-error toasts, booking wizard defaults, item detail keyboard tabs, notifications cache patching, and items cache patching. Remaining derived-key suppressions in event context and equipment conflict checks now carry rationale comments, and `tests/hook-escape-hatches-source.test.ts` pins documented suppressions plus primitive cache keys. Verification passed with focused Vitest, TypeScript, codemap regeneration/docs check, migration prefix check, diff whitespace check, and `npm run build:app`.

---

## Active: Oversized file watchlist (2026-06-22)

Plan: `tasks/oversized-file-watchlist-plan.md`

- [x] Inspect `DESLOPPIFY.md`, `scripts/generate-codemaps.mjs`, generated codemaps, and `tasks/todo.md`.
- [x] Choose an informational codemap section without adding hard line-count policy.
- [x] Add the generated watchlist and regenerate codemaps.
- [x] Sync `DESLOPPIFY.md` and close the plan checklist.
- [x] Run doc-focused verification and record results.

### Review
- 2026-06-22: Oversized file watchlist shipped locally. `scripts/generate-codemaps.mjs` now generates an informational top-20 TypeScript/TSX source file table in `docs/CODEMAPS/architecture.md`, with explicit copy that line count is not a failure threshold. Verification passed with codemap regeneration, docs/codemap check, migration prefix check, and diff whitespace check.

---

## Active: Plan ledger navigation cleanup (2026-06-22)

Plan: `tasks/plan-ledger-navigation-plan.md`

- [x] Inspect `plans/README.md`, `tasks/README.md`, `tasks/INDEX.md`, `tasks/todo.md`, and `DESLOPPIFY.md`.
- [x] Add explicit current-vs-historical navigation guidance to `plans/README.md`.
- [x] Add a start-here note to `tasks/INDEX.md`.
- [x] Sync `DESLOPPIFY.md` and close the plan checklist.
- [x] Run doc-focused verification and record results.

### Review
- 2026-06-22: Plan ledger navigation cleanup shipped locally. `plans/README.md` now identifies itself as a historical improve-plan registry and points current cleanup work to `DESLOPPIFY.md`, `tasks/todo.md`, and `tasks/INDEX.md`; `tasks/INDEX.md` now has a start-here note that separates active backlog execution from historical plan context. Verification passed with docs/codemap check, migration prefix check, and diff whitespace check.

---

## Active: Decision contract tests (2026-06-22)

Plan: `tasks/decision-contracts-plan.md`

- [x] Inspect decision text, helper ownership, existing focused tests, and app/web route surfaces.
- [x] Add `tests/decision-contracts.test.ts` for the three target decisions.
- [x] Run focused Vitest and closeout gates.
- [x] Sync `DESLOPPIFY.md` and `tasks/todo.md`.

### Review
- 2026-06-22: Decision contract tests shipped locally. `tests/decision-contracts.test.ts` now pins D-025 booking status label/display behavior, D-027 venue mapping regex validation and admin-only deterministic matching, and D-040 app/web reservation-first custody boundaries. Verification passed with focused Vitest, TypeScript, docs/codemap check, migration prefix check, whitespace check, and `npm run build:app`.

---

## Active: Testing guide refresh (2026-06-22)

Plan: `tasks/testing-guide-refresh-plan.md`

- [x] Inspect `docs/TESTING.md`, `plans/README.md`, `package.json`, current test inventory, helpers, and `BUG:` usage.
- [x] Replace stale suite counts and known-bug table with current inventory and conventions.
- [x] Document when to run focused Vitest, TypeScript, docs/codemap, migration-prefix, build, and iOS gates.
- [x] Add a reusable test inventory refresh command.
- [x] Sync `plans/README.md`, `DESLOPPIFY.md`, and `tasks/todo.md`.
- [x] Run doc-focused verification and record results.

### Review
- 2026-06-22: Testing guide refresh shipped locally. `docs/TESTING.md` now reflects 242 test files, 1,430 static test declarations, current `BUG:` usage, current helper files, verification gate guidance, and reusable inventory commands. `plans/README.md` now points readers to `docs/TESTING.md` for current inventory instead of historical improve-plan counts. Verification passed with the documented inventory commands, `npm run verify:docs`, `npm run db:migrate:check`, and `git diff --check`.

---

## Active: Booking status display cleanup (2026-06-22)

Plan: `tasks/booking-status-display-cleanup-plan.md`

- [x] Audit D-025, booking detail helpers, booking list helpers, item booking history, and existing status-label tests.
- [x] Add a shared display-only booking status helper.
- [x] Keep existing detail/list imports stable through wrappers or re-exports.
- [x] Migrate item booking history/calendar rows away from local status switches.
- [x] Delete impossible legacy booking-status branches from item history UI.
- [x] Add focused regression and source-contract coverage.
- [x] Sync DESLOPPIFY, relevant area docs, codemaps, and task ledger.
- [x] Run focused Vitest, TypeScript, docs, migration, whitespace, and app-build gates.

### Review
- 2026-06-22: Booking status display cleanup shipped locally. Booking details, booking-list visuals, item booking overview/history, upcoming item reservations, and item schedule agenda rows now use `src/lib/booking-status-display.ts` for labels and badge/status colors. The item tab's local booking status switch and legacy booking states were removed. Verification passed with focused Vitest, TypeScript, docs/codemap check, migration prefix check, whitespace check, and `npm run build:app`.

---

## Active: Venue mapping contract cleanup (2026-06-22)

Plan: `tasks/venue-mapping-contract-plan.md`

- [x] Audit D-027 source, schema, docs, route, sync, and tests.
- [x] Add shared venue mapping contract helpers.
- [x] Enforce ADMIN-only route access and invalid-regex rejection.
- [x] Apply deterministic matching in calendar sync and audit helpers.
- [x] Add focused regression tests and sync docs.
- [x] Run verification and record results.

### Review
- 2026-06-22: D-027 venue mapping contract cleanup shipped locally. Venue mappings now share regex validation/matching/ordering helpers; API reads are ADMIN-only; create rejects invalid regexes; calendar sync applies priority plus longest-pattern matching; audit and sync no longer use substring fallback for invalid regex patterns. Verification passed with focused Vitest, TypeScript, docs/codemap check, migration prefix check, whitespace check, and `npm run build:app`.

---

## Active: Booking action policy cleanup (2026-06-22)

Plan: `tasks/booking-action-policy-cleanup-plan.md`

- [x] Audit D-040 docs, client action helper, server rules, list menu usage, and tests.
- [x] Extract shared DB-free booking action policy.
- [x] Remove stale app/web `checkin` action exposure.
- [x] Update focused client/server action tests.
- [x] Sync DESLOPPIFY and relevant docs.
- [x] Run verification and record results.

### Review
- 2026-06-22: Booking action policy cleanup shipped locally. App/web booking list actions and server booking rules now share DB-free booking action policy helpers, so OPEN checkouts no longer expose `checkin` in regular app/web menus under D-040. Verification passed with focused booking action Vitest, TypeScript, docs/codemap check, migration prefix check, whitespace check, and `npm run build:app`.

---

## Active: Assets gap query bounds (2026-06-22)

Plan: `tasks/assets-gap-query-bounds-plan.md`

- [x] Audit missing-field asset route, Gap Wizard consumer, docs, and tests.
- [x] Bound standard item and item-family gap reads at the database query layer.
- [x] Preserve totals and return suggestion cap metadata.
- [x] Add focused route tests.
- [x] Sync DESLOPPIFY and relevant docs.
- [x] Run verification and record results.

### Review
- 2026-06-22: Assets gap query bounds shipped locally. Missing-category and missing-department cleanup now counts standard items and item families separately, pages source reads at the database layer, and reports capped suggestion matching to the Gap Wizard. Verification passed with focused missing-gap route Vitest, category cleanup wizard source-contract Vitest, TypeScript, docs/codemap check, migration prefix check, whitespace check, and `npm run build:app`.

---

## Active: Schedule role-slot hardening (2026-06-20)

Plan: `tasks/schedule-role-slot-hardening-plan.md`

- [x] Add role-slot mismatch detection to shared Schedule data quality and health.
- [x] Add explicit staff/admin repair route for historical role-slot mismatches.
- [x] Return assignment reroute metadata and surface honest assignment toast copy.
- [x] Split export columns into assigned role and planned slot context.
- [x] Add picker/copy-forward/Open Work hardening coverage and docs.
- [x] Run final verification and record results.

### Review
- 2026-06-20: Role-slot hardening shipped locally. Schedule data quality now flags active assignments whose assigned role disagrees with the planned slot, readiness highlights crew role-slot mismatches, `POST /api/shift-assignments/[id]/repair-role-slot` repairs historical mismatches through the same matching-slot rules, assignment APIs return role-slot outcome metadata for honest UI toasts, pickers explain when a matching slot will be used, exports split Assigned Role from Planned Slot, auto-fill preview labels planned versus assigned role, and Open Work defensively prevents Staff slots from becoming student pickup actions. Verification passed with focused Vitest, TypeScript, diff whitespace, and `npm run build:app`.

---

## Active: Schedule list simplification (2026-06-20)

Plan: compact the expanded Schedule list row so it stays focused on staffing and call time.

- [x] Remove linked/reserved gear badges and reservation-prep actions from the Schedule list.
- [x] Remove repeated inline add-slot controls from expanded shift rows.
- [x] Keep assignment, remove, trade, and one-call-time controls visible.
- [x] Group repeated call times and hide redundant filled-row Staff/Student labels.
- [x] Remove parent-row call-time summary copy from desktop and mobile list rows.
- [x] Sync source-contract tests and Schedule docs.
- [x] Run focused verification and record results.

### Review
- 2026-06-20: Schedule list simplification shipped locally. Expanded Schedule rows now show area, assigned person/open slot, one call-time editor, and minimal assignment actions; repeated add-slot controls plus linked/reserved gear badges and reserve-gear actions were removed from the Schedule list. Detailed gear readiness remains in Event detail and gear queues. Verification passed with focused source-contract Vitest, TypeScript, codemap/docs check, diff whitespace, and `npm run build:app`.
- 2026-06-20: Follow-up simplification grouped repeated expanded-row call times behind one "Most rows" call summary, kept only exception call-time controls visible, renamed the expanded section to Crew, and hid filled-row Staff/Student labels when they match the planned slot. Verification passed with focused source-contract Vitest, TypeScript, docs check, whitespace, and `npm run build:app`.
- 2026-06-20: Follow-up correction removed parent-row call-time preview copy from desktop and mobile Schedule list rows. Call time now lives only in expanded Crew rows, with common and exception call times shown there. Verification recorded after focused checks.
- 2026-06-20: Browser-smoke follow-up started a clean local dev server on `127.0.0.1:3060`; protected `/schedule` redirected to `/login`, but the documented seed admin credentials did not authenticate against the current Neon-backed environment, so authenticated Schedule visual proof remains blocked. Source-contract tests, TypeScript, docs check, whitespace, and `npm run build:app` remain the accepted verification for this local slice.

---

## Active: Schedule staffing class model (2026-06-20)

Plan: `tasks/schedule-staffing-class-plan.md`

- [x] Add `User.staffingType` schema field and migration backfilled from current role.
- [x] Wire Schedule display/routing/scoring/export logic to scheduling class while leaving permissions on `User.role`.
- [x] Surface editable Scheduling class on user detail.
- [x] Add focused regression coverage and sync Schedule docs/gaps.
- [x] Run local verification and record results.
- [x] Deploy pending migration and rerun live migration health.

### Review
- 2026-06-20: Explicit Schedule worker-class model implemented locally. `User.staffingType` now separates scheduling identity from app permission role, backfills existing users from current role, appears as editable Scheduling class on user detail, and drives Schedule labels, direct assignment routing, candidate scoring, copy-forward, auto-fill preview, exports, data-quality checks, Open Work pickup, and trade eligibility. Local verification passed with Prisma format/generate/validate, migration prefix check, focused Vitest schedule tests, TypeScript, codemap generation, docs verification, whitespace check, and `npm run build:app`. Live migration health reached Neon and reported `0082_user_staffing_type` pending; `npm run db:migrate:deploy` was blocked by the approval system before execution, so deploy plus final health remain open.
- 2026-06-20: Live migration follow-up completed. `npm run db:migrate:health` reached Neon and reported all 84 local migrations applied, newest local migration `0082_user_staffing_type` applied, no pending local migrations, no unresolved failed rows, and no DB-only migrations.

---

## Active: Schedule staff/student display cleanup (2026-06-20)

Plan: `tasks/schedule-role-label-cleanup-plan.md`

- [x] Audit Schedule filled-row, assignment, detail-panel, and readiness copy for planned-slot labels leaking into assigned-person labels.
- [x] Patch assigned rows/cards to display the assigned user role, while reserving Staff/Student slot copy for open planning slots.
- [x] Replace role-specific needs summary copy with neutral crew/people copy where the UI is counting open slots.
- [x] Add focused regression coverage and sync Schedule docs.
- [x] Run focused verification and record results.

### Review
- 2026-06-20: Staff/student display cleanup shipped locally. Filled Schedule rows and shift cards now show Staff or Student from the assigned user's role, open rows keep Staff slot/Student slot language, assignment buttons use generic open-slot copy, and coverage/readiness copy says Needs crew or Needs n people instead of Needs n students. Verification passed with focused Vitest, TypeScript, diff whitespace, and `npm run build:app`.
- 2026-06-20: Follow-up correction removed inferred worker classification from roster/profile metadata. Schedule MVP now treats `User.role` as the only current Staff/Student identity source for filled assignments, keeps `Shift.workerType` as the planned open-slot source, and tracks the smarter explicit scheduling-classification model as `PENDING-SCHEDULE-01` in `docs/GAPS_AND_RISKS.md`.

---

## Active: shadcn UI polish pass (2026-06-20)

Plan: goal-tracked cross-cutting UI polish across shared shadcn-centered surfaces.

- [x] Audit Settings/Reports tab rails against the lighter breadcrumb treatment and current docs.
- [x] Patch Settings/Reports rails to use a shared lighter section-nav treatment with clear active states and 40px+ targets.
- [x] Sync Settings/Reports docs and record nav-rail verification.
- [x] Run focused TypeScript, build, docs, whitespace, and browser smoke checks for the nav-rail slice.
- [x] Audit and patch FilterChip plus active filter chips.
- [x] Audit and patch OperationalToolbar.
- [x] Audit and patch SaveableField.
- [x] Audit and patch avatar/UserAvatar adoption.
- [x] Audit and patch hand-rolled empty states.

### Review
- 2026-06-20: Started the goal-tracked shadcn UI polish pass with the Settings/Reports navigation rail slice. Breadcrumb polish established the quieter navigation chrome direction; this slice is consolidating the matching section navigation treatment before moving to FilterChip and active filter chips.
- 2026-06-20: Settings/Reports nav rail slice shipped locally. Added shared `SectionNav` chrome with a translucent shell, 40px+ link targets, horizontal active underline, and desktop Settings rail active accent. Settings and Reports now consume the helper, area docs are synced, and verification passed with TypeScript, app build, docs check, whitespace check, and authenticated browser smoke on `/settings/notifications` plus `/reports/checkouts`.
- 2026-06-20: FilterChip and active-filter chip slice shipped locally. Shared filter chips now use lighter borders, clearer active underline treatment, truncated values, 40px trigger/clear targets, and quieter removable active-filter buttons across operational toolbars. Items, Checkouts, Reservations, and Reports docs are synced; verification is recorded after the focused checks and browser smoke.
- 2026-06-20: OperationalToolbar shell slice shipped locally. The shared toolbar now uses lighter translucent chrome so list command rows read as page controls instead of bordered cards, while children keep their existing layout and 40px control contracts. Design language plus Items, Checkouts, Reservations, and Users docs are synced; verification is recorded after focused checks and browser smoke.
- 2026-06-20: SaveableField slice shipped locally. Shared inline-edit rows now have a quieter hover treatment, visible dirty accent, status pills, and 40px save/cancel buttons with existing field-specific accessible names preserved. Design language plus Items, Checkouts, Reservations, Users, and Kits docs are synced; verification is recorded after focused checks and browser smoke.
- 2026-06-20: UserAvatar slice shipped locally. The shared people avatar now object-fits uploaded photos, strengthens deterministic initials fallback styling, and Items custody/status badges use the semantic `xs` avatar size instead of a custom 18px override. Design language plus Items and Users docs are synced; verification is recorded after focused checks and browser smoke.
- 2026-06-20: Empty-state slice shipped locally. Kit detail add-member misses and empty item-family membership now use shared inline `EmptyState` treatment instead of text-only placeholders. Design language and Kits docs are synced; verification is recorded after focused checks and browser smoke.

---

## Active: shadcn hand-rolled UI cleanup follow-up (2026-06-20)

Plan: tighten older route-local UI that still duplicates shadcn primitives after the shared polish pass.

- [x] Replace the raw global error actions and inline styling with shadcn `Button` plus semantic tokens.
- [x] Replace image-picker text-only search notices and selectable image tile controls with shared shadcn primitives.
- [x] Replace onboarding dialog local metric/status panels with shadcn `Card` composition.
- [x] Sync design/users/items docs and record verification.
- [x] Run TypeScript, app build, docs, whitespace, and browser smoke checks.

### Review
- 2026-06-20: Started the follow-up after the shadcn usage audit. Scope is intentionally narrow: global error fallback actions, image-picker search placeholders/selection tile controls, and onboarding dialog metric/status panels.
- 2026-06-20: Follow-up shipped locally. `global-error` now uses shadcn `Button` and semantic tokens instead of inline-styled raw controls; `ChooseImageModal` uses shadcn `Empty` for search notices and shadcn `Button` for result selection; `OnboardingDialog` metric/status counts use shadcn `Card` without nested cards, and the account-status singular copy now reads correctly. Verification passed with TypeScript, docs/codemap check, app build, diff whitespace, and authenticated browser smoke for the image picker plus onboarding dialog.

---

## Active: Categories visibility audit and patch (2026-06-19)

Plan: `tasks/categories-visibility-plan.md`

- [x] Audit category schema, API, Settings page, Items filters, and item create/detail pickers.
- [x] Patch category option generation so every category, including parent categories and grandchildren, can show up where exact category filters/assignments are valid.
- [x] Make the Fill gaps wizard smarter for missing-category cleanup across standard items and item families.
- [x] Add focused regression coverage.
- [x] Sync Settings/Items docs and record verification.

### Review
- 2026-06-19: Categories cleanup patch shipped locally. Category filters and shared pickers now use full hierarchy paths, `/api/assets?missing=category` suggests categories from already-categorized inventory, and Fill gaps uses those suggestions before gear-term fallback matching. Verification passed with focused Vitest, TypeScript, migration-prefix check, whitespace check, app build, and docs check. Browser smoke was blocked by the Codex/DevTools usage limit after starting the dev server.

---

## Active: Breadcrumb audit and patch (2026-06-19)

Plan: cross-cutting navigation slice in `src/components/PageBreadcrumb.tsx`

- [x] Audit current breadcrumb ownership, route derivation, role-aware sibling menus, recents, creation-flow treatment, and mobile constraints.
- [x] Patch remaining breadcrumb presentation and loading-edge issues without changing AppShell ownership.
- [x] Sync breadcrumb docs and record verification results.
- [x] Run focused verification and browser smoke.

### Review
- 2026-06-19: Shipped the breadcrumb display polish. `PageBreadcrumb` now treats `/new` task routes plus `/import` as quiet breadcrumb routes, waits for current-user role data before rendering role-gated Settings sibling dropdowns, and makes crowded Home crumbs compact on narrow screens while preserving screen-reader text. Verification passed with `npx tsc --noEmit`, `git diff --check -- src/components/PageBreadcrumb.tsx tasks/todo.md docs/AREA_MOBILE.md docs/AREA_SETTINGS.md`, and `npm run build:app`. `npm run verify:docs` reported codemap drift in `docs/CODEMAPS/architecture.md`, `docs/CODEMAPS/backend.md`, and `docs/CODEMAPS/frontend.md`; codemap regeneration was not run because the current worktree includes unrelated category/API edits. Authenticated Chrome DevTools smoke with the seeded admin verified `/settings/notifications` rendered `Home > Settings > Notifications` with 40px breadcrumb targets, `/resources/new` used the transparent quiet breadcrumb treatment, route data retried cleanly to 200, and the console had no app warnings or errors. Screenshot: `/private/tmp/breadcrumb-resources-new.png`.
- 2026-06-20: Follow-up UI refinement shipped locally. The breadcrumb shell now uses a quiet translucent trail without a boxed border, parent crumbs keep 40px+ targets with softer hover surfaces, separators are lower contrast, current-page crumbs use a subtle underline instead of a filled chip, and loading skeletons match the lighter treatment. Verification passed with `npx tsc --noEmit`, `npm run build:app`, `npm run verify:docs`, and focused diff whitespace checks. Authenticated Chrome DevTools smoke verified `/settings/notifications` and `/resources/new`: parent controls stayed transparent at 40px height, quiet routes had no shell background/shadow, current crumbs rendered a 2px underline, route/data requests returned 200 after expected dev retries, and the console had no app warnings or errors. Screenshot capture timed out in DevTools, so verification used DOM measurements and computed styles.

---

## Active: Schedule title cleanup (2026-06-19)

Plan: `tasks/schedule-title-cleanup-plan.md`

- [x] Confirmed Schedule/Event docs, schema, and shared formatter contract.
- [x] Updated shared Schedule title formatting for UW Athletics source prefixes and neutral-site location sublines.
- [x] Aligned future calendar sync prefix cleanup.
- [x] Added focused Schedule formatter and calendar-sync regression tests.
- [x] Run verification and record results.

---

## Active: Schedule call time display (2026-06-19)

Plan: `tasks/schedule-call-time-display-plan.md`

- [x] Confirmed the data model already separates event time, generated/default shift window, slot override, and personal override.
- [x] Update shared call-time display so rows show one call time per slot/person while preserving full-window edit/conflict data.
- [x] Run full verification and record results.

### Follow-up
- [x] Remove duplicate slot + assignment call-time controls from filled Schedule rows, event detail shift cards, and `/schedule/assign` cells.
- [x] Add regression coverage that filled rows use one assignment-target call editor and open slots use one slot-target call editor.
- [x] Run focused verification and record results.

### Follow-up Review
- 2026-06-20: Duplicate call-time controls removed. Filled Schedule rows, Event detail shift cards, and `/schedule/assign` assigned cells now render a single assignment-target call editor; open slots render the slot-target editor. Verification passed with focused Vitest, TypeScript, diff whitespace, and `npm run build:app`.

---

## Active: Schedule hardening from improve pass (2026-06-19)

Plan: `tasks/schedule-hardening-improve-plan.md`
Follow-up plan: `tasks/venue-mappings-audit-surface-plan.md`
Follow-up plan: `tasks/schedule-data-quality-queue-plan.md`
Follow-up plan: `tasks/schedule-event-identity-normalization-plan.md`

- [x] Gate hidden calendar-event list reads by role.
- [x] Replace stale mirrored calendar-events query coverage with route-backed tests.
- [x] Update Schedule/Event docs and run verification.
- [x] Centralize shared CalendarEvent where-building for Schedule/Event server reads.
- [x] Harden sport-code API boundaries and mapped home-venue sync classification.
- [x] Add sport-code route coverage and read-only venue mapping audit helper.
- [x] Harden manual calendar-event creation with schema-backed validation.
- [x] Surface the venue mapping audit in Settings for admin review and recovery.
- [x] Add the Schedule data-quality queue for event cleanup review.
- [x] Normalize noisy event opponent and venue identity strings at ingest/edit boundaries.

### Review
- 2026-06-19: Shipped the Schedule hardening improve follow-up. `/api/calendar-events?includeHidden=true` now rejects non-staff/admin users, route-backed GET tests cover default hidden/archive filtering plus staff-only hidden reads, and the stale mirrored query-helper test was removed. Verification passed with focused Vitest coverage, TypeScript, migration-prefix check, diff whitespace check, docs verification, and `build:app`.
- 2026-06-19: Shipped the query-contract follow-up. `/api/calendar-events`, Schedule health, Schedule automation, and Schedule exports now share `buildScheduleEventWhere`, with helper-level tests covering visibility/archive/status/date-window/sport/unmapped behavior.
- 2026-06-19: Shipped sport-code and venue hardening. API boundaries now normalize lowercase sport codes and reject unknown values before reads/writes, while calendar sync uses mapped home-venue flags when deriving home versus neutral event state.
- 2026-06-19: Shipped route coverage and venue audit follow-up. Schedule health, automation, exports, shift groups, bookings, users, and drafts now have route-level sport-code normalization/rejection tests, and `auditVenueMappings` flags home-venue mapping drift without mutating data.
- 2026-06-19: Shipped manual calendar-event creation schema hardening. `/api/calendar-events` POST now validates manual event payloads through one Zod schema before date normalization and create/audit writes.
- 2026-06-19: Shipped the venue mapping audit surface. Settings > Venue Mappings now shows read-only diagnostics for missing home-venue mappings, stale inactive/missing mapping targets, and home-looking mappings that point at non-home locations.
- 2026-06-19: Shipped the Schedule data-quality queue. Schedule health now flags visible events with missing sport/opponent/venue mapping context, future archived status, or shifts without sport metadata, and `/schedule?queue=data-quality` filters review to those events.
- 2026-06-19: Shipped event identity normalization. Calendar sync, manual event creation, event edits, event revert, and Schedule title rendering now share opponent/venue cleanup while preserving raw calendar venue evidence and pickup-location separation.

---

## Recently Archived: Plan 014, Plan 018, and iOS picker reconciliation (2026-06-19)

Archived to `tasks/archive/completed-2026-06/plan-014-018-020-023-reconciliation-2026-06-19.md`:

- Plan 014 kiosk checkout completion conflict reconciliation.
- Plan 018 resumed kiosk pickup progress reconciliation.
- Plan 020 iOS booking picker display-aligned sort.
- Plan 021 iOS booking picker bulk photos.
- Plan 022 iOS picker category grouping design spike.
- Plan 023 iOS picker category grouping implementation.

---

## Recently Completed: Plan 005 AppTabView split (2026-06-19)

- Split native Profile, Notification Settings, Account Security, Account Avatar, and Availability views out of `ios/Wisconsin/Views/AppTabView.swift`.
- Kept `AppTabView.swift` scoped to stable tab shell and push routing, with no tab label, tag, badge, or role-gating changes.
- Final proof lives in `plans/005-split-ios-app-tab-view.md`.

---

## Recently Completed: Plan 013 CreateBookingSheet split (2026-06-19)

- Split native reservation creation into focused `ios/Wisconsin/Views/CreateBooking/` files for view model logic, event-linking views, selected equipment rows, form rows, and pickers.
- Kept `CreateBookingSheet.swift` scoped to the Details, Equipment, Confirm flow, scanner presentation, submit handling, and view-model wiring.
- Final proof lives in `plans/013-split-ios-create-booking-sheet.md`.

---

## Recently Completed: Plan 011 iOS avatar consolidation (2026-06-19)

- Routed Profile, User detail, Schedule assignment, Users, Booking rows, Event detail crew, and reservation requester avatars through `UserAvatarView` or its thin current-user wrapper.
- Preserved tone-aware fallback colors for role/profile contexts and gray fallback treatment for assignment rows.
- Final proof lives in `plans/011-consolidate-ios-avatar-rendering.md`.

---

## Recently Completed: Plan 017 iOS kiosk checkout error path (2026-06-19)

- Routed native kiosk checkout completion through `KioskAPI.perform` while preserving the current event, purpose, due-back, and cart payload.
- Added source-contract coverage so the method cannot fall back to direct `session.data(for: req)` response handling.
- Final proof lives in `plans/017-ios-kiosk-complete-unify-error-path.md`.

---

## Recently Completed: Plan 050 iOS reservation showtime polish (2026-06-19)

- Aligned native reservation event titles to sport-code `vs`/`at` naming and stopped event venue from silently becoming pickup location.
- Kept counted item families in the same Equipment flow as serialized assets, with thumbnail slots in the picker and review.
- Final proof lives in `plans/050-ios-booking-showtime-polish.md`.

---

## Recently Completed: Plan 043, 049, and 051 reconciliation (2026-06-19)

- Reconciled the three plans that were already shipped on main but lacked individual closeout metadata.
- Checked done criteria and added review notes for available-only derived status filtering, quantity add-to-existing unit-family protection, and Brother battery label CSV tracking.
- Closed the stale plan-ledger TODO summary in `plans/README.md`.

---

## Recently Archived: completed ownership passes (2026-06-19)

Archived to `tasks/archive/completed-2026-06/`:

- Booking creation ownership pass.
- Scan ownership pass.
- Reports ownership pass.
- Trade Board ownership pass.

---

## Recently Archived: completed root cleanup batch (2026-06-19)

Archived to `tasks/archive/completed-2026-06/`:

- Kit detail design-language pass.
- Kiosk gate pending-pickup plan.
- iOS schedule/trade control clarity plan.
- Web interface audit plan.
- Web bug sweep ledger.
- April sprint plan.

---

## Recently Archived: Codex PR and plan orchestrator starting slice (2026-06-18)

Archived to `tasks/archive/completed-2026-06/orchestrator-starting-slice-2026-06-18.md`:

- Created the read-only orchestrator ledger and classified PR #349, PR #353, and PR #324.
- Added reusable builder, dependency-builder, reviewer, and verification-only prompt contracts.
- Ran the first revived PR pilot and kept the recurring wake-up policy manual-first.
- Rechecked PR #324 and preserved the close recommendation behind explicit approval.
- Converted dependency PR audit blockers into the now-archived dependency hardening slice.

## Recently Archived: dependency audit hardening (2026-06-18)

Archived to `tasks/archive/completed-2026-06/dependency-audit-hardening-2026-06-18.md`:

- Cleared the mandatory high audit gate by updating lockfile resolution for `vitest`, `vite`, `ws`, and related transitive dependencies.
- Fixed CI placeholder env scope so `npm ci` can run `postinstall` before audit, tests, and build.
- Allowed only `dependabot[bot]` through Claude Code review.
- Reconciled source-contract tests to current iOS/kiosk/event contracts.
- PR #349 and PR #353 are superseded by this local hardening slice once shipped; PR #324 was closed after explicit approval.

---

## Recently Archived: completed Schedule, iOS, and kiosk custody slices (2026-06-18)

Archived to `tasks/archive/completed-2026-06/active-queue-cleanup-2026-06-18.md`:

- Schedule crew UI trim pass.
- Schedule event editing clarity pass.
- Schedule first-class UI polish pass.
- iOS Schedule all-day display correction.
- Kiosk all-day fallback correction.
- Dashboard upcoming event title cleanup.
- iOS kiosk all-day call-time cleanup.
- Laowa 10mm item detail crash trace.
- Event all-day call-window display cleanup.
- Kiosk-only custody contract.

---

## Recently Archived: completed 2026-06-15 Kiosk/iOS follow-ups (2026-06-18)

Archived to `tasks/archive/completed-2026-06/kiosk-ios-followups-2026-06-15.md`:

- iOS hand-scanner debugger.
- Kiosk activation reset fallback.
- Wiscard profile capture.
- Kiosk numbered battery scanner hardening.
- Kiosk checkout event context.
- Kiosk iOS UI consolidation and brand polish.

The 2026-06-12 kiosk pickup scan follow-up is now archived after live database smoke and cleanup proof.

---

## Recently Archived: Kiosk pickup live smoke follow-up (2026-06-18)

Archived to `tasks/archive/completed-2026-06/kiosk-pickup-live-smoke-followup-2026-06-18.md`:

- [x] Split the live pickup smoke out of the completed 2026-06-12 kiosk cleanup bundle.
- [x] Preserve the completed enum/schema proof from the post-deploy check.
- [x] Get explicit approval to create a disposable live pickup fixture.
- [x] Run an authenticated kiosk pickup scan against live database data and clean up disposable data.

### Review
- 2026-06-18: The schema side is already proven live: migration health is clean, `scan_events.phase` is `ScanPhase`, and the typed comparison that previously failed now succeeds. No live pickup fixture currently exists, so the remaining smoke is carried as an explicit follow-up instead of mutating live data implicitly.
- 2026-06-18: Fixture-backed live database smoke passed through local kiosk HTTP routes. A successful serialized pickup scan wrote scan event `cmqkb0ic80001kvdlqt57up29` with `phase = CHECKOUT`; pickup confirmation completed source reservation `cmqkb0dwf0005kvp65stk1ove` and opened checkout `cmqkb0kem0008kvdlx6k7zuwe`. Cleanup evidence showed zero leftover disposable bookings, kiosk devices, users, or scan events.

---

## Recently Archived: completed 2026-06-12 kiosk bundle (2026-06-18)

Archived to `tasks/archive/completed-2026-06/kiosk-2026-06-12-cleanup.md`:

- Kiosk pickup scan 500 and kiosk UI pass, with live pickup smoke carried forward.
- Kiosk dashboard final polish.
- Kiosk iPad activation and idle polish.
- Always-on kiosk session persistence and standby display.

---

## Recently Archived: completed roadmap intake and project cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/roadmap-and-project-cleanup-2026-06-12.md`:

- Roadmap ideas intake from 2026-06-12.
- Project folder cleanup from 2026-06-12.

---

## Recently Reconciled: iOS booking event linking and showtime polish (2026-06-11)

Plan: `tasks/archive/completed-2026-06/ios-booking-event-linking-polish-plan.md`

- [x] Add native event linking to reservation creation.
- [x] Refresh the three-step iOS booking UI for showtime.
- [x] Add focused tests and doc sync.
- [x] Run the iOS verification stack and record results.

### Review
- 2026-06-11: Native reservation creation now links up to 3 upcoming events, submits `eventIds[]`, preserves event-detail prefill behavior, and has cleaner Apple-style Details/Equipment/Confirm context.
- 2026-06-11: Verification passed with focused iOS source tests, whitespace check, iOS drift check, iOS gap audit, and XcodeBuildMCP simulator build. TypeScript remains blocked by the unrelated pre-existing conflicted `tests/booking-create-ux.test.ts`.

---

## Recently Reconciled: iOS Scan bulk unit QR resolution (2026-06-11)

Plan: `tasks/archive/completed-2026-06/ios-scan-bulk-unit-qr-plan.md`

- [x] Decode `/api/assets` item-family `bulkItems` in native iOS.
- [x] Render resolved numbered battery unit results in Scan instead of "Nothing found."
- [x] Add focused contract coverage and sync docs.
- [x] Run focused tests and iOS verification.

### Review
- 2026-06-11: Native Scan/global search now decode `/api/assets.bulkItems`, render item-family battery results with scanned unit context, and keep reservation scan-to-add explicit by directing item-family matches back to quantity controls.
- 2026-06-11: Verification passed with focused Vitest tests, iOS drift check, iOS gap audit, whitespace check, and escalated iOS Simulator build. `npx tsc --noEmit` remains blocked by unrelated `tests/bulk-unit-adjustment-routes.test.ts:171`.

---

## Recently Archived: completed search and B&H image cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/search-and-bhphoto-cleanup-2026-06-10.md`:

- Ambient quick search type-to-search removal from 2026-06-10.
- B&H asset image picker fix from 2026-06-10.

---

## Release Status

**Current release**: Beta — CalVer versioning adopted.
**Release workflow**: `npm run release` creates CalVer tag + GitHub Release.

---

## Recently Shipped

### iOS Resources Area (2026-08-18)
- [x] **Guide reader Markdown parity** — Replaced the hand-rolled line parser with apple/swift-markdown (CommonMark + GFM, same cmark-gfm engine as `remark-gfm`). Fixes guide photos not loading, tables rendering one monospaced block per row, and `[!WARNING]` printing its literal marker. Contract in `docs/GUIDE_MARKDOWN.md`; 30 tests in `ios/WisconsinTests/GuideMarkdownTests.swift`
- [x] **Reader affordances** — Image captions + VoiceOver labels, downsampled cached image loading, `mailto:`/`tel:` links, task lists, copyable code blocks, video embed cards
- [x] **Area consistency (Guides / Users / Licenses)** — Tab-reset gesture on all three (only Users had it), forced refresh supersedes an in-flight load instead of being dropped, Clear-filters recovery in filtered-empty states, shared active-filter tint on Guides controls, concurrent license reads, expiring license confirmations, varied skeleton widths. Pinned by `tests/ios-resources-area-consistency.test.ts`

### Design System Cleanup (2026-04-14)
- [x] **Badge variants** — Removed 4 unused variants (ghost, link, mixed, yellow); consolidated from 13 → 9
- [x] **Typography** — 15 settings page headings migrated from hardcoded `text-[22px]` → `text-2xl` token
- [x] **Legacy CSS** — ~240 lines removed: `ops-row*` (dashboard columns), `possession-card*` (no consumers), `data-table*` (TradeBoard + ShiftConfigTable) all migrated to Tailwind
- [x] **Accent naming** — 3 direct `var(--accent)` usages replaced with `var(--primary)` / `hover:border-primary`
- [x] **Theme toggle** — `.theme-toggle-row` CSS block migrated to inline Tailwind (`data-[state=on]:`, `hover:`) in Sidebar.tsx

### Guides Feature (2026-04-14)
- [x] **Slice 1** — Guide model + migration (0032), service layer (`src/lib/guides.ts`), 5 API routes with auth + audit logging
- [x] **Slice 2** — `/guides` list page (category chips, search, card grid), `/guides/[slug]` BlockNote reader, sidebar nav entry
- [x] **Slice 3** — `/guides/new` create page, `/guides/[slug]/edit` edit page (publish toggle, admin delete with AlertDialog)
- [x] **Doc sync** — `AREA_GUIDES.md` created, `guides-plan.md` archived

### Kiosk Mode — Full Flow (2026-04-14)
- [x] **Verified all 12 kiosk API routes** — all use `withKiosk`, correct auth on all mutations
- [x] **Confirmed `source: "KIOSK"`** on checkout/complete and checkin/complete audit entries
- [x] **Confirmed 5-min inactivity timer** in KioskShell
- [x] **Updated AREA_KIOSK.md** — all 11 ACs marked complete, full implementation documented
- [x] **Archived `tasks/kiosk-plan.md`** → `tasks/archive/`

### Scan Flow Hardening (2026-04-09)
- [x] **Stress test** — 4 issues found, 4 fixed: scanValue normalization, bulk bin case-insensitive match, cross-booking numbered bulk unit integrity, completeCheckinScan status guard
- [x] **Harden pass** — 6 fixes across 4 files: Badge components, dark-mode color consistency, finally blocks on both hooks, Page Visibility refresh, camera error UX

### Booking Flow Overhaul (2026-04-09)
- [x] **Multi-step wizard** — `/checkouts/new` and `/reservations/new` replace `CreateBookingSheet`. 3 steps: Context & Details → Equipment → Confirmation.
- [x] **BookingDetailsSheet Equipment tab** — 3rd tab with unreturned badge count, scan-to-return (inline camera, local QR lookup, audio/haptic), full EquipmentPicker in edit mode.
- [x] **Thumbnails everywhere** — `<AssetImage size={36}>` on all equipment rows. Bulk qty stepper capped at max, 44px touch targets.
- [x] **Stress test** — 12 issues found, 8 fixed (broken redirect URL, stale scan state, date validation, audit log deps, draft save await, form-options error state).
- [x] **Cleanup** — `CreateBookingSheet` and `BookingEquipmentEditor` deleted. Dashboard wired to wizard navigation.

---

## Open Items

### Recently Archived: item info and identity firmware cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/item-info-identity-firmware-cleanup-2026-06-10.md`:

- Item Info Sidebar Hardening from 2026-06-10.
- Item Detail Identity Firmware Refresh from 2026-06-10.

### Recently Archived: item detail firmware cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/item-detail-firmware-cleanup-2026-06-10.md`:

- Item Detail Firmware Badge from 2026-06-10.
- Item Detail Firmware Display from 2026-06-10.

### Recently Archived: firmware watch cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/firmware-watch-cleanup-2026-06-10.md`:

- Firmware Watch Daily Notifications from 2026-06-10.
- Firmware Watch Inventory Seed Follow-up from 2026-06-10.

### Recently Archived: add item and QR cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/add-item-qr-cleanup-2026-06-10.md`:

- Add Item Flow Quick Fixes from 2026-06-10.
- QR Code Generation Simplification from 2026-06-10.

### Recently Archived: iOS settings cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-settings-cleanup-2026-06-10.md`:

- iOS Settings Detail Menus Slice from 2026-06-10.
- iOS Settings First-Class Slice from 2026-06-10.

### Recently Archived: booking flow and notification category cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/booking-flow-notification-category-cleanup-2026-06-10.md`:

- Booking Flow Follow-up from 2026-06-10.
- iOS Notifications Category Parity Slice from 2026-06-10.

### Recently Archived: iOS notifications token and tap-through cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-notifications-token-tapthrough-cleanup-2026-06-10.md`:

- iOS Notifications Token Honesty Slice from 2026-06-10.
- iOS Notifications Tap-Through Slice from 2026-06-10.

### Recently Archived: iOS notifications audit and runtime cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-notifications-audit-runtime-cleanup-2026-06-10.md`:

- iOS Notifications Audit from 2026-06-10.
- iOS Runtime Warning Cleanup from 2026-06-09.

### Recently Archived: Internal Public Beta Launch Readiness (2026-06-18)

Archived to `tasks/archive/completed-2026-06/internal-public-beta-launch-readiness-2026-06-08.md`:

- Completed onboarding hardening, no-temp-password beta pivot, production env checks, launch data prep, production/authenticated browser smoke, iOS beta gate, and the one-page beta runbook.
- Created release follow-up `tasks/internal-public-beta-release-cut-followup.md` because `npm run release` requires a clean worktree and creates a version commit, tag, push, and GitHub Release.

### Recently Archived: iOS HIG and schedule trade cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-hig-schedule-trade-cleanup-2026-06-05.md`:

- iOS HIG and iOS 27 Readiness from 2026-06-05.
- iOS Schedule Detail and Trade Control Clarity from 2026-06-03.

### Recently Archived: iOS create booking and profile clarity cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-create-booking-profile-clarity-cleanup-2026-06-03.md`:

- iOS Create Booking Control Clarity from 2026-06-03.
- iOS Profile Controls Clarity from 2026-06-03.

### Recently Archived: iOS booking detail and items clarity cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-booking-detail-items-clarity-cleanup-2026-06-03.md`:

- iOS Booking Detail Control Clarity from 2026-06-03.
- iOS Items Control Clarity from 2026-06-03.

### Recently Archived: iOS schedule and tabs clarity cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/ios-schedule-tabs-clarity-cleanup-2026-06-03.md`:

- iOS Schedule Control Clarity from 2026-06-03.
- iOS Tabs And Buttons Readiness from 2026-06-03.

### Recently Archived: Onboarding Flow Plan (2026-06-18)

Archived to `tasks/archive/completed-2026-06/onboarding-flow-plan-2026-06-03.md`:

- Shipped the bulk-capable invitation lifecycle with allowlist security and D-037.
- Unified Users and Settings onboarding around invite-first bulk and one-email flows.
- Added onboarding status follow-up, registration prefill, and iOS forced-password setup.
- Retired first-time temporary-password onboarding for beta.
- Closed Slice 7 with focused onboarding/API/source verification and plan archival.

### Recently Archived: booking create cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/booking-create-cleanup-2026-05-30.md`:

- Booking Create UX Ownership Pass from 2026-05-30.
- Booking Create Hardening from 2026-05-30.

### Recently Archived: May major completed work cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/may-completed-major-work-cleanup-2026-05-21.md`:

- Global Search MVP Hardening through Damage Report Photos + Avatar Polish.
- Includes design language, settings, product image search, resources, schedule, dashboard, bulk families, badges, reports, API hardening, and security patch completed sections.

### Active Backlog Index (2026-05-06)
- [x] **Next recommended slice: Admin Fix Today queue** — Shipped `/admin/fix-today` as an admin-only read queue for overdue gear, pending pickup handoffs, offline kiosks, flagged maintenance items, low batteries, calendar sync failures, and license expirations.
- [x] **Battery follow-through** — Shipped the explicit kiosk battery scan step: typed numbered-battery rows and scan-summary counts in checkout detail, plus dedicated iOS pickup/return battery progress cards.
- [ ] **Admin helpers** — Remaining helper slices moved to `tasks/admin-helper-followups.md`: kiosk admin follow-through, people offboarding, exception review, renewal/expiry calendar, and morning digest.
- [ ] **Ops V2/V3 deferred work** — Keep inventory health, attachment slot schema, templates/presets, and database-configurable equipment guidance behind slice plans.
- [ ] **Low-priority systemic gaps** — Keep generic SystemConfig UI and mobile staff parity visible but behind daily-ops work.

### Recently Archived: Bulk Battery Hardening cleanup (2026-06-19)

Archived to `tasks/archive/completed-2026-06/bulk-battery-hardening-cleanup-2026-05-05.md`:

- Numbered battery kiosk pickup/check-in scans, kiosk client labels, Battery Unit Cockpit, mismatch polish, compatibility lows, explicit battery scan progress, booking-create battery guidance, attachment management polish, battery audit/reporting, and bulk battery item hardening are shipped.
- Remaining future work moved to `tasks/bulk-battery-followups.md`: kiosk admin override visibility, optional gear suggestions, inventory health dashboard, attachment slot schema decision, templates/presets, and database-configurable equipment guidance.

### Recently Archived: May post-backlog UI and item cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/may-post-backlog-ui-item-cleanup-2026-05-07.md`:

- Avatar + shadcn Cleanup through Derived Bulk Unit QR Scans.

### Recently Split: Admin helper and low-priority systemic follow-ups (2026-06-19)

Moved to `tasks/admin-helper-followups.md`:

- Shipped helpers: Admin Fix Today queue, Battery unit cockpit, Inventory hygiene center, and pending-pickup auto-expiry.
- Remaining helper slices: kiosk admin follow-through, People offboarding assistant, Admin exception review, Renewal and expiry calendar, and Admin-only morning digest.
- Remaining low-priority systemic follow-ups: generic SystemConfig admin surface and mobile staff parity review narrowed to GAP-34 and GAP-36.

### Recently Archived: Codex readiness and legacy tail cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/codex-readiness-legacy-tail-cleanup-2026-05-05.md`:

- Codex Readiness and completed legacy Reservations, Users, Known Bugs, Scan Flow, and Phase B entries.

## Notes

### Active: iOS Apple Design full audit (2026-07-10)

- [x] Execute `tasks/ios-apple-design-full-audit-plan.md` and publish `tasks/audit-ios-apple-design-full.md` plus `tasks/ios-apple-design-remediation-slices.md`.
- [x] Implement every source-level remediation slice and reconcile Mobile, Kiosk, Schedule, Search, Reservations, Resources, Notifications, Decisions, tests, and codemaps.
- [x] Verify 170 iOS-focused tests, both simulator targets, iOS drift/audit/project gates, docs, app production build, and diff hygiene.
- [x] Redesign the checkout-return Live Activity around a neutral, minute-level, privacy-conscious lock-screen and Dynamic Island hierarchy; preserve its server lifecycle and booking-detail route.
- [ ] External signoff only: managed-device HID/camera, VoiceOver, AX5, accessibility settings, rotation, and student/counter walkthrough.

### Active: Live Activity durable auto-start (2026-07-10)

- [x] Execute `tasks/live-activity-durable-autostart-plan.md` so eligible return activities start 30 minutes before due without an app launch or frequent cron.
- 2026-07-10: Checkout creation, kiosk direct checkout, lifecycle return-time edits/extensions, and kiosk active-checkout edits now schedule durable runs. Each run sleeps to the 30-minute threshold and revalidates the exact return timestamp and eligible ActivityKit token/start state before sending APNs. Verification details are recorded in the plan review.

- Write a `BRIEF_*.md` or Decision record before implementing any new feature
- Run `npm run build` before any commit
- Every mutation endpoint needs audit logging (D-007)
- Read `NORTH_STAR.md` first in any new Claude session
- When shipping, update the relevant `AREA_*.md` and `GAPS_AND_RISKS.md` per [AGENTS.md](../AGENTS.md)

---

### Recently Archived: Wins Sprint cleanup (2026-06-18)

Archived to `tasks/archive/completed-2026-06/wins-sprint-cleanup-2026-04-30.md`:

- Wins Sprint from 2026-04-30.
