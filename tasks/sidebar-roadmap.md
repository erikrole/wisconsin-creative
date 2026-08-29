# Sidebar — Versioned Roadmap

**Target:** `src/components/Sidebar.tsx` + `src/components/AppShell.tsx`
**Created:** 2026-03-24
**Revised:** 2026-03-25 (full refresh — V1 shipped, V2 partially shipped)
**Status:** V1 shipped (2026-03-24), V2 partially shipped (groups, quick-create, and user-scoped due-today badge shipped; Settings sub-nav superseded by the role-aware Settings rail; desktop Lookup and sidebar shortcuts intentionally removed)

---

## Current State Assessment

### What exists today (post V1 + partial V2 ship)

**Sidebar.tsx** renders two nav groups using shadcn `Sidebar` with `collapsible="icon"`:

| Group | Items | Visible to |
|-------|-------|-----------|
| *(unlabeled)* | Dashboard, Schedule, Items, Bookings, Notifications | All roles |
| Admin | Kits, Users, Reports, Settings | ADMIN + STAFF only |

**Features shipped:**
- `SidebarMenuBadge` on Bookings (overdue count) and Notifications (unread count)
- `SidebarMenuAction` quick-create (+) on Bookings — admin/staff only, hover-reveal
- Kits has a static "Soon" badge (muted style)
- Role-based group filtering: STUDENT sees no Admin group
- User profile header: avatar + name, links to `/users/{id}`
- Brand mark (Badgers.png + "Wisconsin Creative" text)
- Theme toggle (light/dark/system) via `ToggleGroup` in footer
- Logout button in footer with loading state + network failure recovery
- Active item: red left border (`--wi-red`) + white text + opacity background
- Collapsed icon mode: `SidebarMenuButton tooltip` auto-shows label + badge context
- Mobile: shadcn Sheet drawer with same content as desktop
- Deep Wisconsin dark color scheme (`#1a1017` bg)

**AppShell.tsx** orchestrates the sidebar:
- Fetches `/api/me` for user identity
- Parallel fetches `/api/notifications` (unread count) + `/api/dashboard` (overdue count)
- Passes `overdueBadgeCount` + `unreadNotifications` as props to sidebar
- Renders mobile bottom nav (5 items: Home, Items, Reservations, Checkouts, Scan)
- Command palette (`Cmd+K`) for global search
- Topbar: SidebarTrigger, search bar, notification bell, profile icon
- Offline detection banner

### What works well (keep in all versions)
- Role-based group filtering (server validates too — sidebar is UI convenience, not security)
- Icon-only collapse with count-aware tooltips ("Bookings · 3 overdue")
- Mobile Sheet drawer with animated overlay
- Active-item visual: red left border is recognizable and on-brand
- Theme toggle placement in footer (low-frequency action, out of the way)
- Parallel badge fetch with AbortController cleanup

### What's missing or could improve

| Gap | Severity | Version target |
|-----|----------|---------------|
| No keyboard shortcuts for nav items (Cmd+1–5) | Closed | N/A |
| Bottom nav has no badge counts — urgency invisible on mobile home screen | Medium | V3 |
| Badge counts only refresh on full page navigation (no polling) | Medium | V3 |
| Settings has 6 sub-pages but sidebar link goes to flat `/settings` | Low | V2 |
| Kits "Soon" badge is stale — Kits V1+V2 shipped 2026-03-24/25 | Bug | V1 fix |
| No game-day/event context in sidebar — staff don't see what's happening today | Medium | V3 |
| Bookings nav item merges checkouts + reservations — no separate counts | Low | V3 |
| No "Scan" in sidebar (only in bottom nav) — intentional; web is laptop/desktop text-search work, not camera/hand-scan work | Closed | N/A |

### Data available but not surfaced in sidebar
- `/api/dashboard` → `data.myCheckouts.overdue`, `data.myCheckouts.dueToday`, reservation counts
- `/api/calendar-events` → today's events, upcoming game-day context
- `Booking` model → upcoming reservation count, due-today count
- `ShiftAssignment` → user's next shift (could show "Next shift: MBB @ 3pm")

### Roles and sidebar experience

| Role | Current experience | Ideal experience |
|------|-------------------|-----------------|
| STUDENT | 5 nav items, overdue badge on Bookings, unread on Notifications | Same + bottom-nav badges on mobile, shift context |
| STAFF | 9 nav items in 2 groups, quick-create on Bookings | Same + Settings sub-nav, keyboard shortcuts, event context |
| ADMIN | Same as STAFF | Same as STAFF + system health indicators in sidebar |

### Mobile viability
- Sidebar opens as Sheet drawer — full-featured, works well
- Bottom nav provides 5 quick-access items (no badges)
- No sidebar-specific mobile issues; main gap is bottom-nav badge absence

