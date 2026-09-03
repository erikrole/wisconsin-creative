# AREA: Bulk Inventory Management

## Document Control
- Area: Bulk Inventory Management
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-09-03
- Status: Active
- Version: V1

## Direction
Operate item families backed by `BulkSku` records. Normal discovery happens in `/items`; this area is the admin/staff cockpit for stock adjustment, thresholds, numbered-unit audit, lost/retired handling, QR labels, and maintenance. Product UI should describe the two user-facing family styles as Units and Quantity, while docs/code can use unit-tracked and quantity-tracked when implementation precision matters.

## Core Rules
1. `BulkSku` is the implementation record for an item family with category, unit (e.g., "count", "pair", "roll"), and parent/bin QR code.
2. Two tracking modes: **Quantity-tracked** (just a number) or **Unit-tracked** (individual `BulkSkuUnit` records).
3. `/items` shows one item-family row with availability like `43/46 available`; this area exposes the operational controls behind that row.
4. Unit statuses: AVAILABLE, CHECKED_OUT, LOST, RETIRED (color-coded per status); user-facing copy can describe `LOST` units as Missing when the goal is staff follow-up.
5. Conversion from quantity to numbered is one-way (creates N units; cannot convert back).
6. Staff (ADMIN/STAFF) can add units, convert to numbered, mark units lost/retired.
7. Students see item families in equipment picker during checkout and request quantity, not exact physical units.
8. QR-coded batteries stay as unit-tracked item families when they follow the existing Sony battery pattern: one SKU/family with unit-level tracking beneath it.
9. Numbered bulk unit QR values are derived as `{binQrCodeValue}-{unitNumber}` and scan directly as that one unit; printed label text can stay as the unit number only.
10. Camera-slot SD cards are not bulk inventory when assigned to a specific camera slot; they are serialized item attachments under the camera.
11. Numbered battery available quantity derives from effective unit status: active `BookingBulkUnitAllocation` rows make a unit checked out, `LOST` and `RETIRED` remain unavailable, and orphaned raw `CHECKED_OUT` flags with no active allocation read as available. Orphaned flags are also claimable — kiosk checkout/add/bind paths accept them through the shared `CLAIMABLE_BULK_UNIT_WHERE` guard and self-heal the flag on claim; the repair-stale tool remains for bulk cleanup and reporting hygiene.
12. Quantity-only available quantity derives from current `BulkStockBalance.onHandQuantity`; checkout creation, pending pickup, cancellation, and return paths move that balance through audited stock movements, so read models must not subtract active checkout quantities again.
13. Unit-tracked active inventory totals exclude `RETIRED` records. Retired unit numbers remain visible for labels and audit history, but availability denominators, item-list summaries, exports, and picker-facing on-hand totals count only AVAILABLE, CHECKED_OUT, and LOST units.
14. A unit-tracked family may contain multiple interchangeable branded products. `BulkSkuProduct` stores product identity and `BulkSkuUnit.productId` assigns the exact product to a permanent unit without changing the family booking line, status, allocation, or QR sequence.
15. The general battery catalog uses four unit-tracked families: `Monitor Battery`, `Sony Battery`, `Gold Mount Battery`, and `FX6 Battery`. Branded and model-specific batteries belong beneath those families as products, not as additional catalog rows.
16. `Football Sony Battery` is an accepted separate unit-tracked family so the Football pool can be counted and operated independently from the normal `Sony Battery` pool. It has the same reservation, checkout, pickup, return, and custody policy as `Sony Battery`; the separate row does not imply a roster or role gate.

## Routes

### `/bulk-inventory`
- **Page:** `src/app/(app)/bulk-inventory/page.tsx`
- **Type:** Redirect to `/items`
- **Audience:** Admin/staff operations, not the primary item catalog
- **Behaviors:**
  - The legacy bulk inventory landing route redirects to `/items` so normal discovery stays in the primary catalog.
  - Direct `/bulk-inventory/{id}` links remain as the staff/admin stockroom path for item-family operations.

### `/bulk-inventory/batteries`
- **Page:** `src/app/(app)/bulk-inventory/batteries/page.tsx`
- **Type:** Admin/staff operational cockpit for active unit-tracked battery families
- **Navigation label:** Battery Ops
- **Purpose:** Make day-to-day battery unit management faster while keeping normal discovery in `/items`.
- **Structure:**
  1. **Metric strip:** available, checked out, lost, retired, and low-family counts.
  2. **Compatible battery lows:** camera-family battery health derived from active camera inventory and the existing compatibility rules.
  3. **Checked-out units table:** unit number, battery family, holder, booking, due date, and checked-out age.
  4. **Inventory data warnings:** stale checked-out unit flags with no active checkout allocation are listed separately while Battery Ops counts them as available; staff/admin can repair those stored flags from the warning card with an audited reason.
  5. **Battery family workspaces:** one compact row per family leads with available/active inventory, the status breakdown, effective low-stock line, label readiness, family QR, product mix, and explicit receiving/label/metadata actions. Numbered tiles stay collapsed until requested and can be filtered by status.
  6. **Quantity corrections:** quantity-tracked battery families stay in a separate section with an explicit audited live-count adjustment; numbered families never expose a free-form count override.
  7. **Report handoff:** `/reports/bulk-losses` now owns deeper battery audit/reporting for missing units, loss rate, checkout history, and repeat missing patterns.
