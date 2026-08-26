# Item Conflicts and Time-Proximity Plan

## Goal

Make item availability explainable before selection and at the kiosk scan boundary, then make near-future reuse timing actionable without weakening the server-authoritative checks.

## Scope and contracts

- Reservation creation remains reservation-first; the server availability service and transactional create/complete checks remain authoritative.
- The existing `POST /api/availability/check` payload is top-level JSON. Web preview consumers must decode that contract directly; native clients must keep the same top-level contract.
- Native reservation browsing should preview the currently loaded asset list plus selected/deep-linked assets, not only already-selected IDs.
- Kiosk scan routes identify and stage an item. After a scan is staged, the kiosk must immediately show the availability result for that item and the current due-back window; completion remains the final transactional gate.
- Serialized reuse keeps the existing 60-minute turnaround buffer as a hard conflict. Near-but-allowed future use is advisory and should communicate both the next-needed time and the remaining handoff window.
- Numbered bulk-unit binding and kiosk custody boundaries stay unchanged. Bulk-family warnings remain advisory where the current contract intentionally defers exact-unit binding to pickup.

## Bounded implementation slices

1. **Pre-selection reservation preview**
   - Fix the web hook's response decoding.
   - Schedule native reservation checks after asset loads and against visible plus selected IDs.
   - Preserve stale context during transient failures and invalidate context when the request window changes.

2. **Kiosk scan feedback**
   - Reuse the existing kiosk availability preflight after each staged scan.
   - Map blocking conflicts, shortages, unavailable assets, and advisory turnaround risks to item-specific feedback immediately instead of leaving the result only in a summary banner.
   - Keep the staged cart visible so the operator can remove or correct the item; do not bypass completion-time transaction checks.

3. **Time-proximity clarity**
   - Replace ambiguous “Back before” / generic “Next use” copy with explicit needed-at and return-by language.
   - Mark very-close allowed turnarounds as critical advisory risk while retaining the existing hard 60-minute serialized buffer.
   - Enforce that 60-minute buffer symmetrically when a new booking ends before an existing next booking as well as when it starts after an existing prior booking.
   - Keep location-transfer and recent check-in evidence visible without turning advisory warnings into hard blocks.

4. **Docs and verification**
   - Add focused tests for the top-level response contract, pre-selection IDs, kiosk scan feedback, and close-proximity copy/severity.
   - Update reservation, checkout, kiosk, and risk documentation only after behavior is verified.

5. **Native advisory parity follow-up (completed 2026-08-26)**
   - Decode the existing top-level reservation availability advisories in the native client without making newer optional fields a rollout-breaking requirement.
   - Carry needed-next and turnaround state through the reservation view model and show concise, accessible row-level timing alongside hard conflicts.
   - Keep booking-detail checkout/reservation preflight kind-aware and keep server-side create/update enforcement authoritative.

## Follow-up corrections - 2026-08-26

The source review found that the first slice made conflicts visible but left
their action semantics, risk taxonomy, native failure state, and kiosk bulk
timing behavior inconsistent. This follow-up keeps the existing API envelope,
reservation-first boundary, and server-authoritative final checks.

### Slices

- [x] Make buffered serialized conflicts consistently non-selectable in web and native reservation pickers, with an explicit replacement/date recovery path.
- [x] Preserve conflict windows and actionable return-by/available-after copy in web, native, and booking-detail surfaces.
- [x] Separate timing, transfer, and condition-report risk labels/actions, including kiosk blocking behavior for genuinely unsafe condition states.
- [x] Preserve native availability context on refresh failure while exposing a stale/unknown state that cannot be mistaken for clear.
- [x] Enable and test kiosk bulk-family proximity advisories after scanned units are staged.
- [x] Sync focused source-contract tests and area documentation after behavior is verified.

### Follow-up stop conditions

- Do not add a schema or migration; stop if the existing availability response cannot carry the required conflict/risk context.
- Do not make advisory timing or transfer warnings block reservation or checkout unless the current status/custody contract already treats the condition as unavailable.
- Do not let a failed preflight be represented as a clear availability result.
- Preserve the exact-unit kiosk custody boundary; bulk-family timing remains advisory.

