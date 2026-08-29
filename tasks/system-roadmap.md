# Wisconsin Creative — System Roadmap

## Document Control
- Author: System Architecture Review
- Date: 2026-04-03
- Status: Living roadmap — update when shipping features or revising priorities
- Scope: Full-system analysis and three-version evolution plan
- Previous: 2026-03-28 (post-Beta hardening pass); this revision reflects security hardening + registration gating

---

## STEP 1: SYSTEM OVERVIEW

### Core System Purpose

Wisconsin Creative is the internal gear management system for Wisconsin Athletics Creative. It replaces Cheqroom with an **event-driven, athletics-specific operational system** built for game-day media operations at Camp Randall Stadium and Kohl Center.

**Primary value**: Operational speed, clarity, and trust for check-outs, reservations, and gear handling. The right metric is not feature count — it's whether a student can check out a camera kit in three taps, and whether staff always know who has what gear.

### Primary Users

| Mode | Who | Context | Success Metric |
|------|-----|---------|---------------|
| **Students** | Student crew members | Phone, stadium/arena, often rushed | Find and act on due/overdue checkouts within 2 taps |
| **Staff** | Full-time Athletics Creative staff | Desktop + mobile, managing all users/gear | Act on any booking from dashboard within 1 click |
| **Admins** | Technical admins, senior leads | Desktop-primary, lower frequency | Investigate any incident from audit log alone |

### Key Domains — Current Maturity

| Domain | Pages | Maturity | Notes |
|--------|-------|----------|-------|
| **Booking** (checkouts, reservations, drafts) | `/checkouts`, `/reservations`, `/bookings/[id]` | **Polished** | Unified detail page, ref numbers, scan flow, partial check-in, equipment picker V2 (search-on-type), kit integration, overdue priority sort, audit log pagination |
| **Inventory** (items, bulk SKUs, accessories) | `/items`, `/items/[id]`, `/bulk-inventory` | **Solid** | DataTable with sort/filter, derived status, numbered bulk units, parent-child accessories, 9-field search, favorites, CSV export with truncation warning |
| **Kits** (equipment grouping) | `/kits`, `/kits/[id]` | **Solid** | V1 CRUD + member management. V2 kit-to-booking integration (kitId FK, selector, display) |
| **Events** (calendar, ICS sync) | `/events/[id]`, `/schedule` | **Solid** | ICS ingest, unified schedule page, event detail hardened, shift generation failure surfaced to UI |
| **Users** (roles, profiles, assignments) | `/users`, `/users/[id]` | **Polished** | Tiered RBAC, sport/area assignment CRUD, avatar system, 5-pass hardened |
| **Shifts** (scheduling, trades) | `/schedule` | **Polished** | Decomposed (1,012→117 lines), auto-generation, trade board, gear integration, V2 enhancements |
| **Dashboard** (ops console) | `/` | **Polished** | V3 shipped, decomposed into hooks + 7 leaf components, sport/location filters, saved filters, overdue banner, drafts |
| **Notifications** (escalation, email) | `/notifications` | **MVP** | In-app + email dual-channel, 4 escalation triggers, dedup, pagination, mark-as-read. Hobby cron limits latency to ~24h. |
| **Reports** | `/reports/*` | **Solid** | 5 report types with charts, URL-persisted filters, drill-down links |
| **Security** (auth, registration gating) | `/login`, `/register`, `/settings/allowed-emails` | **Polished** | Registration gated by admin-managed email allowlist (D-029), bcrypt+HMAC sessions, rate limiting, CSRF origin validation, SESSION_SECRET entropy validation, deactivated user login blocking, security headers (HSTS, X-Frame-Options, CSP candidates) |
| **Settings** (admin config) | `/settings/*` | **Solid** | Categories, sports, escalation, calendar sources, venue mappings, allowed emails, DB diagnostics |
| **Import** | `/import` | **Solid** | Generic CSV with Cheqroom preset, dry-run, lossless (D-014), batched DB ops |
| **Search** | `/search`, Cmd+K | **Solid** | Debounced auto-search, users scope, recent searches |
| **Scan** | `/scan` | **Polished** | Decomposed (1,038→251 lines), 5-pass hardened, optimistic updates, spam-click guards |
| **Labels** | `/labels` | **Scaffold** | Label generation exists; linked from item detail context menu but isolated |

---

## STEP 2: CURRENT ARCHITECTURE

### Pages & Flows

**Complete page tree** (39 pages, 10,382 total lines):

