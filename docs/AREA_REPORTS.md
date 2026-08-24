# AREA: Reports & Analytics

## Document Control
- Area: Reports & Analytics
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-23
- Status: Active
- Version: V1

## Direction
Provide staff and admin with analytics dashboards to track checkout/reservation activity, utilization patterns, scan success rates, badge awards, and audit events. Reports are read-only views gated to ADMIN/STAFF. The separate Accountability surface is an internal team-visible late-return leaderboard with ADMIN-only intervention and data-quality controls.

## Core Rules
1. All reports are ADMIN/STAFF only (enforced on routes and endpoints), except the Audit report, which is ADMIN only (`report.audit`) to match the admin-only `/api/audit` browse feed.
2. Reports are tab-based: users navigate between report types via sidebar link to `/reports` which redirects to `/reports/utilization`.
3. Each report has metric cards plus the filters its data can honestly support. Period selectors keep their existing per-report query-param names (`days` on Utilization, Checkouts, and Badges; `period` on Scans and Audit) so existing links stay valid, and the chosen window is remembered across report tabs for the session. A URL param always wins over the remembered window.
4. Data is cached via React Query with focus refresh.
5. Empty states and error states use EmptyState + retry. Report bodies dim and set `aria-busy` while a background refresh is in flight, so stale numbers never read as current. When independent query groups fail, usable sections remain visible with additive `partialFailures` and a warning that zeros or empty sections are not final.
6. Report-local CSV exports download only the currently visible report rows and must say that in the action/copy, except Utilization, Checkouts, Overdue, Audit, Scans, and Missing Units where the CSV action exports the full filtered, report-evidence, or row-level inventory result from a bounded server-backed endpoint.
7. `/reports/overdue` remains the live open-custody queue and therefore has no period selector. `/accountability` owns historical late-return patterns, appears in primary navigation for ADMIN/STAFF/STUDENT, and never replaces or mutates custody evidence. Collaborators remain default-deny under D-041. Overdue links admins across to Accountability without merging the two surfaces.
8. Prior-period deltas appear only where a comparable preceding window exists. All-time selections show no delta, an empty prior window shows the raw difference instead of an infinite percentage, and metrics that are themselves rates report percentage points.
9. Report surfaces print without app chrome: sidebar, section nav, refresh/export controls, pagination, and expand toggles are omitted, while active filter chips are retained so a printout states its own scope.
10. `/reports/usage` is not role-granted. It is visible only when the signed-in email appears in the default-deny `USAGE_ANALYTICS_OWNER_EMAILS` environment allowlist. ADMIN alone is insufficient.
11. Product usage events contain only allowlisted event, platform, surface, outcome, version, duration-bucket, session, and enum-property fields. Users and sessions are stored as rotating HMAC values; URLs, record IDs, search text, scan values, and free-form content are rejected.
12. The named **App activity** view is not a general report. It lives in Settings, is absent from Reports navigation, and is visible only to the configured `USAGE_ANALYTICS_OWNER_EMAILS` identity. ADMIN role alone cannot discover or open it.
13. App activity reports client presence, not a guaranteed install census: a client must successfully send an authenticated app-open or surface event. Distribution-channel classification can be `Unknown channel`, and build freshness is `Compare unavailable` until `IOS_LATEST_APP_VERSION` / `IOS_LATEST_APP_BUILD` is configured.

## Routes

### `/reports`
- **Page:** `src/app/(app)/reports/page.tsx`
- **Behavior:** Redirects to `/reports/utilization`

### `/reports/layout.tsx`
- **Layout:** Shared section navigation bar showing all 7 report types:
  - Utilization (default)
  - Checkouts
  - Overdue
  - Scans
  - Missing Units
  - Audit
  - Badges
- **Styling:** Uses the shared `SectionNav` treatment with a quiet translucent shell, 40px+ link targets, and an active underline; responsive on mobile

### `/reports/utilization`
- **Page:** `src/app/(app)/reports/utilization/page.tsx`
- **Type:** Custody-utilization report over a selected window, plus an inventory snapshot
- **Metrics:** Utilization rate (share of available asset-days spent in custody), total days in custody, distinct gear used, assets idle for the whole period, and assets never checked out. Idle value is shown only alongside the count of idle assets that actually have a recorded purchase price, since price coverage is partial.
- **Charts:** Most-used gear ranked by days in custody, and a status-distribution donut whose legend entries are the per-status drill-downs into `/items`.
- **Tables:** Idle gear (highest recorded value first, with last-checked-out date), and by-location / by-category / by-type / by-department breakdowns rendered as share-of-total rows with proportional bars. Location, category, and department rows link into `/items` using ids the items page parses; `type` is free text with no matching items filter, so those rows stay informational.
- **Filters:** Period (30d, 90d default, 1y). No all-time option: a utilization rate needs a bounded denominator.
- **Data:** `GET /api/reports/utilization?days=...`. JSON responses include additive `partialFailures` when an independent aggregate or lookup fails; successful sections remain available.
- **Export:** `GET /api/reports/utilization?format=csv&days=...` returns up to 5,000 inventory rows with derived status, stored status, physical identity fields, location, department, category, availability flags, and per-asset period columns (checkouts, custody days, utilization, last checked out), plus `X-Exported-Count`, `X-Total-Count`, and `X-Truncated` headers when capped.
- **Semantics:** Custody windows come from the booking, not from `AssetAllocation`: check-in flips allocations to `active: false` without stamping an actual return time, so an allocation's `endsAt` stays at the planned date. `COMPLETED` checkouts use `completedAt`, `OPEN` checkouts run to now, and both are clamped to the selected window, using the same basis accountability uses for lateness. Idle and never-checked-out counts exclude `RETIRED` assets. A failed aggregate may use a safe zero or empty fallback only when its section name also appears in `partialFailures` and both clients render that warning.