- **Behaviors:**
  - Only active unit-tracked battery families are shown.
  - Low stock uses the existing battery rule of max(`minThreshold`, 10).
  - Compatible battery lows reuse `src/lib/battery-compatibility.ts`; no separate camera-to-battery schema exists.
  - Unit actions reuse the audited `/api/bulk-skus/[id]/units/[unitNumber]` status endpoint.
  - Numbered-family availability is presented as derived truth: receiving adds the next permanent unit range, while corrections recover, mark missing, or retire the affected unit records.
  - Numbered-unit receiving can assign one existing active family product to the entire new range through the existing audited unit-add endpoint; individual product reassignment remains in family detail.
  - Metadata editing remains in the shared item-family detail flow and is one explicit action away from every Battery Ops workspace.
  - Checked-out units are read-only in this surface and must be returned through check-in before status changes.
  - Stale checked-out flag repair uses `POST /api/bulk-skus/batteries/repair-stale`; it is limited to active battery families, requires `bulk_sku.adjust`, defaults to a dry-run preview, and restores the family balance with an adjustment movement plus one audit entry per repaired unit only when an operator explicitly applies the repair.

### `/items/bulk-{id}` and `/bulk-inventory/{id}`
- **Page:** `src/app/(app)/bulk-inventory/[id]/BulkSkuDetailExperience.tsx`
- **Type:** Shared item-family detail and staff stockroom detail
- **Structure:**
  1. Contained item header with active inventory count, category, location, image, refresh, and stockroom handoff.
  2. Info overview led by current availability, active total, status breakdown, label readiness, and retired-record explanation.
  3. Secondary grouped metadata for identity, stock policy, procurement, QR identity, and operator notes.
  4. Unit operations, QR, history, and settings remain URL-backed tabs.
- **Count language:** `available / active` excludes retired records from the denominator. Retired records remain visible as a separate status and keep their permanent unit numbers.

## Data Model

**Key tables:**
- `BulkSku` — name, category FK, unit (string: "count", "pair", "roll", etc.), binQrCodeValue, minThreshold, trackByNumber (boolean), active, location FK, timestamps
- `BulkStockBalance` — bulk SKU FK, location FK, onHandQuantity, timestamps (aggregate per SKU per location)
- `BulkStockMovement` — bulk SKU FK, location FK, quantity change (positive/negative), reason (ADDED / CHECKED_OUT / RETURNED / LOST / RETIRED), timestamps (audit trail)
- `BulkSkuUnit` — bulk SKU FK, unitNumber (sequential), status (AVAILABLE / CHECKED_OUT / LOST / RETIRED), notes, timestamps (only exists if trackByNumber = true)
- `BulkSkuProduct` — family FK, unique normalized product name within the family, brand, optional model, active state, and timestamps
- `BulkSkuUnit.productId` — optional exact-product assignment with `ON DELETE SET NULL`; product archiving preserves assigned unit identity and history
- `BookingBulkItem` — booking FK, bulk SKU FK, quantity, timestamps
- `BookingBulkUnitAllocation` — bulk SKU unit FK, booking bulk item FK, timestamps (links unit to booking)

**QR behavior:**
- Quantity-only SKUs scan by `BulkSku.binQrCodeValue` and prompt for quantity.
- Numbered SKUs scan by `BulkSku.binQrCodeValue` to open the unit picker, or by `{binQrCodeValue}-{unitNumber}` to submit one specific unit directly.
- Unit QR values are derived; there is no separate QR field on `BulkSkuUnit` in V1.
- Product assignment is not part of QR identity. `Monitor Battery #12` keeps `{binQrCodeValue}-12` when its Watson or GVM product metadata changes.
- Kiosk pickup and check-in accept derived numbered unit QR values so batteries are physically scanned one by one.
- Staff and admins can replace a bad family QR with a generated code or a scanned/manual value from the detail QR tab. Replacement requires confirmation because the old bin label and all derived unit labels stop resolving immediately; unit numbers, inventory state, custody, and history remain unchanged. The mutation rejects case-insensitive collisions across item-family codes and serialized-item QR, primary scan, and asset-tag identities, and records the before/after values in the audit trail.
- Kiosk checkout detail responses mark numbered battery rows with type/SKU/unit metadata and include scan-summary counts so the iOS kiosk can separate battery-unit scan progress from generic item progress.

