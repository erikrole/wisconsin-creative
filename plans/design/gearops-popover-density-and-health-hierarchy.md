# Make GearOps compact and put health detail where it belongs

Written against: `32134418498494916f6dd414f7205e2166bf5290`

Status: IMPLEMENTED and visually verified on 2026-08-08

## Evidence chain

- Surface: authenticated GearOps `MenuBarExtra` popover rendered on 2026-08-08
- Problem: the fixed 500-point scroll region leaves a large empty area when the current two bookings and three kiosks do not fill it; the red aggregate failure icon sits beside the booking count even though the failure is kiosk-specific; kiosk rows state stale/offline without showing when the last heartbeat occurred.
- Design evidence: `macos/GearOps/MenuBarContentView.swift`, `macos/GearOps/GearOpsModel.swift`, `ios/Wisconsin/Views/BookingsView.swift`, and `src/app/(app)/settings/kiosk-devices/page.tsx`
- Owner: `macos/GearOps/MenuBarContentView.swift` with pure aggregate state owned by `macos/GearOps/GearOpsModel.swift`
- Scope and affected surfaces: authenticated GearOps popover, menu-bar accessibility copy, GearOps model tests, macOS source contracts, Dashboard area documentation
- Uncertainty: the final intrinsic popover height must be proven in the actual `MenuBarExtra` runtime because source/build checks previously missed a collapsed scroll region.

## Design decision

Keep the current two-section structure and iOS-aligned booking rows. Make the content region size to its measured intrinsic height until it reaches the existing 500-point cap, then scroll. Keep the popover header focused on app identity and open-booking count with a neutral shipping-box mark. Move aggregate severity into the System Health heading. Make kiosk summary copy describe fleet state, and make each kiosk's last heartbeat more prominent than build identity.

## Reuse

- Existing `GearOpsHealthSeverity`, `KioskConnectionState`, `healthLabel`, and `KioskDevice.lastSeenAt`
- Existing `sectionTitle`, `HealthRow`, and `KioskRow` compositions
- Exemplar: `ios/Wisconsin/Views/BookingsView.swift` for booking hierarchy
- Exemplar: `src/app/(app)/settings/kiosk-devices/page.tsx` for last-seen and build-information hierarchy
- SwiftUI's one-value `onGeometryChange` measures the content directly, avoiding a private preference key and a second layout propagation path.

## Changes

1. `macos/GearOps/MenuBarContentView.swift`
   - Change: replace the fixed `.frame(height: 500)` scroll region with measured intrinsic content height capped at 500 points. Seed the measured height to the signed-out/compact baseline so first render cannot collapse to zero. Keep scrolling enabled when measured content exceeds the cap.
   - Preserve: 380-point width, header/footer structure, booking-first order, health-second order, refresh behavior, and all deep links.
   - Verify: two bookings and three kiosks place the footer immediately after content with no large dead zone; a long booking list retains the 500-point cap and scrolls.

2. `macos/GearOps/MenuBarContentView.swift`
   - Change: use a neutral `shippingbox.fill` app mark in the header. Add the aggregate `healthSeverity.symbol`, color, and `healthLabel` beside the System Health heading. Do not duplicate aggregate severity beside the booking count.
   - Preserve: the menu-bar status symbol and accessibility label continue to reflect aggregate health.
   - Verify: an offline kiosk marks System Health as Critical while the header still reads as GearOps plus the open-booking count.

3. `macos/GearOps/GearOpsModel.swift` and `macos/GearOps/MenuBarContentView.swift`
   - Change: expose tested online, stale, offline, and inactive kiosk counts. When kiosk data is available, label the summary row `Kiosks` and render compact state copy such as `0 online · 2 stale · 1 offline`, omitting zero-valued stale/offline/inactive segments after the online segment. Keep `Kiosk access` only for unknown, restricted, or failed permission/read states.
   - Preserve: exact five-minute and 24-hour heartbeat thresholds, Restricted semantics, and no mutation behavior.
   - Verify: the supplied three-device state reads `0 online · 2 stale · 1 offline`; Restricted never appears as an outage.

4. `macos/GearOps/MenuBarContentView.swift`
   - Change: replace each kiosk subtitle's build-first copy with `Location · Last seen <relative>` or `Location · Never checked in`. Keep app version/build in the row's help text so it remains available without competing with outage diagnosis.
   - Preserve: kiosk name, device icon, right-aligned state label, location, and accessibility combination.
   - Verify: stale and offline rows explain heartbeat age at a glance, and hovering the row exposes build identity.

5. `macos/GearOpsTests/GearOpsModelTests.swift`, `tests/macos-gearops-source.test.ts`, `docs/AREA_DASHBOARD.md`, and `plans/062-gearops-menu-bar.md`
   - Change: add contracts for aggregate kiosk counts, adaptive-height ownership, neutral header identity, health-heading severity, fleet-state copy, and last-seen-first rows. Record the accepted popover hierarchy and runtime proof boundary.
   - Preserve: existing custody, pagination, stale-data preservation, and heartbeat-boundary tests.
   - Verify: focused native and source-contract suites pass and documentation matches the rendered result.

## Scope

- Inherit: all authenticated GearOps users and every open-booking/kiosk count combination.
- Verify: signed-out and restoring popovers, zero bookings, one booking, current two-booking state, enough bookings to exceed 500 points, no kiosks, restricted kiosk access, mixed healthy/stale/offline kiosks, and inactive kiosks.
- Exclude: API contracts, booking lifecycle, kiosk mutations, health thresholds, polling cadence, passkeys, launch-at-login, distribution, notarization, commit, push, and deployment.

## Validation

- Product: launch the rebuilt GearOps app, open the menu-bar popover, and confirm bookings remain first and System Health remains second.
- Interface: visually inspect zero-content, short-content, and overflow states; confirm no collapsed content, no large blank footer gap, correct severity placement, useful last-seen copy, and scrolling at the cap.
- System: confirm the native iOS booking-row hierarchy is unchanged and the web kiosk page remains the source exemplar for last-seen/build priority.
- Repository: `xcodebuild -project macos/GearOps.xcodeproj -scheme GearOps -destination 'platform=macOS' test CODE_SIGNING_ALLOWED=NO` -> all GearOps tests pass.
- Repository: `npx vitest run tests/macos-gearops-source.test.ts` -> all GearOps source contracts pass.
- Repository: `npm run verify:docs` -> codemaps are current.
- Repository: `git diff --check` -> exit 0.

## Stop conditions

- Stop if intrinsic-height measurement makes the menu popover oscillate, collapse, or resize continuously.
- Stop if an adaptive layout requires changing the shared iOS Bookings view or any server response.
- Stop if kiosk state counts cannot be derived solely from the existing `KioskDevice.connectionState()` owner.
- Stop before any commit, push, distribution, notarization, or deployment without explicit authorization.

## Design documentation

- Completed: `docs/AREA_DASHBOARD.md` and `plans/062-gearops-menu-bar.md` record adaptive popover sizing, neutral booking header identity, aggregate health placement, fleet counts, and last-seen-first kiosk diagnostics.
