# Database audit and repair — 2026-09-07

## Scope and ownership

Production read-only audit of Wisconsin Creative / `flat-night-29913432`, branch
`br-gentle-sky-aisuwcsf`, database `gear-tracker`. Preserve unrelated working changes.
Own migration health/deploy checks, their tests, forward overlap and index repairs,
and this audit/runbook evidence. No operational record cleanup or deployment.

## Plan

- [x] Inspect schema, migration wrappers, accepted custody contracts and live catalog.
- [x] Compare production migration receipts with local SQL hashes.
- [x] Add checksum and live overlap-definition verification and regression tests.
- [x] Rehearse forward overlap protection on isolated local PostgreSQL.
- [x] Run focused tests, schema/migration checks, lint, TypeScript and app build.
- [x] Record final findings and remaining production gates.
- [x] Follow-up: inspect snapshot schedule and complete live index inventory.
- [x] Follow-up: harden HTTP fallback with atomic receipts, lock and uncertain-result recovery.
- [x] Follow-up: rehearse both migrations and concurrent/failing fallback SQL locally.
- [x] Follow-up: rerun final source/build gates and record remaining recommendations.

## Findings

1. **P1 — missing overlap protection.** Production lacks the documented
   `asset_allocations_no_overlap` exclusion constraint. No overlapping active
   allocations, duplicate active asset/booking pairs, active allocations on
   completed/cancelled bookings, or duplicate checked-out numbered units were found.
   Numbered-unit partial uniqueness exists. Prepare migration `0144` using `tsrange`,
   matching actual timestamp-without-time-zone columns and the current isolated
   bootstrap. Do not replay historical `0001`, which uses `tstzrange`.
2. **P1 — migration health overstates proof.** All 149 local migration names were
   applied, with no unresolved failures or applied DB-only migrations. Of 153 rows,
   rolled-back attempts are preserved. One actual SHA-256 mismatch exists:
   `0071_add_event_subtitle`. Its production hash exactly matches original commit
   `990e7769`; commit `a7bd3daa` later added `IF NOT EXISTS`. This explains the drift
   without changing its historical receipt. Another 43 receipts are unverifiable:
   39 empty, and four marked `manual` or `manual-neon-editor` (`0009_shift_calendar`,
   `0039_add_pending_pickup_status`, `0043_license_codes`, `0048_user_profile_fields`).
   Report these conditions; never backfill hashes to manufacture proof or edit
   historical SQL/receipts. The 43 legacy receipts still need reconciliation.
3. **Contract discrepancy.** D-033 describes one active allocation per asset, while
   current Reservations contracts permit future non-overlapping reservations,
   D-006 requires overlap exclusion, and the current bootstrap installs exclusion.
   The repair preserves the current time-window contract; no global active-row
   uniqueness index is introduced. The 60-minute application buffer stays intact.
4. **Operational snapshot.** Database size 34 MB, no blocked connections, invalid
   indexes, or unvalidated constraints. Largest tables: product events 2592 kB,
   audit logs 2296 kB. No evidence warrants broad index removal or data deletion.
   `pg_stat_statements` is absent, so cumulative slow-query ranking is unavailable.
5. **P1 — recovery coverage.** Project point-in-time history retention is six hours;
   production branch is not protected. Follow-up API inspection returned no snapshot
   schedule and one manual production snapshot from 2026-05-01. Set a recovery
   objective, configure longer history and scheduled snapshots, and prove restoration
   into an isolated branch before calling recovery ready. No settings changed.
6. **P1 — fallback partial writes, fixed locally.** The old HTTP fallback executed
   statements separately and recorded success afterward. It now validates history,
   plans all pending SQL before writes, acquires Prisma's advisory-lock key with a
   transaction-scoped try-lock, rechecks history under lock, and commits each
   migration and receipt atomically. Lost responses trigger an exact-receipt read
   without replay. It refuses explicit transaction control/concurrent index/VACUUM
   SQL. Raw SQL unsupported inside a transaction rolls back safely. Five-second lock
   and sixty-second per-statement limits bound waits. Production transport was not
   exercised; local real-PostgreSQL rollback and concurrency proof passed.
7. **P2 — six declared indexes absent.** Compared 266 Prisma-generated non-primary
   index names with 368 live indexes including primary/custom indexes. Nine names
   were absent; three were equivalent legacy truncated names and need no new index.
   Prepared `0145_restore_declared_lookup_indexes` for booking requester; stock
   movement, scan and override actor; audit actor/date; and notification user/date.
   These restore the existing schema contract. No measured production speedup is
   claimed; small-table sequential scans can remain appropriate.

## Further hardening priorities

1. Ship reviewed integrity/index repairs after baseline reconciliation, then verify
   the live constraint and indexes. Add schema-vs-catalog checks to release evidence;
   a checksum/name-only migration check cannot detect physical index loss.
