# Desloppify Backlog

Review date: 2026-06-22

Scope: initial review of the current Wisconsin Creative repo, with cleanup execution tracked as tasks are selected. All items were completed or converted into standing maintenance policy on 2026-06-22.

Verification run:

- Initial scan: `npm run lint -- --max-warnings=0` passed.
- C1 execution: focused venue mapping Vitest, TypeScript, docs/codemap check, migration prefix check, diff whitespace check, and `npm run build:app` passed.
- C2 execution: focused booking action Vitest, TypeScript, docs/codemap check, migration prefix check, diff whitespace check, and `npm run build:app` passed.
- C3 execution: focused missing-gap route Vitest, category cleanup wizard source-contract Vitest, TypeScript, docs/codemap check, migration prefix check, diff whitespace check, and `npm run build:app` passed.
- M1 closeout: current oversized-source watchlist reviewed, touched-hotspot extraction verified, docs/codemap check, migration prefix check, and diff whitespace check passed.
- M2 execution: focused booking status label Vitest, TypeScript, docs/codemap check, migration prefix check, diff whitespace check, and `npm run build:app` passed.
- M3 execution: test inventory commands, docs/codemap check, migration prefix check, and diff whitespace check passed.
- M4 execution: focused hook escape-hatch source-contract Vitest, TypeScript, codemap regeneration/docs check, migration prefix check, diff whitespace check, and `npm run build:app` passed.
- N1 execution: codemap regeneration, docs/codemap check, migration prefix check, and diff whitespace check passed.
- N2 execution: focused decision-contract Vitest, TypeScript, docs/codemap check, migration prefix check, diff whitespace check, and `npm run build:app` passed.
- N3 execution: documentation navigation updates, docs/codemap check, migration prefix check, and diff whitespace check passed.
- N4 execution: focused equipment-picker render-split source-contract Vitest, TypeScript, codemap regeneration/docs check, migration prefix check, diff whitespace check, and `npm run build:app` passed.

Sources reviewed:

- `AGENTS.md`
- `README.md`
- `package.json`
- `prisma/schema.prisma`
- `docs/DECISIONS.md`
- `docs/GAPS_AND_RISKS.md`
- `docs/AREA_SETTINGS.md`
- `docs/AREA_EVENTS.md`
- `docs/TESTING.md`
- `plans/README.md`
- `tasks/todo.md`
- Key source files and tests cited per backlog item below.

## 1. Critical Issues

### C1. Enforce the D-027 venue mapping contract — Done 2026-06-22

- **Where:** `docs/DECISIONS.md` D-027; `src/app/api/location-mappings/route.ts`; `src/lib/services/calendar-sync.ts`; `src/lib/permissions.ts`; `docs/AREA_SETTINGS.md`; `docs/GAPS_AND_RISKS.md`
- **Evidence:** D-027 says venue mappings are admin-owned, pattern validation must reject invalid regexes with 400, and equal-priority matches must prefer the longest pattern. The current create schema only checks `pattern: z.string().min(1)`, the list route has no role or permission check, sync still catches invalid regexes and falls back to substring matching, and both list/sync ordering use only `priority: "desc"`.
- **Why it matters:** Venue mappings feed calendar event location and home/neutral classification. A malformed or broad pattern can silently misclassify events, which then bleeds into schedule staffing, pickup location context, and data-quality review. The docs say this is already solved, so future agents will trust a contract the code does not fully enforce.
- **Recommended change:** Add shared server validation for mapping patterns. Reject invalid regexes before insert. Align `location_mapping.view` and `GET /api/location-mappings` with the intended admin-only policy, or explicitly revise the docs if broader read access is intentional. Make matching deterministic by sorting equal-priority mappings by longer pattern first, either in SQL or in memory. Add route tests for admin-only read, invalid regex rejection, and longest-pattern tie-breaking.
- **Status:** Completed. `GET /api/location-mappings` now requires ADMIN, create rejects invalid regex patterns, venue mapping ordering uses priority plus longest pattern, and sync/audit matching no longer falls back to substring matching for invalid regexes.
- **Safe to fix now:** Done.

### C2. Remove stale client-side booking action policy — Done 2026-06-22

