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

## Verification
- [x] Focused kiosk route and scan tests.
- [x] `npx tsc --noEmit --pretty false`.
- [x] No native source changed; the existing kiosk client already renders this route's success/error envelope.
- [x] `npm run codemap` and `npm run verify:docs` if owned maps or docs change.
- [x] `git diff --check`.
- [x] `npm run build:app`.
- [ ] Simulator or physical-kiosk runtime proof, or an explicit blocker.

## Review
- Shipped: local server correction preflights numbered-family availability at the authenticated kiosk, writes the checkout stock movement at that physical kiosk, and returns actionable battery/unit/location recovery before any custody write on a true shortage.
- Verified: read-only production evidence established the Field House checkout versus Camp Randall kiosk mismatch and confirmed units #21/#26 are available with no active allocation and 20 family units on hand at Camp Randall. The cross-location regression and shortage regression pass alongside 20 direct-checkout bulk-unit tests; focused ESLint, TypeScript, production app build, migration-prefix check, codemap/docs check, and whitespace verification pass.
- Deferred: managed-iPad scanner replay after production deployment.
- Blocked: none for the server release; physical scanner acceptance remains a separate gate.
- Proof artifacts: reported screenshot plus local command output in this task.
- Next slice or stop: after the authorized production deployment is ready, replay scans for units #21 and #26 on the managed Camp Randall kiosk.