### `/reports/checkouts`
- **Page:** `src/app/(app)/reports/checkouts/page.tsx`
- **Type:** Tabular report with filterable list
- **Columns:** Title, requester, due date, item count, status
- **Metrics:** Total custody checkout activity in the selected period (with a prior-period delta and a trend sparkline), currently overdue checkouts
- **Charts:** Daily checkout trend, top requesters, and a theme-aware blue 365-day heatmap where stronger intensity means more custody activity. Selecting a day in the trend or the heatmap narrows the checkout row list to that day; the metrics and charts stay on the selected period so the day keeps its context.
- **Filters:** Period (7d, 30d, 90d), plus an optional focused day
- **Data:** `GET /api/reports/checkouts?days=...&date=YYYY-MM-DD`. JSON responses include additive `partialFailures` when an independent aggregate or requester lookup fails; successful sections remain available.
- **Focus day:** `date` is validated as `YYYY-MM-DD` and interpreted as a UTC day to match the daily aggregates. It scopes only `recentCheckouts` (to 50 rows) and is cleared whenever the period changes.
- **Export:** `GET /api/reports/checkouts?format=csv&days=...` returns up to 5,000 matching custody checkout activity rows with `X-Exported-Count`, `X-Total-Count`, and `X-Truncated` headers when capped.
- **Semantics:** Checkout activity metrics, charts, heatmap, and CSV exports count actual custody rows only: `OPEN` and `COMPLETED` checkouts. `DRAFT`, `PENDING_PICKUP`, and `CANCELLED` checkout rows are excluded so awaiting pickup does not inflate custody analytics.

### `/reports/overdue`
- **Page:** `src/app/(app)/reports/overdue/page.tsx`
- **Type:** List of overdue bookings with escalation status
- **Columns:** Requester, overdue bookings, average overdue time, location, outstanding item summary
- **Metrics:** Total overdue checkouts, number of people holding overdue gear
- **Filters:** Location. Options are derived from bookings that are currently overdue, so the filter never offers a choice that yields an empty report, and the control is hidden when fewer than two locations are involved. No period filter: this is the live open-custody queue, not a historical window.
- **Behaviors:** Expand requester row to inspect overdue bookings and deep-link to booking detail. Admins get a cross-link to `/accountability` for repeat patterns.
- **Data:** `GET /api/reports/overdue?location=...`
- **Export:** `GET /api/reports/overdue?format=csv&location=...` returns up to 5,000 overdue checkout rows with requester, booking, due time, overdue hours, location, outstanding item count, outstanding item summary, `X-Exported-Count`, `X-Total-Count`, and `X-Truncated` headers when capped.
- **Semantics:** Only open checkouts past `endsAt` are overdue. Item summaries count active serialized allocations and outstanding bulk quantities, not already-returned gear.

### `/reports/scans`
- **Page:** `src/app/(app)/reports/scans/page.tsx`
- **Type:** Scan activity analytics
- **Columns:** Timestamp, actor, item, phase, booking, result
- **Metrics:** Total scans in the selected period (with a prior-period delta and volume sparkline), success rate (with a percentage-point delta)
- **Charts:** Daily scan volume by success/fail
- **Filters:** Period (all, 7d, 30d, 90d), phase (all, checkout, check-in)
- **Data:** `GET /api/reports/scans?limit=...&offset=...&startDate=...&endDate=...&phase=...`
- **Export:** `GET /api/reports/scans?format=csv&startDate=...&endDate=...&phase=...` returns up to 5,000 matching rows with `X-Exported-Count`, `X-Total-Count`, and `X-Truncated` headers when capped.
- **Semantics:** API rejects invalid dates, inverted date ranges, and phases outside `CHECKOUT` or `CHECKIN`.

