# Items Area Scope (V1 Hardened)

## Document Control
- Area: Items
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-08-27
- Status: Active
- Version: V1

## Direction
Treat physical gear identity as primary, make list and detail views action-oriented, and keep item state reliable through derived logic.

Design language reference: `docs/DESIGN_LANGUAGE.md`.

## Core Rules
1. `tagName` is the primary label for serialized assets.
2. `productName`, `brand`, and `model` are supporting metadata.
3. Asset availability/status shown in UI is derived from active allocations and booking context.
4. Item creation starts with friendly tracking-style selection:
   - **Standard**: one physical item with its own identity, for example a camera body, lens, or laptop.
   - **Units**: one item with many scannable units, for example batteries, radios, or card readers.
   - **Quantity**: one item tracked by count only, for example tape, zip ties, or cleaning supplies.
5. Item families are normal catalog rows backed by `BulkSku`; they appear in `/items` beside serialized assets and show availability such as `43/46 available`.
6. Unit-tracked item families use `BulkSkuUnit` records for pickup, return, loss, and audit custody without creating one catalog row per physical unit.
7. Quantity-tracked item families use the same first-class Items discovery model without unit-level QR custody.
8. Role behavior follows `AREA_USERS.md`:
   - `ADMIN` and `STAFF` can create and edit items.
   - `STUDENT` can view all items, no item edit rights.
9. Metadata enrichment from external product URLs is not supported in V1.
10. Camera-tied SD cards, cages, and fixed camera parts are tracked as item attachments when they should travel with the parent camera and not be individually checked out.
11. One unit-tracked family may contain multiple interchangeable branded products. The family remains the one catalog and reservation row; product identity belongs to each numbered physical unit.
12. Battery discovery uses four canonical item-family rows only: `Monitor Battery`, `Sony Battery`, `Gold Mount Battery`, and `FX6 Battery`. Quantity-only, model-specific, and serialized battery duplicates stay out of the active catalog.

## V1 Workflow

### Items List
1. User lands on all items list (default table mode), sorted by Most popular.
2. User filters by status/category/location/item kind and searches by tagName, productName, brand, model, serial, or tracking code.
3. Searches return one row per item family/SKU; exact unit QR scans resolve to unit context under the parent family rather than producing separate catalog rows.
4. User opens row details or row actions.
5. Reference-data bootstrap is query-backed and recoverable: initial failures show Retry, partial failures name unavailable groups while preserving healthy data, and background failures keep stale options visible. Edit actions remain unavailable until role truth is known.

### Native iOS Items
1. Items is the first destination inside the compact native Browse tab, not a standalone compact tab.
2. Browse owns the navigation stack for its embedded destinations. Opening an item pushes Item Detail on that same stack, and Back returns to the Items list without exposing an intermediate blank transition or dropping to the Browse menu.
3. Search stays in the native search bar.
4. Favorites, Status, and Sort live in native toolbar buttons and menus so the list avoids custom pill chrome while keeping the current filter state discoverable.
5. Row actions remain swipe and context-menu based: Favorite, Reserve, and Copy Asset Tag.
6. The mobile Items list defaults to the web-backed `Most popular` sort and also offers `Asset tag` through a compact native menu.
7. The mobile Items list renders serialized assets and item families in the server-provided mixed order; unit-tracked and quantity-tracked families keep the same naming as web rows.
8. The mobile Items list intentionally avoids desktop-only bulk actions and advanced filter density.

### Inventory Hygiene
1. Staff/admin opens the "Keep data clean" lane on `/operations` (the old `/items/hygiene` route redirects there). `GET /api/inventory-hygiene` is unchanged.
2. The lane shows cleanup checks that improve picker, search, checkout, kit, and scan quality.
3. Each issue card links to the existing repair surface instead of adding new mutation paths.
4. Slice 1 checks missing category, missing department, missing primary scan code, missing image, duplicate scan identity, retired items still in active kits, camera bodies with no attachments, and active bulk SKUs below threshold.
5. The page frames those checks as a read-only cleanup queue with priority ordering, clean/check progress, needs-work/all/clean views, partial-failure warnings, and tag-first sample rows.
6. Checklist health uses the shared shadcn-backed status indicator: green for clean, orange for needs-work or partial data, and red only for critical/blocking states.
7. The Items Fill gaps wizard can repair missing categories and departments across standard items and item families. Missing-category suggestions prefer existing categorized inventory patterns, then fall back to gear-term matching. The backing missing-field API counts standard items and item families separately, pages each source at the database layer, and reports when suggestion matching used a capped sample.

### Create Item
1. User starts `Add item`.
2. User selects tracking style:
   - Standard: one physical unit per record with unique identity.
   - Units: one catalog row with numbered/scannable units underneath.
   - Quantity: one catalog row with count-only stock.
3. User enters required fields and optional advanced metadata.
4. For a newly created Standard, Units, or Quantity record, the user can stage an optional image from product search, HTTPS URL, or file upload before saving. Quantity adjustments to an existing record keep the existing catalog image unchanged.
5. The create mutation runs first, then the staged image saves through the created record's audited image endpoint.
6. The shared handoff confirms record and image state, prioritizes `Add another item`, and keeps `Open item` and `Return to list` available.

> **Picker Roadmap:** Form comboboxes (Department, Location, Category, Bulk SKU) are covered in `tasks/item-picker-roadmap.md` — see FormCombobox V1 cleanup for normalization plan.

### Item Detail
1. User opens item details from list.
2. Header exposes fast actions (`Reserve`, `Check out`) by permission and policy.
3. Header status line exposes live operational state with linked booking context when applicable.
4. `Info` tab opens the default dashboard view with active check-out, upcoming reservations, and editable item information in a split layout.
5. Additional tabs expose schedule context, lightweight insights, complete touch history, attachments, and policy settings.
6. The Attachments tab groups child items into SD Cards, Cages and Rigging, and Misc Parts. Rows lead with the attachment display name, not generated internal storage tags. SD card tags such as `MBB 17 IV 1A` display as camera-slot assignments.

## Items List Surface (V1)

### Top Bar Actions
1. `Add item` visible to `ADMIN` and `STAFF`.
2. `Import` visible to `ADMIN` and `STAFF`.
3. `Export` visible to `ADMIN` and `STAFF`; hidden for `STUDENT`. Downloads the current filtered CSV view.
4. `Customize overview` deferred — not in V1.

### Filters and Controls
1. Search input for identity and metadata fields.
2. Filters control plus quick filter chips:
   - Status
   - Category
   - Location
   - Flag
   - Item kind
   - Kit status
   Category options are exact-ID filters and use full hierarchy paths, including parent nodes and deeply nested subcategories.
3. Sort defaults to Most popular by recent checkout, reservation, and scan usage. Asset tag, category, department, and location remain available.
4. View toggle supports table mode as required baseline.
5. Mobile keeps search and filter access pinned at top for long lists per `AREA_MOBILE.md`.

### Table Columns (V1 Baseline)
1. Selection checkbox
2. Name cell:
   - Primary: `tagName`
   - Secondary: status indicator, tracking code, and key metadata
3. Category
4. Location
5. Brand
6. Model
7. Row actions (kebab)

### Row Behavior
1. Row click opens item details.
2. Status indicator reflects derived availability.
3. Kebab menu includes state-appropriate actions by role.
4. Multi-select is allowed, including item-family rows. Select all matching honors the active item kind and returns family row ids as `bulk-{id}`. Bulk mutations still apply only to serialized items and skip families.
5. Mobile list interactions should avoid deep category drilling as the primary path, favoring search and direct item rows.
6. Attachments are hidden by default and only shown through the Hidden attachments only filter or direct scan/search.

### Pagination
1. Show `Showing X to Y of Z`.
2. Rows per page defaults to 25.
3. Search, filters, sort, page, and rows-per-page are URL-backed and rehydrate after item-detail navigation or browser Back.

## Create Item Surface (V1)

### Required Fields

#### Standard
1. Tracking style = Standard
2. `tagName` (required for standalone Standard items; optional for parented attachments because the app generates a quiet internal tag when blank)
3. Category (required)
4. Location (required)
5. QR code / tracking code (required)

#### Units
1. Tracking style = Units
2. `productName` or display name (required)
3. Category (required)
4. Location (required)
5. Initial unit count (optional, creates numbered units)

#### Quantity
1. Tracking style = Quantity
2. `productName` or display name (required)
3. Category (required)
4. Location (required)
5. Initial quantity (optional)

### Optional Metadata (Collapsed by default)
1. Brand
2. Model
3. Product URL
4. Serial number
5. Purchase date
6. Purchase price
7. Warranty date
8. Residual value
9. Department
10. Fiscal year purchased
11. Notes/description

### Firmware Watch
1. Firmware watch targets are model-level metadata; installed firmware is stored per asset as item metadata key `installedFirmwareVersion`.
2. Watched products use explicit official manufacturer support URLs and parser types.
3. The daily watcher records latest version, release date, baseline status, last check time, and last parse/fetch error.
4. New version notifications are admin-facing operational alerts; item detail compares any recorded installed version against latest available firmware for the matched model.
5. Item detail displays firmware as a compact row inside the admin-only `Identity` section of the `Info` card when the item brand/model matches a watched target. The row matches QR/serial identity styling and uses only a compact `installedFirmwareVersion` badge: green means the recorded installed version matches latest available firmware, orange/yellow means it is behind, and gray means no installed version or no latest version is known.
6. Clicking the firmware badge opens the installed-version editor with installed firmware, newest firmware, last checked date, release date, and the official manufacturer update page link. The mark-updated-to-latest action renders inline below the version input and only when the recorded installed version differs from the latest known version; the dialog footer holds only the manufacturer link and Save.
7. When an installed version is recorded and behind the latest known version, the Identity firmware row shows a muted "x.xx available" hint next to the badge.

### Image Options
1. Upload image
2. Use image from web URL
3. Search for a product photo through the configured Brave Search API
4. Remove/replace image
5. Preserve manual override behavior and image source tracking

### Validation and Save Behavior
1. Save is blocked on missing required fields.
2. Save is blocked on duplicate serialized identity collisions (for example duplicate `tagName` policy if required).
3. Standard manual intake keeps asset tag, category, location, and QR code required for standalone items while allowing product name, brand, model, and department to be filled later.
4. Standard attachments keep category, location, parent item, and QR code required, but the visible asset tag field may be blank. Blank attachment tags submit a generated internal tag from the parent, attachment identity, and QR code so the physical label can stay QR-only with a nearby parent number.
5. Blank Standard brand/model values submit explicit `Unknown` placeholders until operators replace them, preserving the current non-null asset schema without blocking high-volume intake.
6. Submit disables form controls, guards rapid duplicate submits, handles expired sessions through the shared auth redirect, and shows form-level errors for validation, permission, server, or network failures.
7. Every successful Standard, Units, Quantity, or add-to-existing mutation shows the same explicit handoff. `Add another item` resets the full sheet to a blank Standard record; image failure after a successful create keeps the created record and offers a retry without repeating creation.
8. The sheet does not persist drafts in V1. Long-lived draft recovery remains reserved for full-page wizard flows such as booking creation.

## Item Detail Surface (V1)