---

## V1 — Core (Shipped 2026-03-24)

**Principle:** The sidebar should never lie by omission. Urgency is visible. Dead ends are labeled.

**Status: SHIPPED** — all features below are live.

### Features included
1. **Overdue badge on Bookings** — `SidebarMenuBadge` with red pill, count from `/api/dashboard`
2. **Unread badge on Notifications** — `SidebarMenuBadge` with red pill, count from `/api/notifications`
3. **Kits "Soon" badge** — static muted badge indicating upcoming feature
4. **Semantic nav groups** — Operations (unlabeled) + Admin with `SidebarGroupLabel`
5. **Quick-create on Bookings** — `SidebarMenuAction` with `+` icon, admin/staff only
6. **Hardening** — dead CSS removed, AbortController cleanup, isLoggingOut guard, count-aware tooltips, STUDENT-scoped overdue (own bookings only)

### shadcn components used
- `SidebarMenuBadge`, `SidebarMenuAction`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarSeparator`

### API routes
- None new. Reused `/api/notifications` + `/api/dashboard`.

### What's NOT in V1
- No keyboard shortcuts
- No polling/real-time badge updates
- No bottom-nav badges
- No Settings sub-navigation
- No event context

---

## V2 — Enhanced (Improved UX, Reduced Friction)

**Principle:** Now that badges and groups work, make navigation faster and smarter. Add convenience features that reduce clicks and improve discoverability.

**Status:** Partially shipped. User-scoped due-today badge shipped on 2026-06-28. Settings sub-navigation is superseded by the current role-aware Settings rail and command palette because Settings now has many Personal and admin sections, not the original six-page admin-only shape. Lookup was removed from the web sidebar on 2026-06-28 because laptop/desktop use relies on text search rather than scan posture. Sidebar Cmd/Ctrl+number shortcuts were removed because they conflict with browser and system shortcuts.

### Features

**1. Remove stale Kits "Soon" badge** (bug fix)
- Kits V1 (CRUD + member management) shipped 2026-03-24
- Kits V2 (kit-to-booking integration) shipped 2026-03-25
- Remove the `badge: "Soon"` from the Kits nav item — it's misleading now
- Keep Kits in Admin group (admin/staff only)

**2. Lookup stays out of the web sidebar**
- Removed from V2 scope.
- Web is used on laptops and desktops, where the command palette/search bar is the correct text lookup path.
- Mobile and native scan entry points remain the scan posture surfaces.
- 2026-06-28: Removed after review; do not add `/scan` to the web sidebar unless the desktop workflow changes.

**3. Settings collapsible sub-navigation**
- Settings has 6 sub-pages: calendar-sources, sports, categories, database, escalation, venue-mappings
- Use shadcn `Collapsible` + `SidebarMenuSub` + `SidebarMenuSubItem` to show sub-links
- Collapsed by default; expand on click or when any `/settings/*` route is active
- Sub-items: Calendar Sources, Sports, Categories, Escalation, Venue Mappings, Database
- Admin-only (same as Settings parent)
- In icon-only collapsed mode: clicking Settings icon navigates to `/settings` (no sub-nav)
- 2026-06-28: Superseded. Settings is now available to every authenticated user and owns its full role-aware rail/search palette inside `/settings`, so the global sidebar keeps a single top-level Settings link instead of duplicating every sub-page.

**4. Sidebar shortcuts removed**
- Removed from V2 scope.
- Do not register Cmd/Ctrl+number navigation from the app shell; those chords overlap browser tab switching and system expectations.
- `Cmd+K` (search) remains the only global app-owned shortcut in this slice.
- 2026-06-28: Removed after review.

**5. Due-today secondary badge on Bookings**
- Currently shows overdue count only
- Add a secondary amber/muted badge for due-today count when overdue is 0
- When both overdue AND due-today exist, show overdue only (red takes priority)
- Data already available: `dashJson.data.myCheckouts.dueToday`
- Tooltip updates: "Bookings · 2 overdue" or "Bookings · 1 due today"
- 2026-06-28: Shipped using `myDueTodayCount` from `/api/dashboard/stats`, so the sidebar badge stays user-scoped like the existing overdue badge.

### What V1 features get enhanced
- Bookings badge: gains due-today secondary count
- Nav items: no Scan/Lookup entry on web; use command palette/search bar for text lookup.
- Settings: gains collapsible sub-nav
- Tooltips stay label/count-only; no shortcut hints.

### What's NOT in V2
- No live polling (still refresh-on-navigate only)
- No bottom-nav badges
- No event/game-day context
- No search within sidebar

### API routes needed
- None new. Due-today count already in `/api/dashboard` response.

### RBAC
- Scan: not a web-sidebar destination; mobile/native scan entry points remain role-scoped by their existing surfaces.
- Settings sub-nav: admin only (STAFF can see Settings parent per current group config)
- Keyboard shortcuts: no sidebar shortcuts; global search keeps existing Cmd/Ctrl+K behavior.

### Loading/error/empty states
- Settings sub-nav: renders immediately (no data fetch — static links)
- Due-today badge: same pattern as overdue — absent while loading, hidden on error

### Mobile behavior
- No Scan item in the web sidebar drawer; bottom nav and native iOS scan surfaces remain unchanged.
- Settings sub-nav: fully functional in Sheet drawer
- Keyboard shortcuts: no sidebar shortcuts.
- Due-today badge: visible in Sheet drawer same as overdue badge

### shadcn components used
- `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` (already installed)
- `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton` (part of sidebar.tsx)

### Files changed
- `src/components/Sidebar.tsx` — remove Kits "Soon" badge, keep scan out of web sidebar, add due-today badge logic
- `src/components/AppShell.tsx` — pass `dueTodayCount` prop; keep only existing global search shortcut

---

## V3 — Advanced (Predictive, Automated, Intelligent)

**Principle:** The sidebar anticipates user needs. It surfaces the right information at the right time and automates urgency signaling across all surfaces.

### Features

**1. Live nav counts via `/api/nav-counts` endpoint**
- New lightweight endpoint returning role-scoped counts:
  ```json
  {
    "overdue": 3,
    "dueToday": 1,
    "reservedUpcoming": 5,
    "unreadNotifications": 2,
    "pendingTrades": 1
  }
  ```
- Replaces the dual `/api/notifications` + `/api/dashboard` fetch in AppShell
- Single query with `Booking` + `Notification` + `ShiftTrade` counts
- STUDENT-scoped: server filters to requesting user's bookings/notifications
- AppShell polls every 60s with `setInterval` + AbortController cleanup
- Page Visibility API: pause polling when tab is hidden, resume on focus
- Badges update in real-time without full page navigation

**2. Bottom nav badge counts (mobile)**
- Extend `bottomNavItems` in AppShell to accept `badge?: number`
- Wire overdue count to Checkouts bottom nav item
- Wire unread count as red dot on a new Notifications bottom nav item (or replace one of the 5)
- Reuses same `/api/nav-counts` data — zero additional fetches
- Badge renders as a small red circle with count (matches sidebar badge style)
- Closes AREA_MOBILE.md gap: urgency visible on mobile home screen

**3. Game-day event context in SidebarHeader**
- Fetch next upcoming event from `/api/calendar-events?upcoming=true&limit=1`
- If an event starts within 4 hours or is happening now, show compact game-day card:
  - Sport badge (e.g., "MBB")
  - Event title (truncated)
  - Time ("3:00 PM" or "NOW")
  - Click → `/schedule?date={eventDate}`
- Rendered below user profile in SidebarHeader
- Hidden in collapsed icon mode (`group-data-[collapsible=icon]:hidden`)
- Staff/admin only — students see their shifts on dashboard, not event management
- Pulses or highlights when event is within 1 hour (game-day urgency)

**4. Shift context for students**
- For STUDENT role, show next shift assignment in SidebarHeader (where staff sees event context)
- Fetch from `/api/shifts/my?upcoming=true&limit=1`
- Shows: "Next shift: MBB @ 3:00 PM" with sport badge
- Click → `/schedule` filtered to that day
- Hidden when no upcoming shifts

**5. Contextual quick actions based on route**
- When on `/items/[id]`, sidebar Bookings item shows "Book this item" action
- When on `/schedule` with an event selected, Bookings shows "Gear up for [event]"
- Implementation: AppShell reads route params and passes context to Sidebar
- Lightweight — just changes the `quickCreateHref` query params

### What's NOT in V3
- No drag-to-reorder nav items (not useful for 9-item nav)
- No inline booking creation within sidebar (too much surface area)
- No WebSocket push (polling every 60s is sufficient for team size <50)
- No saved filter state in sidebar (filters live on pages, not nav)
- No sidebar search box (Cmd+K command palette already serves this)

### API routes needed
- `GET /api/nav-counts` — new, read-only, fast (~3 SQL queries, <50ms)
- Existing `/api/calendar-events` and `/api/shifts/my` reused for context cards

### Schema changes
- None. All data computed from existing `Booking`, `Notification`, `CalendarEvent`, `ShiftAssignment` models.

### RBAC
- `/api/nav-counts`: all roles, scoped to own data for STUDENT
- Event context card: STAFF + ADMIN only
- Shift context card: STUDENT only
- Bottom nav badges: all roles

### Loading/error/empty states
- Nav counts: badges absent during initial load, hidden on fetch error
- Polling error: silently retry on next interval (no toast/banner for background poll)
- Event/shift context: hidden when no upcoming event/shift (most of the time)
- Bottom nav badges: same as sidebar — absent while loading

### Mobile behavior
- Bottom nav badges are the primary V3 mobile improvement
- Game-day / shift context cards visible in Sheet drawer
- Polling respects Page Visibility API — no battery drain when app backgrounded

### shadcn components used
- `Badge` (for sport code in event/shift context)
- Existing `SidebarHeader` section (already structured for additional content)

### Files changed
- `src/app/api/nav-counts/route.ts` — new endpoint
- `src/components/AppShell.tsx` — replace dual fetch with nav-counts polling, pass event/shift context, wire bottom nav badges
- `src/components/Sidebar.tsx` — event context card, shift context card, contextual quick actions
- `src/app/globals.css` — bottom nav badge styling

---

## Dependencies

| Version | Schema changes | Other pages/components required | API routes | Shared components to extract |
|---------|---------------|-------------------------------|-----------|------------------------------|
| V1 | None | None | None new | Badge prop pattern |
| V2 | None | None | None new | `navGroups` config with keyboard shortcut map |
| V3 | None | None | `GET /api/nav-counts` (new) | Nav count hook (`useNavCounts`) for reuse by dashboard |

---

## Risks

### Scope creep — V1 into V2
- "Add search to sidebar" — **DEFER.** `Cmd+K` command palette already exists. Adding a second search input creates confusion.
- "Add Reservations as separate nav item" — **DEFER.** Bookings is unified per D-002. Separate items would contradict the data model.

### V2 YAGNI
- **Keyboard shortcuts (Cmd+1–5)**: **DO NOT SHIP.** These conflict with browser tab switching and system shortcut expectations.
- **Settings sub-nav**: Only useful if staff visit Settings frequently. Currently Settings is low-traffic (calendar sources + escalation config are set-once). May not justify the UI complexity. **Mitigation:** Ship collapsible-collapsed-by-default so it doesn't add visual weight.

### V3 scope traps
- **"Game day mode" skin**: The event context card is enough. A full theme/layout change for game days is over-engineered for a team of <20 people.
- **WebSocket push for badge counts**: Polling every 60s is fine for this team size. WebSockets add infrastructure complexity (connection management, reconnection logic, Vercel limitations) for marginal gain.
- **Making `/api/nav-counts` too rich**: Must stay tiny — counts only. No booking data, no item data, no event details. Those belong in their dedicated endpoints.

### Coupling risks
- V3's polling interval (60s) must not conflict with dashboard's own fetch cycle. Consider deduplication via shared hook or React context.
- Event/shift context cards share SidebarHeader space with user profile. Needs careful layout so collapsed mode doesn't break.

---

## Build Order

### V2 (estimated: 1 session)
1. Remove Kits "Soon" badge (5 min)
2. Add Scan nav item to Operations group (10 min)
3. Add due-today secondary badge logic (15 min)
4. Settings collapsible sub-nav with `SidebarMenuSub` (30 min)
5. Remove sidebar keyboard shortcuts from AppShell (done 2026-06-28)
6. Verify STUDENT role sees correct items, test collapsed mode (10 min)

### V3 (estimated: 2 sessions)
1. `GET /api/nav-counts` route (30 min)
2. AppShell: replace dual fetch with nav-counts + add 60s polling (30 min)
3. Sidebar: event context card for staff/admin (45 min)
4. Sidebar: shift context card for students (30 min)
5. Bottom nav: badge count wiring + CSS (30 min)
6. Page Visibility API: pause/resume polling (15 min)
7. Test all three roles at all breakpoints (20 min)

---

## North Star Alignment

| Principle | V1 (shipped) | V2 | V3 |
|-----------|-------------|----|----|
| Operational speed | Overdue visible without navigating | Due-today urgency without conflicting shortcuts | Counts update live; context cards surface what's next |
| Mobile-first | Sheet drawer badges work | Scan in sidebar matches bottom nav | Bottom nav badges close mobile urgency gap |
| Student-first | Own overdue only; admin group hidden | Scan prominently placed | Shift context card; scoped counts |
| Event-driven | N/A | N/A | Game-day context card links to schedule |
| Tag-first identity | N/A | N/A | N/A (sidebar is navigation, not item display) |
| Audit trail | N/A | N/A | N/A (sidebar is read-only) |
| Derived status | Counts computed, not stored | Same | `/api/nav-counts` is fully computed |
