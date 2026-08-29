# Importer Area Scope (V1 Generic CSV with Cheqroom Preset)

## Document Control
- Area: Importer
- Owner: Wisconsin Athletics Creative Product
- Last Updated: 2026-05-24
- Status: Active
- Version: V1

## Direction
Build a generic CSV import pipeline with column mapping. The Cheqroom export format is the first preset mapping, but the architecture supports any CSV source.

## Goals
1. Parse any CSV without silent data loss.
2. Import items as serialized or bulk records based on source kind.
3. Preserve all source values even when no first-class target field exists.
4. Produce deterministic import report with row-level errors and warnings.
5. Keep asset status derived from allocations, not imported status text.

## Architecture: Generic CSV Mapper

### Core Pipeline
1. Upload CSV → parse headers and sample rows.
2. Column mapping step: user maps source columns to Wisconsin Creative target fields (or selects a preset).
3. Validate mapped rows against target field requirements.
4. Persist mapped data + full source payload snapshot.
5. Return import report (`created`, `updated`, `skipped`, `errors`, `warnings`).

### Presets
Presets are pre-filled column mappings for known CSV formats. V1 ships with one preset:
- **Cheqroom Export** — maps all known Cheqroom columns automatically (see mapping table below)

Future presets require no architecture changes — just a new mapping configuration.

## Input Contract
- Supported source: any CSV file.
- Cheqroom preset expects: wide CSV with item, metadata, location, financial, tracking, and custody/check-out columns.
- Parser must tolerate:
  - Extra columns (stored in sourcePayload)
  - Missing optional columns
  - Empty cells
  - Mixed timestamp formats

## Lossless Parsing Rule
Every source column must be handled by exactly one path:
1. Mapped to target canonical field, or
2. Stored in `sourcePayload` migration JSON for that row.

No column is discarded.

## Cheqroom Preset: Source to Target Mapping

### Identity and Classification
- `Name` -> `tagName` (serialized primary label)
- `Category` -> `category`
- `Kind` -> `itemKind`
  - `Individual` -> `SERIALIZED`
  - `Bulk` -> `BULK`
- `Quantity` ->
  - bulk: `quantity`
  - serialized: validate as 1 (warn if not 1)

### Product Metadata
- `Brand` -> `brand`
- `Model` -> `model`
- `Link` -> `productUrl`
- `Description` -> `description`
- `Image Url` -> `imageUrl` (if valid URL)

### Tracking and Identifiers
- `Codes` -> primary Cheqroom QR/scan value when present
- `Barcodes` -> fallback scan value and source trace field
- `Serial number` -> `serialNumber`
- `UW Asset Tag` -> `uwAssetTag`
- `Id` -> `sourceExternalId` (Cheqroom id)

### Location and Context
- `Location` -> primary location mapping
- `Geo` -> `sourcePayload.geo`
- `Check-out Location Name` -> `sourcePayload.checkoutLocationName`
- `Kit` -> `sourcePayload.kit`

### Financial and Lifecycle Metadata
- `Purchase Price` -> `purchasePrice`
- `Purchase Date` -> `purchaseDate`
- `Warranty Date` -> `warrantyDate`
- `Residual Value` -> `residualValue`
- `Depreciated Value` -> `sourcePayload.depreciatedValue`
- `Department` -> `department`
- `Fiscal Year Purchased` -> `fiscalYearPurchased`
- `Created` -> `sourcePayload.createdAtSource`
- `Retired` -> `sourcePayload.retiredAtSource`

### Flags and Ownership
- `Flag` -> `flag` or `sourcePayload.flag`
- `Owner` -> `sourcePayload.owner`

### Contact and Custody Snapshot (Migration Context)
- `Contact Name` -> `sourcePayload.contactName`
- `Contact Email` -> `sourcePayload.contactEmail`
- `Contact Company` -> `sourcePayload.contactCompany`
- `Custody (via name)` -> `sourcePayload.custodyViaName`
- `Custody (via email)` -> `sourcePayload.custodyViaEmail`

### Check-out Snapshot Fields (Do Not Drive Live Status)
- `Check-out Started` -> `sourcePayload.checkoutStarted`
- `Check-out Due` -> `sourcePayload.checkoutDue`
- `Check-out Finished` -> `sourcePayload.checkoutFinished`
- `Check-out Id` -> `sourcePayload.checkoutId`
- `Status` -> `sourcePayload.sourceStatus`

## Derived Status Policy During Import
1. Source `Status` is not imported as authoritative asset status.
2. Source `Status` is stored for migration traceability only.
3. Live status remains derived from allocation and booking data in Wisconsin Creative.

## Dedup and Upsert Strategy
1. Primary matching key order:
   - `sourceExternalId` (Cheqroom id)
   - tracking code (`Codes` first, then `Barcodes`)
   - `serialNumber`
   - `tagName`