- **Where:** `src/lib/booking-actions.ts`; `src/lib/services/booking-rules.ts`; `src/components/booking-list/BookingContextMenu.tsx`; `tests/checkout-actions-client.test.ts`; `tests/checkout-rules.test.ts`; `docs/DECISIONS.md` D-040
- **Evidence:** `src/lib/booking-actions.ts` says it mirrors the server-side rules, but it allows `checkin` on `OPEN` checkouts for staff and owners. The server-side `src/lib/services/booking-rules.ts` denies app/web `checkin` because returns are kiosk-only. The client test currently asserts the stale behavior.
- **Why it matters:** This is exactly the kind of duplication that becomes a bug later. The current menu only renders actions present in `contextMenuExtras`, so the stale `checkin` rule is not obviously visible today, but the next booking affordance can accidentally expose an action the server rejects.
- **Recommended change:** Stop maintaining a second action matrix for booking lists. Prefer server-returned `allowedActions` in list responses, or extract a shared pure policy helper used by both server and client tests without importing database code. Update `tests/checkout-actions-client.test.ts` to assert kiosk-only return behavior.
- **Status:** Completed. App/web booking list actions and server booking rules now use a shared DB-free action policy. OPEN checkouts no longer return `checkin` from the client helper, and focused tests assert kiosk-only return behavior.
- **Safe to fix now:** Done.

### C3. Bound the missing-category and missing-department cleanup queries — Done 2026-06-22

- **Where:** `src/app/api/assets/route.ts`; `src/app/(app)/items/gap-wizard-dialog.tsx`; `docs/AREA_ITEMS.md`; Vercel timeout rules in `AGENTS.md`
- **Evidence:** The `/api/assets?missing=category|department` branch fetches all matching assets and all matching bulk SKUs, builds suggestions, then slices in memory. Category suggestions also scan up to 5,000 categorized asset and bulk rows. The app is deployed to Vercel serverless, where API routes need to stay fast.
- **Why it matters:** This works at current inventory size, but it will become painful as migrated inventory grows. Cleanup flows are exactly the kind of admin workflow operators run when data is already messy, so timing out there creates a bad recovery path.
- **Recommended change:** Push pagination and caps into the initial asset and bulk queries. Return explicit `truncated` or `suggestionsLimited` metadata when suggestion sampling is capped. Add focused tests for pagination, total counts, and suggestion behavior.
- **Status:** Completed. The missing-field API now counts standard assets and bulk SKUs separately, fetches only the requested cleanup page from each source, returns `truncated` and `suggestionsLimited` metadata, and the Gap Wizard surfaces capped suggestion matching.
- **Safe to fix now:** Done.

## 2. Medium Cleanup Items

### M1. Split the largest ownership files only when their area is next touched — Policy Closed 2026-06-22

- **Where:** `src/app/(app)/items/[id]/ItemInfoTab.tsx`; `src/app/(app)/users/[id]/UserInfoTab.tsx`; `src/app/(app)/schedule/_components/ListView.tsx`; `src/app/(app)/bulk-inventory/batteries/page.tsx`; `src/components/EquipmentPicker.tsx`; `src/lib/services/reports.ts`
- **Evidence:** Current line-count hotspots include `ItemInfoTab.tsx` at 1,594 lines, `UserInfoTab.tsx` at 1,324, `ListView.tsx` at 1,320, batteries page at 1,117, `EquipmentPicker.tsx` at 1,086, and `reports.ts` at 1,368.
- **Why it matters:** These files are not uniformly bad, but they concentrate unrelated responsibilities. That makes small changes slower to review and raises the chance of merge conflicts in this repo's multi-agent workflow.
- **Recommended change:** Do not do a blind split. For each next feature in one of these areas, first extract one stable sub-responsibility: form state, row rendering, status formatting, or data transformation. Keep tests and docs with the slice.
- **Status:** Policy closed. `docs/CODEMAPS/architecture.md` now maintains the oversized-source watchlist so these files stay visible without treating line count as a failure. The only listed hotspot touched during this backlog was `src/components/EquipmentPicker.tsx`; N4 extracted its selected-items shelf into a render-only component and pinned that boundary with source-contract coverage. The remaining hotspots should still wait for related area work before extraction.
- **Safe to fix now:** Done as policy plus touched-hotspot extraction.

### M2. Centralize booking status display helpers — Done 2026-06-22

