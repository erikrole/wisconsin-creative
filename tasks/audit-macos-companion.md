# Audit: macOS menu bar companion (GearOps)

Last updated: 2026-10-07
Verdict: SOURCE READY
Scope: `macos/GearOps` end-to-end, including local booking-change notifications and Apple menu-bar extra recoverability.

## Improvement pass (2026-10-07)

- **Stale data no longer reads as Healthy.** When the projection has not been confirmed for 15 minutes (`GearOpsModel.staleSnapshotAge`), Companion data turns Needs attention and reads "Unconfirmed for 40m". Confirmation is the client's last successful read, not the server's `generatedAt`. The server rebuilds only on change, so an old `generatedAt` on a quiet day is still current. Each presentation of the extra (its window becoming key) retries a locked Keychain or re-reads the projection when both the last confirmation and the last presentation attempt are older than 60 seconds. Each refresh rotates the companion credential, and that endpoint is rate-limited per IP. This is user-driven, not a timer (D-047).
- **Search.** A field under the header matches every whitespace-separated term against title, requester, location, reference, and item tag or name across open checkouts (overdue first) and upcoming or waiting reservations. The matched item shows on the card (for example `CAM-014 · Sony FX6 Camera`). Opening the extra focuses the field; ⌘F returns to it from a detail.
- **Keyboard.** ↑/↓ move a highlight through the visible rows while focus stays in the field, Return opens the highlighted booking, and Esc clears the search. Keys come from an AppKit local monitor scoped to the extra's window because a focused text field consumes arrow keys before `onKeyPress`.
- **Count mode.** The numeral beside the glyph shows open bookings, overdue only (hidden at zero), or nothing. The legacy `showsMenuBarCount: false` maps to Off. The glyph is unchanged. A 60-second `Timer` lets overdue mode follow the clock. A `TimelineView` inside the `MenuBarExtra` label re-rendered the status button endlessly and hung launch, and a source contract now forbids it.
- **⌃⌥⌘G and the Status window.** A Carbon hot key (no Accessibility permission needed) clicks the visible status item. When macOS has tucked the extra away or the user hid it, the hot key opens the same glance in a regular Status window. Dock reopen and the Dock menu's new **Show Status** item open that window too. This closes the earlier gap where a space-hidden extra left no visible entry point. The hot key can be turned off in Settings › General.
- **Cleanup.** Removed the never-set `countDataIsPartial`, `GearOpsSnapshot.partialFailures`, and the redundant `openBookingTotal`. Caches written by 1.0.5 still decode, and a regression test covers that. `CompanionProjectionLimits.accepts` is now the one trust check for the server projection and the preferences cache. `install` and the capture fixture share `apply(_:)`. The popover is split into `MenuBarContentView`, `BookingCards`, and `HealthPanel`. The 48-item display cap now comes from `CompanionProjectionLimits.itemsPerBooking`, which mirrors server `MAX_COMPANION_ITEMS`. The outdated "Sign in again to load them" copy is gone.

## Findings closed in an earlier pass

### P1 — extra hiding had no native recovery
Apple’s menu-bar extra guidance lets people decide whether an extra is present, warns that macOS may hide extras when space is tight, and asks apps not to rely on that presence. The companion now binds `MenuBarExtra(isInserted:)`, persists the choice, and switches from `.accessory` to `.regular` when the extra is off so the Dock, Dock menu (Dashboard / Refresh / Show in Menu Bar / Settings), and Settings sign-in remain available. Command-drag-out of the menu bar uses the same `isInserted` binding.

### P1 — notifications stacked and dropped opted-in sound
A later booking update now replaces the previous request (`booking-change-{id}`) instead of minting a UUID. Foreground presentation includes `.sound` only when the request actually carries a sound, so the silent default stays silent while Settings is key. The alert category offers **Open Booking** and uses the existing booking deep link. Bookings that leave the projection clear their delivered request, one refresh delivers at most four newest allowed alerts, and turning Booking alerts off empties Notification Center.