2. Import mode options:
   - Dry run
   - Create only
   - Upsert
3. Duplicate matches in a single run are blocked with explicit row errors.

## Validation Rules
1. Required minimum for serialized:
   - `Name`, `Category`, `Location`
2. Required minimum for bulk:
   - `Name`, `Category`, `Location`, `Quantity`
3. Date parsing accepts common ISO and timestamp formats.
4. Numeric fields parse with currency and decimal sanitization.
5. URL fields validate scheme and hostname format.

## Error Handling

### Hard Errors (Row Skipped)
- Missing required fields.
- Invalid item kind.
- Unresolvable duplicate key conflict.
- Invalid numeric parse for required numeric fields.

### Soft Warnings (Row Imported)
- Unknown category/location mapped to fallback.
- Partial metadata parse.
- Serialized quantity not equal to 1.
- Invalid optional URL or timestamp field.

## Import Report Output
- Total rows read
- Created count
- Updated count
- Skipped count
- Error count
- Warning count
- CSV row number + reason list for each error/warning

## Security and Audit
1. Import action requires `STAFF` or `ADMIN`.
2. Full source row snapshot stored for traceability.
3. Import runs generate audit log entry with actor, file name, and summary.

## Performance Targets (V1)
1. Handle typical inventory export size without timeout.
2. Stream parse to avoid memory spikes.
3. Support resumable batch processing for large files.

## Edge Cases
- Header name variants (`Check-out Due` vs `Checkout Due`).
- Hidden Excel formatting and stray Unicode characters.
- Rows with commas/newlines inside quoted fields.
- Duplicate tracking codes across different rows.
- Rows with empty `Name` but filled serial and code.
- Mixed bulk and serialized rows sharing same category/name.

## Acceptance Criteria
- [x] AC-1: Every source column is either mapped or stored in `sourcePayload`.
- [x] AC-2: Import does not write authoritative asset status from CSV `Status`.
- [x] AC-3: Serialized and bulk rows follow separate validation rules.
- [x] AC-4: Duplicate handling is deterministic and reported.
- [x] AC-5: Dry run output matches actual import result counts when rerun unchanged.
- [x] AC-6: Import report includes row-level diagnostics.

## Dependencies
- `AREA_ITEMS.md` for target field semantics.
- `AREA_USERS.md` for import permissions.
- `DECISIONS.md` (D-001, D-006, D-007) for audit and integrity guardrails.

## Out of Scope (V1)
1. Auto-creating historical bookings from checkout snapshot columns.
2. Attachment file ingestion from remote image URLs beyond metadata linking.
3. Custom preset creation UI (presets are code-defined in V1).

## Developer Brief (No Code)
1. Build a staged importer with raw-row preservation and deterministic mapping.
2. Implement strict validation with hard-error vs soft-warning categories.
3. Keep status derivation invariant by storing source status as non-authoritative metadata.
4. Provide dry run, create-only, and upsert modes.
5. Emit detailed import report and full audit events.

## Change Log
- 2026-05-24: Web bug sweep Batch 14. Import preview/import submissions now use shared auth, safe-JSON, and server-error parsing; duplicate preview/import actions are ref-guarded; malformed mapping JSON and unsupported import modes return explicit 400 errors before database work; summary results now include bulk item-family and image-queue counts; and import wizard controls expose stable form metadata.
- 2026-03-01: Initial importer area scope created for Cheqroom CSV migration.
- 2026-03-11: Docs hardening — reframed as generic CSV mapper with Cheqroom preset. Removed Cheqroom-specific framing from title, direction, and pipeline. Added preset architecture section. Updated AREA_PLATFORM_INTEGRITY ref to DECISIONS.md.
- 2026-03-15: Import API rewritten with batched DB operations (≤15 calls for 181 rows). Added column mapping UI step with Cheqroom auto-detect + manual override. Duplicate detection by assetTag + serialNumber with create/update/skip preview. Re-import safe (reuses existing qrCodeValue).
- 2026-03-25: Doc sync — standardized ACs to checkbox format, all 6 checked.
- 2026-04-07: Hardening pass — import page multi-step flow hardened with handleAuthRedirect(returnTo) + classifyError + isAbortError on preview and import fetches. Network vs server errors now distinguished. Hardening score 2/5 → 4/5.
- 2026-05-06: Cheqroom QR repair — importer now treats `Codes` as the canonical QR/primary scan value before `Barcodes`, preserves both source values in `sourcePayload`, updates existing QR values when no unique-owner conflict exists, and normalizes date-like timestamps to UTC day boundaries.
- 2026-05-07: Import image hardening — Cheqroom image header variants now map to `imageUrl`, mapped image URLs are preserved in `sourcePayload`, upserts no longer clear existing item photos when a later import row has no image, and bulk SKU imports preserve image URLs.
