# Dashboard Area Scope (V1 Ops-First)

## Document Control
- Area: Dashboard
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-25
- Status: Active — V3 shipped, reliability + UX polish complete
- Version: V3

## Direction
Make dashboard an action console for daily operations, not a reporting screen.

Design language reference: `docs/DESIGN_LANGUAGE.md`.

## Confirmed Product Decisions
1. Same action-oriented dashboard shell for all users, with role-specific data scope.
2. Primary focus is Check-outs and Reservations.
3. Overdue is visually red and prioritized.
4. Overdue banner includes inline highest-priority checkout items.
5. Section row cap is 5, with `View all` for overflow.
6. Saved filters are deferred — not in V1.
7. No keyboard shortcut layer in V1.
8. Add a draft system for in-progress booking flows.
9. Upcoming Events remains a Team Activity card, not a separate top-level dashboard section.
10. Calendar sync remains backend support for event-linked reservations/checkouts.
11. Past-due reservations are surfaced separately as stale planning work, not merged into checkout overdue custody metrics.
12. Internal Students, Staff, and Admins can view team dashboard rows, totals, and Upcoming Events; the explicit `scope=ios-home` native payload remains personal, and collaborators remain capability-driven.

## Information Architecture (Top to Bottom)
1. Overdue Banner (global)
2. Action Lanes
   - Check-outs needing action
   - Pending pickup handoffs
   - Stale reservations needing cleanup
   - Reservations needing action
3. My Gear in Custody cards
4. Drafts section (recover in-progress reservation/checkout drafts)
5. Sport filter chips shipped (V4). Location filter deferred.

## Section Specs

### 1) Overdue Banner
- Trigger: show when overdue count > 0.
- Style: red severity treatment.
- Content:
  - Overdue total
  - Inline top overdue items (max 3)
  - CTA: `View all overdue`
- Behavior:
  - Clicking inline item opens its BookingDetailsSheet.

### 2) Action Lane: Check-outs
- Purpose: immediate handling of active and risky check-outs.
- Grouping order:
  1. Overdue
  2. Due today
  3. Open (not overdue)
- Sorting: oldest overdue first, then nearest due time.
- Row fields:
  - Booking title
  - Borrower
  - Due time
  - Status
  - Linked event badge (if present)
- Row actions:
  - View
  - Extend
  - Open checkout for kiosk return follow-up

### 3) Action Lane: Reservations
- Purpose: operational prep for near-term reservations.
- Window: next 7 days.
- Grouping order:
  1. Today
  2. Upcoming (within 7 days)
- Sorting: soonest start time first.
- Row fields:
  - Reservation title
  - Owner
  - Start time
  - Status
  - Linked event badge (if present)
- Row actions:
  - View
  - Edit
  - Cancel

### 3b) Action Lane: Stale Reservations
- Purpose: cleanup for reservations that were never converted, cancelled, or completed before their window ended.
- Trigger: `BOOKED` reservations where `endsAt < now`.
- Behavior:
  - Render as a transient red attention card only when present.
  - Link to `/bookings?tab=reservations&filter=overdue`.
  - Do not increment checkout overdue stats or the overdue checkout banner.

### 4) My Gear in Custody
- Purpose: personal accountability and due urgency.
- Card fields:
  - `tagName` primary
  - Booking/reservation title
  - Due datetime
  - Countdown to due
  - Suggested return location
- Sorting: overdue first, then nearest due.
- Empty state: `You currently have no gear checked out`.

### 5) Drafts
- Purpose: recover interrupted in-progress work.
- Scope:
  - Reservation drafts
  - Checkout drafts
- Row fields:
  - Draft type
  - Last edited timestamp
  - Owner
- Actions:
  - Resume
  - Discard

## Interaction Rules
- Desktop:
  - Row hover reveals actions.
  - Row click opens detail sheet.
- Mobile:
  - Row tap opens action sheet.
  - Keep critical tap targets at 44px minimum.
  - Follow shared mobile interaction contract in `AREA_MOBILE.md`.

## Permissions and Visibility
1. Internal users (Students, Staff, and Admins) can view team dashboard rows for reservations, check-outs, and Upcoming Events. Collaborators remain capability-driven.
2. All users can book gear.
3. All users can edit their own reservations.
4. Students can edit only their own reservations and check-outs.
5. Staff can add and edit all users, reservations, check-outs, and items.
6. Admins can do everything staff and students can do.
7. Dashboard action visibility must honor these rules per row and ownership.

## Explicit V1 Non-Goals
1. Chart-heavy widgets and analytics-first layout.
2. Standalone Upcoming Events dashboard section.
3. Keyboard shortcut layer.

## Acceptance Criteria
- [x] AC-1: User can reach a checkout or reservation action in one click/tap from dashboard.
- [x] AC-2: Overdue banner and overdue list counts remain consistent.
- [x] AC-3: Check-outs and Reservations lanes each show max 5 rows plus `View all`.
- [x] AC-4: Reservations lane only includes records within next 7 days. **(Enforced — stats count and lane queries both filter `startsAt` within 7-day window.)**
- [x] AC-5: Permission-restricted actions are hidden or disabled correctly.
- [x] AC-6: Drafts can be resumed without losing entered data.
- [x] AC-7: Refresh failures preserve visible data (toast, no error screen wipe).
- [x] AC-8: Concurrent fetch races are prevented (AbortController).
- [x] AC-9: Draft delete is optimistic with rollback on failure.
- [x] AC-10: Manual refresh button shows data freshness ("Updated X ago").
- [x] AC-11: Operational dashboard, booking list, and booking detail queries verify server truth on mount instead of trusting warm persisted cache as fresh.
- [x] AC-12: Dashboard booking counts and rows converge from committed booking changes without manual refresh while the page is visible, online, and recently active. Polling pauses after two minutes without browser activity and refreshes immediately when the user returns.
- [x] AC-13: Dashboard, booking list, and full booking detail expose the shared booking-change sync health as a visible status indicator.
- [x] AC-14: The Operations page (which absorbed Admin Fix Today) exposes daily queue health through the shared operational status rail and per-check health through the shared status indicator.
- [x] AC-15: Loading-to-content swaps, optimistic draft removal and rollback, and transient exception-card changes use short transform/opacity transitions with reduced-motion handling and no initial replay.