**Brother label CSV + printed-label tracking:**
- `GET /api/bulk-skus/[id]/units/labels?scope=unprinted|all` returns a Brother P-Touch-ready CSV with exactly two columns, `item_number` (the unit number) and `qr_code` (the derived `{binQrCodeValue}-{unitNumber}` value). Rows sort by unit number ascending and every value runs through `csvField` for spreadsheet-formula safety. Default `scope=unprinted` excludes printed and retired units; `scope=all` supports reprints. Only `trackByNumber` SKUs export, and a missing `binQrCodeValue` returns a 400 with no partial file. QR values are never stored — they are derived at export time.
- `POST /api/bulk-skus/[id]/units/labels` with `{ unitNumbers, printed: true }` marks the exact exported units printed. It validates every unit number belongs to the SKU, sets `labelPrintedAt`/`labelPrintedById`/`labelPrintBatchId` only for not-yet-printed non-retired units, returns `updated`/`alreadyPrinted`/`skippedRetired` counts plus the batch id, and writes one batch audit entry (`mark_labels_printed`). Requires the same `bulk_sku` adjust permission as unit status changes.
- Printed-label state is a physical-workflow flag distinct from `BulkUnitStatus`; it never affects availability and is preserved across status/notes patches.
- Battery Ops cards show `N of M labels printed`, a `needs labels` count, a `Brother CSV` download, and a follow-up `Mark printed` confirmation seeded with the exact exported unit numbers. The generic numbered-unit tab (`BulkSkuUnitsTab`) shows a printed-label dot per unit in `BulkUnitGrid` plus a secondary `Brother CSV` export for `trackByNumber` SKUs.

## API

**GET `/api/bulk-skus`**
- Query params: `limit`, `offset`, `search`, `includeArchived`
- Returns: `{ data: BulkSku[], total: number, limit: number, offset: number }`
- SKUs sorted by name; includes `_count.units` if numbered

**GET `/api/bulk-skus/[id]/units`**
- Returns: `{ data: BulkSkuUnit[], total: number }`
- Used for lazy-loading unit details when expanding a SKU row

**GET/POST `/api/bulk-skus/[id]/products`**
- Lists all family products and assigned-unit counts, or creates a product for a unit-tracked family.
- Product names are normalized for family-scoped uniqueness; create writes the product and audit entry in one serializable transaction.

**PATCH `/api/bulk-skus/[id]/products/[productId]`**
- Edits name, brand, model, or active state without deleting assigned units.
- Archived products remain readable on assigned units but cannot be assigned to more units until restored.

**PATCH `/api/bulk-skus/[id]/units/[unitNumber]/product`**
- Assigns an active product from the same family or clears the assignment.
- Writes the previous and next product identity to the audit trail in the same serializable transaction.

**POST `/api/bulk-skus`**
- Body: `{ name, categoryId, unit, binQrCodeValue, minThreshold, locationId }`
- Returns: Created `BulkSku` object
- Requires: ADMIN/STAFF

**PATCH `/api/bulk-skus/[id]`**
- Body: `{ active }` (archive/unarchive)
- Returns: Updated `BulkSku`
- Requires: ADMIN/STAFF

**POST `/api/bulk-skus/[id]/add-units`**
- Body: `{ quantity }`
- Creates N unit records if `trackByNumber = true`, or increments `BulkStockBalance.onHandQuantity`
- Returns: Updated `BulkSku` with new unit count
- Requires: ADMIN/STAFF

**POST `/api/bulk-skus/[id]/convert-to-numbered`**
- Body: (none; no additional params)
- Converts SKU from quantity mode to numbered mode by creating one unit per current on-hand quantity
- Sets `trackByNumber = true` in Prisma
- Returns: Updated `BulkSku` with new units array
- Requires: ADMIN/STAFF

**PATCH `/api/bulk-skus/[id]/units/[unitId]/status`**
- Body: `{ status: "AVAILABLE" | "CHECKED_OUT" | "LOST" | "RETIRED" }`
- Returns: Updated `BulkSkuUnit`
- Requires: ADMIN/STAFF

**DELETE `/api/bulk-skus/[id]/units/[unitId]`**
- Marks unit as RETIRED (soft delete; cannot actually delete for audit trail)
- Returns: Updated `BulkSkuUnit` with status = RETIRED

**POST `/api/bulk-skus/batteries/repair-stale`**
- Body: `{ reason?: string, dryRun?: boolean }`
- Repairs active battery-family units where raw `BulkSkuUnit.status = CHECKED_OUT` but no active `BookingBulkUnitAllocation` exists.
- Defaults to `dryRun: true`; preview responses return candidate units without updating rows or writing audit logs.
- When called with `dryRun: false`, sets those stale rows to `AVAILABLE`, restores the same per-family quantity to the home-location balance with an adjustment movement, and writes `repair_stale_checked_out` audit entries in one serializable transaction.
- Does not alter true active checkout allocations or non-battery bulk families.
- Requires: ADMIN/STAFF

## Components

**Shared:**
- `PageHeader` for title + item-family action buttons
- `Input` for search bar
- `Pagination` for page controls
- `Table` + `TableHeader`/`TableBody`/`TableRow`/`TableCell` for unit list (desktop) or card layout (mobile)
- `Badge` for status indicators (color-coded per status)
- `Button` for actions (Add units, Convert to numbered, Remove)
- `Alert` for errors
- `ConfirmDialog` for destructive actions (via `useConfirm` hook)
- `SkeletonTable` for loading state

**Custom:**
- **BulkSkuRow** — single SKU row (click to expand)
- **BulkUnitTable** — table of units within expanded panel (desktop layout)
- **BulkUnitCard** — card layout for each unit (mobile layout)

