# Schedule MVP End-to-End Plan - 2026-08-10

## Goal

- Make Schedule trustworthy for the daily MVP loop: staff publish and manage crew, Students claim published open slots, assigned workers post and claim trades, availability blockers are visible before action, and every surface recovers honestly from stale or partial data.

## Route

- Owner area: `AREA_SHIFTS`
- Secondary areas: `AREA_MOBILE`, `AREA_NOTIFICATIONS`
- Ledger: this plan plus a closeout entry in `tasks/todo.md`
- Existing references: `tasks/event-shift-working-schedule-plan.md`, `tasks/remove-premier-events-plan.md`, `tasks/shift-trade-actions-plan.md`, `tasks/ios-schedule-availability-trade-redesign-plan.md`, and `plans/061-centralize-shift-trade-side-effects.md`

## Source Checks

- ~~Accepted policy is instant pickup for every published open Student slot. New `REQUESTED` assignments were retired on 2026-07-02; the enum and approve/decline routes remain only to drain legacy rows safely.~~ **Superseded 2026-08-22 by [D-055](../docs/DECISIONS.md):** claims are approval-first again on both paths, and `REQUESTED` is a live status rather than a legacy one. The stop condition below no longer holds.
- The released relational Schedule remains worker-facing truth. Open Work and Trade Board must never expose a private working copy.
- Web and native Trade Board both combine `/api/schedule/open-work` with `/api/shift-trades`; either read can fail independently today.
- Web already classifies availability-blocked trade claims as blocked. Native decodes neither `viewerAvailabilityContext` nor `claimedByAvailabilityContext`, so approved time off can be shown as claimable until the server rejects the tap.
- Open-shift pickup and trade claims recheck publication, worker class, time, active assignment, overlap, availability, transaction isolation, and stale races on the server.
- The current worktree contains unrelated macOS, auth, reporting, documentation, and iOS performance changes. No current dirty implementation file belongs to this slice; shared dirty docs must retain their unrelated hunks.
- Focused baseline passes: 9 files and 110 Schedule/Open Work/trade tests. Repository TypeScript baseline has two unrelated errors in `tests/schedule-publication.test.ts` where `null` is assigned to a required string.

## Stop Conditions

- ~~Stop if implementation would recreate approval-first pickup~~ (retired by D-055) or expose working-copy state to workers.
- Stop if a change weakens `SERIALIZABLE`, permission, audit, availability, notification preference, or transaction-owned durable notification contracts.
- Stop before a schema migration unless a live-data predicate proves a schema cleanup is safe and the migration can be generated through the approved workflow.
- Stop before production mutation, deployment, commit, push, TestFlight upload, or destructive legacy-row cleanup without explicit authorization.
- Preserve unrelated worktree changes and do not rewrite shared dirty docs wholesale.

## Slices

- [x] Slice 1: Pin the active contract in tests: instant Student pickup, legacy-request compatibility only, native availability-blocked trade classification, and independent Trade Board read recovery.
- [x] Slice 2: Bring native Trade Board onto the full availability contract, moving blocked trades out of Available Now and showing the server-provided reason before a claim.
- [x] Slice 3: Make web and native Trade Board partial failures explicit, retain successful data, provide source-specific retry, and never render a false all-clear or empty state when one source is unknown.
- [x] Slice 4: Remove active-surface request/approval drift while retaining clearly labeled legacy review and compatibility routes for any existing `REQUESTED` rows.
- [x] Slice 5: Centralize duplicated post-commit trade push/email orchestration without moving durable notifications out of transactions or changing trade behavior.
- [x] Slice 6: Inspect final web, API, and native diffs; sync `AREA_SHIFTS`, `AREA_MOBILE`, `AREA_NOTIFICATIONS`, gaps, and task closeout only for behavior actually shipped.

## Verification

- [x] Focused Open Work, assignment, trade, notification, web source-contract, and native source-contract Vitest suites.
- [x] `npx tsc --noEmit --pretty false` — clean as of 2026-08-22; the concurrent Settings escalation type error that blocked it is resolved.
- [x] Focused ESLint for touched TypeScript and TSX.
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps` (exit 0; unrelated dirty `ReportsView.swift` remains reported as unregistered).
- [x] `npm run ios:project:check`
- [x] `xcodebuild` for `Wisconsin` using `platform=iOS Simulator,name=iPhone 16 Pro`.
- [x] `npm run codemap` before `npm run verify:docs` when shared source or route ownership changes.
- [x] `npm run verify:docs`
- [x] `git diff --check`
- [x] `npm run build:app` — passes as of 2026-08-22.
- [x] Authenticated local browser smoke for Schedule and Trade Board. Both reads returned 200 and the unfiltered board rendered six server-blocked shifts with explicit reasons; partial-read recovery remains source-contract proof because both local APIs were healthy.
- [ ] Native runtime inspection of Trade Board on iPhone 16 Pro Simulator when an authenticated session is available; do not mutate production Schedule data solely for proof.

## Review

- Shipped: instant-pickup compatibility, server-owned trade claimability and availability context, independent web/native read recovery, legacy-only request language, and centralized post-commit trade delivery.
- Verified: 148 focused tests, focused ESLint, iOS drift/audit/project gates, Wisconsin iPhone 16 Pro Simulator build, codemap/docs, whitespace, and authenticated local Trade Board reads. The full run recorded 3046/3053 before its stale six-area Schedule default assertion was repaired and reverified; the six remaining failures belong to unrelated dirty App Store, booking notification, kiosk, and Settings escalation work.
- Deferred: destructive removal of the `REQUESTED` enum and legacy approval routes until production data proves zero legacy rows.
- Blocked: authenticated native Trade Board inspection stops at Login; final repository TypeScript/build rerun is blocked by concurrent Settings escalation work outside this slice.
- Proof artifacts: local authenticated `/schedule?queue=trade-approval` readback; iPhone 16 Pro Simulator launch screenshot at `/tmp/gear-tracker-schedule-mvp-latest.png` showing the authentication boundary.
- Next slice or stop: stop implementation here. Remaining work is acceptance proof or separately owned dirty-work repair, not another Schedule behavior slice.


## Closeout (2026-08-22)

Superseded by [D-055](../docs/DECISIONS.md). This plan's central premise — instant
pickup as accepted policy — was reversed, and the half-removed approval surface it
described as "legacy only" is live again. The hardening it shipped (server-owned
claimability, independent Trade Board read recovery, centralized post-commit trade
delivery) all survives and is unaffected by the reversal.

Both verification items that were blocked on an unrelated Settings type error now
pass. The one item that remains genuinely open is native Trade Board runtime
inspection, which is carried forward rather than closed here.
