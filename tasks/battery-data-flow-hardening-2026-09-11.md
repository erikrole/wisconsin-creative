# Battery data and flow hardening — 2026-09-11

Scope: improve the existing numbered battery data/repair, receiving, kiosk add/remove, and return contracts. Preserve permanent numbers, derived QR identity, pooled custody, role policy, and unrelated work. Primary workflow: `gt-api-hardening`. Independent custody/architecture and final implementation reviews completed with no blocking findings.

## Plan and implemented behavior

- [x] Read current source, D-022/D-032, area contracts, tests, and current production data.
- [x] Prevent stale repair from adding already-counted stock; compare all-location balances against claimable unit truth, cap positive corrections at the repaired count, and reject changed candidates/malformed input.
- [x] Block status changes against live custody even when the unit flag says LOST/RETIRED. Preserve explicit recovery of ended allocations, with IDs/timestamps in audit evidence.
- [x] Guard negative status decrements, create absent balances on recovery, use signed movements, and commit receiving/status audit with inventory.
- [x] Make Battery Ops read one consistent snapshot and preserve every unreturned allocation as unavailable.
- [x] Restore removed battery stock to the kiosk location; allow removal of a remaining unit after another unit in that family returned, preserving returned history.
- [x] Record each successful battery return's exact scan, operational actor, device context, and location in the custody transaction; use that actor for the stock movement.
- [x] Complete focused regressions, TypeScript, lint, app build, docs checks, and final review; apply only the verified changed files to the shared repository.

## Production read-only evidence

At 2026-09-12 03:50:33 UTC, a read-only repeatable-read query using current Vercel production configuration returned:

| Family | Total | Available | Held | Recorded on hand |
| --- | ---: | ---: | ---: | ---: |
| FX6 Battery | 12 | 12 | 0 | 12 |
| Football Sony Battery | 12 | 12 | 0 | 12 |
| Gold Mount Battery | 8 | 7 | 1 | 7 |
| Monitor Battery | 18 | 18 | 0 | 18 |
| Sony Battery | 53 | 50 | 3 | 50 |

All balances were at Camp Randall and matched claimable units. No stale flags, LOST/RETIRED units with live custody, or unreturned allocations on ended bookings were found. No production data correction was indicated or applied. The current Preview database has no `bulk_sku_units` table, and the older local Preview credentials fail authentication; neither is used as production acceptance evidence. GAP-74's statement that Football Sony family data is absent is stale; full physical flow/label proof remains open.

## Remaining boundaries

- No commit, push, deployment, migration, or production data mutation performed.
- Native device replay and authenticated web verification of changed code remain open. The current Preview database lacks the battery table, and a suitable authenticated local session/fixture was unavailable. Tests/build and this production read-only audit do not replace those gates.
- Exact scans at a kiosk with zero local balance can still fail when stock is recorded at another location. Automatic relocation is deferred until per-unit location evidence and transfer policy are established.
- Completion currently trusts aggregate return counters; an additional outstanding-unit-allocation completion guard is a separate service slice. The live audit found no resulting ended-allocation drift.

## Verification

- Focused battery, numbered-unit, checkout-edit, and check-in regressions: **19 suites, 164 tests passed**.
- Standalone TypeScript check, ESLint, and integrated `npm run build:app`: **passed** in an isolated copy containing the current parallel Kiosk changes. The isolated build used the 4319 dev-port guard and did not interrupt the shared dev server.
- Migration validation: **152 migrations passed**, with no prefix collisions or malformed folders. No migration was applied.
- Generated codemaps and docs verification: **passed**.
- Final independent review of the merged delta: **no blocking findings**.
- Parallel Kiosk history-preserving remove/re-add, operator attribution, and single-event return behavior were retained. This task adds the counter guard, stock-location audit evidence, and optional return device context to those overlapping files.
- Applied 19 files to the shared repository with per-file SHA-256 baseline guards and backups. All 19 read-back hashes matched the verified prepared content; post-application `git diff --check` passed. No staging or broad repository replacement.

Next bounded acceptance step: authenticated web and managed-Kiosk battery receive/checkout/partial-return/remove/re-add replay against a suitable schema before release. Keep this ledger active until the external acceptance and rollout gates are resolved.
