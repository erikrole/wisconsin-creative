# Kiosk Active Checkout Scan Stock Fix Plan - 2026-09-03

## Goal
- Let the kiosk handle a numbered-unit scan on an open checkout against the authenticated kiosk's physical stock location, including when the checkout originated at another location, without exposing internal stock IDs or beginning custody writes on a real shortage.

## Route
- Owner area: Checkouts, with native kiosk as the affected product surface.
- Ledger: this bounded incident plan.
- Existing plan/archive references: `tasks/kiosk-active-checkout-item-editing-plan.md` and the accepted kiosk custody contracts in `docs/AREA_CHECKOUTS.md` and `docs/AREA_MOBILE.md`.

## Source Checks
- The reported ID maps to the canonical Sony numbered-battery family, so the incident is a real bulk-unit scan rather than a serialized/bulk identity collision.
- `POST /api/kiosk/checkout/[id]` claimed a numbered unit before reaching `upsertBulkBalancesAndMovements()`, where a zero local family balance emitted the visible internal-ID error and rolled the transaction back.
- Other direct-checkout paths already preflight family stock; active-checkout scan-add omitted that recovery boundary.
- Read-only production proof found Sony Battery units 21 and 26 available with no active allocation and 20 units on hand at Camp Randall. The open `VB vs Auburn` checkout is assigned to Field House, while the authenticated Video Office kiosk is assigned to Camp Randall. The route incorrectly uses `booking.locationId` for availability and checkout movement, so it reads missing Field House stock as zero despite the physical Camp Randall scan.
- Physical kiosk replay after deployment reproduced `cannot be added: 0 available at Camp Randall`. The remaining zero comes from `checkBulkShortages()`: it subtracts overlapping `BOOKED` family commitments from the on-hand ledger even though the exact scanned numbered unit is physically present and has no active allocation.
- A second managed-iPad replay successfully added 18 Sony units to CO-0304, then units 1, 2, and 40 again failed while Battery Ops still reported each exact unit AVAILABLE and 16 available overall. Production history shows 14 Sony flags were repaired from stale CHECKED_OUT to AVAILABLE on 2026-06-25; that repair updated unit truth without restoring `BulkStockBalance`, creating the latent aggregate deficit exhausted by this larger checkout.
- For an active-checkout add, the exact numbered-unit scan and guarded allocation claim are authoritative. Future family reservation demand remains planning context; it must not veto custody of an individually available unit already at the counter. The stock movement still uses the authenticated kiosk ledger and must remain non-negative.
- Active-checkout edits must remain kiosk-authenticated, location-scoped, serializable, availability-aware, and audited.
- The current worktree contains unrelated Schedule and Event edits; this slice must not touch or stage them.

## Stop Conditions
- Stop if current data shows the referenced ID is not a numbered bulk SKU involved in the reported scan.
- Stop if fixing the incident would require changing the booking lifecycle, inventory schema, or accepted kiosk custody boundary.
- Stop if the authenticated kiosk location is not the accepted stock source for a physical active-checkout add scan.

## Slices
- [x] Reproduce the zero-stock numbered-unit condition with a focused regression test.
- [x] Preflight family availability before claiming the unit and return battery/location/Battery Ops recovery copy on shortage.
- [x] Sync kiosk documentation and close this plan with verification evidence.
- [x] Use the authenticated kiosk location for numbered-unit availability and checkout stock movement on active-checkout add.
- [x] Prove a Field House checkout can add an available unit from the Camp Randall kiosk balance without touching Field House stock.
- [x] Reproduce the deployed false shortage when on-hand stock exists but overlapping booked family commitments reduce aggregate availability to zero.
- [x] Let an exact available numbered-unit scan proceed without the reservation-commitment shortage veto while preserving the atomic unit claim, non-negative kiosk ledger, allocation, and audit write.
- [x] Deploy the corrected route to production.
- [ ] Reconcile a deficient numbered-family balance from effective unit truth inside the serializable exact-scan transaction, with an adjustment movement and audit snapshot before the normal checkout decrement.
- [ ] Make future stale-flag repairs restore the matching family balance and adjustment movement atomically.
- [ ] Replay a real Camp Randall battery scan.

## Verification
- [x] Focused kiosk route and scan tests.
- [x] `npx tsc --noEmit --pretty false`.
- [x] No native source changed; the existing kiosk client already renders this route's success/error envelope.
- [x] `npm run codemap` and `npm run verify:docs` if owned maps or docs change.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [x] Corrected production deployment is Ready and aliased to `wisconsincreative.com`.
- [ ] Simulator or physical-kiosk runtime proof, or an explicit blocker.

## Review
- Shipped: commit `2e97bc61` is pushed to `origin/main`. Production deployment `dpl_8r1fnvQkoTF8ZH3AJRdhHyKtwhCi` is Ready and aliased to `wisconsincreative.com`; exact available numbered-unit scans no longer run the overlapping-reservation aggregate shortage veto.
- Verified: physical managed-iPad replay reproduced the old aggregate `0 available at Camp Randall` veto even though Battery Ops reports available numbered units. The new regression proves an exact available unit proceeds even when aggregate reservation availability reports zero, while the guarded claim, Camp Randall stock movement, allocation, and audit write remain. The two focused active-checkout tests, 20 direct-checkout numbered-unit tests, TypeScript, focused ESLint, `build:app`, migration preflight, production compile, codemap/docs verification, and whitespace checks pass. One broader source-contract test remains red on an unrelated pre-existing dashboard requester string changed by shared-checkout work.
- Reopened: managed-iPad replay proved the exact-unit/reservation correction works for 18 scans, then exposed a historical unit-status versus balance-ledger deficit. Units 1, 2, and 40 are the physical acceptance cases for the next production correction.
- Blocked: none.
- Proof artifacts: reported screenshot plus local command output in this task.
- Next slice or stop: replay one available Sony battery scan at Camp Randall and close the physical acceptance gate.
