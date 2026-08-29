# Design Language Goal Plan

## Objective

Work through the remaining Wisconsin Creative design-language backlog in order, keeping the system practical for an internal operations app: dense, calm, fast, accessible, and consistent with shadcn/ui.

## Ordered Backlog

1. [x] Authenticated visual proof for changed operational surfaces
   - Target changed surfaces first: `/events/[id]` travel roster, `/items/[id]` scan identity, and item image search.
   - Then cover the main operational surfaces named in `docs/DESIGN_LANGUAGE.md`: dashboard, items, users, scan, settings, booking creation, Fix Today, and Hygiene.

2. [x] Remaining sub-40px and hover-only modal/dialog control sweep
   - Search dense dialogs, sheets, popovers, and modal interiors for icon-only controls below the operational 40px baseline.
   - Patch only controls that users can reasonably click/tap, not decorative or table-density text.

3. [x] Route-by-route conformance checklist
   - Create a checklist for major routes: header, toolbar, filters, row actions, empty states, target size, focus, status color, and copy.
   - Apply first to Dashboard, Schedule, Items, Bookings, Users, and Settings.

4. [x] Settings consistency follow-through
   - Keep Settings pages on `SettingsPageShell`, shared inline empty states, and `OperationalRowActions`.
   - Identify pages still carrying route-local shells or inconsistent controls.

5. [x] State and copy audit
   - Normalize success, error, warning, empty, confirmation, and admin-warning copy.
   - Keep copy operational and specific: what happened, what is blocked, and what the operator can do next.

6. [x] Shared component consolidation
   - Continue replacing page-local versions of filter shells, active chips, partial-results warnings, metric cards, empty rows, and row action menus.
   - Update `docs/DESIGN_LANGUAGE.md` when a pattern becomes required.

## Current Slice

- Area 6: Shared component consolidation.
- Status: complete.
- Area 1 note: authenticated browser proof now works when `next dev` is started with the working `.env` Neon URL overriding stale `.env.development.local` values. The stale development-local database host still needs cleanup outside this slice.
- Area 2 note: patched and verified.
- Immediate goal: inspect every Settings sub-page for `SettingsPageShell`, shared inline empty states, `OperationalRowActions`, destructive confirmation copy, and sub-40px controls.
- Patched shared `Dialog`, `Sheet`, and `Drawer` close controls to use visible 40px dismiss targets.
- Patched shared booking `EquipmentPicker` controls that were still 28-32px or 24px text buttons: search clear, scanner close, select-visible, clear-section, bulk steppers, selected-shelf removals, and clear-all.
- Patched `ShiftSlotCard` card-interior actions that were still 32-36px: remove shift, attendance, approve/decline requests, and student request.

## Verification Standard

- `npx tsc --noEmit`
- `npm run db:migrate:check`
- `git diff --check`
- `npx next build`
- Browser smoke with signed-in visual proof when credentials and seeded data are available.

## Review

- 2026-05-21: Started Area 1 on `localhost:3014`. Local login with the documented seed admin reached `/api/auth/login`, but Prisma returned `P1000` database authentication failure before a session could be created. The only existing `localhost:3000` browser page was a different app, so it could not be used as Wisconsin Creative evidence. Area 1 remains open until valid local or authenticated browser access is available.
- 2026-05-21: Area 2 patch pass moved shared overlay close buttons, `EquipmentPicker` dense actions, and `ShiftSlotCard` dense staffing actions to the 40px operational target baseline. `npx tsc --noEmit`, `npm run db:migrate:check`, `git diff --check`, and `npx next build` passed. Browser smoke on `localhost:3014/login` confirmed the login form renders and the attempted local admin login still returns the documented `/api/auth/login` 500, so authenticated visual proof remains blocked.
- 2026-05-21: Area 1 unblocked. Root cause was `.env.development.local` pointing `DATABASE_URL` at a different Neon host than the working `.env`; starting `next dev` with quote-stripped `.env` `DATABASE_URL` and `DIRECT_URL` produced a successful `POST /api/auth/login` as `admin@creative.local`. Authenticated Chrome proof captured with no console errors for dashboard, items, users, scan, settings, checkout creation, Fix Today, Hygiene, item scan identity, item image modal, and event detail. Screenshot evidence: `tasks/design-language-proof-dashboard.png`, `tasks/design-language-proof-items.png`, `tasks/design-language-proof-users.png`, `tasks/design-language-proof-scan.png`, `tasks/design-language-proof-settings.png`, `tasks/design-language-proof-checkout-new.png`, `tasks/design-language-proof-fix-today.png`, `tasks/design-language-proof-hygiene.png`, `tasks/design-language-proof-item-scan-identity.png`, `tasks/design-language-proof-item-image-modal.png`, `tasks/design-language-proof-event-full.png`, and `tasks/design-language-proof-event-crew-actions.png`.
- 2026-05-21: Area 3 route-by-route checklist created at `tasks/design-language-route-conformance-checklist.md`. Dashboard, Schedule, Items, Bookings, Users, and Settings were checked against header, toolbar/filter, row-action, empty/error/loading, target/focus, status/color, and copy rules. No immediate code fix was required from the checklist itself. Next slice is Area 4 Settings sub-page follow-through.
- 2026-05-21: Area 4 Settings consistency follow-through patched the remaining high-confidence Settings drift: Extend Presets remove/add/input targets, Kiosk pending-pickup/copy/cancel targets and empty dialog state, Allowed Emails add-mode target/focus/pressed semantics, and Database initial empty state. Verified with TypeScript, migration-prefix check, whitespace check, production build, and authenticated Chrome smoke on the touched Settings routes. Tracking lives in `tasks/settings-consistency-follow-through-plan.md`. Next slice is Area 5 state and copy audit.
- 2026-05-21: Area 5 state and copy audit patched high-traffic daily-flow copy in dashboard draft recovery, booking detail custody actions, and shift detail staffing actions. Messages now name the affected object, consequence, and whether the attempted action saved or rolled back. Tracking lives in `tasks/design-language-state-copy-audit-plan.md`. Next slice is Area 6 shared component consolidation.
- 2026-05-21: Area 6 shared-component consolidation patched Bookings filters onto `OperationalToolbar`, added shared active-filter chips, and raised shared removable filter controls to the 40px target baseline. TypeScript, migration-prefix, whitespace, production build, and authenticated Chrome smoke for Bookings, Items, and Users passed with no console errors. Screenshot evidence includes `tasks/design-language-proof-bookings-area6.png`, `tasks/design-language-proof-bookings-filter-chip-area6.png`, `tasks/design-language-proof-items-filter-chip-area6.png`, and `tasks/design-language-proof-users-filter-chip-area6.png`.
