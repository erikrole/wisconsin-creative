# Audit: macOS menu bar companion (GearOps)

Last updated: 2026-09-18
Verdict: SOURCE READY
Scope: `macos/GearOps` end-to-end, including local booking-change notifications and Apple menu-bar extra recoverability.

## Findings closed in this pass

### P1 — extra hiding had no native recovery
Apple’s menu-bar extra guidance lets people decide whether an extra is present, warns that macOS may hide extras when space is tight, and asks apps not to rely on that presence. The companion now binds `MenuBarExtra(isInserted:)`, persists the choice, and switches from `.accessory` to `.regular` when the extra is off so the Dock, Dock menu (Dashboard / Refresh / Show in Menu Bar / Settings), and Settings sign-in remain available. Command-drag-out of the menu bar uses the same `isInserted` binding.

### P1 — notifications stacked and dropped opted-in sound
A later booking update now replaces the previous request (`booking-change-{id}`) instead of minting a UUID. Foreground presentation includes `.sound` only when the request actually carries a sound, so the silent default stays silent while Settings is key. The alert category offers **Open Booking** and uses the existing booking deep link. Bookings that leave the projection clear their delivered request, one refresh delivers at most four newest allowed alerts, and turning Booking alerts off empties Notification Center.

### P2 — extra treated offline kiosks as a menu-bar icon alert
The extra popover is a glance: pickups first, overdue-first open bookings (cap 4), live kiosks only (cap 4), inactive counted in the fleet summary, overdue and freshness in the header. View N more expands remaining rows in the extra. Clicking a booking opens a backable detail pane with items instead of the website. The extra glyph stays `shippingbox` / `shippingbox.fill` and its VoiceOver label reports custody count only.
The menu-bar glyph is a monochrome SF Symbol that stays `shippingbox` / `shippingbox.fill` regardless of health. The optional count no longer uses a numeric content transition. Window style remains Apple’s documented exception because bookings, pickups, health, and sign-in are too complex for a flat command menu.

## Remaining open (not blocking this source pass)

- Installed/notarized release, cold restart after a new enrollment, VoiceOver/keyboard smoke, and real APNs delivery remain under the Companion delivery gap.
- When macOS temporarily hides extras to make room for app menus, `isInserted` stays true and the companion remains accessory, so there is still no Dock icon until the user Command-drags the extra out or turns it off in Settings.
- Matched `gt-ui-review` captures are still blocked by the local UI service’s inability to target an `LSUIElement` status item.
- Physical 1Password Universal Autofill remains a device gate.

## Proof

- Source contracts: `tests/macos-gearops-source.test.ts` (26) and `tests/macos-gearops-security-source.test.ts` (5), 31 passed
- Native XCTest: 79 passed, 0 failed (`xcodebuild -project macos/GearOps.xcodeproj -scheme GearOps -destination 'platform=macOS' test` with `OTHER_SWIFT_FLAGS=-disable-sandbox`)
- Parse: `xcrun swiftc -parse macos/GearOps/*.swift macos/GearOpsTests/*.swift`
