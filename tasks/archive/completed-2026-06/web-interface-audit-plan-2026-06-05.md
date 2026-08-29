# Web Interface Audit Plan - 2026-06-05

## Goal
- Audit Wisconsin Creative web interfaces end to end and improve the weakest current UI/UX surfaces while preserving existing product contracts.
- Keep each slice narrow, independently testable, and documented.

## Source Checks
- `AGENTS.md`: non-trivial work needs an upfront plan, progress tracking, verification, shadcn/ui primitives, doc sync, and full-file reads before edits.
- `tasks/lessons.md`: false-empty states, weak network copy, stale refresh behavior, missing 401 handling, unnamed controls, and sub-40px controls are recurring web risks.
- `docs/DECISIONS.md`: preserve derived status, unified bookings, tag-first identity, tiered role policy, audit logging, and onboarding lifecycle D-037.
- `docs/GAPS_AND_RISKS.md`: no broad web UI gap currently requires schema changes; avoid reopening closed broad reliability work without current evidence.
- `prisma/schema.prisma`: this pass starts with existing `AllowedEmail`, `User.forcePasswordChange`, and role/location models; no schema change in Slice 1.
- `docs/AREA_USERS.md` and `docs/BRIEF_ONBOARDING_V1.md`: onboarding is a People workflow with status/follow-up controls for pending, stale, claimed, and direct-created rows.
- `docs/DESIGN_LANGUAGE.md` and `tasks/design-language-route-conformance-checklist.md`: web controls need labels, visible focus, 40px targets, shared page headers, shared empty states, and operational metric patterns.
- `tasks/archive/completed-2026-06/web-bug-sweep-plan-2026-05-24.md` and `tasks/web-operator-trust-plan.md`: broad reliability sweeps already covered many raw JSON, stale data, export, and settings/report issues. New work should target concrete current drift.
- Current route/component inventory under `src/app/(app)`, `src/components`, and `src/components/ui` confirms the app already has `PageHeader`, `EmptyState`, `OperationalRowActions`, `OperationalToolbar`, shadcn primitives, and report/settings shells.

## Route Inventory
- Core queues and lists: `/`, `/items`, `/bookings`, `/checkouts`, `/reservations`, `/users`, `/search`, `/notifications`
- Detail and creation flows: `/items/[id]`, `/bulk-inventory/[id]`, `/kits/[id]`, `/users/[id]`, `/checkouts/new`, `/reservations/new`
- Admin/settings: `/settings/*`, `/admin/fix-today`, `/users/onboarding-status`
- Operations/reports: `/schedule`, `/schedule/assign`, `/events/[id]`, `/reports/*`, `/bulk-inventory/batteries`, `/licenses`, `/resources`, `/labels`

## Current Findings
- `/users/onboarding-status` is a new route outside the existing route conformance checklist. It uses the correct source of truth and row actions, but compact retry/refresh controls sit below the 40px target baseline, search/select controls lack explicit programmatic names, and the metric strip uses route-local markup instead of the shared operational metric primitive.
- `/settings/allowed-emails` links into onboarding and passes location-load state into the shared dialog. It should remain the Settings configuration root, while `/users/onboarding-status` owns operational follow-up.
- Broad design-language and operator-trust plans already marked the major routes mostly conforming. The next useful work is route-specific cleanup on newly shipped or newly touched surfaces, not another redesign pass.

## Slices
- [x] Slice 1: Onboarding status control and metric cleanup
  - Make header refresh and error retry controls meet the 40px target baseline.
  - Add explicit labels/names for the search and status filter controls.
  - Move the status metric strip onto the shared `OperationalMetricCard` primitive.
  - Keep allowlist-backed data, status semantics, and row actions unchanged.
  - Verify with focused source tests, TypeScript, diff whitespace, build, and browser smoke if the local server/browser path is available.
- [x] Slice 2: Add `/users/onboarding-status` to route conformance docs
  - Record the page as an onboarding follow-up surface under Users.
  - Note any remaining browser-smoke follow-up if environment blocks it.