### `/reports/bulk-losses`
- **Page:** `src/app/(app)/reports/bulk-losses/page.tsx`
- **Type:** Missing-unit tracking for quantity-tracked and unit-tracked families
- **Columns:** Item family, category, missing count, date detected, location, battery unit number, last holder, booking handoff
- **Metrics:** Missing units, item families affected, users involved, battery units, missing batteries, missing rate, repeated battery patterns
- **Tables:** Missing units by family, missing units by requester, recent missing-unit events, missing rate by family, missing battery units, recent battery checkout history
- **Signals:** Repeated missing battery patterns by item family and by last known requester
- **Filters:** Location and category, applied through the owning `BulkSku`. Options are derived from families that actually have missing units, and each control is hidden when fewer than two options exist. There is deliberately **no date-range filter**: a unit only carries `status: LOST`, and its `updatedAt` moves on any later edit, so there is no trustworthy "went missing on" timestamp to range over. Adding one would require a dedicated `lostAt` column and a backfill.
- **Filter scope:** The filters narrow every SKU-derived section (family counts, requester attribution, battery audit, missing rate, repeat patterns). The "Recent missing-unit events" card is a raw check-in audit feed keyed by booking, not by SKU, so it stays system-wide and says so in its description whenever a filter is active.
- **Data:** `GET /api/reports/bulk-losses?location=...&category=...`
- **Export:** `GET /api/reports/bulk-losses?format=csv&location=...&category=...` returns up to 5,000 report-evidence rows across missing-unit family counts, requester attribution, recent missing-unit events, battery family summaries, missing battery units, battery checkout history, and repeat patterns with `X-Exported-Count`, `X-Total-Count`, and `X-Truncated` headers when capped.

### `/reports/audit`
- **Page:** `src/app/(app)/reports/audit/page.tsx`
- **Type:** Audit log viewer (ADMIN only, enforced by `report.audit` on the route and hidden from STAFF nav/search/breadcrumb siblings)
- **Columns:** Timestamp, actor, action, resource (item/booking/user), details, outcome
- **Metrics:** Total events in the period, with a prior-period delta rendered without a good/bad direction since audit volume is neither
- **Charts:** Event frequency over time, action breakdown, actor breakdown
- **Filters:** Period (all, 7d, 30d, 90d)
- **Data:** `GET /api/reports/audit?limit=...&offset=...&startDate=...&endDate=...&action=...`
- **Export:** `GET /api/reports/audit?format=csv&startDate=...&endDate=...&action=...` returns up to 5,000 matching rows with `X-Exported-Count`, `X-Total-Count`, and `X-Truncated` headers when capped.

### `/reports/badges`
- **Page:** `src/app/(app)/reports/badges/page.tsx`
- **Type:** Staff analytics for badge recognition, not the primary profile experience
- **Metrics:** Total awards, awards in the selected period (with a prior-period delta), active definitions, manual award count/rate
- **Tables:** User leaderboard, badge distribution, underused active definitions, recent manual recognition, recent awards
- **Filters:** Period (30d default, 90d, 1y)
- **Data:** `GET /api/reports/badges?days=...`

### `/reports/usage`
- **Access:** Explicit product-owner email allowlist only. It is absent from report navigation and returns 403 for every other user, including ADMIN users.
- **Metrics:** Counted events and yearly-pseudonymous active people for 7, 30, or 90 days.
- **Breakdowns:** Platform, normalized surface, allowlisted event, and app-version adoption.
- **Data:** `POST /api/product-events` accepts the strict shared event contract; `GET /api/reports/usage?days=...` returns aggregates only.
- **Collection:** Web records app open plus normalized route-family views. Native iOS records app open plus primary tab destinations. Collection failure never blocks an operational workflow.
- **Retention:** `morning-refresh` deletes raw events older than 90 days. The private report is bounded to the same maximum window.

### `/settings/app-activity`
- **Access:** Explicit product-owner email allowlist only. The Settings layout, direct route, breadcrumb siblings, global search, and `GET /api/settings/app-activity` all fail closed for every other identity, including ADMIN users.
- **Type:** Named adoption/support dashboard over visible roster users, with current pseudonymous client installations nested beneath each person.
- **User signals:** Used/never opened, last launch, active/inactive roster state, and latest seen client.
- **Client signals:** Web or iOS platform, coarse device model, OS version, marketing version, build number, first/last seen, last launch, and best-effort TestFlight/App Store/development channel.
- **Build state:** iOS rows compare their reported build to the optional `IOS_LATEST_APP_VERSION` / `IOS_LATEST_APP_BUILD` server configuration and expose Latest, Stale, Newer, or Compare unavailable.
- **Data model:** `UserAppInstallation` stores one current row per user/HMAC installation/platform tuple. The raw installation key is never stored; no UDID, serial number, IDFA, receipt contents, URL, search text, record ID, or content is accepted.

