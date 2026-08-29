# CSV Importer Fix — Plan

## Status: Complete (2026-03-15)

## Slice 1: Rewrite API with batched DB operations
- [x] Batch location + department upserts via $transaction (1 call)
- [x] Batch asset lookup by serialNumber + assetTag (1 findMany call)
- [x] Batch asset createMany for new items (1 call)
- [x] Batch asset updates via $transaction (1 call)
- [x] Kit upserts + membership creation batched
- [x] Target: ≤15 DB calls total for 181-row CSV

## Slice 2: Column mapping UI
- [x] New "Map columns" step between Upload and Preview
- [x] Auto-detect Cheqroom preset headers
- [x] Dropdown per CSV column → Wisconsin Creative field
- [x] Sample data preview in mapping table
- [x] Save mapping to localStorage for future imports
- [x] Pass mapping to preview + import API calls

## Slice 3: Duplicate detection + re-import safety
- [x] Preview flags "new" vs "update" vs "skip" per row with badges
- [x] Detect duplicates by assetTag + serialNumber (single findMany)
- [x] Handle qrCodeValue conflicts on re-import (reuse existing)
- [x] Summary shows willCreate + willUpdate counts

## Slice 4: Build + docs
- [x] Build passes
- [x] Update AREA_IMPORTER.md change log
