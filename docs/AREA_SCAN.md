# Area: Scan

## Document Control
- Area: Scan
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-09-20
- Status: Web surface removed; native iOS owns lookup and kiosk owns custody scans
- Decision Refs: D-028, D-040

## Overview
The standalone web scan page and browser camera scanner were removed. Native iOS owns camera and hand-scanner lookup for inventory items. Web remains text-first through global search, item search, and item detail; scan-history reporting remains available to staff. Checkout pickup, reservation pickup, and return scans are executed by kiosk flows.

Design language reference: `docs/DESIGN_LANGUAGE.md`.

## Current ownership

- **Native iOS**: camera and hand-scanner lookup, result presentation, and item-family/unit resolution.
- **Native iOS kiosk**: checkout pickup, reservation pickup, return, and exact-unit custody scans.
- **Web**: text-first global search, item search/detail, and staff scan-history reporting at `/reports/scans`.
- **Shared API**: `/api/assets` and item detail endpoints remain available to native clients and web detail/search consumers. Legacy app custody scan endpoints remain kiosk-gated 403 stubs.

## Modes

| Mode | URL Pattern | Description |
|---|---|---|
| **Web text search** | Global search, `/search`, item search/detail | Search by tag, serial, name, or other text without opening a browser scanner |
| **Scan history** | `/reports/scans` | Staff reporting and audit history for scan activity |
| **Native lookup** | Native iOS | Camera or hand-scanner lookup with item result presentation |
| **Kiosk custody** | Native iOS kiosk | Physical checkout, pickup, return, and unit custody scans |

## Key Patterns

1. **No standalone web scanner** - the web app has no `/scan` route, navigation entry, command-palette page result, breadcrumb override, or browser camera trigger.
2. **Text-first web lookup** - desktop web users use global search, item search, and item detail. Native iOS owns camera and hand-scanner lookup.
3. **Kiosk execution boundary** - checkout pickup, check-in, reservation pickup, and numbered battery unit scans run through kiosk routes.
4. **Scan history remains** - staff can review scan activity at `/reports/scans`; reporting is not a capture surface.
5. **Attachment visibility** - item detail and native lookup preserve attached camera context and SD card slot labels when the tag convention supports it.
6. **Item-family lookup** - native lookup resolves parent/bin QR values and derived unit QR values to the parent item-family context. Exact unit scans may show unit status, while custody remains kiosk-owned.