### `/accountability`
- **Access:** ADMIN, STAFF, and STUDENT through `accountability.view`, with a primary-sidebar and global-search entry. COLLABORATOR remains default-deny and cannot open the route or API.
- **Type:** Team-visible late-return leaderboard with expandable checkout evidence. ADMIN retains the intervention and reversible data-quality workflow.
- **Ranking:** Selectable through `sort`. `events` (default) ranks by late-event count, then total late hours, then most recent incident; `time` ranks by total late hours first; `recent` ranks by most recent incident first. The page frames rank 1 as the "wrong leaderboard" with a gentle jeer, not recognition or an award.
- **Time:** Defaults to the current July 1-June 30 academic year, with four prior years and all-time available.
- **Filters:** Academic year, location, active/resolved/overdue-extension incident state, and active/inactive user state. Non-default filters surface as removable toolbar chips.
- **Metrics:** People on the board, late events, total late time, and currently overdue checkouts. ADMIN also sees excluded-record count.
- **Presentation:** Shares the report kit (`ReportToolbar`, `MetricCard`, `ReportDataRegion`, `ReportSectionCard`, mobile cards). A responsive top-three spotlight uses avatars, concise wrong-leaderboard copy, and one-shot reduced-motion-safe transitions when ranking changes. Its three unique jeers are dealt from a source-owned 50-line deck using the stable ordered leaderboard fingerprint, so every internal viewer sees the same set, reloads keep it fixed, and meaningful membership, order, or incident changes rotate it. The full desktop leaderboard reduces each person to five scan targets: identity, late-event count plus active-overdue state, total/typical/worst late-time pattern, a prominent return-record percentage, and an explicit 40px history disclosure. Return-rate bars clamp to full red at 50% and below, interpolate continuously through the middle rates, and reach full green at 100%. Below `xl`, the same hierarchy becomes cards instead of a squeezed table. Expanded checkout evidence stays grouped as complete incident records with booking identity, due context, late duration, return state, and ADMIN action together.
- **Semantics:** `OPEN` rows use current time; `COMPLETED` rows use `completedAt`. Both compare against `endsAt + checkout_policies.gracePeriodHours`. An extension made after the prior due time plus grace is a separate late episode, even when the new due time prevents a later late return. On-time rate appears only after three completed checkouts.
- **Data:** `GET /api/accountability` returns the shared ranking, the shared `spotlightJeers` draw, and server-owned capability flags. STAFF/STUDENT responses receive the same jeer set as ADMIN for identical leaderboard state while continuing to omit exclusion rows, notes, and excluded-record metrics. `POST /api/accountability/exclusions` and `DELETE /api/accountability/exclusions/{bookingId}` remain ADMIN-only.
- **Export:** ADMIN-only `GET /api/accountability?format=csv` exports the filtered person-level ranking in the on-screen sort order through the shared report-export rate limit. Non-admin export attempts fail before report work. Columns cover rank, identity, late events, active overdue, total/median/worst late hours, total and completed checkouts, on-time rate, and last incident.
- **Cleanup:** ADMIN exclusions require a reason, retain the booking and all custody evidence, write audit evidence in the same SERIALIZABLE transaction, and can be restored.

## Native iOS surface

`/reports` on web has no native equivalent; iOS instead carries one glanceable operational report at Browse > Reports (`ios/Wisconsin/Views/ReportsView.swift`), visible only to STAFF/ADMIN.

- **Reads:** `GET /api/reports/utilization?days=` and `GET /api/reports/checkouts?days=`, both unchanged by the native client.
- **Period:** a single 30d/90d control. Checkouts accepts 7/30/90 and utilization accepts 30/90/365, so the shared picker uses the overlap. A period change clears values from the old window, becomes the newest request owner immediately, and rejects any late response from the superseded window.
- **Reliability:** utilization and checkout activity load as independent failure domains. One successful response remains visible if its peer fails. Additive `partialFailures` keeps usable response data visible with an incomplete-data warning and prevents the result from being marked fresh.
- **Content:** utilization rate, checkouts with a prior-period delta, currently overdue, an interactive checkout-activity chart, a status donut, most-used gear by custody days, and idle / never-checked-out counts. Overdue pushes the existing native `OverdueReportView`.
- **Deliberately web-only:** CSV export, audit, badge analytics, missing units, breakdown drill-downs, and every filter beyond the period. Deep reporting and authoring stay on web per the mobile scope contract.
- **Version tolerance:** the utilization `custody` block, `days`, `activeAssets`, and both report `partialFailures` fields decode as optional. A shipped build meeting a server that predates the custody rebuild or failure metadata still renders the response it understands. `ios/WisconsinTests/ReportModelsTests.swift` pins both payload shapes.

## Components

**Shared across reports:**
- `MetricCard` — report-local adapter around `OperationalMetricCard`, preserving report drill-down links, tooltips, badges, and string values while using the shared operational metric primitive. Optional `delta` and `sparkline` props are additive: `OperationalMetricCard` renders identically without them, so the dashboard and other shared consumers are unaffected.
- `useReportPeriod` — per-report period state with URL persistence and session-scoped carry-over between tabs; `buildPeriodDelta` derives the comparison shown on metric cards
- `ReportBreakdownTable` — ranked share-of-total rows with a neutral magnitude bar and optional drill-down, replacing the former pattern of a bar chart above an identical table
- `ReportSelectControl` — toolbar filter for option sets too long for a segmented control
- `ReportDataRegion` — dims report content and sets `aria-busy` during background refreshes
- `OperationalPartialResultsAlert`: names unavailable report sections while keeping successful results visible
- `ReportPrintHeader` — print-only title and run timestamp, since the section nav is hidden on paper
- `ReportExportButton` / report export helpers — shared CSV export actions with duplicate-click guards, formula-safe CSV escaping, dated filenames, server-backed filename/error parsing, and completion copy that names the exported scope
- Charts from `recharts` (line, bar, pie charts as needed per report)
- `Card` + `CardHeader` + `CardContent` for sections
- Filter bar with date range picker, select dropdowns
- Table/skeleton loading states
- EmptyState for no data

