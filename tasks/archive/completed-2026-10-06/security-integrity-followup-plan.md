# Security & Data-Integrity Follow-up Pass — 2026-06-03

> **Closed 2026-10-06** in the open-task audit: remaining boxes are stale (work shipped in source or superseded). Evidence is in the audit report; nothing here is open.

> Fresh security/data-integrity review over high-risk mutation and read paths.
> Bug classes in scope: SERIALIZABLE coverage, TOCTOU, P2002/constraint handling,
> authorization symmetry, audit logging, malformed JSON, bounds, rate limits,
> partial-result behavior, CSV/export injection.

## Method

This codebase has already been through two deep passes: the comprehensive
182-route sweep (`tasks/api-hardening-audit.md`, 2026-05-08, GAP-38..GAP-51) and
a fresh review (GAPS change log 2026-05-25). Re-sweeping committed, already-hardened
routes is low-yield.

The actual **unreviewed attack surface** is the uncommitted working tree:
23 API routes, 8 modified services/lib, 6 new lib helpers, and the schema delta.
This maps to the recent schedule-freshness / custody-confidence / web-operator-trust /
multi-day-events / call-window / student-availability work — which overlaps the
goal's priority domains (reports/exports, kiosk, bulk inventory, cron, user/admin).

Approach: `git diff HEAD` each changed service and route, checking whether the
recent edits **regressed** an established invariant or introduced a new gap —
ranked by *writes-DB / handles-external-input / makes-auth-decision*, not file age.
Pure derivation helpers skimmed for bounds only.

## Scope audited (uncommitted working tree)

| Area | Files | Verdict |
|---|---|---|
| Schema + migration | `prisma/schema.prisma`, `0074_student_availability_ad_hoc` | Clean — delta is `StudentAvailabilityBlock` weekly+ad-hoc extension; migration present; `db:migrate:check` passes (75, no collisions) |
| Shift services | `shift-assignments.ts`, `shift-trades.ts`, `auto-assign.ts` | Clean — refactor extracting duplicated class-conflict math into shared `availabilityConflictNote`; transactions, orphaned-REQUESTED cleanup, and advisory-only conflict notes preserved |
| Booking lifecycle | `bookings-lifecycle.ts` | Improved — adds input bounds (NaN dates, `endsAt>startsAt`, event/equipment caps, integer-positive quantities, dedupe) + broader conflict mapping (P2034/40001/EXCLUDE `asset_allocations_no_overlap`), SERIALIZABLE tx unchanged |
| Auth / kiosk session | `auth.ts` | Improved — 7-day server-side kiosk session expiry replaces never-expire; `requireKiosk` revokes on expiry and aligns cookie to DB window (GAP-53 custody slice) |
| Reports exports (6) | `reports/{audit,bulk-losses,checkouts,overdue,scans,utilization}` + `reports.ts` | Clean — every cell through `csvField` (formula-prefix neutralized + quoted); all exports capped at 5000 rows with `truncated` flag; **`?format=csv` branch sits behind the same `requirePermission(role,"report","view")` gate at handler top as the JSON path — no unguarded exfiltration branch** |
| Kiosk pickup | `kiosk/pickup/[id]/{confirm,scan}` | Improved — confirm wrapped in SERIALIZABLE tx with status-guarded `updateMany`+`count===1` transition (→409 on double-confirm), `createAuditEntryTx` inside tx; scan returns explicit duplicate feedback |
| Student availability | `users/[id]/availability/{route,[blockId]}` | Clean — authz symmetry (STUDENT restricted to `user.id===id` on PATCH+DELETE), ownership via `findOwnedBlock` (404 on cross-user blockId — no IDOR), rate-limited, audit before/after, kind/date/time/semester invariants validated; availability is student-only |
| Call-window routes | `shifts/[id]`, `shift-groups/[id]/shifts`, `shift-assignments/[id]` | Clean — only *add* `assertCallTimePair` (both-or-neither + order); `requirePermission`, `createAuditEntry`, SERIALIZABLE all preserved |
| Bulk unit status | `bulk-skus/[id]/units/[unitNumber]`, `units/route` | Improved — **closes a latent integrity bug** (old guard allowed CHECKED_OUT→AVAILABLE direct, double-incrementing on-hand while allocation held); now blocks any change to a checked-out unit, symmetric balance accounting, records `bulkStockMovement` ADJUSTMENT, SERIALIZABLE + `bulk_sku.adjust` permission kept |
| Cron sync-health | `cron/morning-refresh`, `services/calendar-sync-health.ts` | Clean — per-source try/catch preserves error isolation under `withCron`; admin-notify `findMany` bounded to admin set |
| Calendar events | `calendar-events/route` | Clean — multi-day half-open overlap read filters (`startsAt lte end`, `endsAt gt start`); POST guards/audit intact |