- **Where:** `docs/DECISIONS.md` D-025; `src/components/booking-details/helpers.ts`; `src/components/booking-list/types.ts`; `src/app/(app)/items/[id]/ItemBookingsTab.tsx`
- **Evidence:** D-025 says all UI surfaces should use `statusLabel(status, kind)`. `ItemBookingsTab.tsx` has a local `bookingStatusLabel` with impossible legacy statuses such as `CHECKED_OUT`, `RETURNED`, `CONVERTED`, and `CLOSED`, which are not in the current `BookingStatus` enum. Booking list helpers also carry their own status-label logic.
- **Why it matters:** Display labels look harmless until a state transition changes. Then every local switch becomes a place where users see stale or contradictory language.
- **Recommended change:** Move booking status label plus badge color into one shared display helper, then migrate item history and booking list surfaces to it. Delete impossible branches. Add a small source-contract test that fails if `BookingStatus` labels are reintroduced locally.
- **Status:** Completed. Booking detail helpers, booking-list visual helpers, item booking overview/history, upcoming item reservations, and item schedule agenda rows now resolve display labels and badge/status colors through `src/lib/booking-status-display.ts`. The item tab no longer has a local booking status switch with legacy booking states, and source-contract coverage prevents reintroducing it.
- **Safe to fix now:** Done.

### M3. Refresh the testing guide and known-bug registry — Done 2026-06-22

- **Where:** `docs/TESTING.md`; `tests/`; `plans/README.md`
- **Evidence:** `docs/TESTING.md` said there were 327 tests across 22 files. The current repo has 242 `*.test.ts` files and 1,430 `it()` / `test()` declarations by static count. The same guide still listed known bug tests for issues that appear to have since become regression tests or been closed.
- **Why it matters:** Agents and maintainers use this doc to choose verification gates. Stale counts and stale bug labels create bad risk judgments, especially when deciding whether a task needs focused Vitest, TypeScript, app build, or browser smoke.
- **Recommended change:** Update the guide to describe current test layers, current helper patterns, and the distinction between "BUG:" regression names and open known bugs. Consider adding a generated or easily refreshed test inventory command.
- **Status:** Completed. `docs/TESTING.md` now lists the current static inventory, provides refresh commands, distinguishes service/route/source-contract/iOS/regression layers, clarifies focused and closeout gates, and replaces the stale known-bugs table with live `BUG:` discovery guidance. `plans/README.md` now labels older testing counts as historical snapshots.
- **Safe to fix now:** Done.

### M4. Trim hook dependency suppressions and type escape hatches opportunistically — Done 2026-06-22

- **Where:** `src/hooks/use-last-audit.ts`; `src/hooks/useBookingDetail.ts`; `src/components/create-booking/use-event-context.ts`; `src/components/BookingListPage.tsx`; `src/components/booking-wizard/BookingWizard.tsx`; `src/components/equipment-picker/use-conflict-check.ts`; `src/app/(app)/items/[id]/page.tsx`; `src/app/(app)/notifications/page.tsx`; `src/app/(app)/items/hooks/use-items-query.ts`
- **Evidence:** The source still has several `eslint-disable react-hooks/exhaustive-deps` comments and response transforms using `as unknown as ...` in route-facing hooks.
- **Why it matters:** Some suppressions are probably intentional, but they become invisible over time. The danger is not lint cleanliness. The danger is stale closures and unchecked response-shape drift in pages that fetch operational data.
- **Recommended change:** For each touched hook, either remove the suppression by stabilizing callbacks/deps, or add a short rationale comment that names the invariant. Replace route-response casts with narrow parser functions or Zod where the endpoint shape is volatile.
- **Status:** Completed as a small source-contract/rationale pass. Avoidable dependency suppressions were removed from cache update callbacks and URL/keyed effects. Remaining derived-key suppressions in the touched target set now carry rationale comments, and `tests/hook-escape-hatches-source.test.ts` prevents undocumented suppressions from returning in the M4 target files. Broader `as unknown as` component adapter casts were left for a future type-normalization slice.
- **Safe to fix now:** Done.

### M5. Clarify `location_mapping.view` policy — Covered by C1 2026-06-22

- **Where:** `src/lib/permissions.ts`; `src/app/api/location-mappings/route.ts`; `tests/venue-mapping-audit-route.test.ts`; `docs/DECISIONS.md`; `docs/AREA_SETTINGS.md`
- **Evidence:** The audit route rejects non-admin users, but `PERMISSIONS.location_mapping.view` allows all roles and the main list route does not call `requirePermission` at all. The docs call Venue Mappings admin-only.
- **Why it matters:** This may be harmless operational metadata, but policy ambiguity is how authorization drift starts. The newer diagnostic endpoint and older list endpoint should not disagree.
- **Recommended change:** Decide whether read access is admin-only. If yes, set `location_mapping.view` to `["ADMIN"]`, call `requirePermission` in `GET /api/location-mappings`, and add tests. If no, update the docs to say mutation is admin-only while read is broader.
- **Status:** Covered by C1. The policy decision is admin-only read access; `location_mapping.view` and `GET /api/location-mappings` now enforce ADMIN access with route coverage.
- **Safe to fix now:** Done.

