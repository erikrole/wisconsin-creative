# Item Data Cleanup Plan

Created: 2026-06-25
Owner area: Items, Bulk Inventory, Importer
Status: Complete, with physical attachment mapping deferred to operator review

## Execution Prompt

Clean up Wisconsin Creative item data without UI churn. Treat the current database, item docs, bulk inventory docs, importer contract, and schema as the source of truth. Work in thin, independently verifiable slices. Start with a repeatable read-only audit, then normalize taxonomy, resolve serialized-vs-item-family duplicates, backfill scan identity, and convert camera-tied accessories into attachments where operationally correct. Do not delete history. Do not write authoritative status from imported/source status text. Prove every mutation with before/after counts, affected rows, and focused tests or source-contract checks when code changes are involved. Keep `tasks/todo.md`, this plan, relevant `AREA_*.md`, `GAPS_AND_RISKS.md`, and codemaps in sync when functionality or docs change.

## Source Contracts

- `docs/AREA_ITEMS.md`: serialized `tagName` is primary identity; item families are first-class `/items` rows backed by `BulkSku`; status is derived; camera-tied SD cards, cages, and fixed parts should be attachments.
- `docs/AREA_BULK_INVENTORY.md`: `BulkSku` owns item-family quantity/unit tracking, bin QR, numbered units, and stock movement audit.
- `docs/AREA_IMPORTER.md`: source CSV columns are preserved; source status is trace-only; dedupe key order prefers source id, tracking code, serial, then tag/name.
- `prisma/schema.prisma`: `Asset` and `BulkSku` currently have separate unique scan fields, so cross-table scan collisions must be audited explicitly.

## Baseline Findings

Read-only live audit on 2026-06-25 found:

- 196 serialized assets and 21 item families, all 21 item families active.
- 50 serialized assets missing canonical category.
- 20 active item families missing canonical category.
- 18 active item families missing department.
- 22 serialized assets missing `primaryScanCode`.
- 15 active item families missing image.
- 9 cross-table duplicate scan values where a serialized asset and item family share the same scan identity.
- 46 camera/body-like rows with no attachments.
- 10 likely accessory/fixed-part candidates still bookable as standalone rows in the first sample.

## Slices

### Slice 1: Repeatable Read-only Audit

- [x] Add a repo script that emits the current item-data cleanup queue.
- [x] Run the audit against the current database.
- [x] Record the generated evidence in this plan.

Verification:

- `node --env-file=.env scripts/audit-item-data.mjs`

Generated evidence from `npm run audit:item-data` on 2026-06-26T00:37:40Z:

- Serialized assets: 196.
- Item families: 21, all active.
- Serialized missing category: 50.
- Serialized missing department: 0.
- Serialized missing primary scan code: 22.
- Serialized missing image: 2.
- Serialized missing serial number: 4.
- Serialized unknown brand: 2.
- Serialized unknown model: 1.
- Serialized attachments: 2.
- Serialized retired: 1.
- Serialized maintenance: 0.
- Serialized policy-disabled assets: 2.
- Active item families missing category: 20.
- Active item families missing department: 18.
- Active item families missing image: 15.
- Camera/body rows with no attachments: 46.
- Cross-table duplicate scan values: 9.
- Duplicate scan values: `04629d67`, `0fa31d4e`, `1326c19b`, `180e2785`, `2ec0c07d`, `4a0bed87`, `747349ee`, `94e068d1`, `cbceaa80`.
- First attachment-candidate sample: SmallRig camera cage kits, SmallRig monitor mount, SmallRig top plates, and Sony front lens caps are still checkout/reservation-enabled standalone rows.

### Slice 2: Taxonomy Normalization Plan

- [x] Export missing-category serialized assets and active item families.
- [x] Draft deterministic category/department mapping rules from existing categorized inventory.
- [x] Identify rows that require human/operator judgment before mutation.
- [x] Prepare dry-run mutation script or route-safe batch plan.
- [x] Apply deterministic taxonomy updates to serialized assets and item families.

Verification:

- Before/after counts for missing serialized categories, family categories, and family departments.
- Sample rows reviewed for each mapping bucket.

Read-only taxonomy candidate pass on 2026-06-25 found:

- Current category paths include `Audio/Microphones`, `Batteries/Batteries`, `Batteries/Chargers`, `Cameras/Accessories`, `Cameras/Camera Bodies`, `Media Storage/HDDs`, `Media Storage/SD Cards`, `Media Storage/SSDs`, `Office/Peripherals`, `Tripods/Tripods`, and parent categories such as `Audio`, `Batteries`, `Cameras`, `Lighting`, `Media Storage`, `Office`, and `Tripods`.
- Active departments are `Creative`, `Football`, `Live Production`, `Men's Basketball`, `Photography`, and `Video`.
- 23 of 50 serialized missing-category rows have exact or unique category suggestions from existing taxonomy.
- 13 of 21 item-family rows have exact or unique category suggestions from existing taxonomy.
- 21 of 21 item-family rows can receive a department suggestion from current data, but the default `Video` suggestion should be treated as a low-risk batch only for generic inventory families, not sport-owned rows.
- Terms that need explicit mapping before mutation: `Recording Equipment`, `Gimbals`, `Media Storage/Hard Drives`, `Cameras/Camera Accessories`, and `general`.
- Likely explicit mappings: `Media Storage/Hard Drives` -> `Media Storage/HDDs`, `Cameras/Camera Accessories` -> `Cameras/Accessories`, `Gimbals` -> `Gimbal`, and `Chargers` -> `Batteries/Chargers`. `Recording Equipment` must be split by product family instead of mapped as one category.

### Slice 3: Serialized-vs-family Duplicate Resolution

- [x] Resolve the 9 cross-table duplicate scan identities.
- [x] Keep batteries, counted media, lens caps, sandbags, and similar stock as item families.
- [x] Keep one-off serialized gear as assets.
- [x] Retire or detach the wrong duplicate while preserving booking/audit history.

Verification:

- Cross-table duplicate scan count becomes 0.
- Kiosk and generic scan lookup still resolve numbered battery units and serialized assets correctly.

### Slice 4: Scan Identity Backfill

- [x] Backfill safe missing `primaryScanCode` values from canonical QR values.
- [x] Skip rows with any collision risk.
- [x] Record skipped rows and reasons.

Verification:

- Missing `primaryScanCode` count decreases.
- Duplicate scan count remains 0.

### Slice 5: Attachment Model Cleanup

- [x] Review camera/body rows with no accessories.
- [x] Convert fixed camera-tied cages, handles, plates, and assigned media into attachments where the parent can be proven from current data.
- [x] Keep shared accessories/families as standalone rows only when they are actually checked out independently.
- [x] Record physical-mapping review rows where no parent asset identity can be proven.

Verification:

- Camera-without-attachment count decreases for real camera bodies.
- Attachment rows are hidden from normal picker/list surfaces unless explicitly searched/scanned.

## Stop Conditions

- Stop before any live mutation that cannot be explained as an idempotent data correction.
- Stop if a row has active booking/custody history and the correct representation is ambiguous.
- Stop if cross-table scan identity resolution would change kiosk behavior without focused route coverage.
- Stop if the current dirty worktree would force unrelated code/doc edits into the item-data slice.

## Review