| Page | Lines | Primary Flow | Inbound From | Outbound To |
|------|-------|-------------|--------------|-------------|
| `/` (Dashboard) | 265 | Daily ops triage | Login, sidebar | Checkout/reservation detail, scan, schedule |
| `/checkouts` | 5 | Redirect → BookingListPage | Sidebar, dashboard | Checkout detail, create checkout |
| `/checkouts/[id]` | 7 | Redirect → BookingDetailPage | Dashboard, list, search | Scan, item detail, user detail |
| `/reservations` | 5 | Redirect → BookingListPage | Sidebar, dashboard | Reservation detail, create reservation |
| `/reservations/[id]` | 7 | Redirect → BookingDetailPage | Dashboard, list, search | Item detail, convert to checkout |
| `/bookings` | 208 | Unified booking list | Sidebar | Booking detail |
| `/items` | 429 | Browse/manage inventory | Sidebar | Item detail, create item |
| `/items/[id]` | 737 | Item detail + history | Items list, scan, search | Checkout/reservation links, QR, labels |
| `/kits` | 308 | Kit management | Sidebar (staff+) | Kit detail |
| `/kits/[id]` | 591 | Kit detail + members | Kits list | Item detail (member links) |
| `/schedule` | 117 | Events + shifts + trades | Sidebar | Shift detail panel, trade board, event detail |
| `/events/[id]` | 617 | Event detail + command center | Schedule page | Shift assignments, bookings |
| `/scan` | 251 | QR scan entry point | Sidebar, dashboard, mobile nav | Item detail, checkout detail |
| `/users` | 308 | User management | Sidebar | User detail |
| `/users/[id]` | 409 | User detail + activity | Users list, profile redirect | Booking links |
| `/profile` | 41 | Redirect → `/users/{id}` | Header avatar | User detail |
| `/notifications` | 426 | Notification center | Header bell icon | Booking detail links |
| `/reports` | 12 | Report hub | Sidebar | Sub-report pages |
| `/reports/checkouts` | 376 | Checkout metrics | Reports hub | Checkout list (drill-down) |
| `/reports/overdue` | 375 | Overdue metrics | Reports hub | Checkout list (drill-down) |
| `/reports/utilization` | 365 | Utilization metrics | Reports hub | Item list (drill-down) |
| `/reports/audit` | 258 | Audit log viewer | Reports hub | — |
| `/reports/scans` | 320 | Scan activity | Reports hub | — |
| `/settings/*` | 191–298 ea | Admin config (6 sub-pages) | Sidebar | — |
| `/import` | 736 | CSV import pipeline | Sidebar | Items list (post-import) |
| `/labels` | 249 | Label generation | Sidebar, item detail | — |
| `/search` | 256 | Cross-entity search | Cmd+K, sidebar | Item/booking detail |
| `/bulk-inventory` | 435 | Bulk SKU management | Sidebar | — |

**Navigation Health**:
- **Dead ends resolved**: Reports have drill-down links; labels linked from item detail
- **Remaining weak links**: `/labels` has limited outbound; `/bulk-inventory` isolated from main item flows; `/reports/audit` and `/reports/scans` lack drill-down
- **Orphan risk**: `/bookings` exists alongside `/checkouts` and `/reservations` — unclear sidebar distinction

### API Surface (112 routes)

| Category | Count | Notes |
|----------|-------|-------|
| Auth | 5 | Login, register, logout, forgot/reset password. All rate-limited. |
| Assets | 16 | CRUD + accessories + duplicate + QR + image + maintenance + retire + insights + brands + bulk + export + picker-search + favorite |
| Bookings | 9 | CRUD + cancel + extend + nudge + audit-logs (cursor-paginated) |
| Checkouts | 12 | Scan suite + admin-override + complete variants |
| Reservations | 5 | CRUD + cancel + convert + duplicate |
| Bulk SKUs | 7 | CRUD + adjust + convert-to-numbered + units |
| Calendar | 7 | Events + sources CRUD + sync + command center |
| Shifts | 15 | Groups + assignments + trades (CRUD + approve/decline/swap/request) |
| Users | 7 | CRUD + activity + role + reset-password + me + profile + avatar |
| Admin Config | 10 | Locations + categories + departments + sport-configs + roster + student-areas + location-mappings |
| Kits | 4 | CRUD + members |
| Notifications | 4 | List + nudge + process + cron (timing-safe secret) |
| Reports | 1 | POST with type parameter |
| Other | 10 | Items-page-init, drafts, dashboard, form-options, availability, migrate, seed, db-diagnostics, my-shifts |