**Key files:**
- `src/app/(app)/reports/MetricCard.tsx` — metric display card
- `src/app/(app)/reports/[reportType]/charts.tsx` — recharts components per report
- `src/app/(app)/reports/[reportType]/page.tsx` — report page (data fetching + layout)

## Data Model
- Reports aggregate from existing models: `Booking`, `ScanEvent`, `BulkStockMovement`, `AuditLog`
- `UserAppInstallation` stores current HMAC-keyed client presence for the owner-only App activity view; it is not a raw event history or a hardware identity registry.
- `BookingAccountabilityExclusion` is the sole report-governance exception. It is a one-to-one annotation on a checkout with reason, note, exclusion/restoration actors, and timestamps; it never replaces the booking.
- `BookingDueDateChange` is durable operational evidence for each extension. It records the prior due time, new due time, change timestamp, and actor independently of the 90-day audit retention window.

## Security
- `requirePermission("report", "view")` on all report routes + endpoints, except `/api/reports/audit`, which requires `report.audit` (ADMIN only)
- ADMIN/STAFF only; the Audit report is ADMIN only
- CSV export branches are rate limited per user (`report:export`, 10/min shared across all report exports)
- Audit log endpoint logs report access (low priority)
- Accountability reads require `accountability.view` for ADMIN/STAFF/STUDENT. COLLABORATOR remains default-deny. CSV, exclusion metadata, and exclusion mutations require ADMIN-only `accountability.manage_exclusions`; mutations retain CSRF, rate-limit, SERIALIZABLE, and audit protections.
- App activity reads require the separate `USAGE_ANALYTICS_OWNER_EMAILS` allowlist; named roster data never becomes available through the aggregate `/reports/usage` endpoint.

## Acceptance Criteria
- [x] AC-1: Utilization report with inventory metrics + trend charts
- [x] AC-2: Checkouts report with list + status breakdown
- [x] AC-3: Overdue report with escalation tracking
- [x] AC-4: Scans report with device + phase analytics
- [x] AC-5: Missing Units report with item-family tracking
- [x] AC-6: Audit report with event log viewer (ADMIN only)
- [x] AC-7: Badge report with leaderboard, distribution, and recent awards
- [x] AC-8: Missing Units report includes unit-tracked battery missing-unit, missing-rate, custody-history, and repeat-pattern reporting
- [x] AC-9: Internal Accountability ranks current and historical late returns, while ADMIN supports audited, reversible data-quality exclusions without deleting custody history.
- [x] AC-10: Utilization measures custody over a selected window (utilization rate, custody days, most-used gear, idle and never-checked-out inventory) rather than reporting an inventory snapshot alone.
- [x] AC-11: Period-scoped reports show a prior-period comparison wherever one can be computed honestly, and suppress it where one cannot.
- [x] AC-12: A chosen period carries across report tabs for the session while URL params keep precedence and existing per-report param names are unchanged.
- [x] AC-13: Breakdowns render once, with share-of-total context and drill-down into `/items` by id.
- [x] AC-14: Checkout trend and heatmap days are selectable and narrow the checkout row list server-side.
- [x] AC-15: Overdue filters by location and Missing Units filters by location and category; the previously documented date-range filters are removed from the contract because the underlying data cannot support them honestly.
- [x] AC-16: Report surfaces print without app chrome and carry a title, run timestamp, and their active filter chips.
- [x] AC-17: Utilization and checkout reports preserve successful query groups, identify unavailable groups through additive response metadata, and warn web and native users before fallback zeros or empty sections are treated as final.
- [ ] AC-18: Owner App activity passes migrated, configured, authenticated owner/non-owner acceptance and signed-client TestFlight/App Store channel/build comparison.
- [x] AC-19: Accountability is discoverable in primary navigation for ADMIN/STAFF/STUDENT, keeps COLLABORATOR default-deny, and redacts ADMIN-only export and exclusion capabilities from non-admin responses.
- [x] AC-20: Accountability serves one shared three-line draw from 50 unique reviewed jeers for identical ordered leaderboard state; the draw remains stable across roles, reloads, and clock-only late-hour changes, then rotates when membership, ranking order, or incident state changes.
- [x] AC-21: Accountability keeps its friendly wrong-leaderboard spotlight while the full ranking uses a five-concept desktop summary, prominent continuously colored return record, responsive card fallback, explicit 40px history controls, and grouped incident evidence without changing rank or custody semantics.