## Hardening Notes

See `AREA_ITEMS.md` 2026-04-06 entry for bulk inventory page hardening:
- All 3 mutations (add units, convert to numbered, unit status change) wrapped with `requireAuth()` + 401 redirect
- List data already uses `useFetch` hook (AbortController, 401 handling, focus refresh)
- Item-family image replacement uses the shared image modal. When Brave image search is configured, `BulkSku` detail headers seed the search from the SKU name and save the chosen result through `/api/bulk-skus/[id]/image`, preserving the same re-host and audit path as pasted URLs.
- Detail/Battery Ops client fetches use shared safe response parsing, ref-backed duplicate-action guards for unit/status/archive/delete actions, and stable form-control metadata for inline item-family editors.
- Authenticated visual review uses a deterministic Battery Ops fixture only when `NODE_ENV=development` and the requesting page carries `fixture=battery-ops`; normal development, Preview, and production reads continue to use database-derived inventory.

## Acceptance Criteria
- [x] AC-1: Staff can add bulk SKU with name, category, unit type, location
- [x] AC-2: Quantity mode: show on-hand count per location
- [x] AC-3: Numbered mode: show table of units with status (AVAILABLE/CHECKED_OUT/LOST/RETIRED)
- [x] AC-4: Convert quantity to numbered (one-way conversion)
- [x] AC-5: Add units to quantity-only or numbered-unit SKU
- [x] AC-6: Change unit status (mark lost, retire, release) with audit trail
- [x] AC-7: Unit-tracked battery audit/reporting exposes missing units, loss rate by family, custody history, and repeated missing-unit patterns
- [x] AC-8: Staff can export a Brother P-Touch label CSV (`item_number,qr_code`) for a numbered SKU and mark the exported labels printed, with printed-label state visible per card and per unit and surviving refresh
- [x] AC-9: Item-family detail edits and unit/image mutations invalidate `/items` catalog caches and participate in the shared item-change signal so Back navigation and open detail views converge without manual refresh.
- [x] AC-10: Unit-tracked item-family summaries exclude retired records from active inventory totals while preserving retired unit numbers, label state, and audit visibility.
- [x] AC-11: Staff and admins can replace a bad item-family QR with a generated or manually scanned value through a confirmed, collision-safe, audited mutation that preserves inventory and unit identity while clearly requiring label reprints.
- [x] AC-12: A numbered item family can define multiple branded products, assign one product to each permanent unit, show product counts and identity in the unit workspace, and keep one booking line and derived QR sequence.
- [x] AC-13: Battery Ops presents one compact family workspace with explicit unit receiving, label export, metadata handoff, product mix, derived-count guidance, and an on-demand status-filtered unit roster; quantity-tracked battery corrections remain clearly separate.

