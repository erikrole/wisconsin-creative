# Repo / site / database hygiene — 2026-10-07

## Outcome

Evidence-backed cleanup of dead code and dormant schema, plus task/docs inventory refresh. Database items that need production gates are recorded here without fabricating live row counts.

## What this slice did

- [x] Drop unused `ShiftGroup` notify-after columns (`0168_drop_shift_group_notify_after`) and remove write sites / `clearNotificationPending`.
- [x] Remove dead app/web `checkinItems` / `checkinBulkItem` service exports; keep kiosk return paths, `forceCompleteCheckout`, and 403 check-in routes.
- [x] Archive eight completed root plans into `tasks/archive/completed-2026-10-07/`.
- [x] Refresh `tasks/INDEX.md`, `docs/TESTING.md`, and `tasks/admin-helper-followups.md` path honesty for `/operations`.
- [x] Sync AREA_NOTIFICATIONS / AREA_CHECKOUTS changelogs for the behavior and schema cleanup.

## Database items that still need attention

| Item | Why | Safe next step |
| --- | --- | --- |
| GAP-61 `PENDING_PICKUP` enum + compatibility | New custody opens as `OPEN`; enum and expiry branches remain for legacy rows | Production zero-row check for `CHECKOUT` + `PENDING_PICKUP`, then enum/migration + client cleanup |
| GAP-76 dormant `BookingSerializedItem.assignedUserId` / `assignedAt` | Transfer clears them; columns not removed | After GAP-76/78 acceptance: production null check, then `DROP COLUMN` |
| Legacy `_prisma_migrations` receipts (~43 unknown + `0071` exception) | Blocks confident clone/history rehearsals | Reconcile with exact-target checkpoints; never backfill hashes |
| Fresh `db:migrate:health` read-back | Audit plan wording about `0144`/`0145` is stale vs later applies | Read-only health + catalog spot-check on an authorized target |
| Apply `0168` | Local SQL prepared; not applied here | Deploy migration with compatible app code through the Neon runbook |

## Explicitly deferred (not this slice)

- Blind oversized-file splits (`DESLOPPIFY` M1 policy).
- Package.json script alias collapse (needs docs/skills consumer sweep).
- One-shot operator scripts (`import:cheqroom`, `cleanup:item-data`, demos) — label/ownership pass only.
- Rollout-gated GAPs (60, 62, 64–66, 70–87) and preview cleanup enablement.
- Deleting 403 check-in routes (they still enforce D-040 against old clients).

## Verification

- Focused schedule/combine/checkin-related Vitest.
- `npx tsc --noEmit --pretty false`
- `npm run db:migrate:check`
- `npm run verify:docs` (after codemap if needed)
- `git diff --check`
- `npm run build:app`
