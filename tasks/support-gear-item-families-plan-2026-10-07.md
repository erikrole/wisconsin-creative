# Support-gear item families — 2026-10-07

## Outcome
Make fungible support gear (tripods, cased light kits) follow the battery family model: one picker row per operational pool, models as products under units, Creative vs Football pool splits, family-language guidance, and hygiene that surfaces missing products and serialized pool candidates.

## Owner / scope
- Primary: AREA_ITEMS / D-022
- Secondary: AREA_CHECKOUTS (picker guidance), AREA_BULK_INVENTORY, AREA_KITS (kits stay job templates), GAPS
- No production inventory mutation in this slice

## Source facts
- D-022 already supports multi-product unit-tracked families and Football Sony Battery as a second pool with shared policy.
- Reservation quantity binds exact units only at kiosk pickup.
- Equipment guidance rules exist but only `requirement` level is consumed, and no requirement rules exist — info/warning guidance is effectively dead.
- BookingWizard treats every selected bulk line as `batteries`, which breaks once Tripod / Light Kit families appear in the picker.
- Physical family creation needs operator QR/count/location facts (same stop as GAP-74).

## Accepted product direction (this conversation)
- Tripods: unit-tracked `Tripod` + `Football Tripod`
- Light kits: cased sets; unit-tracked `Light Kit` + `Football Light Kit`
- Brands / models under the family as products, not picker rows
- Held: whether Light Kit also splits 2-point vs 3-point

## Bounded steps
- [x] S1 Canonical support-family contract helper + D-022 / AREA doc sync + GAP for physical setup
- [x] S2 Family-language equipment guidance + wire section guidance into the web picker; classify selected bulk by real section
- [x] S3 Inventory hygiene: unassigned products on product-bearing families; serialized support-pool candidates
- [x] S4 Focused tests + docs verification; stop before inventing physical units

## Verification
- Focused Vitest for support-family helpers, guidance, equipment sections, ops-checks meta
- `npx tsc --noEmit --pretty false`, lint on touched files, `git diff --check`
- `npm run verify:docs` when docs/codemaps touched
- Authenticated browser proof deferred (guidance UI); physical family creation blocked on operator facts

## Stop / next
- Stop before creating Tripod / Light Kit families or retiring live serialized rows.
- Resume physical setup only after Creative/Football counts, bin QR values, locations, and (for light kits) the held 2-/3-point decision are confirmed.