### Header
1. Primary title: `tagName` for serialized items.
2. Secondary metadata: `productName`, `brand`, `model`, and tracking code.
3. Derived status line sits directly under the headline and uses these labels and colors:
   - `Available` (green)
   - `Pending pickup by {user}` (orange, clickable to the reservation or legacy pending pickup checkout)
   - `Checked out by {user}` (blue, red when overdue, clickable to the active checkout)
   - `Reserved by {user}` (purple, clickable to the active reservation once the reservation window has started)
   - `Needs Maintenance` (orange)
   - `Retired` (gray)
4. Status remains derived from active allocations, booking state, maintenance flag, and retirement state. It is not manually editable freeform text.
4. Primary actions:
   - Reserve
   - Check out
5. `Actions` button exposes secondary operations:
   - Duplicate
   - Retire
   - Delete
   - Needs Maintenance
6. `Delete` is allowed only for policy-safe records with no linked reservation history, checkout history, or active allocations. Otherwise the action is hidden or blocked with guidance to use `Retire`.

### Tabs
1. `Info`
2. `Schedule`
3. `Insights`
4. `History`
5. `Attachments`
6. `Settings`

### Info Tab Dashboard Layout
1. `Info` is the default tab and acts as the item dashboard.
2. Desktop layout is split:
   - Left column: operational overview cards
   - Right column: item information card
3. Mobile stacks these sections vertically with operational cards first.

### Left Column: Operational Overview
1. Show both check-outs and reservations by default without requiring a tab switch.
2. Active check-out card displays:
   - Due-back countdown
   - Checkout name or linked event name
   - Current holder
   - Direct link into the checkout record
3. Reservation overview lists upcoming reservations for the item:
   - Reservation title or event
   - Time window
   - Owner
   - Direct link into the reservation record
   - Status labels and badge colors come from the shared booking status display helper, not item-detail-local booking status switches.
4. Recent past bookings render below upcoming reservations for quick context without requiring a tab switch.
   - Rows stay compact, use the requester avatar when available, and prioritize title, requester, date range, booking kind, and status.
5. If no active check-out, upcoming reservation, or past booking context exists, show a clear empty state instead of blank space.

### Right Column: Item Information Card
1. Core metadata fields and editable values by role.
2. Immutable identity values displayed clearly where edits are restricted.
3. Empty optional fields render as action-oriented placeholder text in a distinct muted-accent color, for example `Add purchase price`.
4. Audit-backed edit history and booking touches remain available via `History` tab.
5. `Category` uses a dropdown wired to the canonical category list.
6. `Link` field is available for item-specific external URL entry.
7. `Fiscal Year Purchased` uses predetermined dropdown options based on July 1 fiscal-year rollover:
   - On March 9, 2026, the current fiscal year option is `2026`
   - Option generation should align future values to the same July 1 rule
8. The item information card groups fields into Product, Organization, Procurement, and Notes sections for faster scanning without hiding editable values.
9. `Purchase price` is a USD field: it shows a dollar affordance, accepts common USD formatting, saves as a two-decimal numeric value, and rejects malformed currency instead of loosely parsing partial numbers.
10. `Link` normalizes missing schemes to `https://`, only opens/copies valid `http` or `https` URLs, and shows the source host inline when available.

### Tracking Code and QR Behavior
1. Show QR code / tracking code inside the admin-only `Identity` section of the item information card instead of a detached side panel.
2. Render a QR thumbnail from the stored text code when a code exists.
3. If no QR code exists, provide:
   - `Generate QR code` action that creates a new unique code
   - Manual text input to type or paste a QR code
4. Manual QR entry must validate uniqueness before save.
5. Tracking code edits must remain auditable.

### Settings Tab
1. Settings is the policy surface, not an item-status editor.
2. Show a small status-source summary so users understand current availability is derived.
3. Settings toggles:
   - Check-out eligible
   - Reservation eligible
   - Custody eligible
4. These toggles represent eligibility policy, not current real-time status.
5. Toggle help text should make the operational meaning explicit:
   - Check-out eligible: item can leave inventory through check-out workflows
   - Reservation eligible: item can be reserved for future use
   - Custody eligible: item can be assigned into custody outside short-term bookings

### Schedule Tab
1. Month cells show multi-day bookings as continuous week-spanning bars so one booking reads as one schedule block.
2. Booking bars remain clickable so users can still open the linked booking from any occupied day span.
3. The tab includes a compact month agenda so the calendar answers which booking is occupying the item, not only that a day is occupied.
4. Cancelled bookings stay out of the calendar, agenda, and quick Past Bookings context because they no longer occupy the item schedule.
5. Mobile keeps the agenda-style list so schedule context is usable without relying on the desktop grid.
6. Clicking a schedule booking opens an in-place preview sheet for quick context; deeper edits belong on the full booking page.
7. Booking preview identity should use requester/creator avatars where available so the sheet reads as human activity, not only booking metadata.

### Insights Tab
1. Insights stay lightweight and operational, focused on demand, usage, lifecycle, borrower, and sport signals.
2. Lifecycle values should use human-readable units, for example item age in years instead of raw day counts for older items.
3. Return-timing metrics must avoid overstated precision unless backed by a recorded completion/check-in event.

### History Tab
1. History is the complete item touch log for admins and staff.
2. Users can scope the feed to:
   - All activity
   - Item updates
   - Booking activity involving this item
3. Activity loading is paginated with a visible `Load older entries` action.
4. Timeline rows should translate legacy backend action names into operational language and hide noisy import metadata from field-change pills.

## Bug Traps and Mitigations

### Trap: Manual status edits create drift from allocations
- Mitigation:
  - Do not provide direct editable status field.
  - Always compute status for display from active allocations.

### Trap: Item delete conflicts with audit and booking history
- Mitigation:
  - Allow deletion only for records with no active allocations and no historical booking links.
  - Route all other end-of-life handling through `Retire`.

### Trap: QR generation creates duplicate tracking identity
- Mitigation:
  - Use unique-code generation with collision check before save.
  - Validate manually entered QR codes against the same uniqueness rule.

### Trap: Info tab becomes blank when item has no linked activity or metadata
- Mitigation:
  - Use explicit empty states and inline `Add ...` prompts for missing values.
  - Keep item information card populated even when no booking data exists.

### Trap: Serialized and item-family logic bleed into each other
- Mitigation:
  - Split create and validation paths by serialized asset vs item family kind.
  - Keep item-kind-specific required fields explicit.

### Trap: Duplicate or ambiguous tag identities
- Mitigation:
  - Enforce uniqueness policy for serialized identifiers.
  - Show conflict error with direct resolution guidance.

### Trap: Image metadata prefill overwrites operator intent
- Mitigation:
  - Never overwrite `tagName`.
  - Let user explicitly accept or override image and metadata values.
### Trap: Detail toggles interpreted as status controls
- Mitigation:
  - Label toggles as policy eligibility.
  - Keep derived status visible separately in header.

### Trap: Students discover hidden edit paths via direct route
- Mitigation:
  - Enforce server-side item mutation authorization.
  - Return consistent authorization errors and audit denied attempts.

## Edge Cases
- Missing thumbnail in list row.
- Item has linked reservations/checkouts while category/location edits are attempted.
- Mixed-location history on item with `locationMode = MIXED`.
- Imported item missing `productName`, requiring fallback to `tagName`.
- Tracking code removal requested on asset with active allocations.
- Item has no QR code and needs first-time generation.
- Item has no purchase metadata and should show inline `Add ...` prompts.
- Item is in an in-progress checkout draft (`Checking Out`) and detail header must deep-link correctly.

## Acceptance Criteria
- [x] AC-1: Items list supports required filters, search, and baseline columns.
- [x] AC-2: `tagName` is primary in list and detail for serialized assets.
- [x] AC-3: Header status line supports the defined labels, colors, and deep links for active reservation, checkout, and draft-checkout states.
- [x] AC-4: Item status shown to users is derived, not manually controlled.
- [x] AC-5: Create flow enforces required fields by item kind.
- [x] AC-6: Default `Info` tab shows both operational overview cards and the item information card.
- [x] AC-7: Item detail exposes required tabs and role-appropriate actions.
- [x] AC-8: `Actions` menu includes Duplicate, Retire, Delete, and Needs Maintenance with policy-safe gating.
- [x] AC-9: Category and fiscal year fields use controlled dropdowns.
- [x] AC-10: QR code thumbnail renders from stored text code, and missing-code flow supports generation or manual entry.
- [x] AC-11: Empty optional fields show inline `Add ...` prompts instead of blank values.
- [x] AC-12: Export visibility follows role rules. **(Shipped — Export button in items page header, visible to ADMIN/STAFF only. Downloads filtered CSV.)**
- [x] AC-13: Image and metadata prefill never overwrite `tagName`.
- [x] AC-14: All item mutations are auditable.
- [x] AC-15: Items list and detail surfaces verify committed item and item-family changes without requiring manual browser refresh. `/items` refetches on mount, successful detail mutations invalidate item-family caches, and a lightweight item-change signal converges visible, online, recently active list/detail state from `Asset`, `BulkSku`, and audit changes. Polling pauses after two minutes without browser activity and checks immediately when activity resumes.

## Dependencies
- User role and ownership model from `AREA_USERS.md`.
- Reservation and checkout linkage from `AREA_RESERVATIONS.md` and `AREA_CHECKOUTS.md`.
- Integrity rules from `DECISIONS.md` (D-001, D-006, D-007).
- Mobile operations contract from `AREA_MOBILE.md`.

## Unit-Tracked Item Families

