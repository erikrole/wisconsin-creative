# Kiosk Idle All Checkouts Plan - 2026-08-26

## Goal

- Show every active checkout in the kiosk idle screen's left rail by default instead of limiting the resting list to checkouts due today or overdue.
- Keep Items Out and Overdue as useful temporary filters without leaving a redundant Checkouts toggle over identical content.
- Align the summary-row order with the resting list and make checkout urgency order deterministic on-device.

## Route

- Owner area: Kiosk
- Secondary area: Mobile Operations
- Ledger: this plan
- Existing references: `tasks/audit-kiosk-idle-ios.md`, `docs/AREA_KIOSK.md`, D-040

## Source Checks

- `GET /api/kiosk/dashboard` already returns every `OPEN` `CHECKOUT`, ordered by `endsAt` ascending; no API, schema, permission, or custody mutation change is required.
- `KioskIdleView` currently filters that complete payload through `dueTodayCheckouts` for its resting list and exposes the complete list only through the Checkouts stat tile.
- The left-rail rows already expose the accepted read-only detail and identity-gated Return paths for every active checkout.
- The server orders active checkouts by `endsAt`, but the native view currently trusts payload order; the deterministic review fixture intentionally demonstrates that an out-of-order payload produces an out-of-order custody list.

## Stop Conditions

- Stop if the dashboard response is not the complete active-checkout set or if the change would bypass the existing kiosk identity/custody boundary.
- Preserve unrelated availability, booking-freshness, scanner, return-time, and documentation work in the dirty checkout.

## Slices

- [x] Make Active Checkouts the explicit resting left-rail selection and remove the today-only derived list.
- [x] Pin the default/filter behavior with a focused source-contract test.
- [x] Fix the unrelated, source-clean Settings role-preview error color drift found by the native verification gate.
- [x] Sync Kiosk and Mobile documentation and record runtime/device proof separately.
- [x] Put Checkouts first in both loaded and placeholder summary rows.
- [x] Sort active checkout rows overdue-first, then by earliest due time, with a deterministic title tie-breaker.
- [x] Refresh focused contracts, docs, and the matched review artifact.

## Verification

- [x] Focused kiosk idle source-contract tests.
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] `npm run ios:project:check`
- [x] `npm run ios:xcode:verify:kiosk`
- [ ] `npx tsc --noEmit --pretty false` — current repository run is blocked by unrelated dirty `BookingEquipmentTab.tsx` references to an unimported `Button`.
- [x] `npm run verify:docs`
- [x] `git diff --check` and final scoped diff review.
- [x] Matched kiosk before/after review artifact, or record the concrete fixture/runtime blocker.

## Review

- Shipped: the idle left rail now defaults to every active checkout; Items Out and Overdue remain temporary filters that clear back to Checkouts. The deterministic fixture includes a tomorrow checkout so this behavior stays reviewable. The separate Settings role-preview error now uses the shared red status token.
- Verified: 3 focused Vitest files / 11 tests; `drift:ios` with zero findings; `audit:ios:gaps` 56/56; Xcode project parity; `WisconsinKiosk` Simulator build, XCTest suite, and generic iOS build; docs/codemap verification; diff check; inspected matched Simulator captures for both the all-checkouts change and the ordering/layout follow-up.
- Deferred: physical managed-iPad acceptance and the existing iOS 26 `UIRequiresFullScreen` landscape-lock migration remain separate from this source/Simulator slice.
- Blocked: no kiosk-specific blocker. Repository-wide TypeScript currently fails in unrelated dirty booking work at `BookingEquipmentTab.tsx:273,275` because `Button` is not imported; that parallel file was left untouched.
- Proof artifacts: `tasks/archive/proofs/kiosk-idle-all-checkouts-2026-08-26/index.html`, with the accepted `before.png`, `after.png`, and `after-layout.png`. The first after capture was discarded because Simulator restored the old list scroll position; accepted captures followed fixture-app-only state resets.
- Next slice or stop: stop. Recheck the resting rail on a managed landscape kiosk during the next device QA pass, and rerun TypeScript after the separate booking-equipment work restores its import.
- Follow-up requested 2026-08-26: reorder the summary row and harden native checkout ordering; reopen this plan until the added slice is verified.
