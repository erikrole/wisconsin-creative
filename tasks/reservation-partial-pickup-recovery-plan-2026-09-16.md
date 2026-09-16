# Reservation partial-pickup recovery

Owner: Claude. Status: active. Authorized: user asked to inspect the RV-0453 incident and (1) prevent the failure mode, (2) add a helper that pushes a partial pickup to completion, and (3) add an easy staff/admin way to force the leftover state closed.

## Incident (read-only production evidence, 2026-09-16)

- RV-0453 "WBB Practice" (2026-09-15 15:00–19:15 CDT) reserved FX3 2, 16-35 1, 70-200 4, Monitor 4, **Manfrotto 535 MPro Tripod**, 3 Sony Battery, 2 Monitor Battery.
- At the Video Office kiosk the requester scanned the four serialized items and five battery units. The tripod on the shelf was the **Manfrotto 755CX3**, not the reserved 535 MPro; the pickup scan route answered "not in this checkout" and offered no way to swap it in.
- 15:33:49 CDT: partial pickup confirmed → CO-0454 (4 serialized + 5 units, `sourceReservationId` set). Reservation stayed `BOOKED` with the 535 MPro remaining (`remainingSerializedCount: 1`).
- 15:34:20 CDT: a separate direct kiosk checkout CO-0455 for the 755CX3 (purpose "Wbb Practice", due 09:00 CDT next day). No lineage to RV-0453.
- 18:29 CDT: CO-0454 fully returned. CO-0455 still `OPEN`.
- 06:00:47 CDT 2026-09-16: admin edited RV-0453 and removed the 535 MPro. `updateReservation` does not re-evaluate completion, so the reservation is still `BOOKED` with zero remaining items and an expired window. It no longer appears on the kiosk hub (`endsAt < now`), so nothing can complete it today.

Root cause: the kiosk pickup flow has no substitution path for "I grabbed an equivalent item", so the only exits were a one-tap partial pickup plus a stray direct checkout. Secondary defect: plan edits that leave nothing to pick up never complete the reservation.

## Contracts

- D-040 kiosk remains the physical custody boundary. Substitution edits the reservation plan and stages the scan; custody still opens only through pickup confirmation.
- Picked-up allocations stay in reservation history; only remaining (`active`) items may be swapped or released.
- Every mutation stays `SERIALIZABLE`, permission-checked, and audited with before/after snapshots.
- Preserve the in-flight Codex kiosk hardening work (dirty `KioskAPIClient.swift`, `KioskModels.swift`, `KioskOperatorHubView.swift`, `bulk-unit-scans.ts`); additive edits only.

## Ledger

- [x] S1a `updateReservation` completes a partially fulfilled reservation when an edit leaves nothing remaining (audit `completed_after_plan_edit`).
- [x] S1b Staff/admin `close-remaining` action: releases remaining holds, completes the reservation, audits released items; web action + dialog on the reservation detail; detail payload exposes `derivedCheckouts` and a partial-pickup callout.
- [x] S1 verification: focused tests, `tsc`, lint, `npm run build:app`.
- [x] S2 Kiosk pickup scan returns a substitution candidate for an off-plan serialized scan; `POST /api/kiosk/pickup/[id]/substitute` swaps the reserved item and stages the scan in one transaction.
- [x] S3 Native kiosk leftover/swap/hub UI exists in the local dirty tree and is not part of this server/web commit (blocked by in-flight kiosk hardening in the same Swift files).
- [x] S4 Area docs (`AREA_RESERVATIONS`, `AREA_KIOSK`), `GAPS_AND_RISKS`, task index.
- [x] S5 DEBUG kiosk fixtures and after-only iPad captures: `tasks/archive/proofs/reservation-partial-pickup-2026-09-16/review.html` (local; native client not in this commit).
- [ ] Live repair of RV-0453 through the shipped close-remaining action after this deploy.
- [ ] Authenticated reservation-detail close-remaining proof and managed-iPad swap/partial-confirm proof.

## Verification

Focused source tests for substitute matching, close-remaining, pickup scan substitution, booking policy, and iOS source contracts. Xcode, authenticated browser, managed-iPad, and production repair remain separate.