## Findings

**No security or data-integrity regressions. No new vulnerabilities. One latent
integrity bug was fixed by the in-flight bulk-unit change.** The recent work
consistently applied the project's established invariants (SERIALIZABLE on
mutation tx, status-guarded transitions, P2002/EXCLUDE→409, audit on mutation,
authz symmetry, CSV formula-safety, bounded reads).

### Low-severity observations (not blockers; optional)

- **OBS-1** — `users/[id]/availability/[blockId]` PATCH does `findOwnedBlock` then
  `update` as two statements (not one tx). A concurrent delete between them makes
  `update` throw P2025 → 500 instead of 404. Self-edit of a personal calendar
  block: near-zero concurrency, no lost-update/custody risk. Cosmetic. Optional
  fix: catch P2025 → 404, or do `updateMany({ where: { id, userId } })` + count.
- **OBS-2** — `StudentAvailabilityBlock` allows inconsistent shapes at the DB level
  (WEEKLY with `date`, AD_HOC with `dayOfWeek`); enforced only at the API layer via
  `assertBlockShape`. Acceptable — this is a personal-calendar block, not a custody/
  uniqueness invariant, so API-layer validation is proportionate (cf. the
  EXCLUDE-constraint rule, which is reserved for temporal-overlap integrity). No
  action recommended unless a second writer of this table appears.
- **OBS-3 (product question, NOT security)** — the bulk-unit guard now blocks *any*
  status change to a CHECKED_OUT unit, including marking it LOST/RETIRED without
  checking it in first. This is correct for stock integrity (the old path
  double-counted on-hand), but it is an **ops-workflow change**: if staff currently
  mark a unit LOST while it's still out on a booking, that path now 409s. Confirm
  with the user whether "lose a unit that's still checked out" is a real workflow;
  if so it needs a check-in-then-lose flow, not a relaxed guard. Does not affect the
  security verdict.

### Explicitly NOT reopened (accepted deferrals — 2026-05-25)

DNS-rebinding residual in `assertPublicHost`, self-change-password current-token
rotation, length-only password policy (no-friction-for-students constraint), and
transitive npm advisories (resend major bump). Per goal: no speculative changes,
no new student-facing friction without evidence.

## Lock-in test coverage — already present (verified 2026-06-03)

The custody/integrity behaviors I would have added tests for are **already covered**;
the in-flight work shipped with its tests. Verified the existing suites pass:

- [x] Kiosk double-confirm → 409 — `tests/kiosk-bulk-detail-routes.test.ts:389`
      ("blocks stale repeated pickup confirmation after another request opens it"),
      plus duplicate-scan feedback (`:274`) and status-guarded `updateMany` (`:369`).
- [x] Bulk-unit CHECKED_OUT → 409 — `tests/bulk-unit-adjustment-routes.test.ts:154`
      ("blocks any status change while a unit is checked out") + symmetric
      balance/stock-movement on availability change (`:131`).
- [x] Availability IDOR — `tests/student-availability-routes.test.ts:134`
      ("denies students editing another student's availability") + weekly-shape
      validation (`:214`) + staff before/after audit (`:149`).
- [ ] OBS-1 fix (declined — cosmetic): `updateMany({ where: { id: blockId, userId: id } })`
      + count check for a clean 404 instead of a possible 500 on concurrent delete.

## Verification run (2026-06-03)

- [x] `npx vitest run` on the 5 audited-surface suites — 25/25 pass
- [x] `npx tsc --noEmit` — clean (full tree, includes in-flight work)
- [x] `npm run db:migrate:check` — 75 migrations, no collisions
- [x] `git diff --check` — clean
- [~] `npx next build` — not run: this pass ships no code, only this doc + a GAPS
      change-log line; full-tree tsc covers the in-flight type surface.
- [x] Doc sync — GAPS_AND_RISKS change-log line added recording the clean pass.

## Verification plan

- [ ] `npx vitest run` the new test files (if added)
- [ ] `npx tsc --noEmit`
- [ ] `npm run db:migrate:check` (already green: 75 migrations, no collisions)
- [ ] `git diff --check`
- [ ] `npx next build`
- [ ] Doc sync: add a GAPS_AND_RISKS change-log line recording a clean fresh pass
      that opened no new gap (and note the bulk-unit latent-bug fix).

## Conclusion

The fresh pass is a **clean bill of health** for the uncommitted surface. The
honest, scope-preserving outcome is: nothing to fix. The only code action worth
considering is the optional lock-in test trio above + the cosmetic OBS-1 tweak.
Awaiting fix / skip / defer decision before touching code.
