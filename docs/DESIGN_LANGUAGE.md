# Wisconsin Creative Design Language

## Document Control
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-23
- Status: Active
- Purpose: Define the UI and UX rules that keep Wisconsin Creative cohesive, fast, dense, calm, and operationally clear.

## Highest-Impact Findings
1. Wisconsin Creative already has the right foundation: shadcn/ui primitives, semantic status colors, `PageHeader`, tag-first item identity, role-aware navigation, and operational queue surfaces.
2. The drift is route-level: pages solve the same problems with slightly different headers, metric cards, partial-result warnings, filter shells, and state copy.
3. Green misuse is the easiest trust bug to introduce. Green means available/free. Waiting, pending, maintenance, and pickup handoff states are orange.
4. Small icon controls are operational risk, not polish debt. Every action target needs a real label, visible focus, and at least a 40px target on web.
5. Future work should standardize shared surfaces before inventing page-local UI. Prefer `PageHeader`, `DetailPageHeader`, `OperationalToolbar`, `OperationalStatusRail`, `OperationalMetricCard`, `OperationalPartialResultsAlert`, `Badge`, `Button`, `Input`, `Select`, `ToggleGroup`, `Switch`, `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `Table`, and `Card`.

## Product Personality
Wisconsin Creative should feel:
1. **Operational**: every screen should answer what needs action, who owns it, and where to go next.
2. **Dense but readable**: favor compact rows, clear grouping, and restrained spacing over large promotional panels.
3. **Calm under pressure**: urgent work is obvious, but the app should not look noisy when nothing is wrong.
4. **Trustworthy**: status, color, and labels must match lifecycle truth. Never make pending work look complete.
5. **Fast**: high-frequency actions should be reachable without extra navigation or explanatory copy.
6. **Role-aware**: students see the work they can act on; staff and admins get global controls without hiding the state model.
7. **Repair-oriented**: admin surfaces should reduce daily checking by linking to the existing repair surface, not by adding another report.

Avoid:
- Marketing hero layouts, oversized cards, chart-first dashboards, decorative gradients, and copy that explains the obvious.
- Custom primitives when a shadcn/ui component exists.
- Green for anything that is not available/free in the gear lifecycle.
- Nested interactive controls, hidden hover-only controls on touch layouts, and text-only icon substitutes when a standard icon exists.

## Visual Language
### Layout
- Use `PageHeader` for page title, optional description, and right-side actions.
- Use `DetailPageHeader` for entity detail routes that carry identity media and a meta stack, which `PageHeader` has no slots for. It owns the card shell, the `h1`, and the media / status / title / subtitle / meta / actions / footer slots. Pick `sideBySideAt` to match the action column: `sm` for a couple of compact buttons, `lg` when a wide action column would crowd the title. A detail route without identity media stays on `PageHeader`.
- Use `AuthScreen` for every unauthenticated screen. It owns the login scene, the noise layer, the brand lockup, the translucent `.login-card` material, and the entrance stagger. Pass a `subtitle` saying what the screen is for and an optional `footer` for content that belongs on the scene rather than in the card. Do not rebuild the scene or the card per route.
- Do not restate the heading scale on an `h1`. Every detail title is a real `h1`, never a styled `span`.
- **Heading utilities do not work. Know this before you write one.** The typography rules in `globals.css` (`h1`-`h6`, `[data-slot="card-title"]`, dialog/sheet titles) sit *outside* any `@layer`, and unlayered CSS outranks every layered rule, including all Tailwind utilities. Measured 2026-08-22: on an `h1`, `text-5xl`, `text-[32px]`, and a bare element all compute to the same 30px. Consequences:
  - A size or weight utility on a heading or `CardTitle` is inert. There are 141 such declarations in the codebase that silently do nothing.
  - This is not cosmetic. The `/about` hero is authored `text-5xl sm:text-7xl lg:text-8xl` and was rendering at 30px until the showroom headings were given `!` modifiers.
  - To deviate from the scale deliberately, use the Tailwind important modifier (`text-lg!`), which is what the signature capture header and the public showroom now do.
- **`--font-mono` was resolving to nothing.** Measured 2026-08-23: `--font-mono` is declared on `:root` but resolves `--font-geist-mono`, which `next/font` only defines where its variable class is applied. That class was on `<body>`, one level below `:root`, so the token computed to empty and all 25 `var(--font-mono)` usages fell back to the sans stack — asset tags, UW tags, booking references, shift times, and server paths all rendered proportional. Fixed by moving both font variable classes to `<html>`. If you add a font token, define it where `:root` can see it and verify the computed value in a browser, not just the declaration.
- There are no `font-heading` or `font-mono` Tailwind utilities: the `@theme inline` block has no font entries. Use the family-only `.brand-identity` class for primary operational identity outside semantic heading/title slots. It deliberately does not set size, weight, tracking, or color. Adding font entries to `@theme` would generate utilities; not yet done.
  - **Open architectural fix:** moving the typography block into `@layer base` makes utilities work normally and is the correct structure. It was measured and deliberately not shipped on 2026-08-22 because it changes 141 headings at once — 6 `h1`, 27 `h2`, 46 `h3`, 59 `CardTitle`, 3 dialog/sheet titles — most on authenticated surfaces that cannot be visually verified locally. It needs its own slice with real proof, not a side effect of another change.
- Use page sections as full-width groups or direct content, not cards inside cards.
- Use `OperationalToolbar` for search, filters, quick toggles, and clear actions on operational list pages. The toolbar should read as quiet page chrome; individual controls carry the primary affordance.
- Keep settings sub-pages under the Settings layout header and grouped Settings navigation; use `SettingsPageShell` for the compact section intro and main content, and do not render page-level `h1` inside sub-pages.

### Spacing And Density
- Default operational surfaces should use compact spacing: `gap-2` to `gap-4`, `p-2` to `p-4`, rows at 44px+ where clickable.
- Keep repeated list rows dense and stable. Hover, badges, thumbnails, and inline actions must not resize the row.
- Use cards for repeated items, modals, queue cards, and framed tools. Do not wrap whole pages in decorative cards.

### Typography
- Gotham is the identity face: page and entity titles, serialized asset tags, bulk SKU names, booking/event titles, and person names when they are the primary label of a row, card, selection, or report link.
- Geist is the interface face: controls, field labels, statuses, dates, counts, descriptions, supporting product/model text, email/role metadata, and prose.
- Use semantic headings and shadcn title slots first. Add `.brand-identity` only when primary identity lives in a non-heading row or compact selection surface; do not apply it to an entire table, form, toolbar, or container.
- Labels first, numbers second. Metric cards use small uppercase labels and tabular numbers.
- Use hero-scale type only for real top-level page headers.
- Use sentence-case table headers and action labels.
- Do not scale fonts with viewport width. Let layout adapt instead.

### Color
- Follow `docs/COLOR_SYSTEM.md`.
- Green = available/free.
- Blue = active use.
- Purple = reserved/claimed.
- Orange = warning/waiting/pending/maintenance.
- Red = overdue, destructive, blocked, or failed.
- Gray = inactive, terminal, draft, retired, or neutral.

### Borders And Shape
- Use `rounded-md` or smaller for operational controls and cards unless the shadcn primitive dictates otherwise.
- Use subtle borders and `shadow-xs` only when a surface needs separation.
- Left rails and alert tint should reinforce status semantics, not brand decoration.

### Icons And Motion
- Use lucide icons inside buttons when an icon exists.
- Icon-only buttons need accessible names and at least 40px targets.
- **Open conflict, do not resolve with a regex.** The 40px rule and the "keep repeated list rows dense" rule contradict each other on 23 icon-only controls in 12 surfaces, where clustered 24-32px icons sit inside compact chips and cells: `UserAvailabilityTab` availability chips, `ItemInfoTab` copy/open affordances, `WorkingCrewEditor`, `SelectedEquipmentShelf`, `AssignmentCell`, `report-ui`, `SerializedItemForm`, `settings/data-export`, and the booking wizard. Resizing them to 40px roughly triples the affected chip heights; routing them through `OperationalRowActions` makes approve/deny a two-click action on a primary decision. Each surface needs its own decision. Audited 2026-08-22.
- Motion should be short and functional: focus, hover, active press, refresh spin, loading skeleton. No decorative motion.

## Component Language
- **Buttons**: shadcn `Button`; primary action first; destructive actions use confirmations; icon buttons require `aria-label`.
- **Forms**: shadcn `Input`, `Textarea`, `Select`, `Switch`, `Checkbox`, `Combobox` where available; show form-level errors for API, validation, permission, and network failures.
- **Dialogs**: `Dialog` for create/edit flows; `AlertDialog` for destructive or irreversible choices; `Sheet` or `Drawer` for contextual details. Built-in overlay close controls must keep a visible 40px target and focus ring.
- **Tables**: shadcn `Table`; compact rows; sticky headers when useful; row click and row actions must be siblings, not nested.
- **Row actions**: use `OperationalRowActions` for icon overflow menus in operational rows; keep the trigger 40px, give it a specific accessible label, and use destructive menu variants for destructive actions.
- **Settings row actions**: use `OperationalRowActions` for Settings table/list rows with destructive actions, lifecycle changes, or multiple row commands. Direct inline buttons are only for primary page actions, toggles, and form submit/cancel controls.
- **Filters**: `OperationalToolbar` shell; search first, mode controls next, filter disclosure after; clear action visible when filters are active.
- **Active filters**: use `OperationalActiveFilterChips` under operational toolbars so users can see and remove individual filters without reopening the filter panel. Removable chips are controls and must keep the 40px target baseline.
- **Badges**: use `Badge` semantic variants; do not define ad-hoc status color classes inline.
- **Cards**: use for repeated queue items and focused tools; avoid cards inside cards.
- **Nav**: role-aware, predictable, and stable; hidden routes must also be server-protected.
- **Empty states**: use `EmptyState`; explain the state and offer the next useful action when one exists. Use `inline` for card/table interiors so empty rows stay compact but still carry an icon, title, and recovery copy.
- **Alerts**: use warnings for partial data and stale reads; destructive alerts are for failed/blocking work.
- **Toasts**: use for completed background actions and refresh/save feedback; do not rely on toast as the only form error.
- **Loading states**: use `OperationalLoadingState` for app-shell, command, sheet, and inline loading placeholders so waits preserve layout, announce busy state, and stay on shadcn `Skeleton` instead of route-local spinner/text placeholders.
- **Pending actions**: keep the action label stable while work is in flight and use shadcn `Button loading` or a visible inline spinner for menu actions. Avoid swapping labels to `Saving...`, `Uploading...`, or other temporary progress copy.
- **Partial results**: use `OperationalPartialResultsAlert` with named failed sources whenever a fan-out surface shows available data after one source fails. The alert should say what remains visible and when to refresh before trusting a clean result.

## Workflow Language
- **Create**: "Add {thing}" for starting; "Create {thing}" for final submit; show the post-submit handoff.
- **Edit**: inline edits should save with clear success/failure state; bulk edits need a visible pending/disabled state.
- **Delete**: avoid where history matters. Prefer "Cancel", "Deactivate", "Archive", or "Retire" when those are the true lifecycle actions.
- **Assign**: use "Assign" for staff choosing an owner or worker; use "Claim" only when the current user is taking something.
- **Scan**: native iOS and kiosk own scan interactions. Web is text-first; pickup and return scans belong to kiosk flows.
- **Schedule**: use event, shift, and coverage language. Keep dashboard event widgets read-only unless the full management surface is intentionally opened.
- **Approve**: say what will happen after approval, especially for shift trades and requests.
- **Invite**: email is not assumed. User creation should expose the temporary-password handoff when mail delivery is not wired.
- **Recover**: drafts, skipped cleanup records, and partial results need a visible return path.

## Content Language
- Labels should name the object and action plainly: `Add item`, `New checkout`, `Pending pickup`, `Checked out`, `Reserved window`.
- Helper text should reduce mistakes, not explain the interface.
- Errors should say what failed and what to do next: `Could not load the admin queue. Retry.`
- Confirmation text should name the target and consequence.
- Success messages should be short: `Saved`, `Inventory hygiene refreshed`, `Checkout created`.
- Admin warnings should be direct: `Refresh before treating a clean result as final.`
- Network failures should say whether the attempted action was saved: `Could not reach the server. The shift change was not saved.`
- Rollback messages should name the visible recovery state: `The draft has been restored on the dashboard.`

## Accessibility Baseline
Non-negotiable for every page:
1. All controls are keyboard reachable.
2. Focus is visible and not clipped.
3. Icon-only controls have `aria-label`.
4. Interactive targets are at least 40px, and 44px where touch is primary.
5. Labels are programmatically connected to inputs.
6. Error and status changes are visible and announced when they affect the user's next action.
7. Color never carries the only meaning; pair color with labels, icons, or copy.
8. Avoid nested interactive elements.
9. Tables retain headers and row action labels for screen readers.
10. Loading and refreshing states preserve previous data when possible.

## Feature Improvement Pass
System rules, not feature ideas:
- Shared queue surfaces should use `OperationalMetricCard` and `OperationalPartialResultsAlert`.
- Shared action-first status summaries should use `OperationalStatusRail`: one orientation signal, at most three prioritized exceptions, a calm all-clear state, and optional collapsed details. Domain calculations and routing stay in route adapters.
- Shared list command surfaces should use `OperationalToolbar`.
- Shared page headings should use `PageHeader`.
- Status indicators should import the existing status-color helpers where available.

Feature ideas to consider separately:
- Authenticated visual regression smoke for dashboard, items, users, scan, settings, booking creation, Fix Today, and Hygiene.
- Apply the existing `OperationalRowActions` pattern to remaining operational menus instead of creating route-local dropdown wrappers.
- A reusable partial-results payload type for API routes returning `partialFailures`.
- Continue replacing local text-only empty rows with `EmptyState inline` in remaining admin tables when those surfaces are touched.

## Consistency Audit
- App shell navigation: desktop active matching now selects one most-specific route, Staff management is labeled Operations, collapse state persists, collapsed badges remain glanceable, mobile drawers close after navigation, and sidebar triggers/menu/theme controls meet the operational target floor. The mobile web bar uses the same unified Bookings destination as desktop.
- Shared `StatusIndicator`: status is now carried by the semantic Badge variant, a flat dot, and its label; the decorative ping halo was removed from dashboard, booking, hygiene, Fix Today, and Settings consumers.
- Public showroom: shared section blocks now use solid backgrounds, restrained borders, inline icons, and compact mockup framing instead of atmospheric gradients, tinted icon tiles, and repeated oversized card shadows.
- `/dashboard`: pending pickup previously used green row accent. Fixed to orange waiting semantics.
- `/checkouts/new` confirmation: checkout handoff previously looked complete. Fixed to pending kiosk pickup language.
- `/scan`: removed from the web app. Native iOS owns lookup, web remains text-first, and kiosk owns custody scans.
- `/items`: toolbar was the best existing command surface. It now uses `OperationalToolbar` and shared active-filter chips.
- `/items`: inventory status now uses `OperationalStatusRail` with an active-inventory orientation, prioritized nonzero operational states, and the complete pressed-state-aware status facet set under Details.
- Page-level operational summaries on Dashboard, Inventory Hygiene, Battery Ops, Notifications, Kits, Licenses, Onboarding Status, and Allowed Emails now share `OperationalStatusRail`; report analytics, import outcomes, badge progress, item insights, and Resources navigation remain card-based by design.
- Shared operational toolbar shell: `OperationalToolbar` now uses the lighter translucent chrome shared by breadcrumbs and section nav, while child controls keep 40px targets and their own borders.
- `/items` row actions: table overflow actions now use `OperationalRowActions`.
- `/bookings`: table rows, mobile rows, and booking cards now use `OperationalRowActions` for overflow commands while preserving right-click context menus.
- `/bookings`: list filters now use `OperationalToolbar` plus shared active-filter chips, matching Items and Users instead of a route-local card-header toolbar.
- Shared filter controls: `FilterChip` and `OperationalActiveFilterChips` now use 40px removable targets across Bookings, Schedule, Dashboard, Trade Board, Items, Users, and Reports.
- `/checkouts/new` and `/reservations/new`: shared `EquipmentPicker` search clear, scanner close, select-visible, clear-section, bulk quantity, selected-shelf remove, and clear-all controls now follow the 40px operational target baseline.
- Shared overlay primitives: `Dialog`, `Sheet`, and `Drawer` built-in close controls now use visible 40px targets so modal dismissal is consistent across create/edit/detail flows.
- Shared inline field rows: `SaveableField` renders display-only labels as text instead of untargeted form labels, preserves real label associations when `htmlFor` is provided, names dirty-row save/cancel controls with the field label, and uses a visible dirty-row accent with 40px action buttons.
- Shared people avatars: `UserAvatar` is the canonical web entry point for user photos and initials. Use its semantic size scale instead of hand-sized circular image overrides.
- `/schedule` filters: view and venue segmented controls now use shadcn `ToggleGroup` while Schedule remains a documented domain-specific command-bar exception.
- `/schedule` Trade Board: claim and staff approval stay visible; cancel and decline now use `OperationalRowActions` as secondary/destructive row commands.
- `/schedule` Trade Board: cancel confirmation now names the event, shift window, posted owner, and assignment consequence instead of asking a generic trade question.
- `/schedule` Trade Board sheet: the overlay now includes an accessible description instead of title-only sheet content.
- `/schedule` Trade Board filters: active Area, Status, and My trades filters now use `OperationalActiveFilterChips`.
- `/users`: filter surface matched the idea but used smaller controls and its own frame. It now uses `OperationalToolbar`, 40px controls, and shared active-filter chips.
- `/users/[id]`: editable area assignments now use 40px row actions through `OperationalRowActions` instead of tiny inline chip buttons for primary/remove commands, and profile-photo/size inputs expose stable id/name metadata.
- `/settings/categories`: category row actions now use the shared row-action trigger instead of a page-local kebab button.
- `/settings/categories`, `/settings/departments`, `/settings/locations`, `/settings/allowed-emails`, `/settings/calendar-sources`, `/settings/venue-mappings`, `/settings/bookings`, and `/settings/kiosk-devices`: local text-only empty rows now use shared inline empty states.
- `/settings/departments`, `/settings/locations`, `/settings/allowed-emails`, `/settings/calendar-sources`, `/settings/venue-mappings`, and `/settings/kiosk-devices`: table/list row actions now use the shared row-action trigger for lifecycle and destructive commands.
- `/settings/bookings`: Extend Presets label input, loading skeleton, add preset, and remove preset controls now match the 40px operational target baseline.
- `/settings/kiosk-devices`: pending-pickup summary, activation-code copy, pending-pickup cancel, and empty pending-pickup dialog states now have named controls, visible focus, 40px targets, and shared inline empty-state language.
- `/settings/allowed-emails`: add-mode controls now use 40px segmented targets with visible focus and `aria-pressed`.
- `/settings/database`: initial no-diagnostics state now uses shared inline `EmptyState` copy instead of a route-local text placeholder.
- `/settings/audit`: filter controls now use `OperationalToolbar` plus shared active-filter chips, and audit rows render through shadcn `Table` with shared empty/error states.
- `/operations` (absorbed `/admin/fix-today` and `/items/hygiene`, which now redirect there): merged queue uses the shared rail, metric, and partial-results primitives with one check-card vocabulary.
- `/settings`: uses `PageHeader` plus role-aware grouped navigation. Large desktop uses a left rail; smaller screens keep a horizontal section scroller. Sub-pages now share `SettingsPageShell` for the compact intro/main split.
- `/reports/*`: report metric cards now render through `OperationalMetricCard` via the report adapter, preserving report links, tooltips, badges, and string values without maintaining a separate metric primitive.
- `/reports/checkouts`, `/reports/scans`, and `/reports/audit`: non-default period and phase filters now render removable shared active-filter chips through the report toolbar.
- `/items/[id]`: item detail secondary actions now use the shared dropdown wrapper instead of a route-local menu shell.
- `/items/[id]`: item detail tab empty states now use shared inline empty states for no booking history, empty calendar windows, failed/empty insights, and empty attachment groups.
- `/items/[id]`: header utility controls now follow the 40px target baseline for refresh, favorite, and the secondary action trigger.
- `/items/[id]`: item image edit/add controls now expose the same affordance on keyboard focus as hover, with visible focus rings.
- `/items/[id]`: scan identity QR/serial copy affordances now use explicit 40px icon buttons instead of hover-only inline icons, and the QR preview control has a visible focus ring.
- `/kits/[id]`: detail header now uses `PageHeader`, archive/delete/back actions are 40px controls, and the local add-member clear affordance is a named shadcn icon button.
- `/kits/[id]`: serialized and bulk member removal now uses `OperationalRowActions`; bulk removal confirms the quantity/item family, reports parsed API errors, and relies on a kit-scoped delete check.
- Item image search results: result selection buttons now expose visible keyboard focus, and source links use the 40px operational target baseline.
- `/items`: bulk selection actions now use clearer toolbar semantics, 40px controls, and a specific `Bulk actions` dropdown label for selected-row commands.
- `/login`: auth fields now include both labels and form `name` attributes so browser accessibility checks can identify the inputs after protected-route redirects.
- `/register`, `/forgot-password`, `/reset-password`, and `/change-password`: auth fields now match the login form's label/id/name/autocomplete pattern.
- `/events/[id]`: crew coverage empty area rows now use shared inline empty-state language instead of one-off italic placeholders.
- `/events/[id]`: crew assignment/remove/request controls now use visible keyboard-friendly 40px targets instead of hover-only or sub-40px controls.
- `/events/[id]` shift slot interiors: remove-shift, attendance, approve/decline request, and student request controls now keep the same 40px action baseline as the rest of the event crew surface.
- `/events/[id]`: missing-gear Nudge and Create checkout actions now use the 40px operational action baseline and wrap cleanly on narrow rows.
- `/events/[id]`: travel roster default-traveler, add, and remove controls now follow the 40px operational action baseline, and the empty roster uses shared inline empty-state language.
- `/bulk-inventory/[id]`: unit-tracked item-family units tab now uses shared inline empty states when no units exist.
- `/kits` and `/bulk-inventory/batteries`: summary metric strips now use `OperationalMetricCard` instead of route-local metric card helpers.
- `/kits/[id]`: add-member search misses and empty item-family membership now use shared inline empty states instead of text-only placeholders.
- Global error fallback: the app-level crash fallback now uses shadcn `Button` actions and semantic text/layout tokens instead of inline-styled raw controls.
- App error boundaries: root, app-shell, and global failures now share a shadcn-backed recovery panel with operational retry/sign-in/dashboard copy, optional error ID display, and no generic "Something went wrong" fallback.
- Shared loading states: AppShell boot, command search, and Booking detail sheet loading now use `OperationalLoadingState`; Booking detail recovery/not-found states use shared inline `EmptyState`, and pending booking sheet actions use shadcn `Button loading`.
- Shared pending actions: Booking wizard, Booking detail header/dropdown actions, Booking edit form, and item image modal mutations now keep stable action labels while shadcn loading affordances or inline menu spinners show the active request.
- Shared action result copy: Booking list extension failures and Trade Board claim/approve/decline/cancel/request failures now use object-specific recovery and "not changed/not saved" language instead of generic network or failed-action copy.
- `/search` and quick search: partial endpoint failures now use `OperationalPartialResultsAlert` with named failed result types instead of local generic warning copy.
- Item image picker: search idle, empty, quota, and failed states now use shadcn `Empty` composition, and result selection uses the shared `Button` primitive while preserving the visible selected/focus treatment.
- Add Item images: Standard, Units, and new Quantity records stage Search, Paste URL, or Upload selections in the shared item image picker before create. The created record owns persistence and retry, while Quantity add-to-existing preserves the existing catalog image.
- Shared onboarding dialog: completion, client preview, and account-status preview metrics now use shadcn `Card` composition instead of route-local bordered metric panels.
- `/bulk-inventory/batteries`: checked-out battery units panel now uses shared inline empty states when no units are out.
- `/labels` and `/search`: compact clear, open, result, and view-all controls now meet the 40px operational target baseline on the focused print queue and global command surfaces.
- `/notifications`: summary metrics now use `OperationalMetricCard`, and header/retry/destination/mark-read controls meet the 40px operational target baseline.
- `/licenses`: license pool summary metrics now use `OperationalMetricCard`, and compact refresh/show-retired/export/admin controls meet the 40px operational target baseline.
- `/resources`: active filter removals now use `OperationalActiveFilterChips`, sorting uses shadcn `Select`, and search/filter/sort/contact controls meet the 40px target baseline while keeping the documented Resources rail exception.
- Web sidebar: Settings is visible to every authenticated role, and Bookings uses overdue-first then user-scoped due-today badge priority. Lookup stays out of the web sidebar because laptop/desktop work should use the text search bar or command palette; scan entry points remain mobile/native posture surfaces. Sidebar Cmd/Ctrl+number shortcuts stay out because browser and system shortcuts own that space.
- Route-by-route conformance checklist: Dashboard, Schedule, Items, Bookings, Users, and Settings are now tracked in `tasks/design-language-route-conformance-checklist.md`; future page work should update that checklist when it changes one of those route patterns.
- State and copy audit Area 5: dashboard draft recovery, booking detail custody actions, and shift staffing changes now use operational failure, rollback, and confirmation language that names the affected record and consequence.
- `/schedule` today markers: Calendar, Week, and List views use the shared `--wi-red` token (with the dashboard's `dark:` opacity-bump convention) instead of route-local brand hexes. The token is the official `#c80000` RGB red in both themes, so brand actions and identity moments stay consistent while surrounding contrast treatment remains surface-owned.
- `/schedule` Week view: the "your shift" card ring now uses the `--blue` token instead of a raw `ring-blue-400` Tailwind literal, and an empty week renders a single shared `EmptyState` instead of an empty day grid plus a duplicate empty message (matching Calendar view).
- `/schedule` command targets: the Clear queue, popover Clear all, and Assign review-state toggles now meet the 40px operational target baseline.
- iOS Schedule: the calendar today/selected markers and the Post-trade selection checkmark now use `Color.brandPrimary` (matching the list agenda header, web, and the global brand tint) instead of `Color.accentColor`, which resolved to system blue because the app ships no AccentColor asset. "My shift" indicators (calendar legend/dots, event-row stroke) and the assign area-match chip now use the `.blue` status token to stay distinct from "today" and aligned with the web my-shift blue; the Trade Board Claim CTA inherits the brand tint.
- iOS `EventDetailSheet` (opened from the Schedule list/calendar): the same `Color.accentColor` → token cleanup was applied — the sport-identity chip and the Assign/Request open-slot CTAs now use `Color.brandPrimary`, while the my-shift dot/row wash and the "this is me" assignment icon use the `.blue` status token. Note: the underlying cause is that the app has no AccentColor asset, so `Color.accentColor` is system blue app-wide despite `.tint(.brandPrimary)`. The same latent inconsistency still exists in non-Schedule views (Kiosk, ItemDetail, Search, etc.); adding a brand AccentColor asset would fix it globally but needs a deliberate cross-app audit first.
- `/schedule` nav controls: Calendar month and Week navigation chevrons now use shadcn `Button` icon buttons (matching the Assign page) instead of route-local `<button>` elements.
- `/schedule` in-row density exception: dense shift-row controls keep their compact footprint per the density rules. The always-visible icon-only controls (remove-assignment and the expand/collapse chevron) now carry a ≥40px effective hit target via the existing expanded-hit-area idiom (`before:-inset-*`) without resizing rows; the remaining text-labeled compact actions (Add, Trade, Manage event, Reserve gear) are a documented density exception, not drift.
- `/schedule` Readiness strip: the "filters hide everything" notice now uses shared `EmptyState inline` instead of a one-off dashed text row.
- Shared operational status rail: Schedule readiness and Operations (formerly Admin Fix Today) now use `OperationalStatusRail` for one compact orientation-plus-exceptions line with bounded visible items, overflow accounting, and shadcn-backed details. Metric cards remain inside details instead of competing with the primary queue.
- `/operations` (formerly `/admin/fix-today`): no duplicate queue health badge, oversized summary card, or separate all-clear card. The shared rail owns queue orientation and exception priority; check cards retain their status indicators and use semantic Wisconsin Creative status tokens plus shadcn Card footer and Separator composition.

## Implementation Roadmap
Quick wins:
- Keep replacing page-local metric cards and partial-result warnings with shared primitives.
- Convert route-local filter shells to `OperationalToolbar` when they match the search/filter/clear pattern; route-local card-header filter rows are drift.
- Audit icon-only buttons for labels and target size during each page pass.
- Keep Settings sub-pages on `SettingsPageShell`; new Settings pages should not copy local split-grid markup.
- Settings add-mode, copy, remove, and cancel controls must still meet the 40px target rule even when they sit inside compact admin forms or dialogs.
- Keep item-detail and schedule card/table interiors on shared `EmptyState inline` when there is no data to act on.
- Use `tasks/design-language-route-conformance-checklist.md` as the gate for Dashboard, Schedule, Items, Bookings, Users, and Settings route changes.
- Lower-traffic route checklist entries now cover Kits, Licenses, Resources, Labels, Notifications, Search, Reports, Bulk Inventory, and detail pages. Keep that checklist current when touching those surfaces.
- Treat generic `Failed to save`, `Network error`, and `Something went wrong` copy as drift on daily operational flows; replace it with object-specific outcome and recovery language when the surface is touched.

Medium slices:
- Keep active-filter chips shared through `OperationalActiveFilterChips`; do not introduce page-local removable-chip buttons.
- Standardize remaining row action menus across Users and any future operational tables.
- Keep operational empty states on `EmptyState`, using the inline mode for table/card interiors.

Larger design-system work:
- Run the authenticated browser baseline on an isolated target for release proof, then expand it only when new launch-critical route or recovery contracts need coverage.
- Extend the route-by-route design-system conformance checklist to lower-traffic routes once the six main routes stay stable.
- Consider a small internal examples page only if component usage starts drifting again.

## Authenticated Browser Baseline

The launch-critical web baseline lives in `tests/e2e/launch-smoke.spec.ts`. It checks Dashboard, Bookings, Items, Search, Schedule, Settings overview, and Profile in desktop and narrow-mobile Chromium. The baseline is behavior-first rather than pixel-based: accessible headings and controls, keyboard reachability, no horizontal overflow, clean console/runtime state, role-adaptive Settings content, and named recovery states. Failure-only traces and screenshots provide diagnosis without creating brittle visual snapshots.

Run it only against an isolated target with a dedicated identity. The initial suite avoids business-data mutation actions and uses request interception, not database corruption, for partial-failure states. Normal login and authenticated reads still write session, audit, and last-active metadata, so authenticated runs require the isolation opt-in and reject known production hosts. See `docs/TESTING.md` for the credential, target-safety, and strict CI contract.

## Verification Plan
For every UI/design-language slice:
1. Read relevant `AREA_*`, `BRIEF_*`, `DECISIONS.md`, and current code before editing.
2. Cross-reference sibling pages before standardizing.
3. Run `npx tsc --noEmit`.
4. Run `git diff --check`.
5. Run `npx next build`.
6. Browser-smoke changed routes. If unauthenticated, verify clean protected-route redirect and no console errors. If authenticated credentials are available, inspect the actual signed-in surface.
7. Update the relevant `AREA_*` doc and task ledger.