### Shared Patterns (Established & Consistent)

- `withAuth()` API route decorator — all 112 routes
- `requirePermission()` enforcement on all mutations
- `createAuditEntry()` on all mutations (D-007)
- shadcn/ui components system-wide (42 components installed)
- `AbortController` fetch pattern on all client pages
- Refresh-preserves-data pattern (toast on failure, not error screen wipe)
- `useFormSubmit` on all create/edit forms (auth, kit, bulk, user creation)
- `useFetch` + `useUrlState` + `useDebounce` on all data-loading pages
- High-fidelity skeletons on all list pages
- 401 → login redirect on all fetch calls
- Error differentiation (network vs server) on all hardened pages
- Toast feedback on all mutations (success/error/warning via Sonner)
- Rate limiting on all auth endpoints
- SERIALIZABLE transactions on all booking/scan/allocation mutations

### Remaining Inconsistencies

1. **React Query adoption is ~70%**: Dashboard, Items, Notifications, Bulk Inventory, Users, Schedule all use `useQuery` (via `useFetch` or custom hooks). But **Kits** uses raw `useState`+`useEffect`, **Search** uses raw `fetch()`, and **Bookings** delegates internally. These work fine but miss cache/dedup benefits.
2. **URL state persistence is inconsistent**: Items, Dashboard, Notifications, Search use `useUrlState`/`useUrlSetState`. Kits, Bulk Inventory, Users use local state only — filters lost on navigation.
3. **Loading indicator variance**: Most pages use Skeleton components (correct). Search page uses Spinner (divergent).
4. **Data fetching strategy**: Some pages use dedicated init endpoints (`/api/items-page-init`), others make multiple parallel `useFetch` calls. Both work but no shared cache layer across pages.
5. **Page sizes**: `/items/[id]` (737 lines), `/import` (736 lines), `/events/[id]` (617 lines), `UserInfoTab.tsx` (613 lines) — candidates for decomposition but not blocking.
6. **Detail page architecture**: Items detail is the gold standard (tab extraction, inline edits). Events detail diverges in structure. Kit detail is similar but simpler.
7. **Reports partial failure**: `Promise.all` in report queries means one slow query fails the entire report — no partial results.

### Schema Surface Coverage

| Model | UI Status | Notes |
|-------|-----------|-------|
| SystemConfig | **Zero UI** | Key-value config store, no admin surface. Low priority — only used internally for escalation. |
| All other 34 models | **Full UI** | Every model has API + UI coverage. FavoriteItem, StudentSportAssignment, StudentAreaAssignment all have CRUD UI (previously documented as gaps but were already shipped). |

---

## STEP 3: SYSTEM VERSION ROADMAP

### V1 — Cohesive Foundation ✅ COMPLETE (2026-03-24)

All V1 items shipped. See previous roadmap revision for details.

### V2 — Connected Experience ✅ COMPLETE (Beta Release 2026-03-27)

All V2 items shipped. Key deliverables:
- Scan page decomposition (1,038→251 lines)
- Schedule page decomposition (1,012→117 lines)
- Full hook adoption across all pages
- Kit-to-booking integration
- `useFormSubmit` adopted across all forms (auth, kit, bulk, user)
- Search-on-type equipment picker (eliminated unbounded asset query)
- Database performance audit (SERIALIZABLE everywhere, 6 indexes, dashboard consolidation)
- API security audit (rate limiting, timing-safe secrets, cursor pagination)
- React Query installed (GAP-11 partially addressed)
- Reports with charts, favorites UI, search overhaul

### V2+ — Post-Beta Polish (Current Phase)

**Goal**: Harden remaining rough edges, fix silent failures, close documentation debt. Ship independently without version bumps.

#### Shipped (2026-03-28 – 2026-04-03)

| Item | Status | Date | Notes |
|------|--------|------|-------|
| Dead code cleanup | ✅ | 03-28 | Deleted CreateBookingCard (323 lines), centralized getInitials |
| Booking audit log pagination | ✅ | 03-28 | Cursor-based `/api/bookings/[id]/audit-logs` + "Load older entries" UI |
| Calendar sync shift failure surfacing | ✅ | 03-28 | Warning toast when shift generation fails after successful sync |
| CSV export truncation warning | ✅ | 03-28 | X-Truncated header + UI warning at 5,000 item cap |
| Toast warning variant | ✅ | 03-28 | Added `warning` type to Toast hook |
| Gap registry cleanup | ✅ | 03-28 | Closed 4 stale gaps (GAP-19, 22, 23 + events monolith risk) |
| Cross-cutting security audit | ✅ | 03-30 | SERIALIZABLE on all shift/scan/booking transactions, CSRF Origin enforcement, reports `Promise.allSettled` |
| Registration gating (D-029) | ✅ | 04-03 | AllowedEmail table, admin UI at Settings > Allowed Emails, role pre-assignment, registration endpoint gated |
| SESSION_SECRET entropy validation | ✅ | 04-03 | Minimum 32 characters enforced at startup |
| Deactivated user login blocking | ✅ | 04-03 | Login endpoint checks `user.active` before password verification |
| Existing users backfilled to allowlist | ✅ | 04-03 | Migration 0027 seeds 4 existing users as claimed entries |