## Edge Cases
- No overdue items: banner hidden.
- No rows in a lane: empty state with primary action CTA.
- Cross-midnight and DST countdown behavior.
- Booking linked to deleted or changed event source record.
- Mixed-location return suggestion for multi-location allocations.
- Temporary stale data causing count mismatches: show refresh status, expose shared sync health, refetch operational booking surfaces on mount, and invalidate dashboard/list/detail booking reads from the committed booking-change signal.
- Fast-count partial or request failures: preserve the last trustworthy operational totals instead of applying endpoint fallback zeroes, keep shift-only failures scoped to shift counts, and expose stale/retrying status plus a manual refresh that revalidates both Dashboard queries.

## Dependencies
- Booking and allocation read models.
- Reservation and checkout action policy rules.
- Event linkage metadata on bookings (for badges only).
- Draft persistence model for in-progress flows.
- Role policy from `AREA_USERS.md`.
- Mobile operations contract from `AREA_MOBILE.md`.

## Developer Brief (No Code)
1. Replace chart-first dashboard sections with the V1 ops-first section order.
2. Implement lane read models with deterministic grouping, sorting, and 5-row cap.
3. Implement overdue banner with inline top overdue items and detail routing.
4. Add Drafts read/write/recovery behavior for reservation and checkout flows.
5. Enforce role-based action visibility at row-action level.
6. Add responsive interaction parity (desktop hover actions, mobile action sheets).
7. Add regression tests for permissions, window filtering (7 days), and overdue consistency.

## Change Log

- 2026-08-24: **Profile setup now starts from a quiet Home banner.** Internal users with incomplete profiles see a compact blue Home banner with a missing-detail count and direct Finish setup handoff; the existing wizard remains available through that CTA and continues to own one-day snooze behavior. Dashboard action queues and operational data are unchanged.

- 2026-08-24: **Student Home team visibility restored.** Normal web Students receive team checkout/reservation rows, counts, pending pickup, overdue, and generic Upcoming Events alongside their own work. The explicit `scope=ios-home` native payload remains personal, and Students still retain own-work and role-gated mutation boundaries. The web slice is deployed in `dpl_9cFHwpSQA9QjsQTV3GF3uKf65QtE`; authenticated Student production acceptance remains open.

- 2026-08-20: **Wisconsin Creative macOS companion 1.0.0 shipped.** The hardened menu-bar companion is now distributed as a Developer ID signed, hardened-runtime, notarized and stapled GitHub release (`macos-v1.0.0`) with the production APNs entitlement authorized by its embedded Developer ID profile. Gatekeeper accepts the installed bundle and the Release process is running; native XCTest, full interaction/accessibility smoke, and real APNs delivery remain separate proof gates.

- 2026-08-20: **Companion reliability and privacy hardening.** Wisconsin Creative now restores once at launch and refreshes only from APNs invalidation, explicit refresh, or Mac wake; there is no network polling timer. Projection versions, bounded arrays, counts, access states, and duplicate identities are validated before installation or cache indexing, with invalid external data preserving the last trusted snapshot. Sign-out stages failed remote revocations for bounded retry, clears delivered and pending local booking alerts plus requester-photo caches, and keeps optional notification authorization/APNs registration off the projection critical path. Menu-bar custody count and health severity now share one model truth, and the signed Release configuration enables Hardened Runtime. Native runtime, APNs, signing, and clean Release distribution proof remain rollout gates.

- 2026-08-20: **Dashboard activity rails and event titles stay intentional.** Activity and Upcoming Events rows now tint only their sibling separator's top edge, preserving each row's semantic left rail instead of allowing a later separator color to overwrite it. Upcoming event primary titles reuse the Schedule matchup formatter, so imported dash qualifiers such as `Camper Reunion/Youth Sports Day` remain out of the primary title. Routes, counts, filters, permissions, event data, booking actions, and custody semantics are unchanged.
- 2026-08-19: **Menu bar settings window now appears.** The settings surface used a SwiftUI `Settings` scene, which opened its window behind every other window because an `LSUIElement` accessory app never activates itself, so the menu item looked inert. It is now an explicit `Window` scene: the menu activates the app before ordering the window in, and the window also brings itself front on appear for ⌘, and background re-open. Verified against the window server as frontmost and focused.
- 2026-08-18: **Menu bar startup, display, and health-panel settings.** A General settings tab adds launch-at-login through `SMAppService` (surfacing the approval-pending state with a route into System Settings instead of an error), an optional menu bar booking count, and an opt-in alert sound that keeps silence as the default. System health now renders as one grouped panel whose Companion data, Kiosks, and kiosk device rows are controls that refresh or open their Wisconsin Creative destination, with hover feedback and button traits.
- 2026-08-18: **Menu bar idle kiosks, notification settings, and shared sign-in design.** An idle kiosk heartbeat (five minutes to 24 hours since last check-in) is expected behaviour and no longer escalates health, colours orange, or outranks a kiosk in active use. It reads as `Idle` in neutral text, and only the 24-hour boundary or a device that never checked in remains a fault. Booking alerts are now user-configurable: every change is classified into a `BookingChangeCategory`, a Settings scene exposes a master switch plus per-category toggles and the system authorization state, and filtering happens at delivery so a muted category still advances the change baseline and cannot replay when re-enabled. Sign-in adopts the shared Wisconsin Creative login design — crimson splash scene, brand lockup, light card, identity-then-password steps, and a show/hide password control — with the step split kept local so enrollment remains the only Neon-backed request.
- 2026-08-18: **Menu bar app identity and popover polish.** The popover and sign-in header resolve the Wisconsin Creative icon from the running bundle's compiled `AppIcon` instead of `NSApplication.applicationIconImage`, which silently substitutes Apple's generic application placeholder on an `LSUIElement` bundle whose icon resources are missing. A vector Block W taken from the shared icon source is the fallback, so the popover can never render a foreign placeholder, and a host-bundle test now fails when a build ships without compiled icon resources. Popover polish: one 380-point width across restoring, sign-in, and operations states; projection freshness in the header; an overdue badge derived from the rendered rows; hover feedback on both row types; state-tinted kiosk glyphs; a hidden menu disclosure indicator; and ⌘R, ⌘D, and ⌘Q shortcuts.
- 2026-08-18: **Reservation cards now show pickup time.** Team and personal Reserved cards render the reservation `startsAt` through the shared calendar-relative pickup label, so operators can see when gear should be collected without opening the booking.
- 2026-08-17: **Dashboard My Shifts now preserves all-day event dates.** Staff shift rows carry the event's `allDay` flag through `/api/dashboard` and use UTC-safe date-only formatting for UTC-midnight calendar events, while explicit Student call windows remain timed. This closes the remaining non-UTC dashboard path that could show an upcoming shift one calendar day early in Central time.
- 2026-08-09: **Wisconsin Creative no-wake companion transport.** The menu bar app no longer restores through `/api/me`, polls booking routes, or reads Neon during automatic operation. Explicit password enrollment builds one initial projection while Neon is already awake and returns a signed, revocable companion credential. Successful booking, custody, kiosk, and avatar mutations rebuild a bounded read model after commit, store it in Upstash, and send silent APNs invalidation. Kiosk last-seen publication is chained after the existing deferred heartbeat write. Launch restores only Keychain and the last trusted local cache; APNs and manual refresh fetch only the external projection and never fall through to a database route. Quiet time is not treated as a health failure. The popover keeps the Wisconsin Creative name, shared app icon, package menu-bar symbol, iOS-aligned open booking and pickup rows, requester photos, kiosk diagnostics, passive local change alerts, and read-only web deep links. Production deployment and real APNs delivery remain external proof gates.
- 2026-07-31: **Snow Leopard collaborator and draft-state hardening.** The active booking API and dashboard totals exclude `DRAFT` records, while draft recovery labels them explicitly as Draft. Collaborator dashboard statistics return zero for private My Gear counts unless `MY_GEAR_VIEW` is granted, preventing a capability-denied account from learning personal booking totals.
- 2026-07-24: Booking timing now uses calendar-relative labels (`Today`,
  `Tomorrow`, and `Yesterday`), full month-and-day labels outside that range,
  a comma before the time, and stronger date/time emphasis across checkout and
  pending-pickup rows.