- [x] Slice 3: Shared onboarding dialog role/click-target cleanup
  - Replace raw `ADMIN` / `STAFF` / `STUDENT` role values in the direct-create handoff and temporary-password CSV exports with product labels.
  - Keep API payload values unchanged so role authorization and create semantics stay intact.
  - Bring the location retry control in the direct-create path to the 40px target baseline.
  - Verify with focused source tests, TypeScript, diff whitespace, build, and browser smoke if available.
- [x] Slice 4: Shared onboarding dialog form metadata cleanup
  - Add stable `name` attributes to the bulk invite, single invite, and bulk direct-create controls.
  - Add email autocomplete metadata where operators enter a single invite email.
  - Keep API payload values, role defaults, preview logic, and submission behavior unchanged.
  - Verify with focused source tests, TypeScript, diff whitespace, build, and browser smoke if available.
- [x] Slice 5: Bulk direct-create limit feedback
  - Surface an inline error when bulk direct-create has more than 50 ready rows.
  - Match the existing bulk-invite limit pattern so disabled submit buttons always explain their blocker.
  - Keep the existing 50-row server/client limit and bulk-create payload unchanged.
  - Verify with focused source tests, TypeScript, diff whitespace, build, and browser smoke if available.
- [x] Slice 6: Direct-create handoff guidance tone cleanup
  - Render the pre-submit direct-create handoff note as neutral guidance instead of hardcoded green success styling.
  - Keep the handoff copy, direct-create payload, temporary-password behavior, and post-create profile transition unchanged.
  - Verify with focused source tests, TypeScript, diff whitespace, build, and authenticated browser smoke.
- [x] Slice 7: Onboarding completion success banner cleanup
  - Render the post-commit onboarding completion banner with the shadcn `Alert` primitive and semantic success tokens instead of hardcoded green utility classes.
  - Keep completion copy, sensitive temporary-password warning, action buttons, and all submit/result behavior unchanged.
  - Verify with focused source tests, TypeScript, diff whitespace, build, and authenticated browser smoke.
- [x] Slice 8: Allowed Emails toolbar metadata and action grouping
  - Give the status filter stable browser and accessibility metadata.
  - Keep `Onboard users` and `Status` grouped as workflow actions on the Settings allowlist page.
  - Keep allowlist filtering, onboarding dialog behavior, status link routing, and delete semantics unchanged.
  - Verify with focused source tests, TypeScript, migration check, diff whitespace, build, and authenticated browser smoke.
- [x] Slice 9: Schedule Assign user-picker load recovery
  - Stop treating failed `/api/users` reads as an empty assignment candidate list.
  - Show a retryable inline picker error when assignable users cannot be loaded.
  - Keep universal assignment, conflict review, slot add/remove, call-window editing, and schedule grid data contracts unchanged.
  - Verify with focused source tests, TypeScript, migration check, diff whitespace, safe app build, and authenticated browser smoke.
- [x] Slice 10: Schedule Assign filter metadata cleanup
  - Give Sport and Area assignment filters stable rendered browser/accessibility metadata.
  - Preserve month navigation, filter values, review filter, grid data, and assignment behavior.
  - Verify with focused source tests, TypeScript, migration check, diff whitespace, safe app build, and authenticated browser smoke.
- [x] Slice 11: Booking wizard event-list recovery
  - Stop treating failed booking-wizard event reads as the same state as no upcoming events.
  - Show an inline retryable calendar-event error while preserving the existing ad hoc booking escape path.
  - Preserve checkout/reservation creation payloads, multi-event selection, title/window/location derivation, draft behavior, and equipment flow.
  - Verify with focused source tests, TypeScript, migration check, diff whitespace, safe app build, and authenticated browser smoke.
