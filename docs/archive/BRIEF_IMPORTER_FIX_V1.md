# Brief: CSV Importer Fix V1

## Document Control
- Owner: Wisconsin Athletics Creative Product
- Date: 2026-03-15
- Status: Shipped
- Decision Ref: D-024 (Importer rebuild — batch ops + column mapping)

---

## Problem Statement

The existing Cheqroom CSV importer at `/import` has the right UI structure (4-step wizard) but fails at runtime because it makes individual DB calls per row (~400+ for 181 items), creating severe N+1 query performance issues. It also lacks user-configurable column mapping and proper duplicate detection.

## Root Cause
- Import loop does `findUnique` + `create`/`update` per row = O(n) DB calls
- N+1 query pattern causes excessive DB round-trips and slow imports
- No batch operations used

## Solution

Rebuild the import API to batch all DB operations and add a column mapping step.

## Scope (V1)

### 1. Batch DB Operations (Critical — fixes the break)
- Single `findMany` to look up all existing assets by serialNumber + assetTag
- Single `findMany` for existing locations and departments
- `createMany` for new locations and departments
- `createMany` for new assets (split creates vs updates)
- Batch updates via `$transaction` with grouped update calls
- Target: ≤20 DB operations total regardless of row count

### 2. Column Mapping UI (High)
- New step between Upload and Preview: "Map columns"
- Show detected CSV headers on left, Wisconsin Creative fields on right
- Auto-detect common Cheqroom headers (preset mapping)
- User can override any mapping via dropdown
- Unmapped columns stored in `notes` JSON payload
- Save mapping for future imports (localStorage)

### 3. Duplicate Detection (High)
- Check for existing assets by both `assetTag` AND `serialNumber`
- Preview step flags duplicates with clear "will update" vs "will create" labels
- User can choose: skip duplicates, update duplicates, or fail on duplicates

### 4. Re-import Safety (Medium)
- Second import of same CSV should update existing items, not fail on unique constraints
- `qrCodeValue` conflicts handled gracefully (reuse existing value on update)

## Out of Scope (V1)
- Custom preset profiles (just Cheqroom auto-detect + manual override)
- Bulk item (non-serialized) import branching
- Dry-run mode (preview is sufficient)
- Undo/rollback of imports

## Files Changed
1. `src/app/api/assets/import/route.ts` — Rewrite with batched operations
2. `src/app/(app)/import/page.tsx` — Add column mapping step
3. `docs/AREA_IMPORTER.md` — Update to reflect batched implementation

## Acceptance Criteria
- [ ] AC-1: Import of 181-row Cheqroom CSV completes without subrequest limit error
- [ ] AC-2: Preview step shows correct counts (create/update/skip/error)
- [ ] AC-3: Column mapping step auto-detects Cheqroom headers
- [ ] AC-4: User can override column mappings
- [ ] AC-5: Duplicate detection flags existing items by assetTag + serialNumber
- [ ] AC-6: Re-importing same CSV updates existing items (no unique constraint failures)
- [ ] AC-7: Locations and departments auto-created in batch
- [ ] AC-8: Build passes, ≤20 DB operations for full import

## Risk Assessment
- **Medium risk**: Rewriting the import API could introduce data integrity issues
- **Mitigation**: Preview step validates all rows before any writes
- **Mitigation**: Audit log captures import stats for traceability
- **Performance**: Must verify batch operations keep total DB round-trips under 20