- 2026-07-23: Pending Pickup now counts and lists due `BOOKED` reservations,
  with dashboard summaries exposing the orange operational display status.
  The top active-booking total and breakdown include that lane, and a missed
  handoff uses the accepted `Pickup was due Today, 2:30 PM` wording.
  The separate Stale reservations card is retired. Legacy staged checkout rows
  remain in the same lane during compatibility cleanup, while checkout overdue
  continues to mean physical custody only.
- 2026-07-22: **Personal-scope dashboard counts.** `scope=ios-home` now scopes every stat lane to the caller, not just the row queries: overdue, due today, checked out, reserved, awaiting pickup, and the team/stale totals all read the caller's own numbers, and pending pickups are filtered to `requesterUserId`. `/api/dashboard/stats` accepts the same `scope` parameter and iOS passes it, so the tab badge and Home can no longer disagree. The default web payload keeps its org-wide totals; `COLLABORATOR` behavior is unchanged.
- 2026-07-22: **Native Home Next Up restyle.** Next Up row titles now use the Bookings list's Gotham face at the same size, so a row does not change typeface between the two lists. Shift rows read as event title, full date (`Sunday, September 6`), a home-games-only `Call time 6:30 PM` line, and the event start time in the meta column; the gear subline was removed from shift rows because gear already has its own Next Up row and the event detail sheet. The stat strip's `Synced <relative>` stamp is gone -- pull-to-refresh is the freshness indicator. Dashboard payload contracts are unchanged.
- 2026-07-17: **Native Home actionable-count polish.** The iOS triage strip now renders only nonzero overdue, due-today, pickup, and shift counts as compact disclosure rows. Zero-value metrics no longer compete with real work or resemble disabled controls; when every count is zero, Home retains its existing all-clear summary. Dashboard payloads, count definitions, role scope, and destinations are unchanged.
- 2026-07-16: **Dashboard state-continuity motion.** Cached-column and collaborator loading states now crossfade into resolved content, optimistic draft deletion and rollback preserve row/card continuity, and transient overdue, flagged-item, lost-unit, pending-pickup, and stale-reservation surfaces exit along the same path they enter. Dashboard-only Motion wrappers use 120ms exits, 200ms entrances and layout transforms, skip initial replay, and reduce motion to opacity changes. Data, routes, filters, permissions, and custody behavior are unchanged.
- 2026-07-16: **Dashboard interaction-detail pass.** Dashboard filter options, saved-view controls, queue footer links, section-title links, collaborator header actions, draft recovery actions, event venue toggles, exception links, and row-open surfaces now meet the 40px desktop target baseline with visible keyboard focus. First-run setup links use the shared 0.96 press treatment, and overdue nudge state changes cross-fade with interruptible Motion transitions without animating the initial icon. Booking data, routes, permissions, filters, queue hierarchy, and custody behavior are unchanged.
- 2026-07-16: Collaborator Home now loads and links only the My Gear and published Schedule modules granted by the current affiliation policy.
- 2026-07-16: **Activity-aware operational polling.** Dashboard, booking list, and booking detail keep the existing 30-second booking-change cadence while the user is active. The shared poller stops requests when the tab is hidden, the browser is offline, or no browser activity has occurred for two minutes, then performs an immediate freshness check on focus, visibility, connectivity, or user activity. This lets Neon's five-minute autosuspend window begin overnight without weakening active-session freshness.
- 2026-07-16: **Dashboard exception queue and shell identity cleanup.** The overdue queue now composes the shared dashboard section header and booking row instead of maintaining a separate thumbnail-stack banner. Red stays focused on the count and urgency rail, row selection opens the shared booking sheet, and the header owns the full overdue route. The redundant top-right profile control is removed because the sidebar identity card already owns profile navigation. Overdue sorting, nudge permissions, routes, and booking behavior are unchanged.
- 2026-07-16: **Booking sheet inline-edit and custody alignment.** The dashboard quick-view sheet now matches its status badge to the checkout urgency rail, formats schedule dates weekday-first, and keeps due-back timing as the stable headline. Safe metadata edits happen in context with explicit confirmation or Enter, numbered battery units render directly, active checkout equipment editing stays kiosk-only, and the footer no longer duplicates the sheet with a broad Edit booking action.
- 2026-07-16: **Dashboard sync hierarchy and booking sheet refresh.** Booking sync health now sits beside the Dashboard title as a compact bold indicator with restrained green depth, leaving the command group for Refresh, filters, and New reservation. The shared booking sheet now leads with due or reservation timing, keeps pickup and linked context in a quieter summary, preserves equipment as the working section, and consolidates secondary commands under a named More actions menu. Booking data, permissions, custody rules, and mutation routes are unchanged.
- 2026-07-16: **Dashboard interaction cleanup.** Due checkout rows no longer combine a launch arrow, duplicated clock icons, or an inline Extend action. The row remains the single detail action, and due-date changes stay in the booking detail sheet. Empty team checkout and reservation sections now use compact 64px rows instead of oversized centered panels. Booking routes, urgency semantics, and permissions are unchanged.
- 2026-07-16: **Dashboard visual hierarchy follow-up.** Booking rows now use a medium borrower avatar as the leading identity anchor, a stronger title, and quieter dot-separated metadata. Upcoming Events uses an integrated responsive venue filter, a calendar anchor for each event, and explicit separators between time, location, and call-time context. Dashboard header status, refresh, filter, and creation controls now share the same 40px height. Data, routes, urgency semantics, and permissions are unchanged.
- 2026-07-16: **Dashboard row and command polish.** Booking rows now keep gear quantity in the metadata line instead of repeating it as overlapping thumbnail circles, and due or pickup timing uses compact clock-led text rather than a floating badge. The header now aligns sync health, a labeled refresh action, optional filters, and New reservation as one command group. The operational rail disclosure is named `Booking breakdown`, matching the descriptive disclosure pattern used by Users. Booking links, urgency colors, filters, permissions, and detail behavior are unchanged.
- 2026-07-12: **Fix Today merged into `/operations`.** The standalone `/admin/fix-today` page is now a redirect; its checks render as the ADMIN-only "Run the day" lane on the consolidated Operations page (sidebar: Operations / Kits / Reports), alongside the staff-visible Inventory Hygiene lane and a compact battery summary card that links to Battery Ops. The page defaults to needs-work checks only, folds clean checks into a collapsible summary, and collapses to a single all-clear line when nothing is open. `GET /api/admin/fix-today` remains ADMIN-only and unchanged. See `tasks/ops-consolidation-plan.md`.
- 2026-07-11: **Dashboard action-column UI catchup.** My Gear and Team Activity now use flat shared cards, consistent compact headers and row density, quieter column labels, and neutral hover surfaces. Overdue, due-today, pending-pickup, reservation, checkout, and venue meaning remains visible through semantic rails and badges instead of full-row color washes. Shift, draft, empty, and upcoming-event presentation now follows the same card vocabulary without changing routes, filters, permissions, or actions.
- 2026-07-11: **Overdue checkout card UI catchup.** The dashboard overdue queue now uses the shared card, header, badge, button, focus, and neutral row-hover patterns used by the current action lanes. Red remains focused on the severity accent, icon, count, and elapsed badge instead of washing the full card, while detail selection, checkout routing, permission-gated actions, and nudge behavior are unchanged.
- 2026-07-10: **Dashboard operational status rail.** The custom four-card stat strip now uses the shared action-first rail, prioritizing overdue and due-today work while keeping linked checkout and reservation counts under Details. Dashboard queries, role scope, and booking destinations are unchanged.
- 2026-07-10: **Dashboard fast-count truth.** Failed or partial fast-count refreshes no longer overwrite trustworthy operational totals with zero fallbacks. Shift-only partial failures stay scoped, the page shows count-stale or retrying status, and manual refresh revalidates both the full Dashboard and fast-count queries.
- 2026-07-09: **Admin Fix Today adopted the shared operational status rail.** The page now presents queue freshness, critical checks, checks needing work, open items, partial-data state, and all-clear state in one compact shadcn-backed rail. Full metrics and completion remain available under Details, while the duplicate queue health badge, oversized summary card, and separate all-clear card are removed. Queue section cards retain their shared status indicators and now use semantic project status tokens plus shadcn Card footer and Separator composition. The read-only API and repair links are unchanged.
- 2026-07-09: **All-day event date bug fixed on the dashboard.** Upcoming Events and the "My shifts" card were showing the wrong calendar day and weekday for all-day events (e.g. a Thursday event rendered as "Wednesday, Jul 8") in any non-UTC browser timezone. Root cause: all-day events and full-day-default shift call windows are stored as UTC-midnight instants, but `formatDayLabel` converted them to local time before reading the date, and the shared `isFullDayBoundaryWindow` helper (used to detect "no real call time set, just inherited the event's day boundary") checked local hours instead of UTC hours — so in Central time it never recognized a genuine full-day window, leaking a fabricated clock time like "Call Jul 8, 7:00 PM" onto shifts with no real call time. `formatDayLabel` now takes an `allDay` flag and reuses the existing UTC-safe `calendarDate` helper (already used by `formatDateShort`); `isFullDayBoundaryWindow` now checks UTC hours, which also fixes the same latent bug in the Schedule List View, Schedule Readiness banner, and shift slot cards that already depended on it. No backfill needed — this was a display/detection bug, not corrupted data.
- 2026-07-06: **Dashboard backend consistency hardening shipped.** Upcoming Events and all five personal shift filters (dashboard `myShifts`/`myEventWork`, stats `myShiftsCount`/`myShiftsTodayCount`, `/api/my-shifts`) now exclude archived events, matching Schedule's canonical `buildScheduleEventWhere` semantics, so an archived-but-future event can no longer resurface on Home or drive a student's shift badge and gear prep. Hidden events deliberately stay visible on personal surfaces: hiding is list hygiene and a real assignment beats it. Also: the shared dashboard-counts pending-pickup lane is guarded to `kind = 'CHECKOUT'`, and `/api/my-shifts` clamps its `limit` param to 1..20 (negative values previously reached Prisma as backwards-pagination `take`). Plan: `tasks/archive/dashboard-hardening-plan.md`.
- 2026-07-03: iOS Home hero accessibility cleanup. Native Home keeps the same Snow Leopard header visuals, but the hero now exposes the visible date and personalized greeting as one accessibility element so screen readers do not encounter both the combined greeting and its separate child text nodes.
- 2026-07-02: iOS Home header cleanup. Native Home no longer renders the Apple Foundation Models or deterministic summary subline under the greeting. The header keeps only the date, a deterministic day-varying local greeting, and the signed-in user's first name; operational counts and urgency remain in the stat strip and Next Up action queue. The dashboard API payload is unchanged.
- 2026-07-02: iOS Home all-day event row cleanup. Native Home's Next Up event-work row now reuses Schedule all-day date math so all-day events show date-only `All day` metadata, suppress call-time sublines, and avoid midnight gear-prep times while preserving the existing `/api/dashboard` `myEventWork.event.allDay` payload contract.
- 2026-06-29: iOS Bookings unified list polish. Native Bookings now presents one active-bookings list with Checkouts above Reservations and newest rows first inside each section, keeping dashboard deep links compatible by clearing legacy sub-tab hints rather than requiring a separated control. Booking status display copy now uses Reserved, Checked Out, and Overdue while preserving the existing BookingStatus enum and dashboard payload contracts.
- 2026-06-29: iOS Home visual polish. Native Home no longer renders a floating create button over the Next Up action queue, preserving the dashboard surface for immediate due, pickup, reservation, and shift work. Due Today keeps its existing orange text tone, compact orange status icon tiles use a stronger fill, and the Home sync timestamp uses secondary text for better legibility. Web dashboard data contracts and booking creation routes are unchanged.
- 2026-06-29: iOS Home console/runtime calming. Native Home now logs dashboard payload completion before checkout-return Live Activity reconciliation and records the reconciliation as its own debug timing, so launch measurements match visible Home data. The Apple Foundation Models header line is local opt-in and delayed after first render; deterministic fallback copy is the default Home header path. Remote thumbnails now use a bounded disk URL cache plus the existing decoded in-memory cache to reduce cold-launch image refetches.
- 2026-06-28: iOS Home AFM header line. Native Home now derives a count-only dashboard signal and can generate one short header flavor line when Apple Foundation Models is locally enabled and available on device. The deterministic fallback remains in place, operational counts/queues stay server-authored, and the dashboard API payload is unchanged.
- 2026-06-28: iOS Home launch payload trim. `/api/dashboard` now accepts `scope=ios-home` as a backwards-compatible, same-shape response mode for native Home. The default web payload is unchanged; the iOS scope skips unused row-heavy team, stale-reservation, upcoming-event, and top-overdue sections while preserving counts, personal action rows, pending pickups, shift/event-work rows, and staff follow-up rows.
- 2026-06-27: Admin Fix Today health indicator. `/admin/fix-today` now maps critical checks, checks needing work, partial data, and clean queue state through the shared shadcn-backed status indicator. The page remains a read-only repair queue and still links to existing repair surfaces instead of adding mutations.
- 2026-06-26: Booking sync health indicator. Dashboard, `/bookings`, and the full booking detail header now show the shared shadcn-backed booking sync status (`Live sync`, `Sync retrying`, `Offline`, or `Sync paused`) from the existing booking-change hook. The hook still invalidates dashboard, stats, booking-list, and changed booking-detail caches from `/api/bookings/changes`; this slice makes that freshness state visible without adding new custody actions.
- 2026-06-24: Booking real-time sync Slice 4. Authenticated browser smoke on local dev created, edited, and cancelled reservation `cmqs2rrjt000hkv9t8pp1kicm`; Dashboard moved Reserved 0 -> 1 without Refresh, `/bookings?tab=reservations` showed the row, an open booking detail sheet refreshed title/notes after the detail listener fix, cancellation removed the row from active reservations, and a Dashboard reload showed Reserved 0 with no stale smoke row. Proof notes/screenshots live under `tasks/archive/proofs/`.
- 2026-06-24: Booking real-time sync Slice 3. Dashboard and the shared booking list now mount a shared booking-change sync hook. The hook polls `/api/bookings/changes` only while visible and online, then invalidates dashboard, dashboard stats, booking-list, and changed booking-detail query keys when the server reports committed booking changes.
- 2026-06-24: Booking real-time sync Slice 2. Added bounded authenticated `GET /api/bookings/changes?since=<cursor>` as the server truth signal for later client invalidation. The route requires booking view permission, rate limits per signed-in user, returns `ok({ data: { cursor, changedBookingIds } })`, uses committed `Booking.updatedAt` plus indexed booking audit evidence, and scopes returned booking ids to the viewer.
- 2026-06-24: Booking real-time sync Slice 1. Dashboard full payload, dashboard stats, shared booking lists, and booking details now set `refetchOnMount: "always"` so a route remount or browser reload verifies server truth instead of treating warm dashboard/detail cache as fresh. Source-contract coverage pins the operational-query mount behavior while the bounded booking-change signal remains the next slice.
- 2026-06-16: Dashboard Upcoming Events now preserves the actual event title when an event has sport metadata but no opponent, preventing manual events like Lambeau Field Visit from collapsing to the sport label `Football`.
- 2026-06-15: Kiosk-only custody Slice 3. Dashboard quick actions and My Gear empty/prep states now create reservations only, and reservation rows no longer expose conversion to checkout outside a kiosk.
- 2026-06-11: Plan 039. Dashboard `View all` overflow links are now filter-aware. Previously the section header counts scoped to the active sport or location filter while the overflow footers only checked `activeSport`, so a location-only filter could show a scoped count above a `View all N` link pointing at the unfiltered total. Both columns now hide overflow totals whenever any dashboard filter is active across My checkouts, My reservations, Team checkouts, Awaiting pickup, Stale reservations, and Team reservations, while sport-specific empty-state copy is preserved.
- 2026-05-25: Web bug sweep Batch 47. Fix Today's `Review overdue` CTA now routes to the actual overdue checkout special filter (`/bookings?tab=checkouts&filter=overdue`) instead of the broad open-checkouts list, matching the dashboard banner and reports drill-down contract.
- 2026-05-25: Web bug sweep Batch 44. The dashboard header refresh icon button now exposes an explicit `Refresh dashboard` accessible name instead of relying on tooltip text, fixing the unnamed button surfaced by authenticated browser smoke.
- 2026-05-25: Web bug sweep Batch 36. Fix Today sample rows now use operator-readable Central-time dates for overdue checkout due times, pending pickup times, offline kiosk last-seen timestamps, and license expiry timestamps instead of leaking raw ISO strings in the admin daily queue.
- 2026-05-25: Web bug sweep Batch 22. Shared AppShell notification and overdue badge polling now uses shared auth redirects and safe JSON parsing for both ambient `/api/notifications` and `/api/dashboard/stats` reads, preserving last-known chrome counts when one response is malformed or unavailable instead of raw-parsing and dropping the whole badge refresh.
- 2026-05-25: Web bug sweep Batch 21. Dashboard data loading now uses shared auth redirects and safe JSON parsing for both the full dashboard payload and fast stats endpoint, so expired sessions and malformed gateway responses no longer fall through bespoke parsing paths. Booking-list and booking-detail actions reached from dashboard rows also picked up safer response parsing and guaranteed busy-state cleanup through the shared booking surfaces.
- 2026-05-24: Web bug sweep Batch 7. Dashboard fast stats now safe-parse cached stat responses instead of throwing on malformed JSON, and overdue nudge actions use a ref-backed guard plus shared error parsing so rapid clicks and non-JSON failures do not leave operators guessing.
- 2026-05-21: Design language Area 5 state/copy audit. Dashboard draft deletion now names the recovery-point consequence, rollback failures say the draft was restored, and extend/convert failures explain that the booking or reservation was not changed.
- 2026-05-20: **Design language slice 2:** Fix Today now uses the shared operational metric card and partial-results warning primitives so admin queue status, warning tone, and fallback copy match Inventory Hygiene.
- 2026-05-20: **Design language quick win:** Awaiting Pickup rows now use orange waiting treatment instead of green success treatment, keeping pending kiosk pickup visually separate from available/clean states.
- 2026-05-14: **Upcoming Events venue filter** — Home, Away, and Neutral now share the same venue tone system as Schedule: green for Home, orange for Away, and gray for Neutral. The dashboard Upcoming Events filter now includes a Neutral tab instead of hiding neutral-site events under All only.
- 2026-05-13: **Event work payload for iOS Home** — `/api/dashboard` now returns booking summaries with `eventIds` and `linkedEventId`, and adds `myEventWork` for the signed-in user's event-linked shift plus gear. Gear linkage now checks primary `Booking.eventId`, the `BookingEvent` junction, and `Booking.shiftAssignmentId`, so native Home can render one event row instead of separately inferring reservation/pickup and shift rows.
- 2026-05-13: **Admin Fix Today queue shipped** — `/admin/fix-today` gives admins a read-only daily action queue for overdue checkouts, pending pickup handoffs, offline kiosks, flagged maintenance items, low battery families, calendar sync failures, and license expirations. `GET /api/admin/fix-today` is `ADMIN`-only, uses bounded parallel reads with partial-failure metadata, and links every issue back to existing repair surfaces instead of adding one-off mutation paths.
- 2026-05-10: Status/data wiring ship fixes. The stat strip now labels custody as `Checked out` and deep-links to `OPEN` checkouts only, while Awaiting Pickup remains a separate `PENDING_PICKUP` operational lane.
- 2026-05-10: Scan handoff cleanup. Overdue banner quick action now opens the checkout detail instead of routing to stale app `/scan?checkout=...`; return scanning remains a kiosk flow.
- 2026-05-10: Schedule ownership pass. Dashboard Upcoming Events remains read-only and now avoids repeating open-slot copy when the coverage badge and row severity already communicate staffing state, keeping `/schedule` as the full management surface.
- 2026-05-10: **Dashboard cleanup polish:** Flagged Items banner now uses valid Tailwind arbitrary-value classes for orange border/background/hover treatments, so the warning surface renders with the intended severity styling. The banner CTA no longer points to unsupported `/items?status=flagged`; maintenance-only sets deep-link to `/items?status=MAINTENANCE`, while mixed damaged/lost/maintenance sets open `/items`. Dashboard section header counts now switch to visible filtered row counts when sport/location filters are active, avoiding mismatches between the badge and rendered rows. Awaiting Pickup remains a transient hide-when-empty card and now also hides when active filters remove every pending-pickup row. Inline dashboard row actions remain sibling controls, but are visible on touch-sized layouts instead of relying only on desktop hover.
- 2026-05-10: **Awaiting pickup routing cleanup:** Awaiting Pickup dashboard headers and overflow links now deep-link to `/bookings?tab=checkouts&status=PENDING_PICKUP`, matching the actual checkout lifecycle instead of sending operators to reservations.
- 2026-05-10: **Bookings status ship fixes:** Dashboard now exposes past-due `BOOKED` reservations as a separate Stale reservations card in Team Activity. Checkout overdue stats remain tied to `OPEN` checkouts only, preserving custody semantics.
- 2026-05-08: **Awaiting pickup section (Team Activity column)** — pendingPickup bookings (status `PENDING_PICKUP`, the gap between checkout creation and kiosk pickup) now render as a dedicated card between Team Checkouts and Team Reservations. Card only appears when `data.pendingPickups.items.length > 0` (transient state, hide-when-empty matches existing dashboard behavior). Each row uses `pending-pickup` accent (green left border) by default; flips to `pending-pickup-late` (amber left border + amber bg, same treatment as Due Today rows) when `startsAt < now`. The right-side badge shows `Pickup Today, 3:00 PM` / `Pickup Mar 24, 9:00 AM` for upcoming pickups, and a stronger `2h late` / `30m late` (orange) once the start time has passed. Sport+location filters apply (added `pendingPickups` to `FilteredDashboardData`). Section count clicks through to `/bookings?tab=checkouts&status=PENDING_PICKUP`. Backed by new `pendingPickups: { total, items[] }` field on `/api/dashboard` (top 5, overdue-late first). Files: `src/app/api/dashboard/route.ts`, `src/app/(app)/dashboard-types.ts`, `src/hooks/use-dashboard-data.ts`, `src/hooks/use-dashboard-filters.ts`, `src/app/(app)/dashboard/booking-row.tsx`, `src/app/(app)/dashboard/team-activity-column.tsx`, `src/lib/format.ts` (new `formatPickupLabel`).
- 2026-05-08: API hardening Wave 2. Dashboard and lightweight dashboard-stats API reads now use partial-failure handling for parallel query bundles. One failed side query falls back to an empty count/list, logs the failed segment, and returns `partialFailures` metadata instead of crashing the whole dashboard payload.
- 2026-03-01: Rewritten as concrete V1 ops-first dashboard spec with no standalone upcoming-events section.
- 2026-03-01: Added permission model and draft-system requirements.
- 2026-03-02: Linked dashboard mobile behavior to shared `AREA_MOBILE.md` contract.
- 2026-03-11: Docs hardening — resolved hedged features: saved filters → deferred, filter chips → deferred. Removed ambiguous "if low effort" qualifiers.
- 2026-03-11: **V2 shipped** — two-column split layout (global ops left, personal accountability right). Live countdown timers on "In My Possession" items. Overdue banner with click-through to booking detail. Donut charts removed (future Reports page). Upcoming Events section added. All roles see all data; students read-only. Mobile stacks right column first.
- 2026-03-12: **V3 dashboard redesign** — Column reorganization: left = "My Gear" (possession, my checkouts, my reservations), right = "Team Activity" (team checkouts excl. user, team reservations excl. user, events). Stat strip with 4 glanceable KPIs (checked out, overdue, reserved, due today). Overdue banner redesigned: solid Wisconsin red background, white text, pulsing dot, stacked item list with elapsed times, "View all overdue" link. Inline overdue badges on checkout rows ("3d overdue" red pill). Due-today row treatment with amber left border. "View all N →" overflow links on capped sections. Quick action buttons (New checkout, New reservation) in page header. Mobile: My Gear column stacks first, stat strip goes 2×2.
- 2026-03-16: **Drafts section shipped** — DRAFT booking persistence via `/api/drafts` CRUD. Dashboard shows Drafts card in My Gear column with Resume/Discard actions. Create flow auto-saves as draft on cancel. Draft pre-fills form on resume via `?draftId=` param. Draft deleted on successful booking creation. Closes GAP-2.
- 2026-03-16: Booking reference numbers (D-024) — refNumber badge shown on all dashboard booking rows (my checkouts, my reservations, team checkouts, team reservations).
- 2026-03-17: **My Shifts widget** — shows upcoming shift assignments with gear status (none/reserved/checked out) in left column. "Reserve gear" action links to checkout creation pre-filled with event context.
- 2026-03-22: **shadcn/ui migration** — Replaced all custom CSS avatar/badge/skeleton components with shadcn equivalents (Avatar, AvatarGroup, Badge, Skeleton, Progress). Removed 140 lines dead CSS. Section count badges, ref number badges, sport badges, gear status badges, due-date labels all now use shadcn Badge variants. Card headers standardized.
- 2026-03-22: **Dashboard UX hardening** — Draft discard requires confirmation dialog + toast feedback. Error state differentiates 401 (redirect to login) from network/server errors. Refresh indicator (progress bar) after sheet mutations. Due date labels inline on all checkout rows. Ref numbers shown as badges. My Shifts reordered above Drafts. My Reservations gets "View all" overflow. Welcome banner condition patched (checks reservations/drafts/shifts). Overdue banner uses API-provided initials. Microcopy pass: personalized empty states, "Prep gear" label, "Resolve all overdue" CTA.
- 2026-03-22: **Reliability hardening** — AbortController on dashboard fetch prevents race conditions and cancels on unmount. Refresh failures show toast instead of replacing visible data with error screen. Null-safe array guards on API response prevent crashes from partial backend data. Draft delete has try/catch for network errors, disabled state to prevent double-click, and 401 handling for expired sessions. `toast` dependency removed from `useCallback` deps via ref pattern to prevent infinite re-fetch loops.
- 2026-03-22: **UX polish** — Manual refresh button (spinning RefreshCw icon) with "Updated X ago" tooltip for data freshness visibility. Optimistic draft delete (instant removal + rollback on failure, no full-page reload). Skeleton loading uses varied widths per row to look like real content. Error states differentiated by icon (bell for offline, box for server) with reassuring copy ("usually temporary"). `lastRefreshed` timestamp tracks data age.
- 2026-03-23: **Sport filter chips** — Toggleable sport code filter chips below stat strip. Scopes all dashboard sections (My Checkouts, My Reservations, My Shifts, Team Checkouts, Team Reservations, Upcoming Events) to a single sport. URL-persisted via `?sport=MBB` query param. Client-side filtering on already-loaded data (no API changes). Contextual empty states ("No MBB checkouts"). Overdue banner intentionally unfiltered (safety-critical). Auto-hides when fewer than 2 sport codes present in data.
- 2026-03-25: Doc sync — standardized ACs to checkbox format. Unchecked AC-4 (7-day reservation filter not enforced in code — query fetches all BOOKED reservations without date window).
- 2026-03-25: **UX improvements batch** — (1) Removed donut/activity chart (stat strip KPIs remain). (2) Overdue banner now shows gear thumbnail avatars alongside user avatars for overdue items. (3) Time durations switched from compact ("3d") to explicit ("3 days 2 hours") across all dashboard labels. (4) Upcoming events show full sport names ("Men's Hockey vs Dartmouth") instead of code badges ("MHKY"). (5) Filter chips moved from below stat strip into page header toolbar for better integration.
- 2026-03-25: **Student role-adaptive dashboard** — STUDENT role sees only "My Gear" column (full width via `dashboard-single` layout), no stat strip, no quick actions. Team Activity column and team-wide stats hidden. **Owned-booking accent** — My Gear checkout/reservation rows display `border-l-2 border-l-primary` left accent for instant visual distinction from team rows.
- 2026-03-26: **React Query adoption** — `useDashboardData` hook migrated to `@tanstack/react-query`. Stale-while-revalidate, refetchOnWindowFocus, AbortSignal via queryFn. Refresh failures toast instead of replacing visible data. Error classification (auth/network/server). Optimistic updates via `queryClient.setQueryData`.
- 2026-03-28: **Flagged items banner** — New banner shows damaged/lost/maintenance items needing attention. Top 5 items with links to item detail. Color-coded by type. Staff/admin only.
- 2026-04-09: **CSS variable migration** — Replaced all non-brand CSS variables with Tailwind tokens across 8 dashboard files: `var(--text-sm)` → `text-sm`, `var(--panel)` → `bg-card`, `var(--panel-hover)` → `hover:bg-muted/60`, `var(--radius)` → `rounded-lg`, `var(--accent)` → `primary`, `var(--orange-*)` → `amber-*`, `var(--red-*)` → `red-*`. Only `var(--wi-red)` brand colors retained. Added 401 handling to overdue-banner `handleNudge`.
- 2026-04-09: **Stress test (4 issues found, 4 fixed):** BRK-001: Double-click race on inline actions — added `actionBusyRef` useRef guard to all mutation handlers. BRK-002: Per-item button disabling upgraded to global `acting` boolean (blocks ALL mutation buttons during any mutation). BRK-003: Cross-mutation gap closed — extend/convert and delete-draft now share a unified guard. BRK-004: Missing nudge double-click guard added.
- 2026-04-24: **MVP audit fixes** — Per-user rate limits on `/api/dashboard` (30/min), `/api/dashboard/stats` (90/min), and `/api/bookings/[id]/nudge` (30/min). Stats endpoint now returns `role`, used by the page for early-render gating so staff-only buttons no longer flash for students on warm cache loads. Overdue banner row converted from `<button>` containing nested `<Link>`/`<Button>` to `<div role="button">` with keyboard handlers — fixes HTML-spec violation and screen-reader confusion.
- 2026-04-24: **iOS Home audit fixes** — iOS overdue banner now reads `dashboard.overdueItems` (canonical top-N from backend) with the count from `overdueCount`, fixing the prior bug where the banner showed only items that happened to be in the capped my/team checkout lists (count vs banner could disagree, e.g. "12 Overdue" stat vs "2 Overdue Checkouts" banner header). Refresh failures now surface an inline pill instead of being silent. Added all-clear empty state for first-run students. `HomeViewModel.load` replaced its `hasLoaded`-once guard with a 60s freshness window so tab-back triggers a refresh when stale. `AppState.refresh()` switched from the heavy `/api/dashboard` to `/api/dashboard/stats` (now returns `myShiftsCount` too) — saves ~10 DB queries per badge refresh.
- 2026-05-05: **Cross-page state awareness audit** — Event command and missing-gear checkout flows preserve event context into the booking wizard, and missing-gear checkout now preserves the assigned requester. Dashboard detail interactions already preserve scroll because rows open `BookingDetailsSheet` in-place instead of navigating away.
- 2026-05-05: **Focused home dashboard pass**: Removed the stale reservation-specific extend endpoint branch and now routes all extend actions through `/api/bookings/[id]/extend`. Extracted shared `DashboardBookingRow` for My Gear and Team Activity rows, splitting primary row navigation from inline actions to avoid nested interactive controls. Filter clear moved out of the popover trigger button into a separate icon button. Row layout now truncates long names/titles predictably and hides gear avatar stacks on narrow mobile widths to protect tap targets.
- 2026-05-05: **Follow-up interaction cleanup**: Overdue banner rows now use a dedicated primary row button with check-in and nudge as sibling actions. Saved filter presets now use separate apply and delete buttons instead of a clickable badge containing a delete button. Production browser check rendered `/login` cleanly; protected dashboard visual inspection remains blocked without an authenticated session cookie.
- 2026-05-05: **Console polish pass**: Stat cards reduced from scoreboard-scale numbers to a quieter operational metric strip with labels first and subtle link affordances. Dashboard card headers now use shared `DashboardSectionHeader`, standardizing title, count, link, and header action layout across My Gear and Team Activity sections.
- 2026-05-05: **Live browser polish pass**: Local development login now hydrates correctly by allowing Next dev CSP requirements and unregistering the production service worker in development. The dashboard no longer emits the `dashboard-stats` missing-queryFn console warning. Shared shadcn buttons/toggles now use explicit transition properties plus `active:scale-[0.96]`, stat cards and booking rows have clearer focus-visible treatment, and the Upcoming Events header keeps its title readable by moving the Home/Away filter beneath it in narrow columns.
- 2026-05-06: **DevTools cleanup pass**: Upcoming event titles now keep sport and home/away text separated for both visual and accessibility output. Authenticated Chrome DevTools smoke testing found no dashboard API failures; remaining abort/retry entries are intentional stale-request cancellation during dev remounts.
- 2026-05-06: **Upcoming Events quick-view parity**: Dashboard upcoming events now carry schedule-style read-only coverage metadata from `/api/dashboard` and render event identity, time/location, home/away state, staffing avatars, coverage count, open-slot warning, and home call time where available. Quick-create booking controls were removed from the widget; `/schedule` remains the full management surface.
- 2026-05-07: **Avatar stack cleanup**: Dashboard gear previews now use a shared item thumbnail stack, while assigned-staff previews use the shared people avatar group with consistent tooltip and overflow behavior.
- 2026-08-13: **Team abbreviation display correction.** Dashboard booking rows, event projections, overdue items, drafts, and event-linked work now render known abbreviated team names such as `TCU`, `USC`, and `UCLA` in all caps, including legacy values, without rewriting stored booking or calendar-source data.
- 2026-05-08: **API hardening Wave 13**: Dashboard stats polling allowance increased to 180/min/user so 30s mobile refresh cadences have headroom without removing abuse protection.