- [x] Slice 12: Booking wizard kit-list recovery
  - Stop treating failed location-scoped kit reads as the same state as a location with no kits.
  - Show an inline retryable optional-kit error while preserving the ability to continue without a kit.
  - Preserve checkout/reservation creation payloads, true no-kit behavior, event/ad hoc context, draft behavior, and equipment flow.
  - Verify with focused source tests, TypeScript, migration check, diff whitespace, safe app build, and authenticated browser smoke.
- [x] Slice 13: Full Search item-title fallback
  - Stop full-page Search from rendering a blank item result title when item identity fields are sparse.
  - Match the quick palette's non-empty item-title behavior while preserving tag-first identity.
  - Preserve role-aware page destinations, partial-failure behavior, active booking search scope, and URL query state.
  - Verify with focused source tests, TypeScript, migration check, diff whitespace, safe app build, and authenticated browser smoke.
- [x] Slice 14: Quick Search item-title parity
  - Stop the command palette from falling back to `Untitled item` when item name, brand/model, or type is available but asset tag is missing.
  - Share the item-title fallback between quick search and the full Search page while preserving tag-first identity.
  - Preserve role-aware page destinations, partial-failure behavior, active booking search scope, and URL query state.
  - Verify with focused source/unit tests, TypeScript, migration check, diff whitespace, safe app build, and authenticated browser smoke.