- 2026-06-25: Goal started. Initial live read-only audit identified taxonomy, item-family metadata, scan identity, and attachment-model shortcomings. Slice 1 added `scripts/audit-item-data.mjs` and `npm run audit:item-data` so the cleanup queue can be regenerated before each mutation slice.
- 2026-06-25: Slice 1 verified. `npm run audit:item-data` completed against Neon and recorded the baseline evidence above. Next recommended slice is taxonomy normalization because it has the largest blast radius improvement with the lowest mutation risk.
- 2026-06-25: Slice 2 discovery started with a read-only category/department candidate query. The first safe mutation should apply only exact/unique taxonomy matches plus explicit legacy-term mappings after preserving an exceptions list for `Recording Equipment`.
- 2026-06-26: Full cleanup applied with `scripts/cleanup-item-data.mjs`. Dry-run planned 96 live data actions with zero skipped taxonomy, duplicate, or primary-scan rows; apply retired 9 serialized rows that duplicated active item families, normalized 44 serialized categories, normalized 21 item-family category/department records, and backfilled 22 safe `primaryScanCode` values. A second residual pass filled categories on 6 retired duplicate rows. Both applies wrote system audit-log rows plus `.tmp/item-data-cleanup-*` evidence files.
- 2026-06-26: Final verification passed. `npm run audit:item-data` now reports serialized missing category 0, serialized missing department 0, serialized missing primary scan code 0, active item-family missing category 0, active item-family missing department 0, and cross-table duplicate scan values 0. `npm run cleanup:item-data` now plans 0 actions. Nine possible cage/top-plate/lens-cap attachment rows remain as physical-mapping review items because the current data does not identify a provable parent asset.
- 2026-06-26: Attachment follow-up attached `a7 V 2 Grip` to `A7 V 2` after adding case-insensitive exact-prefix grip matching to `scripts/cleanup-item-data.mjs`. The remaining unresolved list is now tracked in `tasks/item-attachment-mapping-review.md`: two SmallRig cage kits, four SmallRig top plates, three Sony lens caps, and three Sony vertical grips need physical parent confirmation before mutation.
- 2026-06-26: Image follow-up backfilled 6 item-family images from exact active serialized asset matches: `Monitor Battery`, `SanDisk 128GB Extreme UHS-I microSDXC`, `SanDisk 256GB Extreme PRO`, `SanDisk 64GB Extreme PRO`, `Sony 67mm Front Lens Cap`, and `Sony BP-U35 Battery`. Final audit now reports active item families missing image 9. The remaining image sourcing queue is tracked in `tasks/item-family-image-sourcing.md`.
- 2026-06-26: Serialized metadata follow-up corrected `Dell UltraSharp 38" Curved Monitor-3` brand to `Dell`, corrected `Monitor Battery` brand/model to `Watson`/`B-4205` from its stored B&H link, and retired disabled smoke-test asset `SMOKE-20260512-1`. Final audit now reports serialized unknown brand 0 and serialized unknown model 0. Remaining serial/image gaps require physical/source truth and are tracked in `tasks/serialized-metadata-review.md`.
- 2026-06-26: Items list feed follow-up fixed the visible post-cleanup gaps from Dia. `/api/assets` now excludes retired serialized rows from default no-status list results, preserves explicit Retired status filtering, suppresses active item families in Retired-only views, and displays item-family categories from canonical `BulkSku.categoryRel` before legacy category text.
- 2026-06-26: Legacy item-family category text follow-up extended `scripts/cleanup-item-data.mjs` with `bulkLegacyCategory` actions and applied 12 live `BulkSku.category` corrections from canonical category rows. `POST /api/bulk-skus` and `PATCH /api/bulk-skus/[id]` now canonicalize category text from `categoryId`, and `npm run cleanup:item-data` now plans 0 data mutations after apply.
- 2026-06-26: Source-backed name follow-up renamed the unit-tracked `Sony Battery` item family with bin `94e068d1` to `Sony NP-FZ100 Battery`, using the retired duplicate asset's former scan identity, model, image/source metadata, and B&H product link. The quantity-tracked `Sony Battery` row remains for physical/source review because no stored model evidence proves its exact battery type.
- 2026-06-26: Department/category/QR cleanup follow-up applied 66 live audit-logged data actions. All 18 serialized rows and 21 active item families that still used the `Video` department now point to `Creative`. Fifteen deterministic category corrections moved teleconverters to `Lenses/Accessories`, monitor arms to `Office/Peripherals`, and flash/trigger/receiver rows to `Lighting`. Eleven lens rows with real alphanumeric `qrCodeValue` values but stale `E1-###` `primaryScanCode` values now use the alphanumeric QR as the primary scan code. Thirty remaining legacy QR rows had no stored alphanumeric replacement and are tracked in `tasks/item-qr-physical-review.md` for physical/source lookup. Verification: `npm run audit:item-data` still reports 0 duplicate scan values and `npm run cleanup:item-data` now plans 0 data mutations.
- 2026-06-26: Cheqroom CSV crosscheck follow-up reduced the legacy QR review queue from 30 rows to 8. `scripts/cleanup-item-data.mjs` now reads `docs/archive/imports/cheqroom-items-2026-02-27.csv`, requires the CSV `Barcodes` value to match the current legacy QR, requires exactly one alphanumeric `Codes` value, checks live scan ownership collisions, and then updates both `qrCodeValue` and `primaryScanCode` with audit logs. Twenty-two rows were repaired from the CSV. The remaining 8 rows have blank `Codes` in the CSV and remain in `tasks/item-qr-physical-review.md`. Verification: `npm run audit:item-data` reports 0 duplicate scan values and `npm run cleanup:item-data` now plans 0 actions.
- 2026-06-26: Items Most popular sort follow-up added a usage-based list ordering option without changing the default Name/tag sort. `/api/assets` ranks serialized assets and item families together from recent checkout/reservation usage and successful scans, returns the mixed row order for the client to preserve, and falls back to asset-tag family sorting for ties. Verification: focused item-family route tests, `npx tsc --noEmit`, `npm run build:app`, `npm run audit:item-data`, and zero-action `npm run cleanup:item-data` dry run passed. Remaining cleanup is not safely automatable from stored data: 9 active item-family images, 2 serialized images, 4 serialized serial numbers, 45 camera/body rows with no attachments, 12 attachment mapping review rows, and 8 legacy QR rows with blank Cheqroom `Codes`.
- 2026-06-26: Photo-less quantity-tracked `Sony Battery` family archived instead of hard-deleted because live relation counts showed 4 booking rows and 6 stock movements. The row is inactive with an audit log, preserving history while removing it from the active Items list. Post-archive verification reports 20 active item families, 8 active item-family image gaps, 0 duplicate scan values, and 0 dry-run cleanup actions.