#### Remaining V2+ Items

##### Pattern Consistency Cleanup (Size: S)
- **Kits page**: Migrate from raw `useState`+`useEffect` to `useFetch` (React Query) for consistency with other list pages
- **Search page**: Migrate from raw `fetch()` to `useFetch`; replace `Spinner` with `Skeleton` to match other pages
- **URL state persistence**: Add `useUrlState` to Kits and Bulk Inventory filters (currently local state only — filters lost on navigation)

##### Inline Dashboard Actions (Size: M)
- **Overdue quick actions**: Extend and check-in buttons directly on overdue rows
- **Reservation convert**: "Start checkout" button on reservation dashboard rows
- **Notification actions**: Each notification row gets a primary CTA

##### Cross-Page State Awareness (Size: M)
- **Event context propagation**: Event Command Center → Create Checkout passes `?eventId=X`
- **Scroll position preservation**: Dashboard → detail sheet → back preserves scroll
- **Item availability timeline**: Item detail calendar tab shows conflict warnings

##### Security Hardening (Size: S)
- **CSP header**: Add Content-Security-Policy for XSS defense-in-depth (`default-src 'self'; script-src 'self'`)
- **User deactivation feature**: Wire up the `User.active` field with admin UI toggle (login blocking is already in place; needs UI + booking migration per `BRIEF_USER_DEACTIVATION_V1.md`)

##### Student Availability Tracking (Size: M)
- V1 shipped: students declare recurring weekly unavailability blocks via `StudentAvailabilityBlock`
- Shift assignment surfaces availability conflicts; auto-assign/trade paths preserve conflict notes
- Optional follow-up: date-specific exceptions if recurring weekly blocks are not enough

##### Shift Email Notifications (Size: S)
- Email channel for trade claims and shift assignment changes
- Extends existing Resend infrastructure

---

### V3 — Intelligent System

**Goal**: The system anticipates needs, automates repetitive tasks, and provides operational intelligence.

#### 3.1 Exception-Focused Admin Queue (Size: M)

Keep staff/admin work focused on concrete exceptions rather than a game-day score:
- **Fix today**: overdue gear, pending pickup orphans, offline kiosks, sync failures, low batteries, and license expirations
- **No readiness score**: do not add an aggregate Game-Day Readiness Score or separate ops-view surface without a new product decision
- **Role-specific emphasis**: students see their own gear first; staff/admin see actionable exceptions

#### 3.2 Unified Search V2 (Size: L)

- Current: Cmd+K searches assets, checkouts, reservations in separate sections
- Target: Single search across all domains with type indicators
- Include: items, checkouts, reservations, users, events, kits
- Backend: Server-side search endpoint (Postgres full-text when scale demands)
- UX: Keyboard-navigable, type-ahead, category filters

#### 3.3 Automation (Size: L)

- **Auto-generate bookings from recurring events**: Football Home → auto-reserve Camera Kit A
- **Bulk check-in by scan session**: Scan all → system matches open bookings → one-tap confirm
- **Scheduled notifications**: Evening-before-game-day gear reminders
- **Shift → checkout auto-linking**: Shift assignment auto-creates reservation for standard area kit

#### 3.4 Operational Intelligence (Size: L)

- **Usage analytics**: Most-used items, peak checkout times, average duration by sport
- **Equipment health scoring**: Age + usage frequency + maintenance history
- **Peak usage prediction**: Historical data → forecast busy periods
- **Audit log search**: Admin UI for searching/filtering audit entries

#### 3.5 Deeper Integration (Size: L)

- **Event changes cascade**: Rescheduled event updates linked bookings' dates (with confirmation)
- **Maintenance scheduling**: Track usage hours, suggest intervals, auto-flag overdue service
- **Multi-source event ingestion**: Beyond UW Badgers ICS (Phase C)
- **Admin-configurable equipment guidance**: DB rules replacing code rules (D-016 Phase C)
- **Kiosk mode**: Self-serve scan station for game-day operations (Phase C)

