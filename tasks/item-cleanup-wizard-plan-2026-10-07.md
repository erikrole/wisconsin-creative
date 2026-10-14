# Item cleanup wizard — 2026-10-07

## Outcome

Staff/Admin walk a guided queue of catalog rows that need physical confirmation. For each row the wizard asks a concrete question (for example “Is a QR code printed on this item?”), then applies an audited fix or records a durable deferral so the row leaves the queue.

## V1 scope

- Kinds: `legacy_qr` (shelf-label codes like `E1-041`), `missing_serial`, and `attachment_candidate` (standalone cages/plates/caps/grips).
- Entry: Items toolbar + `/items?cleanupWizard=1|legacy_qr|missing_serial|attachment_candidate`; Operations Keep data clean CTAs.
- Actions: set QR (writes `qrCodeValue` + `primaryScanCode`), set serial, attach to parent (sets `parentAssetId` + disables checkout/reservation/custody; blocks active custody), defer with reason, skip for this session.
- Deferrals persist in `SystemConfig` key `item_cleanup_wizard_deferred` (no schema migration). Attachment defer reason: `keep_standalone`.

## Out of V1

- Item-family image sourcing.
- Bulk/family bin QR repair.
- Inventing physical parent decisions without operator confirmation.

## Plan

- [x] Service + `/api/items/cleanup-wizard` for counts, queue, set QR, set serial, defer.
- [x] `CleanupWizardDialog` with question → enter/defer/skip flow.
- [x] Wire Items toolbar + `?cleanupWizard=` and Operations hygiene CTAs.
- [x] Attachment candidate queue with parent suggestions, attach, keep-standalone defer.
- [x] Focused tests and AREA_ITEMS sync.

## Verification

Focused route/service/UI tests, TypeScript, lint of touched files, docs sync, `build:app` when closeout requires it.