## 3. Nice-To-Have Polish

### N1. Create a lightweight oversized-file watchlist — Done 2026-06-22

- **Where:** `scripts/generate-codemaps.mjs`; `docs/CODEMAPS/`; `tasks/todo.md`
- **Evidence:** The repo already uses codemaps and docs checks. Large files have historically been tracked manually in gaps and audit notes.
- **Why it matters:** This repo benefits from seeing drift early. A small generated "top 20 largest TS/TSX files" section would make size creep visible without treating line count as a hard failure.
- **Recommended change:** Add an optional codemap section or script output for largest files and recent churn hotspots. Keep it informational.
- **Status:** Completed. `scripts/generate-codemaps.mjs` now adds an informational top-20 TypeScript/TSX source file watchlist to `docs/CODEMAPS/architecture.md`, with explicit copy that line count is not a failure threshold.
- **Safe to fix now:** Done.

### N2. Add source-contract tests for "documented decisions that must stay true" — Done 2026-06-22

- **Where:** `docs/DECISIONS.md`; `tests/*source*.test.ts`; `tests/api-route-wrapper-contract.test.ts`
- **Evidence:** The repo already has source-contract tests for route wrappers, iOS contracts, schedule source truth, and public route abuse controls. D-027 and D-025 drifted because their decision text was stronger than the current tests.
- **Why it matters:** This codebase has many accepted decisions. The ones that matter most should fail fast when code drifts.
- **Recommended change:** Add a small `tests/decision-contracts.test.ts` for high-value decisions only: D-025 status-label ownership, D-027 venue mapping validation, D-040 kiosk-only custody boundaries.
- **Status:** Completed. `tests/decision-contracts.test.ts` now pins D-025 status-label mapping/overdue visuals, D-027 regex validation/no invalid-regex fallback/admin-only venue mapping policy, and D-040 app/web reservation-first custody boundaries.
- **Safe to fix now:** Done.

### N3. Reconcile historical plan files with the active task queue — Done 2026-06-22

- **Where:** `plans/README.md`; `tasks/todo.md`; `tasks/archive/`
- **Evidence:** `plans/README.md` is explicitly historical and complete. `tasks/todo.md` remains the active ledger with many recent completed slices.
- **Why it matters:** Future agents can waste time reading old completed plans before finding the current task queue. This is not broken, but it slows orientation.
- **Recommended change:** Add a short top note to `plans/README.md` or `tasks/INDEX.md` that says where active work lives now and when to consult historical plans.
- **Status:** Completed. `plans/README.md` now opens as a historical improve-plan registry and points current work to `DESLOPPIFY.md`, `tasks/todo.md`, and `tasks/INDEX.md`. `tasks/INDEX.md` now has a start-here note separating active backlog execution from historical plan context.
- **Safe to fix now:** Done.

### N4. Keep `EquipmentPicker` splits incremental — Done 2026-06-22

- **Where:** `src/components/EquipmentPicker.tsx`; `src/components/equipment-picker/*`; `src/lib/equipment-sections.ts`
- **Evidence:** `EquipmentPicker.tsx` is still 1,086 lines, but it already has extracted hooks for search, conflict checks, and quantity recovery.
- **Why it matters:** A full rewrite is not warranted. The next pain point will likely be render readability and scan/selection state coupling.
- **Recommended change:** When the picker is next touched, extract render-only pieces such as selected shelf, scanner panel, and section list rows. Leave the data hooks alone unless a bug requires changing them.
- **Status:** Completed as an incremental render-only split. The selected-items shelf now lives in `src/components/equipment-picker/SelectedEquipmentShelf.tsx`; `EquipmentPicker.tsx` still owns search, scan lookup, availability checks, section data, and selection state. `tests/equipment-picker-render-split-source.test.ts` pins that the extracted shelf remains presentational.
- **Safe to fix now:** Done.

## Recommended Next Task

No DESLOPPIFY backlog items remain open. Future large-file work should start from the generated oversized-source watchlist and extract one stable responsibility only when the related area is already being changed.