---

## STEP 4: CROSS-CUTTING FEATURES

| Feature | Current State | V2+ Target | V3 Target |
|---|---|---|---|
| **Error handling** | `classifyError()` shared; all pages differentiate network vs server; 401 redirect; calendar sync surfaces partial failures | Reports use `Promise.allSettled` for partial results | React Query automatic retries |
| **Loading states** | High-fidelity skeletons on all hardened pages. Search page uses Spinner (inconsistent) | Standardize Search to Skeleton. All decomposed components have proper skeletons | Streaming/suspense for progressive loading |
| **Empty states** | shadcn `<Empty>` on all pages; contextual messages on filtered views | Context-aware CTAs on filtered empty states | Proactive suggestions based on role + current event |
| **Toast notifications** | Sonner with success/error/warning; all mutations covered | Standardize messages (past tense success, retry guidance on error) | Undo on destructive toasts |
| **Confirmation dialogs** | AlertDialog on all destructive actions | Batch confirmations ("Cancel 3 selected?") | — |
| **Form validation** | `useFormSubmit` with Zod on all create/edit forms; `skipAuthRedirect` for auth pages | Inline field-level validation with debounced server checks | — |
| **RBAC enforcement** | `requirePermission()` on all mutations; UI gating; stress-tested | Maintain coverage on new features | Row-level security if multi-tenant |
| **Audit logging** | `createAuditEntry()` on all mutations (verified); 90-day retention via weekly cron | Maintain coverage | Audit log search/filter UI for admins |
| **Auth & security** | bcrypt (cost 10) + HMAC-SHA256 sessions; httpOnly/secure/sameSite cookies; CSRF Origin validation; rate limiting on all auth endpoints; SESSION_SECRET entropy validation; deactivated user login blocking; registration gated by AllowedEmail (D-029); security headers (HSTS 2yr, X-Frame-Options DENY, nosniff, Referrer-Policy); Sentry error tracking; timing-safe cron secret | Add CSP header for XSS defense-in-depth | Persistent rate limiter (Redis/KV) if scale demands |
| **Mobile responsiveness** | All pages validated; 44px+ tap targets; iOS fixes | Validate inline dashboard actions on mobile | PWA with offline read cache |
| **Keyboard accessibility** | Cmd+K palette; tab shortcuts on item detail; arrow keys in picker | Audit tab order; shortcuts on all detail pages | Full shortcut layer (J/K, Enter/Esc) |
| **Pagination** | Cursor-based on asset activity + booking audit logs; offset on all list pages | Cursor pagination on remaining unbounded queries | — |
| **Rate limiting** | In-memory sliding window on all auth endpoints (resets on cold start) | Extend to mutation-heavy endpoints if abuse detected | Persistent rate limiter (Redis/Upstash KV) |

---

## STEP 5: DATA & STATE STRATEGY

### Current State

| Layer | Pattern | Used By |
|-------|---------|---------|
| **Server state** | `useFetch()` hook with AbortController + Visibility API refresh | All data-loading pages (fully migrated) |
| **URL state** | `useUrlState()` hook + `useSearchParams` | Dashboard, reports, items, schedule, notifications, search |
| **Local state** | `useState` for form inputs, modals, loading flags | All pages |
| **Derived state** | `useMemo` for filtered/sorted views | Dashboard, items, schedule, booking history |
| **Persisted local** | `localStorage` for saved filters, view mode, My Shifts toggle | Dashboard, schedule |
| **React Query** | ~70% adoption via `useFetch`/custom hooks. QueryClient configured (1min stale, 5min GC). Not used by: Kits (raw useState), Search (raw fetch), Bookings (delegated) | Migrate remaining pages for consistency |

### How Data Flows Across Pages

- **Re-fetch on mount**: Every page fetches fresh data. Dashboard → Checkout Detail → Dashboard = 3 full fetches.
- **URL params for context**: `?sport=MBB`, `?draftId=X`, `?eventId=X`, `?location=Camp+Randall` pass minimal context.
- **Detail sheets**: `BookingDetailsSheet` receives ID, fetches own data. Parent refreshes on close via `onUpdated`.
- **Visibility refresh**: `useFetch` hook includes Page Visibility API — re-fetches when tab becomes active (universally adopted).
- **No WebSocket/SSE**: All data is request-response. No real-time updates across tabs.