### P2 — extra treated offline kiosks as a menu-bar icon alert
The extra popover is a glance: pickups first, overdue-first open bookings (cap 4), live kiosks only (cap 4), inactive counted in the fleet summary, overdue and freshness in the header. View N more expands remaining rows in the extra. Clicking a booking opens a backable detail pane with items instead of the website. The extra glyph stays `shippingbox` / `shippingbox.fill` and its VoiceOver label reports custody count only.
The menu-bar glyph is a monochrome SF Symbol that stays `shippingbox` / `shippingbox.fill` regardless of health. The optional count no longer uses a numeric content transition. Window style remains Apple’s documented exception because bookings, pickups, health, and sign-in are too complex for a flat command menu.

## Remaining open (not blocking this source pass)

- Installed/notarized release, cold restart after a new enrollment, VoiceOver/keyboard smoke, and real APNs delivery remain under the Companion delivery gap.
- When macOS temporarily hides extras to make room for app menus, there is still no Dock icon, but ⌃⌥⌘G now opens the Status window. Whether `occlusionState` reports a space-hidden status item as not visible is unproven on a crowded menu bar; if it does not, the hot key clicks a hidden item and nothing appears.
- The installed ⌃⌥⌘G path, the real status-item popover, and the overdue-mode minute tick in the menu bar label are unverified. Fixture captures cover the popover content only.
- `xcodebuild test` hosts the tests in the real, non-fixture app. It shares `UserDefaults` and the Keychain with the installed app, so a successful restore in the host can rotate the installed app's companion credential. A cache the new build writes no longer has `snapshot.partialFailures`, so 1.0.5 drops it as untrusted and refetches if it relaunches before an upgrade. This hazard predates this pass. A fixture-style test host would remove it.
- The local UI service still cannot target an `LSUIElement` app. Fixture captures use `screencapture -l` on the Debug Status window, and keyboard checks post `CGEvent`s to the fixture PID.
- Physical 1Password Universal Autofill remains a device gate.

## Proof

2026-10-07 pass:
- Installed 1.0.6 (build 7) at `/Users/role/Applications/Wisconsin Creative.app`. It is a universal Release archive exported as Developer ID with Hardened Runtime, the production APNs entitlement, and profile `4f4171d8-…`. Strict signature verification passes. It is not notarized, matching the 1.0.5 it replaced. 1.0.5 is preserved at `/private/tmp/Wisconsin Creative-previous-installed-1.0.5-20261007-0841.app`. After relaunch the process is idle, the session is still signed in, and the cache is present.
- Native XCTest: 90 passed, 0 failed (82 before this pass plus 8 new: stale health, unchanged read confirming an old generation, bounded presentation refresh including a failing read, locked-credential retry on presentation, search, count modes, legacy count migration, and 1.0.5 cache decode).
- Release build (`-configuration Release`, unsigned) succeeded.
- Source contracts: 37 passed across `macos-gearops-source` (32, including 4 new) and `macos-gearops-security-source` (5). The 6 `companion-*` files pass 21 tests.
- Fixture interaction: typing, ↓↓, Return, and Esc were posted as `CGEvent`s to the Debug fixture PID. They autofocused search, highlighted the second row, opened its detail, and returned. Captures and receipts are in `tasks/archive/proofs/gearops-menu-bar-improvements-2026-10-07/`.
- A launch hang from a `TimelineView` in the `MenuBarExtra` label was caught by the test host ("runner hung before establishing connection") and confirmed with `sample`. It was fixed before these runs.

Earlier pass:
- Source contracts: `tests/macos-gearops-source.test.ts` (26) and `tests/macos-gearops-security-source.test.ts` (5), 31 passed
- Native XCTest: 79 passed, 0 failed (`xcodebuild -project macos/GearOps.xcodeproj -scheme GearOps -destination 'platform=macOS' test` with `OTHER_SWIFT_FLAGS=-disable-sandbox`)
- Parse: `xcrun swiftc -parse macos/GearOps/*.swift macos/GearOpsTests/*.swift`
