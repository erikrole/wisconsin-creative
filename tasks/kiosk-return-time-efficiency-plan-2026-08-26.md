# Kiosk Return-Time Efficiency Plan - 2026-08-26

## Goal

- Make kiosk return times fast and predictable to set in 15-minute increments while retaining an explicit date and time choice for the custody record.
- Carry the same interaction into active-checkout edits so the two kiosk return-time surfaces do not drift.
- Apply the same forward-only quarter-hour contract to the web surfaces that create or edit a booking return time.

## Route

- Owner area: Kiosk
- Secondary area: Checkouts
- Ledger: this plan
- Existing references: `tasks/audit-kiosk-scanning-ios.md`, `docs/AREA_KIOSK.md`, D-040

## Source Checks

- Direct checkout currently uses separate always-visible native date and time controls in `KioskCheckoutView.swift`; one-tap duration presets were deliberately removed because they encouraged operators to accept a due time they had not chosen.
- A new checkout defaults to tomorrow at 9:00 AM. A linked event defaults to 90 minutes after the event ends. Restored drafts are clamped only to five minutes in the future.
- Active-checkout detail uses a compact native date/time editor and the existing kiosk mutation path. No API, schema, permission, audit, or custody-state change is needed.
- Web `DateTimePicker` and `InlineDateField` already offer minute options `00/15/30/45`, but both use nearest-quarter display math. That can move an off-grid value backward and turns minutes 53–59 into an invalid minute value of 60.
- Current web return-time consumers are reservation creation, inline booking detail/sheet edits, and the explicit Extend panel. Schedule and shift time controls are separate workflow contracts and are out of scope.

## Stop Conditions

- Stop if a 15-minute picker requires a non-native custom wheel, hides the chosen day, or reintroduces a one-tap duration default.
- Stop if normalization could move a stored active-checkout due time without an operator edit or if it changes the server payload contract.
- Stop if a shared web correction would silently save an untouched legacy timestamp, broaden web custody authority, or alter Schedule/shift controls.
- Preserve the unrelated availability and scanner-keyboard changes already present in the same files.

## Slices

- [x] Add a shared native kiosk time picker backed by `UIDatePicker.minuteInterval = 15` plus a deterministic round-up helper.
- [x] Use it for direct checkout and active-checkout editing; round generated event/draft minimums up to the next quarter-hour without silently rewriting untouched persisted bookings.
- [x] Pin the 15-minute control, normalization, and both call sites with focused tests.
- [x] Sync Kiosk docs and record physical-iPad acceptance separately from source/build proof.
- [x] Add one shared web quarter-hour helper that rounds forward, handles hour/day rollover, and clamps to the next valid minimum.
- [x] Use it in shared web date-time controls and pass truthful return-time minimums from reservation creation, booking detail/sheet, and Extend.
- [x] Add focused helper/source coverage and sync Checkout/Reservation docs without changing API or custody ownership.

## Verification

- [x] Focused kiosk return-time and checkout-detail tests.
- [x] `npm run ios:project:check`
- [x] `npm run drift:ios` and `npm run audit:ios:gaps` (gap audit passes; drift remains blocked by the unrelated existing `SettingsView.swift:82` literal-red finding).
- [x] `WisconsinKiosk` Simulator build and shared `Wisconsin` iPhone 16 Pro Simulator build.
- [x] `npm run verify:docs`
- [x] `git diff --check` and final scoped diff review.
- [ ] Managed landscape iPad interaction proof; record the blocker if the kiosk devices remain unavailable.
- [x] Focused web return-time tests, `npx tsc --noEmit --pretty false`, lint, and `npm run build:app`.
- [ ] Authenticated browser interaction and matched UI review, or record the exact runtime/proof blocker.

## Review

- Shipped: shared native quarter-hour time input; direct checkout and active-checkout edit call sites; forward-rounded generated event and stale minimums; untouched persisted checkout timestamps remain unchanged until edited.
- Verified: native proof above; web proof includes 3 focused Vitest files / 18 tests, TypeScript, full repository ESLint, `npm run build:app`, regenerated/current codemaps, docs verification, and `git diff --check`.
- Deferred: smarter suggestions based on location hours or next reservation demand need an accepted source-of-truth contract; no speculative presets were added.
- Blocked: managed kiosk iPads are unavailable for interaction proof. Authenticated web interaction and a matched UI review are unavailable because no dedicated isolated Playwright identity is configured; production credentials were not used. `drift:ios` also reports the unrelated existing `ios/Wisconsin/Views/SettingsView.swift:82` literal-red finding.
- Proof artifacts: `/private/tmp/kiosk-return-time-after.png` is retained only as failed-fixture evidence; the DEBUG `checkout-details` scenario rendered a blank sheet and is not accepted as visual proof. A matched native or web before/after review page was not manufactured without a kiosk UI-test screenshot target or an isolated authenticated web identity.
- Next slice or stop: stop after documentation and diff gates; perform the physical 15-minute picker walkthrough on a managed landscape iPad and the authenticated web interaction on an isolated test identity when available.
