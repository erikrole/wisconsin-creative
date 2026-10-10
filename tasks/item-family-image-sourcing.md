# Item-Family Image Sourcing Queue

Created: 2026-06-26
Owner area: Items, Bulk Inventory
Status: Stale pending live audit — do not source images from this table until refreshed

> **2026-10-07:** The 2026-07-15 battery consolidation retired product-specific battery families and archived the photo-less quantity `Sony Battery`. Several rows below likely no longer exist as active families. Run `npm run audit:item-data` on an authorized database, replace this queue with the live active-family missing-image list, then source photos. See `tasks/item-data-hygiene-status-2026-10-07.md`.

## Completed Safe Backfills

The item-data cleanup copied existing Blob-hosted serialized asset images onto exact-match active item families where there was one unambiguous source image:

- `Monitor Battery`
- `SanDisk 128GB Extreme UHS-I microSDXC`
- `SanDisk 256GB Extreme PRO`
- `SanDisk 64GB Extreme PRO`
- `Sony 67mm Front Lens Cap`
- `Sony BP-U35 Battery`

Verification after apply: active item families missing image dropped from 15 to 9.

## Remaining Image Gaps

These active item families have no exact active serialized asset image to copy. They need product photo sourcing through the existing item-family image replacement flow or an approved backfill source.

| Item family | Category | Tracking | Notes |
|---|---|---|---|
| `Anton Bauer Digital 150 Gold-Mount Battery` | Batteries | Units | Needs product image source. |
| `Impact Filled Saddle Sandbag (15 lb, Black)` | Recording Equipment | Quantity | Needs product image source. |
| `Impact MC-FULL Milk Crate (Full Size)` | Recording Equipment | Quantity | Needs product image source. |
| `Panasonic eneloop pro AA Rechargeable` | Batteries | Quantity | Needs product image source. |
| `ProGrade Digital 128GB UHS-II SDXC Memory Card` | Media Storage/SD Cards | Quantity | Needs product image source. |
| `Sony BP-U70 Battery` | Batteries | Units | Needs product image source. |
| `Sony Battery` | general | Quantity | Confirm whether this is still needed or should be merged/retired before sourcing. |
| `Tamron SP Front Lens Cap (67mm)` | Recording Equipment | Quantity | Needs product image source or attachment/family decision. |
| `Watson NP-F550` | Batteries | Units | Needs product image source. |

## Apply Rule

1. Prefer the existing item-family image replacement path so selected photos follow the same re-host and audit behavior as manual image changes.
2. Do not hotlink third-party CDN images directly unless the normal image flow re-hosts them.
3. If a row should be retired or merged instead of pictured, resolve identity first and avoid adding an image to stale data.