## API Dependencies

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/assets` | GET | Item lookup search |
| `/api/assets/{id}` | GET | Item detail for preview |
| `/api/checkouts/{id}/scan` | POST | Kiosk-gated 403 stub for legacy app checkout scan requests |
| `/api/checkouts/{id}/checkin-scan` | POST | Kiosk-gated 403 stub for legacy app check-in scan requests |

Kiosk execution endpoints are documented in `docs/AREA_KIOSK.md`.

## Change Log

| Date | Change |
|---|---|
| 2026-09-20 | Removed the unreferenced app-side scan service functions (`startScanSession`, `recordScan`, `completeCheckoutScan`, `completeCheckinScan`) and their tests; every scan now runs through the kiosk endpoints in `docs/AREA_KIOSK.md`. The kiosk-gated 403 stubs stay as the app contract; `createAdminOverride` is the only remaining export. |
| 2026-08-03 | Removed the standalone web `/scan` route, browser camera decoder, web navigation/search/breadcrumb entry points, and embedded camera triggers from booking and item intake surfaces. Native iOS keeps lookup, kiosk keeps custody, and `/reports/scans` keeps history. |
| 2026-07-10 | Scan item preview drawer: the Current custody label unifies to the sanctioned small-uppercase label style. Visual only. |
| 2026-07-03 | Native iOS tab order now keeps Search pinned trailing after Home, Schedule, Bookings/My Gear, and More. The directory surface formerly shown as Browse is now More, with Items, Guides, Licenses, and Users still inside it; scan remains inside Search and custody scan boundaries did not change. |
| 2026-06-30 | Native iOS Browse navigation replaced the standalone compact Items tab with a system Browse tab for Items, Guides, Licenses, and Users. Search remains the pinned trailing search tab, and scan remains inside Search; custody scan boundaries did not change. |
| 2026-06-29 | Native iOS navigation polish: Scan lookup now uses SwiftUI's built-in `Tab(...)` API with `role: .search` and pinned placement, and compact iPhone uses `.tabBarOnly` instead of sidebar-adaptable styling so the system owns the dedicated trailing Scan placement. The custom bottom bar overlay was removed, and Users is kept out of the compact iPhone tab set to prevent Scan from falling into More. Regular-width layouts expose Guides, Users, and Licenses as sidebar-only secondary destinations; compact iPhone reaches them from Profile/Settings > Directory. Scan remains lookup-only; kiosk custody routes did not change. |
| 2026-06-25 | Battery custody trust hardening: `/api/assets`, scan lookup, kiosk pickup/reservation staging, and generic numbered-bulk scan recording now share the same allocation-aware effective status rule. Active `BookingBulkUnitAllocation` rows make a unit checked out; stale raw `CHECKED_OUT` flags with no active allocation read as available so returned Sony batteries do not block pickup or inflate native Scan checked-out counts. |
| 2026-06-16 | iOS camera preview fix (`QrScanner.tsx`): a benign `video.play()` rejection on iOS (AbortError/NotAllowedError) no longer surfaces as a fatal "Camera not available" error, and the live feed sets the `muted` DOM property plus `playsinline`/`webkit-playsinline`/`disablepictureinpicture` attributes so WebKit keeps the camera inline and stops offering/auto-popping Picture-in-Picture. Historical entry; current camera ownership is native iOS/kiosk. |
| 2026-06-15 | Synced scan scope with D-040: app/web scan remains lookup-only, while checkout creation, reservation pickup, and return custody scans belong to kiosk flows. |
| 2026-06-15 | Kiosk custody location evidence shipped. Serialized kiosk checkout/pickup/return scans now reconcile the item's saved location to the kiosk location, and pickup/return scan events record expected and actual location IDs plus a mismatch flag when the item or booking is not where the kiosk flow expected it. App `/scan` remains lookup-only. |
| 2026-06-15 | iOS hand-scanner debugger: staff/admin Settings -> Tools now has a Scanner Debugger that opens as a dedicated sheet, captures HID keyboard scanner input, displays raw/trimmed scan values, submits through native `SearchService`, and reuses the existing `ScanResultSheet` hero-card presentation. This is lookup/debug only; checkout pickup and return custody scans stay kiosk-owned. |
| 2026-06-11 | iOS hero card hardening: pull-to-refresh re-runs the lookup in place so availability/custody stay current while the sheet sits open; numbered-family cards show a per-unit status roster grid (new `units` array on `/api/assets` bulkItems, exact-unit scan path only) with the scanned unit ringed; Reserve is hidden for retired/maintenance assets; the hero photo opens a full-screen pinch-to-zoom viewer; and card content caps at 560pt width for iPad/landscape. |
| 2026-06-11 | iOS hero card round 4: the custody row deeplinks to the linked booking on tap (asset cards via activeBooking.id; family cards via new `matchedUnitBookingId` exposed by `/api/assets` bulkItems), shows holder initials instead of a generic person icon, action buttons drop the red accent for neutral label-on-background styling matching web shadcn buttons, and hero cards regain the .large detent for full slide-up (empty/error states stay medium-only). |
| 2026-06-11 | iOS hero card round 3: hero image frame is full white behind catalog photos (placeholder keeps neutral fill), the asset tag becomes the card headline in Gotham Black (web's PageHeader face, now bundled on iOS as Gotham-Black/Bold TTF with system-heavy fallback), and both cards gain a Reserve button that opens the prefilled CreateBookingSheet (asset preselect or one bulk unit seeded) and lands on the new booking detail. Asset cards keep View item alongside; family cards have no View item since iOS has no bulk-SKU detail screen. |
| 2026-06-11 | iOS hero card polish round: product photos fit instead of crop, unit status badge moved from the title row to the Scanned Unit block (it describes the unit, not the family), zero-count stat tiles render neutral (zero available renders orange — the actionable state), lost/retired counts surface as a caption under Units total, unit numbers use tabular digits, and fixed-content sheets (hero card, empty, error) drop the .large detent so the sheet hugs its content. |
| 2026-06-11 | iOS scan result hero card: when a scan resolves to exactly one match, the result sheet now shows a rich card (hero image, status badge, prominent unit number / asset tag, availability stats, holder + due info) instead of a compact row. Single serialized assets show the card with a View item tap-through instead of auto-pushing detail; bulk-unit matches like a scanned battery unit show the card as the destination. Multi-match scans keep the compact row list. |
| 2026-06-11 | iOS item-family scan lookup fix: native Scan and global search now decode `/api/assets` `bulkItems`, so derived numbered battery unit QR labels resolve to the Sony battery family with unit context instead of showing Nothing found. Regular app scan remains lookup-only; pickup and return custody scans stay kiosk-owned. |
| 2026-06-09 | iOS runtime warning cleanup: native Scan now leaves VisionKit stopped while result/error sheets are visible and re-arms scanning when the sheet dismisses, reducing system material frame-update churn while preserving lookup-only scan behavior. |
| 2026-06-06 | iOS Scan result retry recovery: native lookup failures now expose Try again before Type code instead, retry the last scanned value after clearing same-code dedupe, and preserve lookup-only scope plus kiosk custody boundaries. |
| 2026-05-25 | Web bug sweep Batch 22: lookup now safe-parses `/api/assets` and item detail responses, handles expired sessions through the shared auth redirect, and surfaces unreadable lookup payloads as retryable errors instead of collapsing malformed server responses into generic network copy. |
| 2026-05-20 | Design language slice 3: lookup now uses the shared `PageHeader` title/description/action rhythm instead of a custom local heading block. |
| 2026-05-20 | Design language quick win: scan camera dismiss, manual lookup, and retry controls now use shadcn-sized targets with labels/focus behavior while preserving lookup-only scope. |
| 2026-05-13 | Scan lookup polish: exact item-family unit QR scans now show the parent family, scanned unit number, unit status, and checked-out custody context while keeping app scan lookup-only. |
| 2026-05-13 | Item-family lookup: app scan now resolves parent/bin QR and derived unit QR values to the parent item-family detail context while preserving kiosk-only custody scans. |
| 2026-05-10 | Scan ownership pass: app `/scan` is now lookup-only, stale booking deep links show kiosk handoff instead of a broken camera checklist, mobile nav says Lookup, and booking/dashboard links no longer target `/scan?checkout=...`. |
| 2026-05-09 | Badge achievements Slice 3: kiosk checkout, pickup, and check-in scans now emit feature-flagged badge scan-result events from the kiosk routes only. Regular app checkout/check-in scan stubs remain kiosk-gated 403 routes and award nothing. |
| 2026-05-08 | Reconciled stale scan endpoint rate-limit TODO: regular app checkout/check-in scan routes are kiosk-gated 403 stubs, and a static contract now protects that boundary |
| 2026-05-07 | Check-in damaged/lost item reports can include optional photo evidence. The retired app booking-mode checklist UI that exposed this is no longer wired through `/scan`; future exception reporting should be re-cut outside lookup scan. |
| 2026-05-05 | Kiosk battery unit scans: pickup/check-in can scan one numbered battery unit at a time, and kiosk lookup resolves unit QR values to parent SKU and unit status |
| 2026-05-05 | Numbered bulk unit QR scans: values like `94e068d1-7` resolve to the parent bulk SKU and unit #7, bypassing the picker while preserving server-side unit validation |
| 2026-05-05 | Camera attachment lookup polish: lookup preview labels attached items with parent camera context and SD card slot labels when tags follow the `1A` convention |
| 2026-03-23 | Scan page hardened (5-pass): design system alignment, data flow, resilience, UX polish |
| 2026-03-25 | Decomposed from 1,038→251 lines: extracted 2 hooks + 4 components + shared types (GAP-14 closed) |
| 2026-04-03 | Audio + haptic scan feedback: distinct tones & vibration patterns for success/error/info/celebration via Web Audio API (`src/lib/scan-feedback.ts`) |
| 2026-04-09 | **Scan flow stress test (4 fixes):** scanValue normalization (trim+lowercase), bulk bin case-insensitive matching, cross-booking numbered bulk unit check-in integrity guard + frontend picker scope fix, completeCheckinScan booking status guard |
| 2026-04-09 | **Hardening pass (6 fixes):** mode badges → Badge component; bulk row/circle dark-mode color normalization; handleLookupScan finally block; loadScanStatus finally block; Page Visibility refresh on tab return; camera error prefix removed |

Historical entries before 2026-08-03 may reference the retired web lookup implementation. Current web scope is text-first search and scan-history reporting; native iOS owns lookup and kiosk owns custody.
- 2026-06-11: **Real holder avatars on scan hero card (iOS)** — the hero card custody row drew a hand-rolled initials circle for the gear's current holder. It now renders the shared `UserAvatarView` (real profile photo with initials fallback), matching how the web shows requester avatars. Serialized matches use `Asset.activeBooking.requesterAvatarUrl` (server already returned it); bulk-family unit matches use a new `matchedUnitHolderAvatarUrl` added to `/api/assets`'s matched-unit custody payload.