## Review
- Shipped: `/users/onboarding-status` now uses shared `OperationalMetricCard` status metrics, a 40px header refresh action, a 40px retry action, explicit search/status filter names, and gray terminal `Claimed` badges. Settings > Allowed Emails now uses the same gray claimed status so terminal allowlist rows do not imply availability.
- Shipped: The shared onboarding dialog now renders Admin, Staff, and Student labels in direct-create confirmation, default-role preview, and temporary-password CSV exports instead of raw role enum values. The direct-create location retry control now meets the 40px target baseline. API payload role values are unchanged.
- Verified: `npx vitest run tests/onboarding-status-page-source.test.ts` passed 3 tests. `npx tsc --noEmit` passed. `npm run db:migrate:check` passed with 75 migrations and no prefix collisions. `git diff --check` passed. `npx next build` passed and generated 168 static pages, including `/users/onboarding-status` and `/settings/allowed-emails`.
- Verified: Slice 3 focused source coverage passed with `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts` (6 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Browser smoke on `http://localhost:3003/users/onboarding-status` and `http://localhost:3003/settings/allowed-emails` reached the expected unauthenticated `307 -> /login` redirect with no console errors and successful login asset requests. The temporary dev server was stopped and port 3003 was cleared.
- Shipped: The shared onboarding dialog now exposes stable browser form names for bulk invite rows, bulk invite role, single invite email, single invite role, bulk direct-create rows, default role, and default location. The single invite email field also exposes email autocomplete. Submission payloads, role defaults, preview checks, and bulk-create behavior are unchanged.
- Verified: Slice 4 focused source coverage passed with `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts` (7 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Browser smoke on `http://localhost:3003/users/onboarding-status` reached the expected `307 -> /login` redirect with no console errors. Browser smoke on `http://localhost:3003/settings/allowed-emails` reached the expected `307 -> /login` redirect with no console errors. The temporary dev server was stopped and port 3003 was cleared.
- Shipped: Bulk direct-create now shows an inline destructive alert when the ready account count exceeds 50, matching the disabled `Create accounts` state and the existing bulk-invite limit pattern. The row limit, payload, role defaults, and server behavior are unchanged.
- Verified: Slice 5 focused source coverage passed with `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts` (7 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke with the seeded admin opened `http://localhost:3003/settings/allowed-emails`, opened `Onboard users`, switched to `Create account` > `Bulk create`, pasted 52 valid student rows, and confirmed the visible alert `Reduce the batch to 50 ready accounts before creating.` with the submit button disabled. Console had no errors or warnings, and authenticated data endpoints returned 200.
- Shipped: The direct-create one-account handoff note now renders as a neutral shadcn alert with a key icon instead of hardcoded green success styling before submission. Temporary-password behavior, direct-create payloads, and post-create profile handoff behavior are unchanged.
- Verified: Slice 6 focused source coverage passed with `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts` (7 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://localhost:3003/settings/allowed-emails` opened `Onboard users`, switched to `Create account` > `One account`, and confirmed the guidance appears inside a visible alert. Console had no errors or warnings after a clean reload, and authenticated page/API reads returned 200. The temporary dev server was stopped and port 3003 was cleared.
- Shipped: The onboarding result banner now uses the shadcn `Alert` primitive with semantic green CSS tokens instead of hardcoded green utility classes. Completion titles, sensitive temporary-password warning copy, result counts, and follow-up buttons are unchanged.
- Verified: Slice 7 focused source coverage passed with `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts` (7 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://localhost:3003/settings/allowed-emails` opened `Onboard users`, submitted an already-allowlisted email through `Invite to register` > `One email`, and confirmed the completion banner appears as an alert using `var(--green-bg)` without `green-50` or `green-200` classes. Console had no errors or warnings, relevant page/API reads returned 200, and the skipped-invite submit rendered the expected completion state without adding a new allowlist row. The temporary dev server was stopped and port 3003 was cleared.
- Shipped: Settings > Allowed Emails now gives the status filter a stable rendered `id`, `name`, and accessible label, and keeps `Onboard users` plus `Status` in one workflow action group. Filtering, onboarding dialog behavior, status routing, table data, and delete semantics are unchanged.
- Verified: Slice 8 focused source coverage passed with `npx vitest run tests/onboarding-dialog-source.test.ts tests/onboarding-status-page-source.test.ts` (7 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. `npm run build` could not be completed in this sandbox because it attempted a remote Neon migration deploy and DNS failed; escalation for that mutating build path was rejected, so `npx next build` was used as the safe app build. Authenticated browser smoke on `http://localhost:3003/settings/allowed-emails` confirmed the combobox renders as `Allowed email status filter` with `id="allowed-email-status-filter"` and `name="allowedEmailStatusFilter"`, the `Onboard users` button and `/users/onboarding-status` link share the action group, console had no errors or warnings, and relevant page/API reads returned 200. The temporary dev server was stopped and port 3003 was cleared.
- Shipped: `/schedule/assign` no longer converts failed active-user reads into an empty assignment candidate list. The shared avatar picker now accepts a user-load error state and renders retryable inline recovery copy before assignment, while preserving universal assignment, conflict filters, slot add/remove actions, and call-window editors.
- Verified: Slice 9 focused source coverage passed with `npx vitest run tests/schedule-assign-source.test.ts` (1 test). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://localhost:3003/schedule/assign` loaded the route, Review filter, empty active-future-events state, `/api/calendar-events`, `/api/shift-groups`, and `/api/users` with 200 responses and no console errors or warnings. The local fixture had zero future assignment events, so the exact picker retry branch was covered by source test instead of browser-observed route state. The temporary dev server was stopped and port 3003 was cleared.
- Shipped: `/schedule/assign` now gives the Sport and Area filters stable rendered browser/accessibility identities with explicit `id`, `name`, and `aria-label` attributes on the shadcn select triggers. Month navigation, filter values, review filters, grid data, and assignment behavior are unchanged.
- Verified: Slice 10 focused source coverage passed with `npx vitest run tests/schedule-assign-source.test.ts` (2 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://127.0.0.1:3003/schedule/assign` confirmed the Sport combobox renders as `Assignment sport filter` with `id="assignment-sport-filter"` and `name="assignmentSportFilter"`, and the Area combobox renders as `Assignment area filter` with `id="assignment-area-filter"` and `name="assignmentAreaFilter"`. Route document, `/api/calendar-events`, `/api/shift-groups`, and `/api/users` returned 200. Console had no errors or warnings; only Fast Refresh logs appeared. Background dashboard notification/stat requests aborted during navigation, then reloaded with 200 responses.
- Shipped: Checkout and reservation creation now keep failed upcoming-event reads distinct from a true no-event list. Step 1 shows a destructive inline calendar-event recovery alert with `Retry events` and `Use ad hoc details`, while preserving the existing ad hoc escape path, multi-event selection, title/window/location derivation, drafts, equipment flow, and create payload contracts.
- Verified: Slice 11 focused source coverage passed with `npx vitest run tests/booking-wizard-event-context-source.test.ts` (1 test). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://127.0.0.1:3003/checkouts/new` loaded the true no-event state normally. A forced browser fetch override for `/api/calendar-events` on `http://127.0.0.1:3003/checkouts/new?failure-smoke=events` rendered the new inline alert and confirmed `Use ad hoc details` switches the page to Manual booking without leaving Step 1. Authenticated browser smoke on `http://127.0.0.1:3003/reservations/new` rendered the shared wizard normally; route document, `/api/calendar-events`, `/api/form-options`, `/api/drafts`, and `/api/kits` returned 200 after expected React dev duplicate-request aborts. Console had no errors or warnings.
- Shipped: Checkout and reservation creation now keep failed location-scoped kit reads distinct from a true no-kit location. Step 1 shows a destructive inline optional-kit recovery alert with `Retry kits` and explicit continue-without-kit copy, while preserving true no-kit behavior, event/ad hoc context, drafts, equipment flow, and create payload contracts.
- Verified: Slice 12 focused source coverage passed with `npx vitest run tests/booking-wizard-kit-fetching-source.test.ts` (1 test). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://localhost:3003/checkouts/new` rendered the normal Kit select. A forced browser fetch override for `/api/kits` on `http://localhost:3003/checkouts/new?failure-smoke=kits` rendered `Could not load kits for this location. You can still continue without selecting a kit.` plus `Retry kits`, and the Step 1 `Next` action remained available. Authenticated browser smoke on `http://localhost:3003/reservations/new` rendered the shared wizard normally; route document, `/api/calendar-events`, `/api/form-options`, `/api/drafts`, and `/api/kits` returned 200 after expected React dev duplicate-request aborts. Console had no errors or warnings.
- Shipped: Full-page Search now keeps item result titles non-empty when sparse item identity data reaches the result mapper. It falls back through asset tag, item name, brand/model, type, and `Untitled item`, matching the quick palette's non-empty title behavior while preserving tag-first priority.
- Verified: Slice 13 focused source coverage passed with `npx vitest run tests/search-page-source.test.ts tests/search-pages.test.ts` (4 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://localhost:3003/search?q=fx3` rendered normal item results. A forced browser fetch override for `/api/assets` on `http://localhost:3003/search?q=sparse-fallback` returned one sparse item with no tag, name, brand, model, type, or location, and the page rendered `Untitled item` with its status badge instead of a blank result title. Console had no errors or warnings; normal search fan-out endpoints returned 200 after expected React dev duplicate-request aborts.
- Shipped: Quick Search and full-page Search now share the same item title helper, keeping tag-first identity while falling back through item name, brand/model, type, and `Untitled item` on both surfaces.
- Verified: Slice 14 focused coverage passed with `npx vitest run tests/search-result-title.test.ts tests/search-page-source.test.ts tests/search-pages.test.ts tests/app-shell-search-source.test.ts` (10 tests). `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` all passed. Authenticated browser smoke on `http://localhost:3003/?quick-search-sparse=2` used a forced `/api/assets` response with no asset tag and the fallback name `quick-sparse Camera Name`; the command palette rendered that name under Items with an Available badge instead of `Untitled item`. Console had no errors or warnings, and the non-overridden search endpoints returned 200 after expected React dev duplicate-request aborts.
- Deferred: Broader end-to-end commit smoke for creating or inviting real accounts is intentionally not part of this UI-only slice, because this change only adds client-side over-limit recovery copy and does not alter submit payloads or API behavior.
