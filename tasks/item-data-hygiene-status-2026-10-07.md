# Item data hygiene status — 2026-10-07

## Verdict

Automatable item-data cleanup finished in June 2026 (`tasks/archive/completed-2026-07/item-data-cleanup-plan.md`). What remains is physical/operator review plus keeping Operations hygiene honest against the audit script.

This workspace has no `DATABASE_URL`, so live `npm run audit:item-data` was not re-run here. Counts below are from the last verified June closeout plus ledger honesty notes.

## What looks off

1. **`tasks/item-family-image-sourcing.md` is stale** after the 2026-07-15 battery consolidation (product-specific batteries retired; quantity `Sony Battery` archived). Re-run audit before sourcing images.
2. **Operations hygiene lagged the audit script** — duplicate scan ignored active family bin QR, missing-field counts included retired rows, and item-family taxonomy/image gaps were invisible. Fixed in this slice.
3. **Duplicate-scan count was capped at the sample limit (6)** — fixed with a separate total count query.
4. **Camera-without-attachments** is a noisy forever advisory, not a hard defect queue.
5. **Root review ledgers** outlived the archived parent plan; keep them until physical queues clear, then archive.

## What needs work (operator / physical)

| Queue | Ledger | Open (as written) | Freshness |
| --- | --- | --- | --- |
| Attachment parents | `tasks/item-attachment-mapping-review.md` | 12 cages/plates/caps/grips | Medium — shelf check |
| Legacy QR codes | `tasks/item-qr-physical-review.md` | 8 camera/gimbal/flash rows | Medium-High |
| Family images | `tasks/item-family-image-sourcing.md` | was 9; likely wrong after battery consolidation | Low — refresh after audit |
| Serial / image | `tasks/serialized-metadata-review.md` | 3 active + retired smoke | Medium |

## What can be retired / demoted

- Re-opening taxonomy/duplicate/scan-backfill as active cleanup — **done**; dry-run should plan 0.
- Treating `import:cheqroom` as routine intake — one-shot historical importer only.
- Treating `camera-missing-attachments` as a blocking hygiene severity — now info/advisory.
- Image-sourcing rows for consolidated/inactive battery families — drop after live confirm.

## What this slice improved (code)

- Hygiene duplicate-scan parity with `audit-item-data` (includes active `bin_qr_code_value`).
- True duplicate count (not sample-length capped).
- Active-only serialized missing category/department/scan/image.
- Active item-family missing category/department/image checks.
- Operations CTAs for taxonomy gaps → `/items?fillGaps=1` (opens Fill gaps wizard).
- Source-contract coverage for the hygiene route shape.

## Product surface

The **Cleanup wizard** (2026-10-07) walks `legacy_qr` and `missing_serial` queues with operator questions and audited save/defer. Entry: Items → Cleanup wizard, `/items?cleanupWizard=…`, Operations Keep data clean. Attachment parent mapping remains ledger/physical-only until a later slice.

## Next bounded steps

1. Authorized DB: `npm run audit:item-data` + dry-run `npm run cleanup:item-data`; refresh the four ledgers.
2. Physical: run Cleanup wizard for legacy QR + missing serial; then 12 attachment parent decisions.
3. Archive cleared review ledgers into `tasks/archive/completed-YYYY-MM-DD/`.
