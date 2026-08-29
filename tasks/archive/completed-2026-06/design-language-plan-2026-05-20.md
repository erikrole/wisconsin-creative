# Wisconsin Creative Design Language Plan - 2026-05-20

## Goal
- Build a practical UI/UX system for Wisconsin Creative that keeps future work cohesive, fast, dense, calm, and operationally clear without turning into a brand refresh.

## Source Checks
- `docs/NORTH_STAR.md` defines the product as an event-driven operations layer where speed, clarity, trust, mobile-first workflows, tag-first identity, and accountable custody matter more than feature breadth.
- `docs/COLOR_SYSTEM.md` defines semantic status color rules: green means available/free, blue active use, purple reserved/claimed, red urgent/problem/destructive, orange warning/waiting, gray inactive/terminal.
- `docs/AREA_DASHBOARD.md` defines the dashboard as an action console, not a reporting page, with overdue, checkouts, pending pickup, stale reservations, reservations, personal custody, and drafts as the core order.
- `docs/AREA_ITEMS.md` defines tag-first item identity, derived status, item-family rows, action-oriented list/detail surfaces, and the Inventory Hygiene read-only cleanup queue.
- `docs/AREA_USERS.md` defines role-adaptive UI: students can view broadly but only mutate owned booking work, staff/admin can operate globally.
- Current code already has shadcn/ui primitives in `src/components/ui/`, global tokens in `src/app/globals.css`, `PageHeader`, `EmptyState`, app shell search/navigation, Items table patterns, Users filters, Settings control map, Fix Today, and Inventory Hygiene.

## Audit Ledger
- [x] Status/severity consistency: pending pickup and handoff states should read as waiting/pending, not available/clean.
- [x] Accessibility baseline: icon-only and tiny inline controls need consistent labels, focus, and 40-44px hit targets.
- [x] Page structure consistency: Settings and Scan should use or intentionally mirror the shared header rhythm.
- [x] Operational primitive extraction: metric strips, queue cards, partial-results alerts, filter toolbars, and row-action menus should converge.
- [x] Content standards: create/edit/delete/recover workflows need consistent labels, helper text, error text, and confirmation language.
- [x] Verification matrix: desktop/mobile smoke across dashboard, items, users, settings, scan, booking creation, Fix Today, and Hygiene.

## Slices
- [x] Slice 1: Status and accessibility quick wins
  - [x] Fix pending-pickup accent language.
  - [x] Fix checkout confirmation handoff tone.
  - [x] Bring scan and inline save controls up to minimum target sizes.
  - [x] Record the design rules these fixes imply.
- [x] Slice 2: Shared operational feedback primitives
  - [x] Extract or standardize partial-results alerts.
  - [x] Align Fix Today and Inventory Hygiene metric/card severity language.
- [x] Slice 3: Shared list/filter/page structure
  - [x] Normalize filter toolbar behavior from Items and Users.
  - [x] Normalize Settings and Scan header rhythm against `PageHeader`.
- [x] Slice 4: Durable docs
  - [x] Add `docs/DESIGN_LANGUAGE.md`.
  - [x] Cross-link from relevant AREA docs and update this plan review.
- [x] Slice 5: Shared active-filter chips
  - [x] Extract a shared active-filter chip row for operational toolbars.
  - [x] Add removable active chips to Items filters.
  - [x] Move Users removable chips onto the shared component.
- [x] Slice 6: Shared row-action menu trigger
  - [x] Extract a shared operational row-action dropdown trigger.
  - [x] Move Items table row actions onto the shared trigger.
  - [x] Move Settings Categories row actions onto the shared trigger.
- [x] Slice 7: Inline operational empty states
  - [x] Add inline sizing to the shared `EmptyState`.
  - [x] Move Settings Categories local empty rows onto shared inline empty states.
  - [x] Move Settings Departments local empty rows onto shared inline empty states.

## Verification
- [x] `npx tsc --noEmit`
- [ ] Focused tests if shared helpers are added
- [x] `git diff --check`
- [x] Browser smoke for changed routes
- [x] `npx next build` before ship

## Review
- Shipped: Slice 1 corrected pending-pickup waiting semantics, checkout handoff copy, scan control target sizes, and shared inline save/cancel targets. Slice 2 added shared operational metric and partial-results warning primitives, then wired them into Fix Today and Inventory Hygiene. Slice 3 added the shared `OperationalToolbar`, moved Items and Users onto it, and put Scan on `PageHeader`. Slice 4 added `docs/DESIGN_LANGUAGE.md` and cross-linked the active area docs. Slice 5 added shared active-filter chips and aligned Items plus Users filter recovery behavior. Slice 6 added a shared row-action dropdown trigger and moved Items plus Settings Categories onto it. Slice 7 added inline shared empty states and moved Settings Categories plus Departments onto them.
- Verified: Slice 1 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`; browser smoke reached the protected `/scan` route and cleanly redirected to `/login` with no console errors. Slice 2 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`; protected-route browser smoke reached `/admin/fix-today` and `/items/hygiene`, redirected to `/login`, and showed no browser console errors. Slice 3 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`; protected-route browser smoke reached `/items`, `/users`, `/scan`, and `/settings`, redirected to `/login`, and showed no browser console errors. Slice 4 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`. Slice 5 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`; protected-route browser smoke reached `/items` and `/users`, redirected to `/login`, and showed no console errors. Slice 6 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`; protected-route browser smoke reached `/items` and `/settings/categories`, redirected to `/login`, and showed no console errors. Slice 7 passed `npx tsc --noEmit`, `git diff --check`, and `npx next build`; protected-route browser smoke reached `/settings/categories` and `/settings/departments`, redirected to `/login`, and showed no console errors.
- Deferred: Authenticated visual inspection of `/scan`, `/dashboard`, and booking creation remains for a broader browser pass with a signed-in session.
