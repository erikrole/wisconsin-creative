# Gear Intake Readiness Plan - 2026-06-10

## Goal
- Confirm whether Wisconsin Creative is ready for a large new-gear logging session on 2026-06-11, and identify the smallest improvements that would reduce operator friction or data risk.

## Source Checks
- `docs/AREA_ITEMS.md`: Items support Standard, Units, and Quantity tracking styles; `/items` is the primary discovery surface for serialized assets and item families.
- `docs/AREA_IMPORTER.md`: CSV import is the intended high-volume path with preview, mapping, create-only/upsert modes, row warnings, and source payload preservation.
- `docs/AREA_BULK_INVENTORY.md`: Unit-tracked and quantity-tracked item families use `BulkSku`, `BulkSkuUnit`, and `BulkStockBalance`; numbered units remain custody-safe through kiosk pickup and return.
- `docs/AREA_SCAN.md` and `docs/AREA_KIOSK.md`: App scan is lookup-only; pickup and return custody scans stay on kiosk APIs.
- `docs/DECISIONS.md`: Item status is derived, tag-first identity is primary, imports are non-authoritative for live status, and mutation paths must be auditable.
- `prisma/schema.prisma`: Current schema includes serialized assets, item families, stock balances, numbered units, allocations, and audit logs.
- Current source: manual item creation, import route, item-family route, bulk adjustment route, and related regression tests were inspected.

## Readiness Verdict
- [x] Ready for tomorrow if the intake uses the existing `/import` CSV path for large batches and reserves manual `Add item` for exceptions or small counts.
- [x] Ready for unit-tracked items such as batteries, radios, or card readers when each family can be created with an initial unit count.
- [x] Ready for quantity-tracked supplies when the operator intentionally treats the upload as an added shipment.
- [x] Improved for high-volume manual entry of incomplete serialized assets: the Standard sheet now requires asset tag, category, location, and QR identity, while allowing name, brand, model, and department to be filled later.
- [ ] Not ideal for rerunning the same bulk CSV in upsert mode because existing bulk rows increment stock again instead of behaving idempotently.

## Improvement Slices
- [x] Slice 1: Manual one-by-one intake readiness.
  - Relax Standard manual entry to match the documented minimum where the schema allows it: asset tag, category, location, and scan/QR identity stay required; name, brand, model, and department become fill-later metadata.
  - Submit explicit placeholder brand/model values only when operators leave them blank, preserving current non-null schema without forcing slow metadata research during intake.
  - Tighten tracking-style selection copy so operators pick Standard for individually identified gear, Units for numbered/scannable families, and Quantity for count-only supplies.
- [x] Slice 1B: Booking-inspired Add item sheet polish.
  - Borrow the booking wizard's compact status chrome, badge summary, and review-panel rhythm without converting simple item creation into a full wizard.
  - Make the current tracking style visually obvious and summarize what identity/custody outcome the operator is creating.
  - Replace plain radio rows with clearer card-style choices for Standard, Units, and Quantity while preserving radio semantics.
  - Upgrade the post-create handoff so operators see the created record's status/outcome and the next actions in one review-style panel.
- [x] Slice 1C: Booking-inspired form section structure.
  - Wrap Standard and item-family subform sections in quiet card surfaces that match the booking wizard's section rhythm.
  - Keep required/optional metadata clear at the section level without changing validation, payloads, or mutation routes.
  - Preserve all existing field ids, names, and combobox wiring.
- [x] Slice 1D: Add item form field accessibility cleanup.
  - Associate Add item sheet labels with their text, number, date, URL, textarea, combobox, and switch controls.
  - Add conservative `autoComplete` attributes to manual inventory-entry fields so Chrome no longer flags unlabeled/autocomplete-missing fields during smoke checks.
  - Preserve validation, payloads, and mutation routes.
- [ ] Slice 2: Add a pre-intake CSV template and checklist for future bulk sessions.
  - Include required columns by tracking style.
  - Include guidance for when to use Standard, Units, and Quantity.
  - Include a warning to use `create_only` for one-time new-gear imports unless intentionally adjusting existing quantity stock.
- [ ] Slice 3: Harden bulk import idempotence.
  - Preview existing `BulkSku` matches by location plus bin QR.
  - Show bulk rows as create, update, or quantity adjustment.
  - Prevent accidental duplicate stock increments on unchanged reruns, or require an explicit "add shipment quantity" mode.
- [ ] Slice 4: Add importer coverage for quoted multiline CSV fields if expected supplier exports contain descriptions with line breaks.

## Verification
- [x] `npx vitest run tests/import-route.test.ts tests/api-assets-item-families.test.ts tests/bulk-unit-kiosk-scans.test.ts tests/bulk-scan-race.test.ts`
- [x] `npx vitest run tests/new-item-sheet-ui-source.test.ts tests/manual-intake-submit.test.ts`
- [x] `npx vitest run tests/manual-intake-submit.test.ts tests/create-asset-route.test.ts tests/api-assets-item-families.test.ts tests/bulk-unit-kiosk-scans.test.ts tests/bulk-scan-race.test.ts`
- [x] `npx tsc --noEmit`
- [x] `npm run db:migrate:check`
- [x] `git diff --check`
- [x] `npx next build`
- [x] Browser smoke on `http://localhost:3001/items`: opened Add item, switched Standard, Units, Quantity, and Quantity > Add to existing; no runtime console errors, warnings, or Chrome form-field issues.
- [ ] `npm run build` skipped because it can apply pending migrations to Neon before building; it needs explicit approval for production-impacting schema behavior.

## Review
- Shipped: Slice 1 manual one-by-one intake readiness. Standard item creation now supports fast incomplete intake while preserving required asset tag, category, location, and QR identity. Blank brand/model submit `Unknown` placeholders because the current Asset schema still requires non-null values. Slice 1B added booking-inspired visual framing: compact tracking summary, card-style tracking choices, and a review-style post-create handoff. Slice 1C added shared booking-style section cards inside the Standard, Units, and Quantity subforms. Slice 1D associated Add item labels/autocomplete metadata across Standard, Units, Quantity, and add-to-existing stock fields.
- Verified: Focused Add item UI source, manual-intake, asset-create, item-family, scan, TypeScript, migration-prefix, whitespace, app-only production build, and authenticated browser smoke checks passed. Chrome no longer reports Add item form-field issues in the checked Standard, Units, Quantity, or Quantity > Add to existing states.
- Deferred: Bulk import idempotence, CSV intake templates, and multiline CSV coverage remain future slices. They are lower priority if the June 11 intake is intentionally manual one-by-one.
