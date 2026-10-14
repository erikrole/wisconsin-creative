# Ops Page Consolidation Plan - 2026-07-12

## Scope

Merge the three Operations sidebar queues — Fix Today (`/admin/fix-today`), Hygiene (`/items/hygiene`), and the Battery Ops entry — into one calm `/ops` dashboard that routes attention instead of acting as a control panel. Battery Ops keeps its URL and all cockpit tooling; it is summarized on `/ops` and demoted from the sidebar.

## Findings

- Fix Today and Hygiene are the same read-only pattern (checks with counts, sample records, and repair links) with near-identical card components and both already use `OperationalStatusRail` / `OperationalMetricCard`.
- Battery Ops is an interactive mutation cockpit (~1,300 lines) and should not be inlined into a dashboard.
- The low-batteries check is triplicated: Fix Today `low-batteries`, Hygiene `low-bulk-stock`, and Battery Ops itself. The merged page keeps one.
- Roles differ: Fix Today is ADMIN-only, Hygiene is staff. The merged page renders the hygiene lane + battery summary for staff and adds the admin lane only for ADMIN.

## Design principles

- One merged status rail at the top; collapses to a single "All clear" line when clean.
- Needs-work-only by default; clean checks fold into one expandable summary line.
- Two lanes, severity-sorted: "Run the day" (operational checks) and "Keep data clean" (hygiene checks).
- One compact battery summary card (available / checked out / missing / low families) linking to Battery Ops.
- No charts, no new analytics. Silence when nothing is wrong is the feature.

## Slices

- [x] Slice 1 — Normalize the data. Shared `OpsCheck` type + adapters that map both existing API payloads (`/api/admin/fix-today`, `/api/inventory-hygiene`) into one shape, dropping the duplicate hygiene `low-bulk-stock` check at normalize time. Focused unit coverage. No page changes yet.
- [x] Slice 2 — Build `/operations` (renamed from `/ops` per owner direction). Parallel fetch of the two feeds (role-gated), shared queue card (based on Fix Today's `QueueSectionCard`), merged rail, needs-work default with clean-checks fold, battery summary card from existing battery totals.
- [x] Slice 3 — Rewire navigation. Sidebar Operations group becomes Ops / Kits / Reports; redirects from `/admin/fix-today` and `/items/hygiene`; `/bulk-inventory/batteries` stays live but leaves the sidebar; update `src/lib/search-pages.ts`.
- [x] Slice 4 — Clean up. Delete the orphaned old page code (redirect stubs stay); docs sweep; codemap regeneration. (Affected contract tests were already repointed in slice 3; `admin-fix-today-service` and `battery-ops-repair-source` needed no changes since their APIs are unchanged.)

## Review

- 2026-07-12: Slice 4 shipped. Deleted the orphaned `FixTodayClient.tsx` (the redirect stubs at `/admin/fix-today` and `/items/hygiene` remain as the permanent route aliases). Docs sweep: AREA_DASHBOARD (AC-14 + change-log entry), AREA_ITEMS (Inventory Hygiene section + change-log entry), DESIGN_LANGUAGE route-conformance bullets now name `/operations`; codemaps regenerated via `npm run codemap`. Verification: `npx tsc --noEmit`, `npm run verify:docs`, `git diff --check`, full `npx vitest run` (2029 passed; only the pre-existing unrelated `ios-forced-password` failure remains), `npm run build:app`. Remaining follow-ups: authenticated browser proof of `/operations` across ADMIN and STAFF roles, and the optional lighter battery-totals endpoint.
- 2026-07-12: Slice 3 shipped. Sidebar Operations group is now Operations / Kits / Reports (Fix Today, Battery Ops, and Hygiene entries removed). `/admin/fix-today` and `/items/hygiene` are server redirects to `/operations`. `search-pages.ts` replaces the Hygiene and admin-only Fix Today entries with one staff Operations entry (keywords cover the old names) and keeps Battery Ops searchable since it left the sidebar. Contract tests repointed from the old page sources to `OperationsClient` plus a new redirect assertion; hygiene removed from `items-response-parsing` fetch-path list. Verification: `npx tsc --noEmit`, eslint on touched files, full `npx vitest run` (2029 passed; the single failure, `tests/ios-forced-password.test.ts`, is pre-existing — it also fails at clean HEAD with local changes stashed and reads iOS Swift files untouched by this work), `npm run build:app` (routes `/operations`, `/admin/fix-today`, `/items/hygiene` all compile). Docs sweep (AREA_ITEMS, AREA_DASHBOARD, DESIGN_LANGUAGE, CODEMAPS) deferred to slice 4 alongside file deletion.
- 2026-07-12: Slice 2 shipped. `/operations` (label "Operations") renders a merged status rail with all-clear collapse, a partial-data alert, a compact battery summary card linking to Battery Ops, and two lanes ("Run the day" admin-only via `enabled: isAdmin` on `useFetch`; "Keep data clean" for staff). Needs-work checks render as cards; clean checks fold into a collapsible one-line summary per lane. Server wrapper gates to ADMIN/STAFF and passes `isAdmin`. Battery summary reuses `/api/bulk-skus/batteries` totals — payload is heavier than a summary needs; a lighter totals endpoint is an optional follow-up. Verification: `npx tsc --noEmit`, `npx eslint src/app/(app)/operations`, `npx vitest run tests/search-pages.test.ts tests/ops-checks.test.ts`, `npm run build:app` (route `/operations` compiled). Authenticated browser proof not yet run; recommended alongside slice 3 nav rewiring.
- 2026-07-12: Slice 1 shipped. `src/lib/ops-checks.ts` defines the shared `OpsCheck` shape plus `normalizeFixTodayQueue`, `normalizeHygieneQueue` (drops the duplicate `low-bulk-stock` check and attaches severity/repair routing from `HYGIENE_CHECK_META`), `sortOpsChecks`, and `summarizeOpsChecks`. Pure functions, no DB access, no page changes. Verification: `npx vitest run tests/ops-checks.test.ts` (8 passing), `npx tsc --noEmit`, `git diff --check`.