### Data Risks

| Risk | Severity | Current Mitigation | Recommendation |
|------|----------|-------------------|----------------|
| **Re-fetch on every navigation** | Medium | No shared cache; Visibility refresh helps tab-switching | V3: React Query with stale-while-revalidate |
| **Stale data across tabs** | Low | Visibility API refresh in `useFetch` (universally adopted) | Adequate for current user count |
| **Race conditions on mutations** | Low | SERIALIZABLE transactions everywhere + P2034 retry | Adequate |
| **N+1 queries** | Low | Consolidated init endpoints; batch DB ops; audit log batching | Monitor |
| **Unbounded result sets** | Low | Pagination on all lists; cursor-based on activity + audit logs; picker-search paginated | Adequate |
| **Audit log growth** | Medium | 90-day retention via weekly cron (batch delete 1,000/query); cursor pagination | Monitor quarterly; adjust retention window if table exceeds 10x current size |
| **Reports partial failure** | Low | `Promise.all` — one slow query fails entire report | V2+: Switch to `Promise.allSettled` for partial results |
| **CSV export cap** | Low | 5,000 item cap with UI truncation warning (shipped 2026-03-28) | Adequate for current inventory (~500 items) |

### Recommendations by Version

**V2+** (no new dependencies):
- Switch reports to `Promise.allSettled` for partial failure resilience
- Add section-level caching on dashboard if performance degrades

**V3** (adopt React Query system-wide):
- Replace `useFetch` with `useQuery` — automatic cache, background refresh, deduplication
- Migration path: one page at a time (dashboard → items → checkouts → rest)
- Shared cache eliminates re-fetch-on-every-navigation problem
- Optimistic mutations via `useMutation` replace manual rollback patterns

**V3+** (real-time, only if justified):
- Server-Sent Events for dashboard overdue count and checkout status
- Only justified for game-day mode or multi-user concurrent operations

---

## STEP 6: DEPENDENCIES & ORDER

### V2+ Remaining Dependency Graph

```
Independent (no blockers):
    ├──→ Pattern consistency cleanup (Kits, Search, URL state)
    ├──→ User deactivation UI (login blocking done; needs admin toggle)
    ├──→ Inline dashboard actions (dashboard already decomposed)
    ├──→ CSP header (next.config.ts only)
    ├──→ Cross-page state awareness (URL params, scroll preservation)
    ├──→ Student availability tracking (V1 shipped; optional date-specific exceptions remain)
    └──→ Shift email notifications (shipped for trade lifecycle)

Completed:
    ├── ✅ Reports Promise.allSettled (2026-03-30)
    ├── ✅ Registration gating D-029 (2026-04-03)
    └── ✅ Security hardening — entropy, login blocking (2026-04-03)
```

All remaining V2+ items are independent — no sequential blockers.

### What Blocks V3 Improvements

| Blocker | What It Blocks | Status |
|---------|---------------|--------|
| V2 hook adoption | React Query migration (need consistent patterns) | ✅ Complete |
| Dashboard decomposition | Game-Day Mode (needs component-level control) | ✅ Complete |
| Kit-to-booking integration | Automation (kit-based auto-reservations) | ✅ Complete |
| Scan decomposition | Bulk check-in by scan session | ✅ Complete |
| Student availability model | Shift automation conflict warnings | Shipped V1; date-specific exceptions optional |
| Historical usage data | Equipment health scoring, peak prediction | Needs time to accumulate |

### V3 Dependency Graph

```
React Query migration (V3-A)
    │
    └──→ Game-Day Mode (benefits from cache + background refresh)
              │
              └──→ Scheduled notifications (game-day context awareness)

Unified Search V2 (V3-B)
    └──→ Independent (new endpoint + Cmd+K upgrade)

Automation (V3-D)
    ├──→ Auto-generate bookings (requires event sync ✅ + kit integration ✅)
    ├──→ Bulk check-in by scan (requires scan decomposition ✅)
    └──→ Shift-checkout auto-linking (requires shift ✅ + kit integration ✅)

Operational Intelligence (V3-E)
    └──→ Independent (new reports endpoints + admin UI)

Deeper Integration (V3-F)
    ├──→ Event cascade (requires event sync foundation ✅)
    ├──→ Maintenance scheduling (requires new schema)
    └──→ Kiosk mode (requires scan foundation ✅)
```

### Quick Wins (Ship Independently, No Blockers)

