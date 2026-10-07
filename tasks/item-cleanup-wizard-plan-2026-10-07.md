# Item cleanup wizard — 2026-10-07

## Outcome

Staff/Admin walk a guided queue of catalog rows that need physical confirmation. For each row the wizard asks a concrete question (for example “Is a QR code printed on this item?”), then applies an audited fix or records a durable deferral so the row leaves the queue.

## V1 scope

- Kinds: `legacy_qr` (shelf-label codes like `E1-041`) and `missing_serial`.
- Entry: Items toolbar + `/items?cleanupWizard=1|legacy_qr|missing_serial`; Operations Keep data clean CTA for legacy QR.
- Actions: set QR (writes `qrCodeValue` + `primaryScanCode`), set serial, defer with reason, skip for this session.
- Deferrals persist in `SystemConfig` key `item_cleanup_wizard_deferred` (no schema migration).

## Out of V1

- Attachment parent mapping (needs parent picker + custody policy flips).
- Item-family image sourcing.
- Bulk/family bin QR repair.

## Plan

- [x] Service + `/api/items/cleanup-wizard` for counts, queue, set QR, set serial, defer.
- [x] `CleanupWizardDialog` with question → enter/defer/skip flow.
- [x] Wire Items toolbar + `?cleanupWizard=` and Operations hygiene CTAs.
- [x] Focused tests and AREA_ITEMS sync.

## Verification

Focused route/service/UI tests, TypeScript, lint of touched files, docs sync, `build:app` when closeout requires it.
