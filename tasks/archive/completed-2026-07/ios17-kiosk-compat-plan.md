# iOS 17 Kiosk-Only Compatibility Plan - 2026-06-22

## Goal
- Let the iPad Pro 10.5-inch running iPadOS 17.7.11 install and run a native kiosk-only Wisconsin app, so the device can operate as an app-based kiosk without Wisconsin Creative user sign-in.
- Keep the existing full Wisconsin app target on iOS 26.0. No non-kiosk pages or views are part of this slice.

## Source Checks
- `docs/AREA_KIOSK.md` defines the native iOS app as the canonical kiosk surface and keeps device-level kiosk auth separate from user sessions.
- `docs/DECISIONS.md` D-030 accepts kiosk auth through `KioskDevice` activation codes, not personal user sessions.
- `docs/DECISIONS.md` D-039 requires active kiosk sessions to resume through Keychain-backed token restore.
- `ios/project.yml` keeps the full `Wisconsin` app and `WisconsinTests` on iOS 26.0.
- Current non-kiosk Swift source uses iOS 26-only Liquid Glass button styles, so lowering the whole app target would require touching unrelated pages. That path was backed out after the kiosk-only correction.
- The kiosk source directory can compile independently with a small kiosk-only app entry point and support shims for shared app symbols used by kiosk files.

## Slices
- [x] Slice 1: Back out the whole-app iOS 17 downgrade and leave non-kiosk views untouched.
- [x] Slice 2: Add an iOS 17.0 `WisconsinKiosk` app target that includes only kiosk sources, kiosk-only support, app assets, and resources.
- [x] Slice 3: Generate the Xcode project from XcodeGen and build the kiosk target.
- [x] Slice 4: Sync kiosk/mobile docs and record verification.

## Verification
- [x] `npm run ios:project:check`
- [x] `npx vitest run tests/ios-api-contract.test.ts`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] `npm run verify:docs`
- [x] `git diff --check`
- [x] `xcodebuild -project ios/Wisconsin.xcodeproj -scheme WisconsinKiosk -destination 'generic/platform=iOS Simulator' -configuration Debug build`
- [x] `xcodebuild -project ios/Wisconsin.xcodeproj -scheme WisconsinKiosk -destination 'generic/platform=iOS' -configuration Debug CODE_SIGNING_ALLOWED=NO build`
- [x] `xcodebuild -project ios/Wisconsin.xcodeproj -scheme Wisconsin -destination 'generic/platform=iOS Simulator' -configuration Debug build`

## Review
- Shipped: Added a separate native `WisconsinKiosk` iPad app target at iOS 17.0, with a kiosk-only app entry point and the kiosk source set/resources. The full `Wisconsin` target and tests remain iOS 26.0.
- Verified: XcodeGen output matches the checked-in project, kiosk simulator and generic device builds succeeded, the full app simulator build succeeded, iOS drift/audit checks passed, docs codemaps are current, whitespace is clean, and `tests/ios-api-contract.test.ts` now pins the target split.
- Deferred: Physical iPad install/signing and Guided Access setup remain manual hardware steps.