| Item | Effort | Impact | Notes |
|------|--------|--------|-------|
| ~~Reports `Promise.allSettled`~~ | ~~S~~ | ~~Medium~~ | ~~Shipped 2026-03-30~~ |
| Kits page → `useFetch` migration | S | Low — consistency win | Replace raw useState+useEffect with useFetch |
| Search page → `useFetch` + Skeleton | S | Low — consistency win | Replace raw fetch + Spinner |
| CSP header | S | Low — defense-in-depth | Single line in next.config.ts |
| Event context propagation (`?eventId=` param) | S | Medium — fewer manual selections in checkout | URL param only |
| Notification deep-links to booking detail | S | Medium — notifications become actionable | Already partially wired |
| URL state on Kits/Bulk Inventory filters | S | Medium — filters survive navigation | Add useUrlState to 2 pages |
| ~~Shift email notifications~~ | S | Shipped — trade lifecycle emails | Extends Resend |
| Remember last-used filters (localStorage) | S | Medium — fewer clicks per session | Dashboard already does this; extend to items/bookings |

---

## STEP 7: RISKS & COMPLEXITY

### Overengineering Risks

| Idea | Risk Level | Reasoning |
|------|-----------|-----------|
| Predictive gear suggestions (V3) | High | Requires historical data at scale; team is small. Rule-based per sport is sufficient. |
| Real-time SSE/WebSocket (V3) | Medium | Only for multi-user concurrent ops (game day). Polling + visibility refresh covers 90%. |
| PWA offline mode (V3) | Medium | Students have reliable campus WiFi. Offline mutations add complexity for rare benefit. |
| Equipment health scoring (V3) | Low risk | Valuable but requires structured maintenance data that doesn't exist yet. |
| Full React Query migration before V2+ features | Medium | `useFetch` wraps `useQuery` on ~70% of pages already. Migrate remaining 3 pages incrementally, not as a big-bang. |

### Tight Coupling Concerns

- **Dashboard ↔ API shape**: Monolithic data object. New sections require API changes. Break into section endpoints if performance degrades.
- **BookingDetailPage ↔ booking-actions.ts**: Action gating tightly coupled to status enum. Status vocabulary (D-025) translation must stay in sync.
- **Equipment guidance ↔ code**: D-016 keeps 3 rules in code. Fine for now but blocks operator self-service.
- **Resolved 2026-05-10 - Scan hooks ↔ checkout API**: app `/scan` is lookup-only and no longer couples page hooks to checkout scan endpoints. Checkout pickup and return execution stays in kiosk routes.

### Scaling Considerations

| Dimension | Current | 2x Users | 10x Inventory |
|-----------|---------|----------|---------------|
| Page load time | Fast (Neon serverless, paginated) | Fine | Need cursor pagination on items list |
| Dashboard query | Single API call | May need lazy-loaded sections | Section-level caching |
| Search | Client-side filter in Cmd+K | Fine | Server-side full-text (Postgres `tsvector`) |
| Audit log | Cursor-paginated, no retention | Fine short-term | Retention policy or archival needed |
| Notification volume | Daily cron + dedup | Fine | Fine — dedup prevents explosion |
| CSV export | 5,000 cap with UI warning | Fine | Streaming CSV or background job |
| Equipment picker | Search-on-type with server pagination | Fine | Fine — already paginated |

### Scope Creep Boundaries

The V2+/V3 boundary is most likely to blur on:
- **React Query adoption** during V2+ work — resist; `useFetch` is adequate. React Query is V3.
- **Game-Day Mode** pulled forward because readiness score seems "simple" — requires significant dashboard rework and new data aggregation.
- **Unified search** expanding into Postgres full-text — client-side is fine for current scale.
- **Automation** before availability conflict data is respected — V1 conflict data exists; future automation must continue honoring it.

---

## STEP 8: IMPLEMENTATION STRATEGY

### V2+ Recommended Order