### Overview
Item families can optionally enable `trackByNumber` on the backing `BulkSku` implementation record to assign individually numbered units (e.g., Battery #1-#40) under one parent bin QR. Unit QR values are derived from that parent QR plus the unit number, so physical labels can show only the unit number while scans still resolve a specific unit. Family-scoped products can identify the Watson, GVM, Sony BP-U, or Anton/Bauer product assigned to each unit without splitting the catalog row or QR sequence. The live battery catalog applies this rule through the four canonical Monitor, Sony, Gold Mount, and FX6 families.

### Creation
1. Staff toggle "Track by number" during item-family creation.
2. Initial quantity creates numbered units #1–N via `createMany`.
3. Physical labels on items must match assigned numbers (user responsibility).

### Unit Lifecycle
- **Statuses:** AVAILABLE, CHECKED_OUT, LOST, RETIRED (`LOST` is usually presented to staff as Missing)
- **Status transitions:** click-to-cycle in UI (Available → Missing → Retired → Available); checked-out units are locked
- **Adding units:** POST to units endpoint appends from max+1
- **Conversion:** existing quantity-only SKUs can be converted to numbered tracking

### Checkout/Check-in Flow
1. Booking creation records numbered batteries by quantity, not by unit number.
2. Kiosk pickup scans each physical unit QR and allocates that unit via `BookingBulkUnitAllocation`.
3. Kiosk check-in scans each physical unit QR and returns only that unit.
4. The bin QR plus picker flow remains available for non-kiosk scan surfaces.
5. Missing units are flagged with specific unit numbers.

### Data Model
- `BulkSkuUnit`: numbered unit with status, linked to BulkSku (cascade delete)
- `BulkSkuProduct`: product identity beneath one BulkSku, with family-scoped normalized-name uniqueness
- `BulkSkuUnit.productId`: optional exact-product assignment; product ranges are never inferred from unit numbers
- `BookingBulkUnitAllocation`: links specific units to bookings with checkout/checkin timestamps
- `trackByNumber` boolean on BulkSku determines behavior branching

### Inventory Display
- Unit-tracked families show available/total count and status summary in table
- Expandable unit grid with color-coded status dots
- Numbered battery available quantity derives from units with `AVAILABLE` status

### Decision Reference
- D-022: Item Families With Checkoutable Units (see DECISIONS.md)

## Out of Scope (V1)
1. Procurement workflow and purchase-order lifecycle.
2. Depreciation accounting model.
3. Bulk mutation operations beyond basic import/export.
4. Full customizable analytics overview on items list.

## Developer Brief (No Code)
1. Implement list controls and table schema with tag-first identity and derived status indicators.
2. Implement create flow split by Standard, Units, and Quantity tracking styles, with strict validation.
3. Implement detail layout with linked status header, workflow tabs, dashboard-style `Info` view, and `Settings` tab policy controls.
4. Enforce role-based edit visibility and server-side authorization checks.
5. Preserve audit coverage for every mutation.

## Change Log

- 2026-08-27: **Repeated item copies now keep the latest feedback authoritative.** Link, QR-dialog, and QR/serial identity copy controls cancel the older reset timer, ignore superseded clipboard results, and clear pending timers when the control leaves the page. A second success receives its full copied-state window instead of being cleared early by the first click. Item identity, QR generation, permissions, and data contracts are unchanged. Focused tests, TypeScript, full lint, and `npm run build:app` pass locally; populated Item browser proof remains separate.

- 2026-08-26: **Item identity and links now report copy failures honestly.** Link, QR, and QR/serial identity controls only enter their copied state after the browser accepts the write and show visible-value manual-copy recovery when clipboard access is unavailable. Item identity, QR generation, permissions, and data contracts are unchanged. Focused source/behavior tests, TypeScript, and lint pass locally; the full build remains blocked by unrelated dirty Trade Board work.

- 2026-08-26: **Items list context now survives Item detail navigation.** Search, filters, sort, page, and rows-per-page continue to share one query string, and their updates now go through the App Router so browser Back returns to the same result set instead of the default full Items list. No item API, pagination, permission, or detail behavior changed.
- 2026-08-23: **Items list now opens on Most popular, and select-all matching follows the visible kind.** `/items` defaults to the existing popularity sort from recent checkout, reservation, and scan usage. Clearing a column sort snaps back to Most popular instead of falling through to Asset tag. The clean `/items` URL means Most popular; choosing Asset tag writes `sort=assetTag`. Select all matching now sends `item_type` and includes item-family ids.

- 2026-08-23: **Omitted `/api/assets` sort and native Items now match web Most popular.** Callers that leave `sort` off `/api/assets` receive the same popularity ranking as `/items`. Native Items opens on Most popular, treats that sort as the resting toolbar state, and still offers Asset tag. Dedicated picker-search stays asset-tag ordered so category lists remain scannable.

- 2026-08-09: **Native item clears are explicit and authoritative.** Item Detail now distinguishes an unchanged name, serial number, or notes field from a user clearing it. Name and serial clears encode JSON `null`, notes clears encode the server's accepted empty string, and the sheet installs the returned changed fields immediately after success instead of reporting success before a fallible reload.

- 2026-07-31: **Snow Leopard catalog and reservation-entry hardening.** Reservation entry points now fail closed until the signed-in user is loaded and collaborators have `RESERVATION_CREATE`. Item page initialization, brand references, and form options enforce the collaborator catalog or My Gear capability at the API boundary, matching the existing sanitized response contract.
- 2026-07-28: **Add Item image and repeated-intake workflow unified.** The comprehensive Add Item sheet keeps Standard, Units, and Quantity in one form while removing duplicated tracking guidance and the pre-submit Add another checkbox. Every newly created catalog record can stage one optional image through the shared Search, Paste URL, or Upload chooser before save; serialized and item-family image persistence runs only after create returns an ID and uses the existing audited Blob routes. Quantity add-to-existing leaves the current catalog image alone. The shared result state makes `Add another item` primary and fully resets to Standard, while image failure reports that the item was created and retries only the image mutation. The previous serialized upload field mismatch (`image` versus the route's required `file`) is removed.
- 2026-07-18: **Native reservation item-family presentation now matches Items truth.** Reservation category tabs preserve the server-provided mixed popularity order for serialized assets and item families. Other means every reservable result outside Cameras, Lenses, and Batteries. Numbered-family rows show available over effective on-hand inventory, such as `42/46 available`, while planning quantities remain abstract until exact units bind at kiosk pickup. `/api/form-options` now uses the effective numbered-unit roster for that denominator instead of a potentially stale balance. No family identity, derived availability, unit status, reservation payload, or custody behavior changed.
- 2026-07-17: **Native Browse-to-Item navigation repaired.** Browse now owns one navigation path across Items and Item Detail instead of embedding an Items-owned `NavigationStack`. Items uses the explicit always-visible native navigation-bar search drawer so SwiftUI reserves its row above loaded content instead of overlaying the first item during the push. Row-to-detail animation and Back navigation stay in one native hierarchy; Back returns to Items, while selecting the active Browse tab again returns to the Browse menu. The adjacent Users destination uses the same embedded-stack and search-drawer contracts, and completed reservation creation from Items still opens the new booking through destination state. No item API, filter, reservation, role, or custody contract changed.
- 2026-07-17: **Item-family exhaustion and conversion bounds are explicit.** Unit numbers and generated counters stay within PostgreSQL `Int` range, duplicate logical unit identities are rejected, and numbered-family creation/conversion is capped at 500 units. Quantity-tracked families keep large count support. Converting a quantity family to numbered units now rejects any nonzero balance outside the chosen location before writing units, stock, or audit history, preventing hidden stock from being stranded or silently discarded.
- 2026-07-17: **Asset-create validation and conflict reporting tightened.** Purchase and warranty values must be valid ISO dates before Prisma runs. Uniqueness conflicts now name the actual identity involved, including asset tag, serial number, QR code, or primary scan code, instead of always reporting an asset-tag collision.
- 2026-07-17: **Native Item Detail hierarchy refresh.** The iOS detail surface now leads with a compact adaptive static-image-and-Gotham-Black identity hero, without duplicate navigation/status chrome. The product subtitle is a quiet caption and the location beneath it has stronger contrast. A linked active-custody card reads booking title, natural live due copy such as `Due in 2 hours, 40 minutes`, then requester; otherwise a quiet card says `Available` or `Available until [next reservation]`. Reservation actions use the semantic purple reservation tone. Upcoming Reservations remains visible on the main page even when empty; populated rows stay chronological and open Booking Detail. A neutral one-line Previous Bookings row opens newest-first history already returned by `/api/assets/[id]`; previous records reveal in 10-row scroll batches and open Booking Detail. Details and Previous Bookings share the same compact single-row card anatomy while category, department, serial, procurement, product-link metadata, and a collapsed Attachments disclosure live under Details. The tappable QR chip drops its redundant copy icon, and Edit/QR/product-link commands use the native overflow menu. No server query, API shape, data, status, reservation, or custody behavior changed. Regression guard: `tests/ios-item-detail-hierarchy.test.ts`.
- 2026-07-16: **Items list interaction-detail conformance.** Header commands, retry actions, item-type controls, advanced-filter triggers, selection controls, favorites, and desktop sort headers now meet the 40px operational target baseline. Creation entry points consistently say `Add item`; desktop table headers preserve sentence case and use keyboard-operable buttons with accessible sort state and contextual icon motion that skips initial render. Favorite state transitions use the same controlled icon treatment, mobile rows gain precise 0.96 press feedback, Hidden attachments uses its full labeled container, requester photos use neutral black/white outlines, and the faceted-filter plus icon is optically spaced through the button's existing gap. Item identity, image rendering, filter/sort behavior, selection semantics, freshness, creation, and row actions are unchanged.
- 2026-07-16: Collaborator catalog visibility now derives from the active affiliation policy's `GEAR_CATALOG_VIEW` capability while retaining the permanent sanitized response boundary.
- 2026-07-16: **Activity-aware item freshness.** Items and item-family detail keep the existing 60-second change-signal cadence while the user is active. The shared poller stops requests for hidden, offline, or two-minute-idle sessions and checks immediately when the user returns, allowing Neon compute to autosuspend overnight while preserving active-session freshness.
- 2026-07-15: Gold Mount inventory was corrected from 10 to eight physical batteries after confirming the consolidated Anton Bauer Digital 150 units 9-10 do not exist. The archived Digital product and its two never-allocated unit records were removed; all eight remaining units are Anton/Bauer Dionic XT 150Wh. The old inactive Digital family row stays hidden to preserve two historical booking references.
- 2026-07-15: The live battery catalog was consolidated to four active unit-tracked Items rows: Monitor Battery, Sony Battery, Gold Mount Battery, and FX6 Battery. Product-specific families became product metadata beneath the canonical row; history-free duplicates were deleted, and history-bearing rows were retired or deactivated to preserve operational evidence.
- 2026-07-15: Unit-tracked families can now contain multiple branded products while remaining one Items row and one reservation line. Item-family detail owns product creation, archive/restore, assigned-unit counts, add-unit product selection, and exact per-unit product assignment.
- 2026-07-12: **Inventory Hygiene merged into `/operations`.** The standalone `/items/hygiene` page is now a redirect; its checks render as the staff-visible "Keep data clean" lane on the consolidated Operations page, sharing one status rail and check-card vocabulary with the former admin Fix Today queue. The duplicated `low-bulk-stock` check is dropped at normalize time (Fix Today's `low-batteries` check and Battery Ops own that signal). `GET /api/inventory-hygiene` and all repair links are unchanged. See `tasks/ops-consolidation-plan.md`.
- 2026-07-12: **Image write hardening + thumbnail optimization.** Asset and bulk-SKU image writes (upload, URL mirror) now share a per-user `image-mutation` rate limit (60/hour), update the database before deleting the previous blob (deleting first left records pointing at dead URLs on update failure), and delete the freshly uploaded blob when the record update fails. Blob pathname extensions derive from the validated MIME type via shared `imageExtensionForType` instead of the client-controlled filename. Item thumbnails (`AssetImage`, `ItemThumbnailStack`, item-detail header) now use the next/image optimizer for blob-hosted images (matching the check-in condition-photo behavior) and stay `unoptimized` only for legacy external URLs pending the rehost cron. Regression guards: `tests/asset-image-route.test.ts`, `tests/asset-image.test.ts`.
- 2026-07-10: **New-item sheet label polish.** Summary row labels unify to the sanctioned small-uppercase label style. Visual only.
- 2026-07-10: **Inventory Hygiene operational status rail.** Open records, checks needing work, and partial-data state now lead through the shared compact rail, while all checklist totals remain under Details and the existing cleanup queue, filters, and repair links remain available.
- 2026-07-10: **Item detail visual refresh.** ItemHeader metadata (UW tag, brand/model line, updated timestamp, location/category/department meta, and the parent-attachment banner) drops faint sub-11px tracked mono styling for standard readable text; field labels across ItemInfoTab (including the firmware dialog and identity panel) unify to the sanctioned `text-[11px] font-medium uppercase tracking-wide text-muted-foreground` label style; the Identity "Admin" badge and tab count drop mono/uppercase micro-type. Visual only; no behavior changes.
- 2026-07-10: **Items operational status rail.** The page-local seven-tile inventory summary now uses the shared `OperationalStatusRail`: active inventory stays as the orientation signal, nonzero custody and attention states remain direct status-filter actions, and all six counts remain available as pressed-state-aware, equal-height filters under Details. The Items API, derived-status contract, multi-select filtering, and pagination behavior are unchanged.
- 2026-07-10: **Search typing stability.** Fast typing in the Items (and Labels) search no longer hitches or drops field focus. Keystrokes now echo locally in a shared `DebouncedSearchInput` and commit once per pause (250ms, instant on clear/Enter/Escape), `useItemsQuery` keeps previous rows visible via `placeholderData: keepPreviousData` while a changed query refetches (shimmer bar instead of skeleton swap), and the Items toolbar is mounted outside the loading/empty/error conditional so the search input never unmounts, including when a search matches nothing. Regression guard: `tests/search-input-focus-stability.test.ts`.
- 2026-07-10: **Items bootstrap recovery.** The Items list now distinguishes initial, refresh, and named partial reference-data failures; preserves healthy or stale filter options; handles expired authentication; offers retry and partial-data alerts; and keeps staff/admin edit actions fail-closed until role truth is available.
- 2026-07-09: Activity timeline redesign (all four history surfaces: items, bookings, users, audit report). Rows are anchored by a tinted event-type icon node on a hairline rail instead of avatars; timestamps show time-only inside date groups (full datetime on hover), with coalesced runs showing a time range; diffs render old value red + struck and new value green, URLs in mono with protocol stripped; runs of edits to one field render as a value chain (`May 4 → May 8 → May 27`, with day delta) instead of a ×N badge; non-linkable rows expand via chevron to the raw audit entry (actor role, entity ids, before/after JSON). Plan: tasks/archive/timeline-redesign-plan.md.
- 2026-07-09: Item History timeline clarity pass. `/api/assets/[id]/activity` now joins booking title + kind onto booking-typed audit rows (audit payloads never snapshotted them), so item timelines read `Cancelled checkout "…"` and those rows deep-link to the checkout/reservation. `ActivityTimeline` filters phantom rows (all-hidden-field diffs) before date grouping so empty date headers no longer render, adds describers/colors for the asset, bulk-SKU, and kiosk action families plus a capitalized fallback for unmapped actions, and truncates long diff-pill values (full value on hover).
- 2026-07-03: Native iOS Item Detail attachment language aligned with D-023. Bundled child rows and VoiceOver labels now say `Attachments`, while standalone category taxonomy such as `Accessories` continues to display as stored data.
- 2026-07-03: Native iOS Items attachment visibility tightened. The regular Items list plus typed global item search stay on the default `/api/assets` behavior that hides parented attachments, while QR/direct lookup can still resolve a child attachment for scan recovery and item detail still shows child attachments on the parent record.
- 2026-07-03: Image rehost cron now drains active item-family photos as well as serialized asset photos. `/api/cron/rehost-images` keeps the serverless-safe candidate cap, timeout, and wall-clock deadline, rewrites reachable external `BulkSku.imageUrl` values to Vercel Blob, increments `BulkSku.imageRehostAttempts` for unreachable family URLs, and reports item-family processed/rehosted/failed/remaining counts separately from asset counts.
- 2026-07-02: Attachment rows now hide generated internal tags in the quiet parent detail list and lead with the attachment display name instead, while direct detail/search still preserves the stored identity.
- 2026-07-02: Attachment intake can now leave the visible Standard asset tag blank when the item is tied to a parent. The form still requires QR code, category, location, and parent item, then submits a generated internal tag so small fixed accessories can carry only the QR label and a nearby parent number.
- 2026-07-02: Attachment policy consistency tightened. Attaching an existing serialized item to a parent now disables checkout, reservation, and custody eligibility together, matching new attachment intake and keeping fixed camera parts quiet but findable through parent detail and direct scan/search. Detaching restores standalone eligibility.
- 2026-06-30: Native iOS tag-first list parity applies the Items identity contract outside the main Items screen. Serialized assets and numbered bulk units use the operational tag as the primary Gotham header in booking equipment, create-booking picker/review rows, Search, kiosk checkout/pickup/return lists, active checkout drawers, flagged item alerts, and utility pickers; product/model/SKU names move to secondary copy when a tag exists.
- 2026-06-30: Native iOS Items control cleanup moved Favorites, Status, and Sort from the horizontal custom pill strip into SwiftUI toolbar controls and native `Menu`s while preserving the existing `.searchable` list search, row actions, web-backed sort choices, and reload behavior.
- 2026-06-27: Inventory Hygiene checklist health indicator. `/items/hygiene` now maps needs-work, partial-data, and clean checklist state through the shared shadcn-backed status indicator in the page header and checklist health card while keeping the page read-only and repair-surface linked.
- 2026-06-26: Items list niceties shipped. The web sort selector now names the default sort `Asset tag`; item-family rows can be favorited through the same star and context-menu paths as standard items; `/api/assets?favorites_only=true` now includes favorited item families instead of silently filtering them out; shared asset-tag search aliases let compact and hyphenated family tags such as `70200` and `70-200` find each other in Items and picker search; and item-family row actions now expose valid shortcuts only, including inventory management and numbered-unit label export.
- 2026-06-26: Asset-tag sort now groups repeated equipment families before operational prefixes. Tags such as `70-200 1`, `70-200 2`, `70200 4`, and then `FB 70-200 1` sort as one readable family block instead of alternating by copy number across unprefixed and team-prefixed rows.
- 2026-06-26: Items list/detail freshness shipped. `/items` now verifies server truth on mount instead of trusting a still-fresh 60s cache after Back navigation, serialized item detail mutations invalidate the item-family list and picker caches after successful saves, and a lightweight `/api/items/changes` signal refreshes visible item list/detail surfaces from committed `Asset`, `BulkSku`, and audit-log changes.
- 2026-06-26: Equipment picker sorting aligned with Items asset-tag ordering. `/api/assets/picker-search` and picker bulk rows now reuse the shared asset-tag family comparator, keeping prefixed rows grouped with their real equipment family across Items and checkout/reservation selection.
- 2026-06-26: iOS Items list visual polish shipped. Native Items controls now use calmer default chip styling so unfiltered `All statuses` no longer reads as an active red state, non-default sort/filter selections still carry semantic tint, serialized and item-family rows share the app's standard card surface, available rows show the current location name instead of category taxonomy, unavailable rows defer to holder/status cues, bulk rows omit tracking-style labels from the compact list, and list content keeps bottom clearance above the floating tab bar.
- 2026-06-26: iOS Items web-parity slice shipped. Native Items now consumes `/api/assets.itemOrder`, renders serialized assets and active item families in the same mixed order as web, exposes Asset tag and Most popular sorts, labels item families as Unit-tracked or Quantity-tracked, and keeps active status badges focused on the holder name while the badge color and row status rail carry Checked Out, Reserved, Awaiting Pickup, and Overdue state together.
- 2026-06-26: Active item status surfaces now keep holder identity paired with the status color. Item detail headers, global command item results, scan preview badges, and item-list rows use the person name as the visible badge label where an active holder exists, while title/accessibility text preserves calm state labels such as `Checked Out`, `Reserved`, and `Overdue`.
- 2026-06-26: Items list status labels calmed down. Checked-out rows now show `Checked Out` in title case, with due timing kept in the hover hint instead of inline badge text. The Checked Out filter label now matches the row badge.
- 2026-06-26: Photo-less quantity-tracked `Sony Battery` item family archived after live verification showed 4 booking rows and 6 stock movements, so hard delete would have destroyed operational history. The active `Sony NP-FZ100 Battery` family remains. The Items table also hides disabled selection checkboxes on item-family rows so families no longer show a broken-looking bulk-action affordance.
- 2026-06-26: Items list Most popular sort added. `/api/assets` now scores serialized assets and item families together from recent checkout/reservation usage plus successful scans, returns a server-provided mixed row order for the current page, and keeps asset-tag family sorting as the tie-breaker. The Items toolbar exposes the sort without changing the default Name/tag behavior.
- 2026-06-26: Data cleanup follow-up moved every current `Video` department row to `Creative`, improved deterministic category assignments for teleconverters, monitor arms, and flash/trigger/receiver rows, and repaired 11 lens primary scan codes where the real alphanumeric QR was already stored in `qrCodeValue`. Thirty remaining legacy QR rows have no stored alphanumeric replacement and are tracked in `tasks/item-qr-physical-review.md` for physical/source lookup before mutation.
- 2026-06-26: Cheqroom CSV QR crosscheck reduced the legacy QR review queue from 30 rows to 8. The cleanup script now reads the archived Cheqroom CSV, repairs rows only when `Barcodes` matches the current legacy QR and `Codes` contains one collision-free alphanumeric value, and writes audited updates to both `qrCodeValue` and `primaryScanCode`.
- 2026-06-26: Item detail field validation is now server-owned for organization, link, and money edits. Standard item create/update routes preflight location/category/department IDs and return clear 400s for missing targets, product links normalize missing schemes to `https://`, and purchase/residual values must fit the stored `Decimal(10,2)` contract instead of relying on Prisma failures.
- 2026-06-26: Item detail department edits now accept both CUID and UUID foreign-key IDs across Standard item and item-family routes. This fixes the generic "Validation failed" error seen when changing the department on UUID-backed records such as Sony Battery, while keeping the server-side FK validation bounded to recognized database ID formats.
- 2026-06-26: Remaining operational item-family summary surfaces now use effective state. Admin Fix Today battery lows, Inventory Hygiene item-family low-stock checks, and Missing Units battery summary totals now match the shared item-family availability contract instead of counting raw stored unit flags.
- 2026-06-26: Item-family state read-model consolidation. Items list, Items export, item-family list/detail, and form-option picker APIs now share the same item-family state helper, reducing duplicate availability math across routes and pinning list/detail/export/form behavior with focused regression coverage.
- 2026-06-26: Item-family state alignment now covers the booking picker path. `/api/form-options` computes numbered item-family availability from active unit allocation rows and the shared effective unit-status helper instead of raw `AVAILABLE` rows, so forms, `/items`, item-family detail, and Battery Ops agree when a raw unit flag is stale or a live allocation is present.
- 2026-06-26: Items CSV export parity hardening. `/api/assets/export` now follows the active Items list contract: the default export excludes retired serialized rows, explicit retired-status export still works, item-family rows export under All/Units/Quantity when filters allow them, and the Items page sends the selected item kind to the export route.
- 2026-06-26: Bulk item delete safety hardening. `/api/assets/bulk` now matches single-item delete policy by checking booking history and active allocations inside a SERIALIZABLE transaction. Bulk delete no longer removes `BookingSerializedItem` or `AssetAllocation` history rows to force deletion; operators receive Retire guidance for any selected item with booking history.
- 2026-06-26: Items list unified pagination cleanup. `/api/assets` now receives the selected item kind and builds one asset-tag sorted page across serialized assets and active item families for the default list. Unit- and quantity-tracked rows now occupy real pagination slots instead of being appended to page 1, and Units/Quantity tabs paginate server-side.
- 2026-06-26: Items list asset-tag sort hardening. Operational prefix stripping now distinguishes short team/sport prefixes from broad department words. `FB Wireless Flash` and `MBB 70-180 1` still group by the gear family, while possible real item names such as `Video Assist 1` and `Photo Printer 1` keep their leading word unless the rest is a known equipment tag like `FX6`.
- 2026-06-26: Source-backed item-family name cleanup. The unit-tracked `Sony Battery` family with bin `94e068d1` is now `Sony NP-FZ100 Battery`, based on the retired duplicate asset's former scan identity, model, and B&H source link. The remaining quantity-tracked `Sony Battery` family stays unchanged until physical/source evidence proves its exact model.
- 2026-06-26: Items list asset-tag-family sort cleanup. The default Items Name/tag sort now compares an operational asset-tag family key instead of the raw display tag, so department/team prefixes such as `FB` and `MBB` no longer split related equipment away from `70-200`, `FX3`, `FX6`, and other base gear families. Visible asset tags remain unchanged.
- 2026-06-26: Legacy item-family category text cleanup. The cleanup script now normalizes `BulkSku.category` from canonical category rows, and live data received 12 audit-logged category text corrections so stale family labels no longer exist underneath the canonical `categoryId`. New item-family create/update paths derive legacy category text from `categoryId`, preventing future `"general"` or importer-era category text drift.
- 2026-06-26: Items list feed cleanup follow-up. `/api/assets` now treats the default no-status Items list as active inventory by excluding retired serialized rows, while explicit `status=RETIRED` still returns retired items. Item-family rows now display category labels from canonical `BulkSku.categoryRel` before falling back to the legacy category text, so cleaned families no longer surface stale labels such as `Recording Equipment`, `Cameras/Camera Accessories`, or `general`. Retired-only views no longer include active item-family rows.
- 2026-06-26: Item-data cleanup shipped as a data-only pass. A repeatable audit script and dry-run/apply cleanup script now cover item metadata hygiene. Live cleanup normalized serialized category gaps to 0, serialized department gaps to 0, primary scan-code gaps to 0, and cross-table duplicate scan identities to 0. The 9 serialized rows that duplicated active item families were retired with scan values moved into retired namespaces, preserving history while item-family QR scans now resolve to the family. Camera cage/top-plate/lens-cap rows without provable parent asset identity remain review-only physical mapping items.
- 2026-06-26: Attachment cleanup follow-up attached `a7 V 2 Grip` to `A7 V 2` using an exact case-insensitive tag-prefix match and disabled checkout/reservation/custody policy on the child. Remaining cage/top-plate/lens-cap/vertical-grip candidates are tracked in `tasks/item-attachment-mapping-review.md` until physical parent ownership is confirmed.
- 2026-06-26: Item-family image follow-up backfilled 6 missing family images from exact active serialized asset image matches, reducing active item-family missing images from 15 to 9. Remaining rows need sourced product photos or identity decisions and are tracked in `tasks/item-family-image-sourcing.md`.
- 2026-06-26: Serialized metadata follow-up cleared unknown brand/model rows to 0 by fixing the Dell monitor and Monitor Battery from stored source evidence, and retired the active smoke-test asset with no history. Remaining serial/image gaps need physical or source-truth review and are tracked in `tasks/serialized-metadata-review.md`.
- 2026-06-22: **Item booking status display cleanup.** Item detail booking overview, upcoming reservations, schedule agenda, and booking history now use the shared booking status display helper instead of a local switch with retired booking states.
- 2026-06-22: **Fill gaps query bounds.** `/api/assets?missing=category|department` now counts standard items and item families separately, fetches only the requested cleanup page from each source, and tells the wizard when suggestion matching used a capped source sample.
- 2026-06-20: **Image picker shadcn cleanup.** The shared item image modal search tab now uses shadcn `Empty` composition for idle, empty, quota, and failed states, and result selection uses the shared `Button` primitive instead of a raw button while preserving source links and selected/focus styling.
- 2026-06-20: **Shared filter-chip UI refinement.** Items inherits the refreshed `FilterChip` and `OperationalActiveFilterChips` treatment: lighter filter chrome, 40px removable targets, clearer active underline, and less card-like active filter pills across the toolbar.
- 2026-06-20: **OperationalToolbar shell refinement.** Items inherits the lighter shared toolbar chrome, so search, type toggles, filters, attachment switch, and applied filters sit in quiet page chrome instead of a bordered card-like frame.
- 2026-06-20: **SaveableField refinement.** Item detail inline-edit rows inherit the refreshed shared dirty-row treatment: quieter row hover, visible dirty accent, status pills, and 40px save/cancel actions with field-specific accessible names.
- 2026-06-20: **UserAvatar refinement.** Item list custody/status badges now use the shared semantic `UserAvatar` sizing instead of an ad hoc 18px override, inheriting the refreshed photo object-fit and initials fallback polish.
- 2026-06-16: **Item detail nullable serial crash fix.** Serialized item detail now treats a missing serial number as a valid empty field, matching the nullable `Asset.serialNumber` schema. Newly-created items such as lenses without serial numbers no longer crash during Info tab render, and the QR identity dialog copy now uses the current Identity language.
- 2026-06-15: Kiosk-only custody Slice 3. Item detail now exposes `Reserve` as the only non-kiosk booking creation action; direct item checkout starts only from the kiosk, while existing checkout status links remain visible for active custody records.
- 2026-06-11: **Item-detail Reserve and Check out actions now align with booking availability.** The header treats `availableForReservation` and `availableForCheckout` as workflow policy, then layers current status on top: both actions only start a new booking when the item's derived status is `AVAILABLE`. Reserve previously stayed enabled for `MAINTENANCE` items even though server-side booking validation rejects any non-`AVAILABLE` status, sending staff into a flow doomed at submit time. Disabled buttons now name the real blocker (maintenance, retired, awaiting pickup, already checked out, or policy off) instead of always claiming the policy is off.
- 2026-06-10: **Items list wide-screen layout shipped.** The items list page now centers in a max-w-screen-2xl container, and the table's Status/Category/Department/Location columns carry pinned header widths (via a `thClassName` column meta applied in the data table) so the Name column absorbs leftover width instead of all columns drifting apart on large monitors.
- 2026-06-10: **Item detail layout follow-ups shipped.** The item detail page (header, tabs, tab content) now centers in a max-w-7xl container so wide monitors get balanced margins instead of dead space on the right. A real `scrollbar-hide` utility was added to globals.css (the class was referenced by four tab strips but never defined), removing the stray scrollbar beside the tab bar. Identity QR/serial values are now click-to-copy with the copy icon hugging the text. The Attachments tab dropped the stat tile row, per-group descriptions, and per-row "travels with parent" filler, leaving a single card with a count badge and grouped two-line rows.
- 2026-06-10: **Item detail layout and modal upgrades shipped.** The Info tab dashboard grid now caps at a readable width on large monitors instead of stretching the operational column across the full viewport. The QR dialog gained a framed white QR tile, a copy button on the code value, a Download PNG action for label printing, a destructive confirm before generating a replacement code (printed labels stop resolving), and a manual-entry mode that swaps in place of the action buttons. The Attachments tab shows one Add attachment CTA when empty (in the empty state) instead of two, and zero-count stat tiles render muted.
- 2026-06-10: **Item Info sidebar hardening shipped.** Purchase price now behaves as a strict USD field with decimal input semantics, display formatting, and strict save normalization. Product links now normalize missing schemes to `https://`, reject non-http(s) URLs, copy/open the normalized target, and show the source host inline. The grouped Identity/Product/Organization/Procurement/Notes layout remains compact for fast scanning.
- 2026-06-10: **Info card field grouping shipped.** The Info card's flat field stack is now grouped into labeled sections (Product, Organization, Procurement, plus an unlabeled Notes section) using the same tracked-uppercase label grammar as the Identity card. Procurement remains hidden from students; section dividers separate groups while rows keep their hairline dividers within each group.
- 2026-06-10: **Firmware editor and Identity row polish shipped.** The firmware dialog hero now reads "Installed" with a larger tabular version, a divided Newest/Checked/Released stat row, and an orange Newest value when behind. Mark updated to latest moved from the footer (where it wrapped awkwardly) to a contextual full-width action under the version input, shown only when an update is actually available. The Identity firmware row gained hover/press feedback on the badge and a muted "x.xx available" hint when outdated.
- 2026-06-10: **Inventory-driven Sony firmware watch shipped.** Wisconsin Creative now has model-level firmware watch targets for verified official Sony support URLs, latest version/release date, active versus maintenance support mode, baseline state, and parse errors. The daily maintenance job polls enabled targets and notifies active admins when a newer version appears after baseline. Canon is not seeded; non-Sony adapters and unresolved Sony support URLs remain explicit follow-up work.
- 2026-06-10: **Item detail Identity firmware refresh shipped.** The admin scan identity card is now `Identity`, with QR, serial, QR preview, and firmware in one inset surface. Firmware now matches the QR/serial row grammar instead of rendering as a separate card or separate inline status label. Its compact `installedFirmwareVersion` badge opens an editor with current firmware, newest firmware, last checked date, release date, a Mark updated to latest action, and the official Sony update page link.
- 2026-06-10: **Item detail firmware badge shipped.** The Info card now shows firmware as a compact badge backed by per-asset `installedFirmwareVersion` metadata: green when recorded installed firmware matches latest, orange/yellow when it is behind, and gray when unset or unknown. Clicking the badge opens an editor with a Mark updated to latest action and the official Sony update page link.
- 2026-06-10: **Item detail firmware display shipped.** Serialized item details now show matched model-level firmware watch data in the Info card: latest available version, release date, support mode, check status, and an official-source link. Firmware release/check dates render in UTC to preserve vendor date-only releases across local timezones.
- 2026-06-10: **Add item quick fixes shipped.** Standard item creation now shows repeat-tag context for asset families such as `FX3`, `FX3 2`, and the next likely tag, marks purchase price as USD with currency-aware parsing, saves fiscal year to the same `fiscalYearPurchased` metadata key used by item detail, and includes an inline photo upload field that saves through the existing asset image endpoint after create.
- 2026-06-10: **Add item repeat-tag suggestions are live.** The Standard asset-tag helper now updates while typing, not only on blur, and treats partial text as a prefix. Typing `F`, `FX`, `FX3`, or `70-200` can surface the strongest existing tag family and suggested next tag before the operator enters a number.
- 2026-06-10: **B&H product images work in the image picker again.** Brave returns B&H image URLs behind Cloudflare bot protection (`www.bhphotovideo.com/cdn-cgi/...`), which 403'd hotlinked previews, server-side rehosting, and even Brave's own thumbnail proxy, so B&H tiles were blank and saving failed. B&H URLs are now rewritten to the openly served `static.bhphoto.com` host: search tiles render the 500px static image, and saving rehosts the 1000x1000 hero white-background product photo to Vercel Blob. Result tiles across all sources now prefer the hotlink-safe thumbnail with full-image fallback, and the rehost fetch sends browser-like headers so other strict CDNs accept it. Follow-up in the same day: `multiple_images/` gallery URLs (B&H product galleries) also rewrite to the static host, and B&H Explora blog images, which are blocked on every host including Brave's thumbnail proxy, are dropped from search results instead of rendering as permanently blank tiles.
- 2026-06-10: **Generated QR codes are shorter.** New asset QR generation now creates 8-character uppercase codes without the old `QR-` prefix, so physical labels are easier to read while existing prefixed labels and scan fallbacks keep working.
- 2026-06-10: **Scalar notes no longer hidden as metadata.** `parseNotes` on `/api/assets/[id]` treated any successful `JSON.parse` as import metadata, so a note that happened to parse ("1234", "true") was suppressed from the notes field and returned a non-object `metadata` value that could break the iOS asset-detail decode. Only plain JSON objects are treated as metadata now; everything else stays a visible user note.
- 2026-06-10: **Add item form field accessibility cleanup.** Standard, Units, and Quantity creation fields now associate visible labels with text, number, date, URL, textarea, combobox, and switch controls. Manual inventory-entry fields also declare conservative autofill behavior so Chrome no longer flags the Add item sheet for missing labels or autocomplete metadata. Validation, payloads, and mutation routes are unchanged.
- 2026-06-10: **Add item section-card polish.** Standard, Units, and Quantity creation sections now use shared booking-style card surfaces with compact badges and section-level guidance. Field ids, names, validation, and submit behavior are unchanged.
- 2026-06-10: **Booking-inspired Add item polish.** Add item now borrows the checkout/reservation wizard's compact badge summary, card-style choice rhythm, and review-style post-create handoff while staying a sheet instead of becoming a multi-step wizard. Standard, Units, and Quantity creation behavior is unchanged.
- 2026-06-10: **Manual one-by-one intake readiness.** Standard item creation now keeps asset tag, category, location, and QR code required for safe manual intake while allowing product name, brand, model, and department to be filled later. Blank brand/model values submit explicit `Unknown` placeholders to satisfy the current non-null asset schema without forcing metadata research during high-volume entry. Tracking-style copy now distinguishes Standard, Units, and Quantity choices for manual intake.
- 2026-06-06: **iOS Items empty-state recovery.** Native search-empty and Favorites-only empty states now include direct recovery actions, Clear search and Show all items, while preserving the current search, Favorites, Status scope, row actions, and no-inventory copy.
- 2026-06-06: **iOS Items load error copy.** Native Items initial-load and pagination failures now use recovery-oriented Items copy instead of raw Swift error descriptions, while keeping the existing Retry controls, pull-to-refresh, search, filters, and row actions unchanged.
- 2026-06-05: **iOS Items retired reserve gating.** Native retired items remain visible with their derived Retired status, but iOS no longer exposes Reserve from list swipe actions, row context menus, or item detail. Favorite, copy-tag, row navigation, search, and status filtering are unchanged.
- 2026-06-05: **iOS Items favorite failure recovery.** Native item-list favorite actions now preserve optimistic update plus rollback behavior while showing a shared bottom toast when the server rejects the favorite change, so a reverted star is no longer silent. Search, Favorites, Status filters, swipe actions, context menus, and the favorite API contract are unchanged.
- 2026-06-05: **iOS Items row detail hint.** Native item rows now expose a VoiceOver hint that double-tap opens item details while keeping tag-first identity, derived status labels, search, Favorites, Status filters, swipe actions, and context menus unchanged.
- 2026-06-03: **iOS Items control clarity slice.** Native Items now exposes Favorites and Status as visible named controls above the list instead of icon-only toolbar buttons. The slice preserves search, pagination, row favorite/reserve actions, reserve prefill, and the intentional V1 mobile deferral for admin lifecycle actions.
- 2026-05-25: **Web bug sweep Batch 48.** The Labels print queue now distinguishes serialized item rows from item-family rows in checkbox and open-link accessible names, including tracking mode and location for item families, preventing duplicate labels such as `Select Sony Battery` when serialized assets and multiple bulk families share the same visible product name.
- 2026-05-25: **Web bug sweep Batch 45.** Items list selection/favorites, item detail reads/actions/history/insights/attachments, Inventory Hygiene, and the Fill Gaps dialog now safe-parse success bodies and reject unreadable or incomplete payloads instead of silently trusting raw `res.json()` reads.
- 2026-05-25: **Web bug sweep Batch 35.** Item detail link-field icon buttons now have explicit accessible names independent of hover tooltips, and the link input exposes stable browser form metadata. Duplicate tag/serial blur checks now use the shared auth and safe-JSON response path, and inline category creation reports unreadable success responses instead of silently failing to attach the new category.
- 2026-05-25: **Web bug sweep Batch 34.** The shared image modal now fails loudly when a successful paste/search image save returns an unreadable or missing `imageUrl` instead of silently leaving the modal open with no feedback. The Paste URL and hidden file controls also expose stable form metadata, and image-search result tiles have explicit action labels for browser accessibility checks.
- 2026-05-25: **Web bug sweep Batch 27.** Serialized item detail tabs now use the shared URL-state hook, so `?tab=` links, browser Back/Forward, and same-route query changes rehydrate the visible tab instead of staying on the first mounted tab.
- 2026-05-25: **Web bug sweep Batch 25.** The custom Items URL filter/query hooks now rehydrate search, filters, item kind, favorites/accessories flags, sort, page, and limit from browser back/forward or external query strings. Filter URL writes also preserve pagination params instead of stripping `page`/`limit` on load.
- 2026-05-25: **Web bug sweep Batch 22.** The shared item list query hook now routes expired sessions through the shared auth redirect and rejects malformed asset payloads before React Query treats them as valid item data. Labels now uses shared fetch error state to show a retryable load failure instead of the false `No labels available` empty state when item data cannot be read.
- 2026-05-24: **Item creation sheet response reliability sweep.** Standard, unit, and quantity item creation handoffs now safe-parse success responses before opening post-create actions; asset-tag uniqueness, parent attachment search, and existing stock lookup now tolerate malformed JSON and route expired sessions through the shared auth redirect.
- 2026-05-24: **Shared image modal reliability sweep.** The item image modal now uses shared safe JSON parsing for image search, paste-URL saves, and uploads; upload/remove paths now route 401 responses through the shared login redirect and use the same ref-backed double-submit guard as search and pasted URL saves. This protects item detail, post-create image handoff, and any shared item-family image selection from non-JSON proxy/server responses and rapid repeated clicks.
- 2026-05-24: **Item detail accessibility smoke fix.** Browser smoke on item detail caught unlabeled form-control metadata on select/date/notes controls. The item info tab now threads stable `id`/`name` attributes through saveable native selects, the shared date picker input, and notes textarea so browser autofill/accessibility checks no longer flag those controls.
- 2026-05-21: **Attachments MVP hardening:** Item detail attachment management now uses a structured add/move dialog with searchable candidate states, status/location/category context, blocked-candidate explanations, and warnings for busy items. Child attachment detail now exposes the existing move-parent workflow, detach copy names the child and parent while pending states prevent repeat clicks, attachment rows show image/status/slot context, and `/items` makes hidden child attachments clearer through filter copy and informative parent count hover text. No schema change; the slot-schema decision remains deferred.
- 2026-05-21: Labels and Search target audit raised compact clear/open/view controls to the 40px operational target baseline while preserving their focused print and global-command surface shapes.
- 2026-05-21: **Design language slices 25-26:** Image-search result selection now exposes visible keyboard focus and 40px source-link targets. Item detail scan identity controls now use explicit keyboard-visible 40px QR/serial copy buttons, and the QR preview button exposes a focus ring.
- 2026-05-20: **Design language slice 23:** Item detail image edit/add buttons now show visible focus rings and reveal the edit affordance on keyboard focus, not only hover.
- 2026-05-20: **Design language slice 20:** Item detail header utility controls now use the 40px target baseline for refresh, favorite, and the secondary action trigger.
- 2026-05-20: **Design language slices 15-16:** Item detail empty states now use the shared inline `EmptyState` treatment across booking history, calendar agenda, insights, and attachments. The Items bulk action bar now reads as a selected-row toolbar with 40px controls and a clearer `Bulk actions` dropdown label.
- 2026-05-20: **Design language slice 12:** Item detail secondary actions now use the shared `OperationalRowActions` dropdown wrapper while preserving Duplicate, Print label, Maintenance, Retire, and Delete policy.
- 2026-05-20: **Favorites cross-filter cache fix**: Favoriting/unfavoriting only updated the active React Query cache key (`["items", url]`), so toggling the favorites filter could resurrect stale fav state within the 60s `staleTime` (fav 4, filter on, unstar 3, filter off, removed favs reappeared). Favorite mutations now invalidate the whole `["items"]` query family: single-item toggles mark sibling filter views stale without refetching the current view (no flicker), and bulk mutations refetch the active view plus mark siblings stale.
- 2026-05-20: **Favorites hardening pass**: (1) Bulk favorites (`/api/assets/favorites/bulk`) cap raised 100 to 5,000 to match `/api/assets/bulk`, so "Select all matching" can be starred/unstarred in one request instead of returning a 400. (2) Bulk route now filters to existing, not-already-favorited assets before `createMany`, preventing an FK-violation 500 on stale/invalid ids and keeping the returned count accurate. (3) Bulk route now enforces `asset.favorite` permission and writes batched audit entries (`favorite_added`/`favorite_removed`), matching the single-item endpoint. (4) Single-item star toggle now ignores re-clicks while a request is in flight (per-asset lock) and reconciles the row to the server's authoritative `favorited` value instead of trusting the optimistic guess, fixing double-click and multi-tab desync.
- 2026-05-20: **Design language slice 6:** Items table row actions now use the shared `OperationalRowActions` trigger, preserving existing open, label, duplicate, maintenance, and retire behavior while aligning overflow hit area and destructive styling.
- 2026-05-20: **Design language slice 5:** Items filters now expose shared removable active-filter chips for type, favorites, status, category, location, department, brand, and attachments-only filters, matching Users toolbar recovery behavior.
- 2026-05-20: **Design language slice 3:** Items toolbar now uses the shared `OperationalToolbar` shell, keeping its search, item-type toggle, filter disclosure, and attachment switch as the reference command surface for operational list pages.
- 2026-05-20: **Design language slice 2:** Inventory Hygiene now uses the shared operational metric card and partial-results warning primitives so cleanup queue status, warning tone, and fallback copy match Fix Today.
- 2026-05-20: **Human-pick product image search shipped.** Staff/admin image selection now includes an optional Search tab when `BRAVE_SEARCH_API_KEY` is configured. Searches are seeded from the submitted or current product title, try B&H first through Brave's `site:bhphotovideo.com` operator, mix in broader product-photo-biased Brave results so blocked retailer previews do not monopolize the grid, show source domains, and save the selected result through the existing Vercel Blob image routes. This replaces the withdrawn B&H scraping direction for photos only and does not perform metadata enrichment.
- 2026-05-20: **Asset photos no longer go missing after CSV import.** Image re-hosting moved out of the import request path: the importer used to mirror external Cheqroom CDN images to Vercel Blob inline in batches, which blew the serverless timeout on large imports and left most assets pointing at fragile third-party URLs (the cause of "asset photos not displaying" once the team migrated off that SaaS). Imported assets now keep their source URL and a new daily cron (`/api/cron/rehost-images`) drains any non-Blob `imageUrl` in small batches well under the 10s budget, rewriting to Blob on success and capping retries via `Asset.imageRehostAttempts` for serialized assets and `BulkSku.imageRehostAttempts` for item families so dead URLs stop being retried. The import response/audit now reports `imagesQueued` instead of `imagesHosted`. The existing ~180-image production backlog is fixed out-of-band by running `scripts/backfill-asset-images.mjs --apply` once.
- 2026-05-13: Item-family detail pages now read as normal item detail pages: headers use Units or Quantity without row badges, QR copy avoids web-print assumptions, settings say item instead of implementation terms, and unit exception states use Missing language.
- 2026-05-13: Item creation now uses friendlier Standard, Units, and Quantity tracking-style choices with examples, while the Items list lets availability carry the distinction instead of adding kind badges. Unit creation sends `trackByNumber=true`; quantity creation stays count-only.
- 2026-05-13: Reframed bulk SKUs as first-class item families in `/items`: one mixed catalog row per SKU, unit-tracked/quantity-tracked filter language, `/items/bulk-{id}` detail routing, and app scan lookup for parent and derived unit QR values.
- 2026-05-12: **Creation-flow standard slice** — Items New asset now uses a clearer post-create handoff for serialized assets, new bulk SKUs, and add-to-existing bulk stock: operators can open the created item/bulk record, add an image, return to the refreshed list, or continue adding another. The sheet now guards duplicate submits with a ref-backed lock, disables form controls while saving, routes 401 responses through the shared login redirect, and surfaces safe form-level errors for non-JSON, server, permission, and network failures. Asset creation API validation now accepts existing department IDs from current data, including UUID-shaped department IDs.
- 2026-05-12: **Item thumbnail reliability fix**: shared gear thumbnails now normalize stored image URLs, reset failed-image state when a source changes, and bypass optimizer-dependent rendering so imported or Blob-hosted item photos render consistently across list, booking, picker, stack, scan, and detail surfaces.
- 2026-05-24: **Web bug sweep item detail fixes**: authenticated browser smoke now confirms item detail editable select/date/notes controls expose stable `id`/`name` metadata, and the above-the-fold item image is marked priority so Next.js no longer warns on the detail page's LCP image.
- 2026-05-10: **Status/data wiring ship fixes**: `PENDING_PICKUP` is now a first-class active item state across server status derivation, item filters, web/iOS badges, and item detail headers. Future reservations no longer show as the active item booking before their window starts. Quantity-only bulk availability now uses the movement-adjusted stock balance instead of subtracting active checkout quantities a second time.
- 2026-05-10: **Items ownership polish**: `/items` now keeps persisted density and column visibility hydration-safe, prevents bulk SKU rows from entering serialized-item selection, favorites, labels, and lifecycle bulk actions, and tightens toolbar plus pagination control hit areas. Bulk rows continue to open their Bulk Inventory detail route while serialized asset actions stay on serialized assets only.
- 2026-05-10: **Inventory Hygiene ownership polish** — `/items/hygiene` now has priority ordering, a cleanup queue summary, checklist progress, needs-work/all/clean views, partial API failure warning state, refresh toast feedback, and tag-first sample labels from `GET /api/inventory-hygiene`. The surface remains read-only and continues linking to existing item, kit, and bulk repair routes.
- 2026-05-10: **Item row action semantics cleanup** — Mobile item cards now separate the primary open target from the selection checkbox instead of making the whole card a fake button that contains another control. This keeps card tap behavior, context menus, and checkbox selection distinct.
- 2026-05-09: **Labels print queue polish** — `/labels` now reads as a focused print queue with matching/selected/ready metrics, a clearer search and queue toolbar, accessible selectable rows, item-detail escape links, filtered-empty recovery, and a preserved browser-print label grid.
- 2026-05-08: API hardening Wave 2. `/api/items-page-init` and `/api/inventory-hygiene` now use partial-failure handling for parallel reference and checklist queries. Failed side queries fall back to empty data, log the failed segment, and return `partialFailures` metadata instead of taking down the entire items list bootstrap or hygiene checklist.
- 2026-05-06: **Inventory Hygiene Center shipped** at `/items/hygiene`. The first slice is a read-only staff/admin checklist backed by `GET /api/inventory-hygiene`, covering missing category, missing department, missing primary scan code, missing image, duplicate scan identity, retired items still in active kits, camera bodies without attachments, and low-threshold bulk SKUs. Each sample links to the existing repair surface.
- 2026-05-06: **Item detail tabs final polish** — Schedule now pairs the month grid with a compact month agenda and quieter calendar chrome. Insights now uses recorded completion audit activity for return-timing when available, labels that metric more honestly, and renders item age in human-readable units. Attachments no longer shows a misleading travel rule on items with no attached children, and its empty state now explains when fixed accessories should be added.
- 2026-05-06: **Item detail tabs follow-up** — Schedule now uses start, continuation, and end markers so long bookings no longer visually repeat the same title on every occupied day. Past Bookings now receives requester avatar URLs from the item detail API and renders a denser context row with title, requester, range, kind, and status. History now supports scoped backend activity queries, cursor pagination, cleaner legacy audit labels, and quieter field-change output for import metadata.
- 2026-05-06: **Item detail tab direction pass** — the detail tab rail now removes the redundant Bookings tab, renames Calendar to Schedule, removes visible keyboard shortcut numerals from tab labels, and keeps only meaningful count badges. The Info tab now adds recent Past Bookings under upcoming reservations for quick context. Insights was simplified into lightweight usage signals instead of a dense chart dashboard, History is framed as the complete item touch log including booking activity, Attachments gained stronger operational summary/direction, and Settings now reads as workflow eligibility policy rather than current status control.
- 2026-05-06: **Item detail data form hardening** — inline item detail fields now guard against rapid duplicate saves, disable text/select/date/notes/QR inputs while saving, toast actual save errors, use parsed API error messages for relationship saves, and align PATCH normalization with clearable form fields for names, serials, dates, links, and financial values. The local save path now passes same-origin localhost PATCH requests through the shared CSRF guard while preserving 403s for bad origins. The info card also normalizes select/category/date/year control framing with gray picker surfaces, makes Fiscal Year a year-only picker, uses the shared Admin badge style, and top-aligns textarea rows.
- 2026-05-06: **Item detail UX/UI cleanup slice 4** — the admin scan identity panel now uses a compact inset layout with labeled QR/Serial values, matching copyable mono text, and a larger QR preview that owns the manage/view action without a redundant text button.
- 2026-05-06: **Item detail UX/UI cleanup slice 3** — header buttons now read as one action cluster with workflow actions first, `Actions` kept with the workflow controls, and refresh/favorite plus date/time freshness text moved into a quieter utility row without a blocking tooltip.
- 2026-05-06: **Item detail UX/UI cleanup slice 2** — serial number no longer competes with the status in the header, duplicated brand/model sublines collapse when the product name already carries that identity, location/category/department read with explicit separators, Check out is the primary available item action with Reserve secondary, and scan identity rows now label QR vs Serial.
- 2026-05-06: **Item detail UX/UI cleanup slice 1** — the default Overview now follows the spec: operational state sits first, item facts sit in the right column, and QR/scan identity is inside the item information card instead of a detached admin-only sidebar. The header is quieter, uses the derived status as the lead signal, and makes unavailable Reserve/Check out actions explicit.
- 2026-05-06: **Item detail hardening and polish pass** — header actions now share the detail action busy state, optimistic favorite toggles are guarded against double-submit, failed item photos fall back to the empty-photo treatment instead of leaving a blank image frame, the mobile calendar tab now shows a month booking list, booking filters use the standard toggle-group control, and detail tab fetches cancel stale requests with consistent 401 handling.
- 2026-05-06: **Items compact and Fill gaps upgrade** — compact density now removes row thumbnails so the desktop list reads closer to a standard shadcn data table. Fill gaps now treats cleanup as a small mixed serialized/bulk queue with batch prefetch, retryable count/load/save errors, ranked suggestions, same-category department hints that also work for legacy bulk category text, Department-first field ordering, explicit no-photo handling, and a skipped-item review path before closing the session.
- 2026-05-06: **Items page UX/UI polish pass** — toolbar controls now sit in one command surface with search, item type, favorites, and a collapsible advanced filter row. Header actions now share a compact 32px sizing rhythm. The inventory status summary is a compact health grid instead of a loose chip rail. Desktop rows and mobile cards now put tag/product identity first while keeping serial and duplicate department metadata out of the name stack.
- 2026-05-06: **Items page hardening pass** — export, duplicate, maintenance, and retire handlers now release busy state from `finally` blocks, including auth redirects and unexpected failures. The list uses merged serialized/bulk rows for empty-state and pagination visibility, clears selected rows when item type/favorites/attachments/sort filters change, and CSV export now honors favorites plus the same extended search fields as the list.
- 2026-05-05: Camera attachment scope shipped — item detail now labels grouped Attachments, shows SD card slot labels, and keeps attached SD cards out of day-to-day checkout selection while preserving direct scan/search visibility.
- 2026-04-30: **Items list — screenshot-review polish**. (1) Subtitle hidden when it duplicates the assetTag — kills the doubled "100-400 1 / 100-400 1" rows. (2) Sort indicators now only render on the active sort column or on header hover, dropping the per-column ⇅ noise. (3) Row kebab menu fades in only on row hover or focus. (4) Status breakdown summary chips are now clickable filters that toggle status into the URL filter set; all 5 buckets (Available + Out + Reserved + Maintenance + Retired) always render with zeros greyed, so the strip's information is shape-stable. (5) Density toggle (Compact / Comfortable) added to the page header, persisted to `items-density` localStorage key.
- 2026-04-30: **Items list — tighter assignee status pill**. The CHECKED_OUT/RESERVED pill is now a single line: `[avatar] STATUS · due-label`. Name moved off the pill into a hover tooltip on the avatar. Status label hover tooltip shows the full due-back date + time. Cleaner visual weight at row density; full information still one hover away.
- 2026-04-30: **Items list — assignee avatar status + bulk sort fix**. The CHECKED_OUT and RESERVED cells now render a richer status pill: `[avatar] [STATUS label] · [name]` instead of using the requester's name as the status label. API now returns `activeBooking.requesterAvatarUrl`. Bulk-row merging logic updated: serialized items keep server-side sort order (so the user's chosen sort actually wins), bulks are grouped together at the end and sorted alphabetically with numeric awareness so "16-35" sorts before "100-400". Closes the audit's "merged sort silently breaks" finding.
- 2026-04-30: **iOS items list audit + parity wins** — see `tasks/items-list-ios-audit.md`. Added `Asset.withFavorited(_:)` helper, collapsing 30 lines of struct rebuilds in the optimistic favorite path. iOS status filter went single-select → multi-select (`Set<AssetComputedStatus>`) closing one parity gap with web. APIClient `assets(status:)` parameter renamed to `assets(statuses:)`. CHECKED_OUT badge surfaces `due Xd` / `Xd overdue` (and turns red on overdue) from `activeBooking.endsAt` — same data already on the wire, mirrors web slice 2.
- 2026-04-30: **Items list audit — bigger bets (mobile cards, due dates, select-all-matching)**. Mobile now renders a real card list (image + name + status + meta) instead of the desktop table on small screens. CHECKED_OUT badge surfaces `due Xd` / `Xd overdue` from `activeBooking.endsAt`. Bulk-bar shows "Select all N matching" when more rows match the filter than are on the current page (new `/api/assets?ids_only=true` endpoint, 5000-row cap). Bulk-action `ids` cap raised 50 → 5000 to support select-all flows. Kits prefetch moved into `/api/items-page-init` (one fewer client fetch every time selection becomes non-empty).
- 2026-04-30: **Items list audit quick wins + bigger bets** — see `tasks/items-list-audit.md`. Fixed unreachable `loadError` in `use-items-query` (now `isError && !response`); `showAccessories` now part of `hasActiveFilters` and reset by `clearAllFilters`; `clearAllFilters` resets search too. Centralized `bulk-` row-id branching in `items/lib/item-href.ts` (replaces 5 scattered call sites). Cmd/Ctrl/middle-click on a list row now opens in a new tab. Sticky table header. URL-synced `?page=` and `?limit=` so list state survives reload and is shareable. Bulk Retire shows an Undo toast (8s) backed by new `unretire` action on `/api/assets/bulk`. Desktop loading skeleton column count fixed to match real table (8 cols). Removed dead `onExportCsv` prop from `BulkActionBar`. Demoted duplicated inline error in bulk bar (toast already covers it).
- 2026-04-24: **iOS items audit fixes** — see `tasks/audit-items-ios.md`. Closes AC-5/AC-7 role gating gaps on iOS detail; the AC-8 admin actions menu (Duplicate/Retire/Delete/Needs Maintenance) remains web-only by design (V1 mobile is student/operational-first). iOS list now matches web's filter race-safety, pagination error handling, dark-mode parity, and 44pt tap targets. Reserve from item context menu now prefills the booking with the asset.
- 2026-03-01: Initial standalone area scope created.
- 2026-03-01: Rewritten into hardened V1 list/create/detail spec based on Cheqroom references and Wisconsin Creative rules.
- 2026-03-01: Added explicit B&H auto-import and editable-prefill behavior.
- 2026-03-02: Added mobile list/search behavior alignment and contract dependency.
- 2026-03-09: Items page V1 implementation complete (slices 1–4): list columns/filters/pagination, status dot with booking popover, clickable rows, detail tabs (Check-outs/Reservations/Info/History), inline edit for ADMIN/STAFF, item-kind-aware create form.
- 2026-03-09: Expanded item detail spec with status-line states, working `Actions` menu requirements, dashboard-style `Info` tab, `Calendar` and `Settings` tabs, QR generation/manual entry rules, inline missing-value prompts, and fiscal-year dropdown guidance.
- 2026-03-11: Docs hardening — resolved "Customize overview" ambiguity: deferred, not in V1. Updated AREA_PLATFORM_INTEGRITY ref to DECISIONS.md.
- 2026-03-14: Added Numbered Bulk Item Tracking section — trackByNumber flag, unit picker scan flow, conversion endpoint, D-022 reference.
- 2026-03-15: Removed B&H enrichment — scraping blocked by source. Removed all B&H references from rules, workflow, traps, and acceptance criteria.
- 2026-03-16: Item Bundling (Accessories) V1 shipped — parent-child self-ref FK on Asset, accessories CRUD API, detail page accessories section with attach/detach, items list hides children by default with +N badge on parents, scan preview shows "Accessory of" banner. See D-023.
- 2026-03-22: Items list page redesign — 6 slices shipped:
  - API performance: derived status filtering pushed to DB via Prisma relation subqueries (eliminates 2000-row in-memory cap). Server-side sorting with `sort`/`order` query params.
  - Page decomposition: 561-line monolithic page → 4 hooks (`use-url-filters`, `use-items-query`, `use-filter-options`, `use-bulk-actions`) + 4 components (`ItemsToolbar`, `ItemsPagination`, `BulkActionBar`, `ItemCard`).
  - Search expansion: now covers 9 fields (assetTag, brand, model, serialNumber, name, notes, category name, location name, department name). Department filter added. Accessories toggle added. Accessory count badge on parent rows.
  - UX polish: differentiated empty states (no inventory vs no matches), first/last page buttons, "Showing X–Y of Z" range display, keyboard shortcuts (/ to search, Escape to clear, arrow keys for pagination).
  - Mobile card view: responsive card layout on <768px with 44px+ tap targets, status badges, kebab menu.
  - Consolidated fetch: single `/api/items-page-init` endpoint replaces 4 separate mount-time fetches.
- 2026-03-22: Items list page hardening (5-pass audit):
  - Design system: accessories count badge migrated to shadcn Badge, bulk action spinner uses Spinner component.
  - Data flow: AbortController prevents race conditions on rapid filter changes, unmount cleanup aborts in-flight requests. Silent failures on row actions (duplicate, maintenance, retire) replaced with toast feedback. Double-click guard via actionBusy state.
  - Resilience: refresh failures preserve visible data (toast error instead of replacing table with error screen). Initial load vs refresh distinguished — skeleton only on first load, shimmer progress bar on subsequent refreshes.
  - UX polish: loading skeleton matches actual table layout (image placeholder + two-line text, pill-shaped status badge, varied widths). Retire confirmation names the specific item and states consequences. Bulk actions toast success/failure with action type and count. Retire button shows "Retiring…" during in-flight action.
  - Bulk action hook now toasts success/failure messages.
- 2026-03-23: Items page roadmap created — V1 polish, V2 enhanced UX, V3 advanced features. See `tasks/items-roadmap.md`.
- 2026-03-24: Item details page roadmap created — V1 hardening, V2 enhanced workflows, V3 intelligent features. See `tasks/item-details-roadmap.md`.
- 2026-03-25: Doc sync — standardized ACs to checkbox format. Marked export feature as deferred (AC-12). Updated Last Updated date.
- 2026-03-25: **Items list UX polish** — Status badges simplified: removed "Checked out by"/"Reserved by" prefix, now shows just the username with badge color indicating status (title tooltip preserves full text). Column widths tightened for higher density (Name 280→260, Status 200→160, Category/Dept 140→120, Location 160→130).
- 2026-03-26: **Favorites UI shipped (GAP-22)** — Star column in DataTable, optimistic toggle on detail page, "Favorites" filter chip in toolbar, `favorites_only` query param. Batched favorite lookup (no N+1).
- 2026-03-26: **CSV export shipped (AC-12)** — Export button in items page header (ADMIN/STAFF only). Downloads current filtered view as CSV. Truncation warning at 5,000 items.
- 2026-03-26: **Inventory summary bar shipped** — "X items · Y checked out · Z maintenance" display above table. Status breakdown from API.
- 2026-03-26: **Column visibility persistence shipped** — Column visibility saved to localStorage and restored on mount.
- 2026-04-03: **Item detail page hardened** — AbortController on all fetches, 401 redirect, refresh-preserves-data, error differentiation (not-found/network/server), manual refresh button with freshness tooltip, breadcrumb, mobile tab overflow scroll, tab badge counts, page decomposed (738→313 lines).
- 2026-04-06: **Data integrity fixes (4 total):** (1) QR update TOCTOU — catches P2002 instead of pre-check. (2) Delete asset — wrapped in `$transaction`. (3) Generate QR TOCTOU — removed pre-check loop, now catches P2002 with retry. (4) Duplicate asset tag collision — catches P2002 with retry, increased suffix entropy from 12→16 bits, fixed null serialNumber creating "null-COPY-XXX".
- 2026-04-06: **Kits detail page hardening:** Added 401 redirect on all 6 mutations (save name, save description, add member, remove member, toggle archive, delete). Kits list page already uses `useFetch` hook (has AbortController, 401 handling, visibility refresh).
- 2026-04-06: **Bulk inventory page hardening:** Added 401 redirect on all 3 mutations (add units, convert to numbered, unit status change). List data already uses `useFetch`.
- 2026-05-05: **Bulk battery hardening:** Numbered battery units now use derived unit QR scans for kiosk pickup/check-in and available quantity derives from `AVAILABLE` unit status.
- 2026-04-06: **Accessory operations wrapped in transactions** — Attach, move, and detach now use `$transaction` to prevent TOCTOU races (e.g., concurrent attach of same child to different parents).
- 2026-04-06: **Export permission corrected** — `/api/assets/export` now uses `requirePermission("asset", "export")` instead of `"asset", "create"`. New `export` action added to permissions map. Same ADMIN/STAFF gate, correct semantics.

- 2026-04-09: **DataTable rebuilt with standard shadcn pattern** — Removed custom column resizing (fixed layout, colgroup, mouse-drag handlers), removed mobile card view (`ItemCard` deleted — table scrolls horizontally via `overflow-x-auto`), moved toolbar/bulkBar slots above the bordered table container instead of inside it. Shimmer animation now uses global CSS keyframe instead of inline `<style>` tag. Added `aria-busy` for screen reader refresh indication. Fixed `data-state` attribute emitting `"false"` instead of `undefined`. Column size/minSize constraints removed — columns auto-size via CSS.
- 2026-04-09: **Items list stress test (6 fixes)** — (1) Stale closure on `actionBusy` replaced with ref guard to prevent double-execute on rapid clicks. (2) 401 handling added to all 6 mutation paths (favorite, duplicate, maintenance, retire, export, bulk) via `handleAuthRedirect`. (3) Favorite API TOCTOU fixed — catch P2002 on concurrent toggle, use `deleteMany` for concurrent unfavorite. (4) Maintenance API TOCTOU fixed — read-then-toggle wrapped in SERIALIZABLE transaction. (5) Bulk action dialog buttons disabled during busy. (6) Bulk action bar kits fetch gets AbortController cleanup.
- 2026-04-09: **Item detail pages rebuilt** — (1) Stale actionBusy closure in use-item-actions fixed with ref guard. (2) 401 handling added to all 15 mutation paths across 5 files (field saves, category/dept/location, QR generate/manual, settings toggles, accessory attach/detach, favorite, duplicate, retire, maintenance, delete). (3) Dead `details-grid` CSS class replaced with Tailwind grid. (4) CSS vars (`--text-tertiary`, `--accent`, `--accent-soft`) replaced with Tailwind tokens. (5) `text-secondary` (background token) corrected to `text-muted-foreground`. (6) Unstable `toast` removed from useCallback deps in use-item-data.
- 2026-04-09: **Item detail header redesign** (commit 37d127b) — "Equipment manifest" aesthetic. Replaces flat header with card-based design: top red accent stripe, atmospheric corner glow, Gotham typography for asset tag (weight 900) and name, mono brand/model/serial lines, refined property pills row with status badge and vertical divider. Tab bar labels updated to Gotham Medium with mono shortcut indicators. File modified: `ItemHeader.tsx` (392→275 lines; refactored for brand identity).
- 2026-04-09: **Gap Wizard shipped** (commit 3f4ca67) — One-by-one dialog for assigning missing category or department to items. Reachable via "Fill gaps" button in items page header. Shows upfront count of items missing each field. Walks through items one-by-one: user can assign value via picker, skip to next, or stop. API: `GET /api/assets?missing=category|department` returns count and data, `PATCH /api/assets/[id]` to assign. New file: `gap-wizard-dialog.tsx` (320 lines). Imports `CategoryCombobox`, `FormCombobox`, `AssetImage`.
- 2026-05-07: **Items list context menu** — Right-clicking item rows now opens a row context menu with open, open-in-new-tab, select, copy tag, favorite, print label, and staff/admin lifecycle actions. Bulk rows keep safe open/copy/select actions only, so serialized-only mutations are not exposed for bulk inventory records.
- 2026-05-07: **Item row photo visibility fix** — Item list rows now keep the thumbnail slot visible in both comfortable and compact density; importer upserts no longer clear existing asset photos when the source row lacks an image URL.
- 2026-05-08: **API hardening Wave 10** — Asset retire now reads current status, writes `RETIRED`, and records audit metadata inside one SERIALIZABLE transaction. Favorite toggles now use explicit `asset.favorite` permission and verify the asset exists before creating or deleting the favorite row.
- 2026-05-08: **API hardening Wave 12** — Asset import now reports duplicate asset tags/tracking codes instead of silently skipping create conflicts, item CSV export is actor-rate-limited and formula-safe, picker search caps at 100 rows, and external image mirroring uses an explicit 5s timeout.
- 2026-05-08: **API hardening Wave 13** — Asset brand reference reads now use short private caching, item activity uses the explicit `asset.audit` permission, and the permission map includes `asset.audit` for ADMIN/STAFF.

## Roadmaps
- **Items list page**: `tasks/items-roadmap.md` — V1 polish, V2 enhanced UX, V3 advanced features
- **Item details page**: `tasks/item-details-roadmap.md` — V1 hardening, V2 reduced friction, V3 predictive/proactive