## Change Log
- 2026-09-03: **Numbered battery unit truth now repairs a deficient aggregate ledger.** A large active checkout successfully scanned 18 Sony units, then exposed historical drift: a June stale-flag repair had made 14 unit records effectively available without restoring the aggregate balance, so later exact scans stopped at `0 available` while Battery Ops still showed units 1, 2, and 40 available. Active-checkout exact scans now add only a positive aggregate deficit from effective unit truth through an audited adjustment before the normal checkout decrement. Future stale-flag repairs restore the matching balance and movement atomically with the unit changes.
- 2026-08-30: **Battery family operations became count-honest and compact.** Battery Ops now keeps all numbered tiles collapsed on load, uses one independent row per family, leads with available/active state plus threshold/label/QR/product metadata, and names `Add units`, `Export labels`, and `Edit metadata` explicitly. The on-demand roster filters by effective unit status, receiving can assign an existing active product to the new permanent range, and quantity-tracked families retain a separate audited `Adjust live count` action. A development-only authenticated fixture supports matched visual proof without mutating inventory.
- 2026-08-30: **Football Sony Battery is a separate pool with the normal Sony policy.** The accepted product model is two unit-tracked families so Football inventory can be counted and operated independently, without a Football-roster or role gate. The earlier local eligibility schema, migration, mutation guards, and special picker/kiosk copy were removed before deployment. Physical family, QR, count, and unit creation remain open under GAP-74.
- 2026-07-28: **Item-family images joined Add Item intake.** New Units and Quantity catalog records now use the same pre-save image chooser as Standard items, seeded from the family name and supporting Search, Paste URL, and Upload. The staged selection persists through `/api/bulk-skus/[id]/image` only after `/api/bulk-skus` returns the new family ID, preserving the existing permission, Blob re-hosting, and audit contract. Quantity add-to-existing remains a stock adjustment and does not alter the family image.
- 2026-07-15: **Gold Mount physical-count correction.** Live inspection confirmed the two Anton Bauer Digital 150 records consolidated as Gold Mount units 9-10 do not exist physically. A guarded production transaction removed those unprinted, never-allocated units, deleted the archived Digital 150 product, reduced the Gold Mount balance from 10 to 8, and wrote both product-deletion and inventory-correction audit entries plus a `-2` adjustment movement. Gold Mount now contains exactly eight available units, all assigned to Anton/Bauer Dionic XT 150Wh. The inactive source family remains hidden because its two historical booking rows must be preserved.
- 2026-07-15: **Canonical battery-family consolidation.** The initial consolidation produced exactly four unit-tracked families: Monitor Battery (18 records), Sony Battery (52 permanent records, including three printed retired placeholders), Gold Mount Battery (initially 10 records), and FX6 Battery (12 records). Model-specific rows moved beneath Gold Mount and FX6 as assigned products. Monitor units 15-18 retain Watson NP-F550 identity; units 1-14 remain product-unassigned until physical Watson/GVM mapping is confirmed. History-free quantity and serialized duplicates were hard-deleted with audit snapshots, while history-bearing Gold Mount and Sony rows were retired or deactivated so booking, allocation, scan, and movement evidence remains intact. The later Gold Mount physical-count correction above supersedes the initial 10-record count.
- 2026-07-15: **Multi-product item families.** Added family-scoped product records with normalized uniqueness, optional per-unit product assignment, audited product create/edit/archive and unit assignment routes, product-aware add-unit controls, product counts, and unit-grid product identity. QR values remain `{family QR}-{unit number}` and reservations continue to request one family quantity.
- 2026-07-15: **Item-family QR replacement recovery.** The detail Identity section now routes staff/admin operators to a dedicated QR workspace with `Reset with new code` and scanned/manual replacement options. Both paths require confirmation that the current bin label and all `{binQrCodeValue}-{unitNumber}` labels will stop resolving, while inventory counts, unit numbers, custody, and history stay intact. The dedicated serializable mutation checks case-insensitive collisions against other item families plus serialized QR, primary scan, and asset-tag identities, retries generated collisions, and writes before/after QR values into the same transaction's audit entry. The numbered QR preview remains available for label verification.
- 2026-07-15: **Item-family detail ownership pass.** Active inventory totals now exclude retired numbered records across the shared item-family state helper, so Sony Battery reports 47 available out of 49 active units while keeping units 50-52 visible as three retired records. The detail page now leads with operational inventory truth, label readiness, and the retired-record rule; metadata is grouped into a quieter secondary column; the header is contained and shows active stock; unit controls distinguish active units from numbered records and use larger interaction targets. Focused state/route tests, TypeScript, lint, and app build cover the change; authenticated local visual proof remains unavailable without a configured local test identity.
- 2026-07-10: **Bulk SKU detail visual polish.** Unit-count values in the overview card drop forced mono for standard tabular numerals. Visual only.
- 2026-07-10: **Battery Ops operational status rail.** Missing units, low families, stale flags, and checked-out units now use the shared prioritized rail; available, checked-out, missing, retired, and low-family totals remain under Details without changing effective-status or repair behavior.
- 2026-07-06: **Bulk check-in ledger unification shipped.** `checkedInQuantity` had two incompatible conventions: web `checkinBulkItem` incremented it AND restocked `BulkStockBalance` immediately, while kiosk unit check-in scans and admin-override scans incremented WITHOUT restocking. Completion paths then guessed: `maybeAutoComplete` restocked the full checked-out quantity (double-restocking anything returned via `checkinBulkItem`), while `markCheckoutCompleted`/`forceCompleteCheckout` restocked out-minus-in (permanently under-restocking scan-based returns). Mixing paths on one checkout, e.g. batteries returned at the kiosk then completed from the web, silently corrupted on-hand stock, which availability reads. Now: (1) every check-in scan restocks at the moment of physical return (kiosk unit scans, admin-override numbered and plain scans), so each `checkedInQuantity` increment carries its own CHECKIN movement and availability sees a returned battery immediately; (2) all three completion paths reconcile through the new movement-sourced `settleBulkLedgerAtCompletion` helper (CHECKOUT movements minus CHECKIN movements minus lost units), which is self-healing for pre-deploy returns that never wrote movements; (3) reservation-pickup unit binding enforces bound == plannedQuantity per numbered SKU inside the transaction (the route blocked under-staging but not over-staging, and the ledger was decremented by planned). Contract pinned in `tests/bulk-checkin-ledger-contract.test.ts`. Plan: `tasks/archive/checkin-hardening-plan.md`.
- 2026-07-06: Numbered-unit custody hardening (Sony battery pass). (1) Claim paths now match read paths: kiosk checkout completion, active-checkout add-item, and reservation-pickup unit binding claim on effective availability via the shared `CLAIMABLE_BULK_UNIT_WHERE` guard (`status IN (AVAILABLE, CHECKED_OUT)` AND no active allocation, inside the existing SERIALIZABLE transactions). Previously a battery with an orphaned `CHECKED_OUT` flag scanned as available but 409'd at completion until staff ran repair-stale; now the claim itself heals the flag. (2) Units PATCH →AVAILABLE closes lingering active allocations from non-open bookings, so a found battery can't come back as phantom "checked out on another booking" (a shape repair-stale cannot fix). (3) `markCheckoutCompleted` auto-LOST no longer restores bulk stock for lost units (onHand feeds `checkBulkShortages` even for numbered SKUs) and closes their allocations at completion; loss attribution is unaffected because the bulk-losses report reads the latest allocation regardless of open/closed. That function is currently dead code (caller `completeCheckinScan` has no callers since D-040) but stays exported and is now safe to re-wire. Tests: orphan-claim + genuinely-held cases in `kiosk-checkout-complete-bulk-units`, LOST stock/allocation behavior in `mark-checkout-completed`.
- 2026-07-03: Data-quality repair hardening. `POST /api/bulk-skus/batteries/repair-stale` is now dry-run-first: default requests list stale checked-out battery flags without mutating rows or audit logs, while Battery Ops sends `dryRun: false` only after the operator confirms the repair reason. Applied repairs keep the existing serializable transaction and per-unit `repair_stale_checked_out` audit entries.
- 2026-07-03: Item-family image rehosting joined the existing daily image drain. Active `BulkSku.imageUrl` values that still point at third-party hosts are now picked up by `/api/cron/rehost-images` in a bounded item-family batch, mirrored to Vercel Blob when reachable, capped through `BulkSku.imageRehostAttempts` when unreachable, and included in separate cron result counts so operators can see family-image backlog alongside serialized asset-image backlog.
- 2026-06-29: Battery Ops now matches item-family detail availability for numbered batteries. The read model no longer infers checked-out custody from open `BookingBulkItem` quantity rows; only active `BookingBulkUnitAllocation` rows on `OPEN` checkout bookings make a numbered unit checked out. Orphaned raw `CHECKED_OUT` unit flags stay visible in inventory data warnings and count as Available until repaired.
- 2026-06-26: Item-family freshness shipped. Bulk SKU detail edits, image changes, QR/settings updates, and unit additions now invalidate shared Items catalog caches, while open item-family detail pages listen to the shared item-change signal for committed `BulkSku` updates from other surfaces.
- 2026-06-26: Active item-family department cleanup moved every family still assigned to `Video` onto `Creative`, leaving canonical category FKs and legacy category text intact. The audit-logged cleanup script now treats `Creative` as the default generic family department for future deterministic data repair.
- 2026-06-26: Item-family detail field validation is now hardened for location/category/department references, purchase links, and purchase price. `POST /api/bulk-skus` verifies the target location before creating the SKU and stock balance, `PATCH /api/bulk-skus/[id]` returns clear 400s for missing FK targets, purchase links normalize missing schemes to `https://`, and purchase price is bounded to the stored `Decimal(10,2)` shape.
- 2026-06-26: Item-family detail edits now accept both CUID and UUID foreign-key IDs for category, department, and location updates. This fixes the Sony Battery department save path where a valid UUID department ID was rejected by route validation before Prisma could update the `BulkSku`.
- 2026-06-26: Operational battery/item-family summaries now use effective state beyond the main item APIs. Admin Fix Today low-battery cards, Inventory Hygiene low-stock item-family checks, and Missing Units battery summary totals use the shared item-family state contract. `LOST` and `RETIRED` numbered units now remain terminal in `effectiveBulkUnitStatus` even when stale active allocation context exists, while raw `CHECKED_OUT` reads remain only for stale-data warning and repair detection.
- 2026-06-26: Item-family state read models now share one pure summary helper. `/api/bulk-skus`, `/api/bulk-skus/[id]`, `/api/assets`, `/api/assets/export`, and `/api/form-options` use `summarizeItemFamilyState` for effective unit statuses, on-hand counts, available counts, checked-out counts, and missing/retired counts. The helper preserves the existing contract: unit-tracked families count active allocations as checked out and stale orphaned `CHECKED_OUT` flags as available, while quantity-tracked families use movement-adjusted stock balance.
- 2026-06-26: Numbered item-family mutation and picker state now share the effective unit-status contract. Per-unit status changes still block units with active checkout allocations, but stale raw `CHECKED_OUT` flags without an allocation can be corrected through the audited status route with the right stock-balance delta. `/api/form-options` also derives numbered-family availability from active allocation rows plus effective unit status, so booking pickers no longer drift from `/items`, Battery Ops, or item-family detail.
- 2026-06-26: Generic item-family read models now use the same effective numbered-unit status rule as Battery Ops. `GET /api/bulk-skus`, `GET /api/bulk-skus/[id]`, and the `PATCH /api/bulk-skus/[id]` response count active `BookingBulkUnitAllocation` rows as checked out and treat orphaned raw `CHECKED_OUT` flags as available until repaired, so list/detail availability no longer drifts from Battery Ops or `/items`.
- 2026-06-26: Source-backed item-family name cleanup. The unit-tracked family formerly named `Sony Battery` with bin `94e068d1` is now `Sony NP-FZ100 Battery`, based on the retired duplicate asset's former scan identity and source metadata. The quantity-tracked `Sony Battery` family remains unchanged because stored data does not prove its exact model.
- 2026-06-26: Legacy item-family category text cleanup. `POST /api/bulk-skus` and `PATCH /api/bulk-skus/[id]` now canonicalize the legacy `BulkSku.category` text from the selected `categoryId`, and the item-data cleanup script applied 12 live audit-logged category text corrections. Active family category and department FKs remain complete, and cleanup dry-run now plans 0 data mutations.
- 2026-06-26: Item-family data cleanup shipped. All 21 active item families now have canonical category and department FKs, and 9 duplicate serialized rows for batteries, SD cards, lens caps, sandbags, milk crates, and similar stock were retired in favor of the active `BulkSku` item-family records. Cross-table scan collisions between serialized assets and item families are now 0, so bin QR scans route to the family instead of the retired duplicate asset.
- 2026-06-26: Item-family image cleanup backfilled 6 missing `BulkSku.imageUrl` values from exact active serialized asset image matches through the audit-logged item-data cleanup script. Active item families missing images now stand at 9, tracked in `tasks/item-family-image-sourcing.md`.
- 2026-06-25: Battery custody trust hardening shipped. Effective numbered-unit status is now centralized and allocation-aware across Battery Ops, `/api/assets`, kiosk pickup/reservation staging, and generic scan recording; stale raw checked-out battery flags can be repaired from Battery Ops with audited `repair_stale_checked_out` entries; migration `0084_unique_active_bulk_unit_allocation` adds a partial unique index so one numbered unit cannot have two active checkout allocations.
- 2026-06-23: Battery Ops checked-out unit context now derives holder, booking, due date, and age from active `BookingBulkUnitAllocation` rows for `OPEN` checkout bookings, while keeping future reservations as quantity intent until kiosk pickup. Orphaned `CHECKED_OUT` unit flags with no active checkout context read as Available on Battery Ops instead of inflating checked-out counts.
- 2026-06-23: Battery Ops now exposes read-only inventory data warnings for stale checked-out unit flags that have no active checkout allocation. The warning card lists the affected unit numbers and family/location while the metrics continue to count those units as Available.
- 2026-06-11: Brother battery label CSV export and printed-label tracking shipped. Added `labelPrintedAt`/`labelPrintedById`/`labelPrintBatchId` to `BulkSkuUnit` (migration 0077), a `buildDerivedBulkUnitQrValue` formatter, the `GET/POST /api/bulk-skus/[id]/units/labels` route (CSV export + audited batch mark-printed), label counts on Battery Ops cards with a Brother CSV download and mark-printed confirmation seeded from the exported unit numbers, per-unit printed-label indicators in Battery Ops and `BulkUnitGrid`, and a secondary export on the numbered-unit detail tab. QR values stay derived and are never stored.
- 2026-06-11: Native iOS Scan and global search now decode `/api/assets` item-family `bulkItems`, so a printed derived unit QR such as `{binQrCodeValue}-1` resolves to the parent battery family and scanned unit context instead of being discarded as no item found. Scan-to-add in native reservation creation still asks users to add item families with the quantity controls.
- 2026-05-30: Battery hardening adjustment slice shipped. Battery Ops now includes quantity-tracked battery families, adds audited signed quantity adjustments, adds audited numbered-unit creation with operator reasons, requires reasons for unit status changes, blocks any status mutation while a unit is checked out, and shows before/after count impact before staff confirm.
- 2026-05-30: Battery hardening started. Battery Ops and checkout picker form-options now return live no-store count responses instead of browser-cached inventory counts, and picker-selected bulk quantities clamp down with explicit recovery copy when refreshed availability drops below the selected quantity.
- 2026-05-25: Web bug sweep Batch 27 hardened item-family detail tab URL state. Bulk SKU detail now rehydrates `?tab=` links and browser Back/Forward through the shared URL-state hook, and direct links to mode- or role-hidden tabs fall back to Info instead of rendering an empty detail body.
- 2026-05-24: Web bug sweep hardened item-family detail and Battery Ops client fetches. Bulk detail loading, inline saves, QR edits, department loading, Battery Ops loading, unit status changes, unit additions, archive, and delete now avoid raw JSON assumptions, guard duplicate actions with refs where state alone could race, differentiate network/server failures, and expose stable ids/names for visible inline editor controls.
- 2026-05-24: Shared item-family image replacement inherited the `ChooseImageModal` reliability sweep: search probe/results and image mutation responses now parse safely, upload/remove handle expired sessions through the shared auth redirect, and every save/remove path shares a ref-backed duplicate-submit guard.
- 2026-05-21: Battery Ops summary metrics now use the shared `OperationalMetricCard` primitive instead of a route-local metric card helper, keeping available, checked-out, missing, retired, and low-family tones aligned with the design-language metric contract.
- 2026-05-20: Battery Ops checked-out-units panel now uses shared inline `EmptyState` copy when no battery units are currently checked out, matching item-family detail empty-state behavior.
- 2026-05-20: Unit-tracked item-family detail now uses shared inline `EmptyState` copy and recovery action when no units exist, replacing the local text-only empty row.
- 2026-05-20: Item-family image replacement now participates in the shared Brave-backed product image search flow. Bulk SKU detail headers seed search from `sku.name`, and selected results still save through the existing bulk image endpoint so future manually chosen photos are re-hosted rather than stored as raw third-party image URLs.
- 2026-05-13: Admin navigation now labels the battery operations surface as Battery Ops, and item-family detail handoff copy uses Stockroom view for the direct staff/admin operations path.
- 2026-05-13: Native kiosk battery-unit scan clarity now shows required/scanned unit counts, exact scanned/returned unit chips, and clearer blocked pickup-confirm guidance for unit-tracked battery families.
- 2026-05-13: Battery cockpit and Missing Units report copy now use Missing and Units language in metrics, empty states, unit actions, and section descriptions instead of old lost/numbered wording.
- 2026-05-13: Item-family detail copy now treats the page as a normal item detail surface, with compact Units/Quantity tracking labels, Missing wording for `LOST` unit exceptions, clearer low-stock threshold labels, and QR copy that no longer assumes web-app label printing.
- 2026-05-13: Reframed this area as admin/staff operations for first-class item families. `/items` now owns normal discovery/detail routing, while `/bulk-inventory` keeps stock, unit, QR, threshold, and audit controls.
- 2026-05-13: Creation/list language now favors Standard, Units, and Quantity for users. `unit-tracked` and `quantity-tracked` remain implementation/doc terms where precision is useful.
- 2026-05-13: Label/report/admin polish brought print labels, Battery Ops metrics, item-family settings, and report docs into the first-class item-family language while keeping `BulkSku` as the implementation record.
- 2026-05-13: Battery follow-through polish. Kiosk checkout detail now returns typed numbered-battery item metadata plus scan-summary counts, and the iOS kiosk pickup/return screens show a dedicated battery-unit scan progress card.
- 2026-05-13: GAP-37 closed. `/reports/bulk-losses` now appears as Missing Units and includes a unit-tracked battery audit section with missing units by unit number, missing rate by family, recent battery checkout history, repeated missing family/requester patterns, and a handoff back to Battery Ops.
- 2026-05-10: Status/data wiring ship fixes. Quantity-only bulk read models now report availability from the movement-adjusted stock balance, and checkout cancellation restores outstanding stock with a compensating movement before the booking is cancelled.
- 2026-05-08: API hardening Wave 13. Battery cockpit reads now use short private caching, battery-family detection uses term-boundary matching, and license/bulk history-style endpoints stay bounded.
- 2026-05-08: API hardening Wave 12. Bulk asset maintenance toggles now run under SERIALIZABLE isolation with transaction-local audit rows, and bulk SKU activity cursors must belong to the requested SKU or unit audit scope before pagination continues.
- 2026-05-08: API hardening Wave 11. Bulk stock adjustments now bound both request deltas and resulting on-hand quantities to prevent overflow-scale inventory counts; numbered-unit status updates were re-verified as SERIALIZABLE read/update/balance operations.
- 2026-05-06: Battery compatibility lows panel shipped on `/bulk-inventory/batteries`. The cockpit now summarizes low compatible battery families by matching active camera inventory to the existing Sony/Canon/V-mount compatibility rules, then comparing available numbered battery units against each family threshold.
- 2026-05-06: Battery Unit Cockpit shipped at `/bulk-inventory/batteries`. The Admin nav now exposes a battery-focused operational page for active unit-tracked battery families with available/out/lost/retired counts, low-stock signals, checked-out unit aging, booking/requester context, and direct audited unit status actions.
- 2026-05-06: Kiosk battery mismatch polish shipped. Derived unit QR handling now checks active unit-tracked battery families beyond the booking family list so kiosk pickup/return can explain wrong battery type, already checked-out elsewhere, not checked out on this booking, duplicate scan, and lost/retired unit cases.
- 2026-05-06: Items Fill gaps now includes active bulk SKUs when counting and assigning missing category or department values, suggests departments from same-category inventory patterns including legacy bulk rows with category text but no `categoryId`, and the Items table receives bulk department metadata from `/api/assets`.
- 2026-05-05: Battery compatibility mapping aligned to the current import snapshot: Sony NP-FZ100 bodies (FX3, A7/A1/A9 family) and Sony BP-U bodies (FX6) warn against matching unit-tracked battery families.
- 2026-05-05: Bulk battery hardening — kiosk pickup/check-in now accepts numbered battery unit QR scans, lookup resolves battery units, and checkout creation warns when compatible battery availability is low.
- 2026-05-05: Numbered bulk unit QR scans shipped — values like `94e068d1-7` resolve to the parent SKU and unit #7 without opening the picker.
- 2026-05-05: Clarified battery/media split — QR-coded batteries remain numbered bulk units, while camera-slot SD cards belong to the item attachment model.
- 2026-03-15: Bulk inventory V1 shipped — SKU CRUD, quantity vs numbered tracking modes, unit table, add units, convert to numbered. Color-coded status badges. Mobile card layout. Pagination.
- 2026-04-06: Bulk inventory page hardening (5-pass audit) — 401 redirect on all 3 mutations (add units, convert to numbered, unit status change). List data uses `useFetch` hook.
- 2026-04-09: Design refresh (Phase 2) — UNIT_STATUS_CLASSES token map added. Data-table → shadcn Table. useConfirm instead of native confirm(). Shadcn Pagination. Tailwind classnames. Doc sync.
- 2026-04-09: Created AREA_BULK_INVENTORY.md as formal feature area documentation.