| # | Item | Effort | Impact | Notes |
|---|------|--------|--------|-------|
| ~~1~~ | ~~**Reports `Promise.allSettled`**~~ | ~~S~~ | ~~Medium~~ | ~~Shipped 2026-03-30~~ |
| ~~2~~ | ~~**Registration gating (D-029)**~~ | ~~M~~ | ~~High~~ | ~~Shipped 2026-04-03~~ |
| ~~3~~ | ~~**Security hardening (entropy, login blocking)**~~ | ~~S~~ | ~~Medium~~ | ~~Shipped 2026-04-03~~ |
| 4 | **Pattern consistency cleanup** | S | Medium | Kits→useFetch, Search→useFetch+Skeleton, URL state on Kits/Bulk |
| 5 | **User deactivation UI** | M | Medium | Wire BRIEF_USER_DEACTIVATION_V1 — login blocking done, needs admin toggle + booking migration |
| 6 | **Inline dashboard actions** | M | High | Overdue extend/checkin without page navigation |
| 7 | **CSP header** | S | Low | XSS defense-in-depth; low risk but easy |
| 8 | **Cross-page state awareness** | M | Medium | Event context, scroll preservation |
| 9 | ~~**Student availability tracking**~~ | M | Shipped V1 | Weekly recurring blocks + assignment conflict warnings; date-specific exceptions optional |
| 10 | ~~**Shift email notifications**~~ | S | Shipped | Trade lifecycle emails extend existing Resend infrastructure |

### Page Decomposition Backlog (Optional)

These pages work correctly but are candidates for decomposition when touched next:

| Page | Lines | Priority | Notes |
|------|-------|----------|-------|
| `/items/[id]` | 737 | Low | Tab extraction would help; gold-standard architecture but large |
| `/import` | 736 | Low | Multi-step wizard could be extracted; works well as-is |
| `/events/[id]` | 617 | Low | GAP-20 closed after hardening; further decomposition optional |
| `UserInfoTab.tsx` | 613 | Low | Contains TextInputField/SelectInputField inline; could extract |

### V3 Rollout Plan

| Phase | Items | Approach | Prerequisites |
|-------|-------|----------|---------------|
| **V3-A** | React Query migration | One page at a time: dashboard → items → checkouts → rest | V2+ complete |
| **V3-B** | Unified Search V2 | New server endpoint + Cmd+K upgrade | Independent |
| **V3-C** | Game-Day Mode | Dashboard widget + readiness score API | V3-A (cache) |
| **V3-D** | Automation | Booking templates, bulk check-in, scheduled notifications | V3-A + shipped availability conflict data |
| **V3-E** | Operational Intelligence | New report endpoints + admin analytics UI | Independent |
| **V3-F** | Deeper Integration | Event cascade, maintenance, kiosk mode | Each independent |

### Parallelization Strategy

**Can run in parallel** (independent):
- All V2+ items (touch different files/domains)
- V3-B (search) alongside V3-A (React Query)
- V3-E (intelligence) alongside any other V3 phase
- Page decomposition (each page independent)

**Should be sequential**:
- V3-A (React Query) before V3-C (Game-Day Mode)
- Availability conflict data before shift automation (V3-D) — V1 now shipped

### Effort Estimates

| Size | Definition | Example |
|------|-----------|---------|
| **S** | 1-3 hours, 1-3 files | Shift email, reports allSettled, notification deep-links |
| **M** | 3-8 hours, 3-8 files | Inline dashboard actions, date-specific availability exceptions, page decomposition |
| **L** | 1-3 days, 8+ files | React Query migration, unified search V2, game-day mode |

---

## Change Log
- 2026-03-23: Initial system roadmap created. Full architecture analysis, three-version plan.
- 2026-03-24: V2 revision. V1 marked complete. V2 plan detailed.
- 2026-03-26: V3 revision. V2 mostly complete. Updated domain maturity levels. New systemic gaps (GAP-19–23).
- 2026-03-27: Alpha → Beta release (v0.2.0). V2 marked COMPLETE. Late additions: React Query, reports charts, search overhaul, favorites UI.
- 2026-03-28: Post-Beta revision. V2+ polish items shipped (dead code cleanup, audit log pagination, calendar sync failure surfacing, CSV export truncation warning). Closed 4 stale gaps (GAP-19, 22, 23 + events monolith risk). All 26 documented gaps resolved except GAP-4 (Phase C unscoped), GAP-11 (cross-page cache), GAP-21 (SystemConfig UI). Updated maturity: Users→Polished, Booking→Polished (audit log pagination). Added reports partial failure and page decomposition backlog. Revised V2+ → V3 boundary.
- 2026-04-03: Security hardening revision. Added Security domain (Polished maturity). Shipped: registration gating (D-029, AllowedEmail table + admin UI), SESSION_SECRET entropy validation (32+ chars), deactivated user login blocking, existing users backfilled to allowlist. Updated pattern consistency analysis — React Query adoption measured at ~70% (Kits/Search/Bookings remain on raw patterns). Added V2+ items: pattern consistency cleanup, user deactivation UI, CSP header. Updated cross-cutting table with Auth & Security row. Revised V2+ recommended order (3 items shipped, 7 remaining). Updated quick wins list.