2. Add scheduled snapshots, branch protection and an isolated restore rehearsal.
   Agree on acceptable recovery age and recovery time before selecting retention.
3. Enable `pg_stat_statements` through an approved observability change, establish
   latency/query-count baselines for booking lists, notifications, availability and
   Schedule, and tune measured hotspots. Do not infer slow queries from scan counts
   alone or remove unused-looking indexes without a representative observation window.
4. Promote the local PostgreSQL failure/concurrency rehearsals into an isolated CI
   database gate. Current CI runs unit tests and an app build with placeholder URLs;
   it does not itself exercise real database DDL or constraint races.
5. Keep bounded transaction retry and side-effect reset contracts. Shared retry
   currently handles P2034/raw 40001 and retries once; raw deadlock 40P01 and staged
   insert/retry side effects deserve a separate focused failure-injection audit.
6. Retention is already implemented for audit logs and product events. Session
   cleanup is unbatched; measure growth before adding expiry indexes or changing
   cleanup budgets. At 34 MB, partitioning, replicas and broad cache layers are not
   justified by this audit's evidence.

## Verification

- Follow-up: 96 tests passed across eight migration/bootstrap/availability/retry files.
- `npx tsc --noEmit --pretty false`, `npm run lint`, `npm run build:app` (259 pages),
  `npx prisma validate`, migration-prefix check (151 including prepared `0144`/`0145`),
  docs verification and `git diff --check` passed.
- Isolated PostgreSQL proved overlapping inserts, conflicting reactivation and
  extensions rejected; adjacent windows, inactive history and different assets
  retained; repeat application accepted; pre-existing conflicts failed without
  data correction; a same-named wrong constraint failed closed.
- [Production metadata snapshot](archive/proofs/database-audit-2026-09-07/production-readonly.json)
  contains no user records or credentials. Live catalog was read through Neon;
  the changed evaluator was replayed against these captured receipts. The full
  direct-URL CLI was not run against production.
- [Fixture and verification evidence](archive/proofs/database-audit-2026-09-07/verification.md).
- [Fallback and index verification](archive/proofs/database-audit-2026-09-07/fallback-verification.md)
  and [follow-up read-only catalog/snapshot evidence](archive/proofs/database-audit-2026-09-07/followup-readonly.json).

## Release boundary

### Authorized follow-up: fix all — 2026-09-07

- Live: history retention increased from 21,600 to 604,800 seconds; production
  branch protection enabled; daily 07:00 UTC snapshots retain seven days.
- Created snapshot `snap-shiny-dust-airv1n4i`, expires 2026-10-07T23:00:00Z.
- Incident: `restore_snapshot` with no target and omitted `finalize` promoted
  `br-holy-smoke-aiqsnxmf` to production, moving `ep-flat-firefly-ai889avp`.
  The tool description implied a new branch, but the default finalization swapped
  the source. Detected at 21:46 UTC; original endpoint routing restored at 21:49 UTC.
  No forward DDL had run. At 21:48 and again after correction, all 91 public tables
  matched row counts and sorted row-content MD5 fingerprints, with zero differences.
  This is evidence of no observed data divergence, not proof of uninterrupted service.
- Original `br-gentle-sky-aisuwcsf` is again named production, default, protected,
  with original active endpoint `ep-flat-firefly-ai889avp`. Temporary replacement
  endpoint `ep-rapid-cell-ainzwda0` was removed. Rehearsal branch now has its own
  0.25-CU compute, five-minute autosuspend, and expires 2026-09-08T23:00:00Z.
- Snapshot schedule read-back after correction confirmed the daily entry.
- Direct-URL migration rehearsal on the isolated copy hit the known blank Prisma
  engine error, then the strict HTTP fallback refused historical checksums.
  No migration receipts were changed and neither forward migration was applied.
- Local: APNs 410 ExpiredToken classification fixed with four behavioral tests;
  real PostgreSQL CI job and all-model read check added. Fresh-schema and base-commit
  rehearsal paths both passed locally. CI publication and app deployment remain open.
- Final gates: 46 focused tests, TypeScript, lint, build:app (259 pages), docs
  verification and diff whitespace checks passed. No Vercel runtime errors were
  reported for the interval beginning 21:44 UTC. Original production read-back
  still has 340 bookings, zero 0144/0145 receipts, and no overlap guard.
  [Verification summary](archive/proofs/database-audit-2026-09-07/fix-all-verification.json).


Migrations `0144` and `0145` are preparation only until historical drift is reconciled and the
target is rechecked. Local PostgreSQL fixture proof does not establish production
application, live concurrent route handling, or restoration readiness.

Next bounded slice: reconcile the legacy baseline, then apply only the reviewed
forward repairs with bounded lock timeouts and
production catalog/read-back verification. No commit, push, or deployment occurred.