## Change Log
- 2026-08-23: Rebuilt the full Accountability leaderboard around five scan targets instead of eight competing columns, made return-record percentages prominent with a continuous red-at-50% to green-at-100% bar, moved cramped widths to structured cards, replaced whole-row pseudo-buttons with explicit 40px history controls, and grouped each expanded incident into one readable record. Ranking, filters, shared jeers, custody evidence, and ADMIN cleanup behavior are unchanged.
- 2026-08-23: Replaced fixed podium jeers with a source-owned 50-line deck generated and reviewed through GPT-5.6 Luna Max. The Accountability API now derives one deterministic three-line draw from stable ordered leaderboard state and serves it identically to ADMIN, STAFF, and STUDENT. Reloads and clock-only late-hour updates do not churn the copy; membership, order, and incident changes rotate it without a runtime model call or per-user storage.
- 2026-08-23: Promoted Accountability into primary ADMIN/STAFF/STUDENT navigation and global search while keeping COLLABORATOR default-deny under D-041. The API now returns server-owned capability flags and omits export/exclusion metadata for Staff and Student. The former horizontal chart is replaced by a responsive top-three wrong-leaderboard spotlight with avatars, gentle jeers, reduced-motion-safe sort transitions, and the same expandable custody evidence. ADMIN export and audited reversible exclusions are unchanged.
- 2026-08-21: Added the owner-only `/settings/app-activity` client-presence dashboard alongside the aggregate `/reports/usage` report. It shows named roster adoption, last launch/seen, device and OS identity, build/channel, and configurable stale/latest iOS state while keeping raw product-event analytics pseudonymous and bounded. Local source/schema/tests pass; migration, owner environment configuration, authenticated browser proof, and signed-client acceptance remain rollout gates.
- 2026-08-12: Added private first-party Usage counting. Strict authenticated ingestion stores rotating pseudonymous identifiers and allowlisted enum fields only; web records normalized surface use and iOS records app opens plus tab destinations. The private report is default-deny through `USAGE_ANALYTICS_OWNER_EMAILS`, so ADMIN status alone grants nothing. No third-party analytics, replay, URLs, search text, record IDs, or scanned values are collected.
- 2026-08-10: Utilization and checkout aggregation now preserves successful query groups without silently presenting failed groups as authoritative zeros. Additive `partialFailures` is logged and rendered on web and native; native sources load independently, period changes use newest-request ownership, and partial results never become fresh cache truth. Focused service, route, source-contract, TypeScript, lint, and inventory gates pass. Native simulator compilation and authenticated visual proof remain separate gates.
- 2026-08-03: Disabled automatic RSC prefetching for the authenticated sidebar, notification chrome, and report section links after Safari desktop proof showed the viewport prefetch storm failing and falling back to full browser navigations. Click navigation remains client-routed.
- 2026-07-23: Accountability now preserves checkout due-date changes and counts extensions made after the prior deadline plus grace as distinct late episodes. Migration `0102_booking_due_date_history` backfills retained extension audits, while future extensions write durable evidence in the same SERIALIZABLE transaction.
- 2026-07-23: Added the ADMIN-only Accountability surface. It ranks academic-year late-return incidents using the configured overdue grace period, separates active and resolved evidence, exposes filtered CSV, and adds audited reversible checkout exclusions for test or bad data while preserving D-040 custody history. The existing staff/admin Overdue report remains the live open-checkout queue.
- 2026-07-16: Checkout report heatmap colors now use a theme-aware blue OKLCH intensity scale, matching the product rule that blue means active use. The visual change does not alter report data, custody semantics, filters, or APIs.
- 2026-07-12: Reports hardening sweep. `/api/reports/audit` now requires the new `report.audit` permission (ADMIN only), matching the admin-only `/api/audit` browse feed and AC-6; the Audit tab is hidden from STAFF in the reports nav, global search, and breadcrumb siblings via `requiredRole` on `REPORT_SECTIONS`. All six report CSV export branches now share a per-user `report:export` rate limit (10/min). Corrected doc drift: Utilization has no filters or query params, and the Audit report filters by period only with `startDate`/`endDate`/`action` params.
- 2026-06-20: Report toolbars inherit the refreshed shared active-filter chip treatment, keeping Checkouts, Scans, and Audit non-default filters removable while making applied filters read as lighter controls with 40px targets and active underline.
- 2026-06-20: Reports navigation now uses the shared `SectionNav` treatment adopted by Settings. The report switcher keeps mobile horizontal scrolling and active underlines, but drops the heavier bordered card shell so the nav reads as page chrome instead of another content panel.
- 2026-06-18: Schedule Source Of Truth Slice 13 added Schedule CSV exports outside the main Reports shell. `/api/schedule/export?type=...` is still governed by `report.view`, uses shared formula-safe CSV escaping, returns export count/truncation headers, caps date windows to 366 days, and supports roster, hours, open slots, conflicts, trades/open-work requests, and gear-readiness exports from the Schedule page.
- 2026-06-18: Kiosk-only custody Slice 5 tightened Checkouts report semantics. `/reports/checkouts` metrics, top requesters, recent rows, heatmap, and CSV export now count only custody checkout rows (`OPEN` and `COMPLETED`) so `PENDING_PICKUP` awaiting-pickup records and cancelled records do not inflate actual checkout activity.
- 2026-06-02: Web operator trust sweep added Utilization row-level CSV export. `/reports/utilization` now exports bounded server-backed inventory rows with derived status evidence, stored status, location, department, category, and availability flags while keeping JSON metric/card/chart behavior unchanged.
- 2026-06-02: Web operator trust sweep added Missing Units evidence CSV export. `/reports/bulk-losses` now exports bounded server-backed report-evidence rows across missing-unit groupings, requester attribution, recent loss events, battery family summaries, missing battery units, checkout history, and repeat patterns while keeping the JSON report sections and drill-down links unchanged.
- 2026-06-02: Web operator trust sweep tightened Overdue report CSV export semantics. `/reports/overdue` now exports overdue checkout rows through a bounded server-backed CSV path, includes outstanding item summaries that exclude already-returned bulk quantities, reports capped exports with row-count headers/copy, and keeps the JSON leaderboard grouping and expansion behavior unchanged.
- 2026-06-02: Web operator trust sweep tightened Checkouts report CSV export semantics. `/reports/checkouts` exports matching checkout activity rows for the selected period through a bounded server-backed CSV path, reports capped exports with row-count headers/copy, and keeps JSON report metrics/charts/heatmap unchanged.
- 2026-06-02: Web operator trust sweep tightened Scans report CSV export semantics. `/reports/scans` now exports all matching filtered scan events through a bounded server-backed CSV path, reports capped exports with row-count headers/copy, and keeps JSON report pagination/charts unchanged.
- 2026-06-02: Web operator trust sweep tightened Audit report CSV export semantics. `/reports/audit` now exports all matching filtered audit rows through a bounded server-backed CSV path, reports capped exports with row-count headers/copy, and keeps the JSON report browse pagination/charts unchanged.
- 2026-06-02: Web operator trust sweep tightened report CSV exports. Utilization, Checkouts, Overdue, Scans, Audit, and Badges now label exports as visible-row downloads, ignore rapid duplicate export clicks, and show completion copy that names the exact visible row scope without changing report APIs or analytics semantics.
- 2026-05-25: Web bug sweep Batch 49 cleaned up Utilization report status language. Metric cards, status chart labels, and CSV status rows now use shared equipment display labels such as `Awaiting Pickup` instead of raw enum values like `PENDING_PICKUP`, while keeping raw status keys only in drill-down URLs.
- 2026-05-25: Web bug sweep Batch 43 fixed Reports overdue drill-down links. Checkouts and Overdue metric cards now use `/checkouts?filter=overdue`, matching the booking list's special filter contract instead of sending invalid `status=overdue` links into the unified Bookings route.
- 2026-05-25: Web bug sweep Batch 39 hardened Audit report URL state. Audit period and pagination controls now rehydrate from browser Back/Forward or shared links, invalid filter params self-correct, and out-of-range pages clamp after report data loads.
- 2026-05-25: Web bug sweep Batch 38 hardened badge report display copy. Badge Distribution and Underused rows now show only operator-facing badge names, and badge category/source labels render as title-cased product language such as `On Time` and `Manual` instead of raw internal keys or enum strings.
- 2026-05-25: Web bug sweep Batch 23 hardened report URL-state rehydration. Checkouts and Scans now re-read filter and pagination state from the address bar after browser back/forward or external report links, keeping visible controls, active filters, and API query params aligned.
- 2026-05-25: Web bug sweep Batch 22 hardened the shared `useFetch` helper used by reports, Labels, and Fix Today. It now safe-parses JSON responses and rejects unreadable success bodies before report consumers treat malformed gateway responses as valid data.
- 2026-05-24: Web bug sweep Batch 11 moved the Reports layout permission check to the server before the report shell renders, matching the `/api/reports/*` `report.view` guard and redirecting non-staff users instead of showing a skeletonized forbidden reports shell.
- 2026-05-21: Report metric cards now render through the shared `OperationalMetricCard` primitive while preserving report-specific links, tooltips, badges, and string values.
- 2026-05-20: Reports period and phase filter state now uses shared `OperationalActiveFilterChips` through the report toolbar on Checkouts, Scans, and Audit so non-default filters can be removed without changing the segmented control directly.
- 2026-05-13: Missing Units report copy now avoids old lost/numbered wording in the battery audit sections, using Missing and battery families using Units instead.
- 2026-05-13: Battery audit reporting now lives under Missing Units. Staff/admin can see missing unit-tracked batteries by unit, missing rate by family, recent unit checkout history, repeated missing family/requester patterns, and a direct handoff to Battery Ops.
- 2026-05-10: Reports ownership pass. Checkout analytics now exclude draft bookings, overdue reports count only outstanding gear, and scan report filters are normalized in the UI with API-side validation for invalid dates and phases. Browser smoke also fixed the shared React Query provider hydration path so report pages no longer log hydration mismatches after reloads.
- 2026-05-25: Web bug sweep Batch 33 hardened shared current-user reads used by the reports shell and other role-aware navigation surfaces. `/api/me` success bodies now safe-parse through `useCurrentUser`, so an unreadable identity payload falls back through the normal unauthenticated/loading behavior instead of throwing during page render.
- 2026-05-09: Badge report insight polish added manual award rate, underused active definitions, and a recent manual recognition section so staff can see whether the badge catalog is being used consistently.
- 2026-05-09: Badge report shipped. `/reports/badges` now gives staff/admin read-only analytics for total awards, 30-day award volume, active definitions, manual awards, user leaderboard, badge distribution, and recent awards while keeping `/users/{id}?tab=badges` as the primary profile badge surface.
- 2026-05-09: Reports authenticated browser smoke completed. Chrome DevTools verified seeded-admin rendering for Utilization, Checkouts, Overdue, Missing Units, Scans, and Audit; the pass also fixed a Recharts responsive sizing warning centrally in the shared shadcn chart wrapper.
- 2026-05-09: Focused Reports UI polish slice. Added shared report UI helpers for toolbar rhythm, metric grids, section cards, and loading skeletons; upgraded the Reports header/tab shell; and migrated Utilization, Checkouts, Overdue, Missing Units, Scans, and Audit to the shared presentation patterns without changing report APIs or analytics semantics.
- 2026-05-09: Reports chart polish follow-up. Moved report chart components onto the shared report chart-card wrapper, centralized the chart palette, tightened chart legends and numeric alignment, and fixed utilization breakdown sorting so charts no longer mutate incoming data arrays.
- 2026-05-09: Reports filter polish follow-up. Checkouts, Scans, and Audit period/phase controls now use the shared Reports segmented-control helper backed by shadcn ToggleGroup, preserving URL sync and pagination reset behavior while removing hand-rolled button groups.
- 2026-05-09: Reports state polish follow-up. Added shared report error, empty, and pagination helpers; normalized retry layout across report pages; improved empty-state copy; and kept Scans/Audit pagination query behavior unchanged.
- 2026-05-09: Reports row polish follow-up. Added shared report row/link helpers, normalized dense table/mobile row hover and focus treatment, and replaced Overdue text disclosure arrows with lucide chevrons while preserving expansion behavior.
- 2026-05-09: Reports export polish follow-up. Added an icon-backed shared report export button and centralized CSV escaping/download behavior for Utilization, Checkouts, Overdue, Scans, and Audit exports.
- 2026-05-09: Reports loading cleanup follow-up. Added a shared chart-loading helper, migrated Utilization and Checkouts dynamic chart fallbacks to it, and finished the remaining Checkouts mobile requester row adoption.
- 2026-05-09: Reports overdue presentation follow-up. Reused the shared report table-link treatment inside expanded Overdue mobile rows and replaced the remaining inline red text styles with report-compatible utility classes while preserving expansion/navigation behavior.
- 2026-05-09: Reports metadata line follow-up. Added a shared compact metadata-line helper and migrated Checkouts and expanded Overdue row details away from raw separator strings while preserving displayed content.
- 2026-05-08: API hardening Wave 13. Audit and scan reports now use shared pagination parsing, dashboard stats polling has a mobile-friendly rate limit, and audit last-lookups are rate-limited by actor.
- 2026-05-08: API hardening Wave 11. Checkout reports now reject lookbacks outside 1-366 days before aggregation, and booking audit-log pagination validates cursors against the requested booking before returning another page.
- 2026-05-07: iOS Overdue report. First report ported to iOS as a stripped-down floor view: leaderboard sorted by total overdue time, expandable per-person, tap-through to booking detail. Chart + CSV deliberately omitted — those stay on web (per "iOS = day-to-day ops, web = power user" rule). Server enforces `report:view` = ADMIN/STAFF; client also gates Profile entry point. See `AREA_MOBILE.md` for context.
- 2026-03-15: Reports V1 shipped — 6 report pages (utilization, checkouts, overdue, scans, bulk-losses, audit). Tab navigation. Metrics cards. Charts (recharts). Filters. Table lists. Date range pickers. Empty states + error handling.
- 2026-04-09: Design refresh (Phase 3) — Linear/Notion refresh applied: one-off error div → Alert component, inline styles → Tailwind, legacy CSS removed. Text-secondary → text-muted-foreground. Doc sync.
- 2026-04-09: Created AREA_REPORTS.md as formal feature area documentation.
- 2026-05-01: Audit pass — split `/api/reports?type=X` mega-route into per-type routes under `/api/reports/{utilization,checkouts,overdue,scans,audit,bulk-losses}`; moved handlers to `src/lib/services/reports.ts`. Replaced in-memory daily aggregation with `date_trunc` `$queryRaw` GROUP BY in scan + checkout reports (no more pulling every row to bucket in JS). Removed dead heatmap block from utilization page (API never returned the field). Standardized `bulk-losses` loading/error guards to match siblings (preserves data on refresh). Extracted shared `syncUrl()` to `src/lib/url-sync.ts`; checkouts page now uses it.