### Follow-up verification

- [x] Focused service, web picker, kiosk, and native source-contract tests.
- [x] `git diff --check`, TypeScript, lint, and `npm run build:app`.
- [x] `npm run verify:docs` after codemap/doc changes.
- [x] `npm run ios:project:check`, affected source-contract tests, and the Wisconsin/WisconsinKiosk simulator builds.
- [ ] Authenticated browser and native/kiosk runtime proof when the environments are available; otherwise record the proof boundary.

## Files likely involved

- Web: `src/components/equipment-picker/use-conflict-check.ts`, shared availability-copy helper, `EquipmentPicker.tsx`, `BookingEquipmentTab.tsx`.
- Service: `src/lib/services/availability.ts` and its focused tests if proximity severity/message changes.
- Native reservation: `ios/Wisconsin/Core/APIClient.swift`, `ios/Wisconsin/Views/CreateBooking/CreateBookingViewModel.swift`, the native picker view, and source-contract tests.
- Native kiosk: `ios/Wisconsin/Kiosk/KioskCheckoutView.swift` or a focused helper/model file plus kiosk source-contract tests.
- Docs: `docs/AREA_RESERVATIONS.md`, `docs/AREA_CHECKOUTS.md`, `docs/AREA_KIOSK.md`, and `docs/GAPS_AND_RISKS.md` if an existing gap closes.

## Stop conditions

- Do not add a schema or migration unless the current payload cannot carry the required result.
- Do not make kiosk scan success create custody or override completion-time availability checks.
- Do not claim authenticated browser, simulator, or physical-device proof if the required environment is unavailable. The default iOS proof destination remains iPhone 16 Pro.
- Preserve the unrelated existing worktree changes in `src/app/globals.css`, `src/components/resources/MarkdownReader.tsx`, and `tests/markdown-reader.test.ts`.

## Verification gates

- Focused Vitest tests for availability, picker contracts, kiosk feedback, and native source contracts.
- `git diff --check`.
- `npx tsc --noEmit --pretty false`, lint, and `npm run build:app`.
- Affected native Xcode build plus source-contract tests when the native sources change.
- Authenticated browser proof for the reservation picker if credentials/dev runtime are available; otherwise report that boundary explicitly.
- Kiosk simulator/native proof only at the available iPhone 16 Pro destination; physical scanner/device acceptance remains separate.

## Evidence recorded

- Follow-up-focused Vitest suite: 11 files, 168 tests passed, covering service semantics, shared copy, web picker/detail contracts, kiosk availability/completion, native API/model/picker parity, rapid-scan ownership, and the booking review CTA.
- Web gates: `npx tsc --noEmit --pretty false`, `npm run lint`, `npm run build:app` (241 static pages/routes), `npm run verify:docs`, and `git diff --check` pass. Codemaps were regenerated before the final docs check.
- Native gates: `npm run ios:project:check` passes; the `Wisconsin` target builds on iPhone 16 Pro, iOS 26.5; the iPad-only `WisconsinKiosk` target builds on iPad Air 11-inch, iOS 26.5. The requested iPhone 16 Pro kiosk destination is unavailable because that scheme targets iPad families only.
- Full Vitest: 554 of 561 files passed and 3,847 of 3,856 tests passed. The nine failures are pre-existing dirty-worktree contracts in API hardening, Schedule/Snow Leopard, native Welcome ordering, operational target baseline (`RolePreviewControl`), and hidden-user visibility; none touch this item-conflict slice.
- Browser/device boundary: no authenticated browser proof or physical scanner acceptance was available, so those remain open and deployment was not attempted.

## Next-slice review

- Shipped: web and native pre-selection preview, hard conflict recovery, kiosk scan feedback, shared needed-next/return-by copy, critical proximity severity, symmetric serialized buffer, capacity-aware bulk timing, native booking-kind parity, refresh-failure preservation, and native row/cart advisory parity.
- Next: authenticated browser acceptance, iPhone/native runtime review where the target supports it, and physical scanner acceptance.
- Stop: do not broaden this slice into new schema, migration, kiosk custody, or deployment work.
