# iOS Xcode Workflow

Last refreshed: 2026-07-17

This is the default path for debugging, testing, and reviewing the native Gear Tracker iOS app.

## Fast Closeout

Use the repo script before declaring an iOS slice done:

```bash
npm run ios:xcode:verify
```

The script runs these gates in order:

1. `npm run ios:project:check`
2. `npm run drift:ios`
3. `npm run audit:ios:gaps`
4. `xcodebuild` for `Wisconsin` on `generic/platform=iOS Simulator`
5. `xcodebuild test` for `Wisconsin` on the resolved simulator destination
6. `xcodebuild` for `Wisconsin` on `generic/platform=iOS`

Any gate that exits non-zero aborts the run with that status. A run only prints
`OK: iOS Xcode verification passed` when every gate above actually ran and passed.

The XCTest destination is resolved to a **UDID** at runtime from `xcrun simctl list
devices available` — `iPhone 16 Pro` for `Wisconsin`, `iPad (A16)` for `WisconsinKiosk`,
preferring a booted device and otherwise the newest runtime that has one. A
`name=...,OS=latest` destination is matched only against the newest installed runtime,
so it fails outright for a device such as the iPhone 16 Pro that is installed under an
older runtime. If the device is not available the script stops and lists the available
simulators rather than substituting another one, per the AGENTS.md simulator policy.

The script sets `-derivedDataPath` to `${TMPDIR}/gear-tracker-xcode-derived-data` by default. That keeps command-line builds out of Xcode's shared DerivedData and avoids the build database lock failures that happen when multiple `xcodebuild` processes hit the same location.

Useful variants:

```bash
# Verify the kiosk target.
npm run ios:xcode:verify:kiosk

# Compile only for Simulator.
IOS_SKIP_DEVICE_BUILD=1 npm run ios:xcode:verify

# Skip XCTest only when isolating a compile failure. Normal closeout must run tests.
IOS_SKIP_TESTS=1 npm run ios:xcode:verify

# Use a different simulator by name; still resolved to a UDID.
IOS_SIMULATOR_NAME='iPad (A16)' npm run ios:xcode:verify

# Bypass resolution entirely with a literal xcodebuild destination.
IOS_TEST_DESTINATION='platform=iOS Simulator,id=<udid>' npm run ios:xcode:verify

# Keep static gates out when repeating a compile-only check after a failed Swift build.
IOS_SKIP_STATIC_GATES=1 npm run ios:xcode:verify

# Use a disposable DerivedData folder for a one-off investigation.
IOS_DERIVED_DATA_PATH=/tmp/wisconsin-dd npm run ios:xcode:verify

# Show full xcodebuild output when diagnosing build-system behavior.
IOS_XCODEBUILD_VERBOSE=1 npm run ios:xcode:verify
```

## Xcode Setup

Open the checked-in project:

```bash
open ios/Wisconsin.xcodeproj
```

Use these defaults:

- Scheme: `Wisconsin` for the main app, `WisconsinKiosk` for the dedicated kiosk target.
- Configuration: `Debug` for local debugging and review.
- Destination: the newest installed iPhone Simulator for main-app review. Use the newest installed iPad simulator for `WisconsinKiosk` checks; the kiosk target requires iOS 26 or later.
- Bundle identifier: keep `com.erikrole.Wisconsin` unless you intentionally want a separate install and Keychain identity.

Regenerate the project only after adding, moving, or removing Swift files:

```bash
cd ios
xcodegen generate
cd ..
npm run ios:project:check
```

## Debugging Path

Use Xcode for interactive debugging:

1. Select the right scheme and destination.
2. Add breakpoints in the view model, `AppState`, `APIClient`, or focused SwiftUI view.
3. Run with `Cmd+R`.
4. Filter Xcode or Console logs by subsystem/category when the code uses `Logger`.
5. Reproduce the issue once with the debugger attached, then rerun `npm run ios:xcode:verify` before closing the slice.

Use command-line builds for compile proof, not interactive diagnosis:

```bash
npm run ios:xcode:build:sim
npm run ios:xcode:build:device
```

Do not run multiple Xcode builds for this project in parallel unless each process has a different `-derivedDataPath`.

## Simulator Review

For visual review, build from Xcode or the verify script, then install and launch on the target simulator:

```bash
xcrun simctl list devices available
xcrun simctl boot <SIMULATOR_UDID>
xcrun simctl install <SIMULATOR_UDID> "${TMPDIR:-/tmp}/gear-tracker-xcode-derived-data/Build/Products/Debug-iphonesimulator/Wisconsin.app"
xcrun simctl launch <SIMULATOR_UDID> com.erikrole.Wisconsin
xcrun simctl io <SIMULATOR_UDID> screenshot /tmp/wisconsin-review.png
```

Use screenshots for visual or HIG work. Static source-contract tests and `xcodebuild` prove compilation, but they do not prove that the screen looks correct.

If a managed sandbox blocks the script at CoreSimulator or compiler-plugin startup, record the exact blocker and rerun it with approved access or use direct XcodeBuildMCP test/build evidence for the affected target. The 2026-07-17 adversarial closeout passed the full repository wrappers for both schemes, including 12/12 Wisconsin tests, 5/5 WisconsinKiosk tests, simulator builds, and generic-device builds.

## Codex/XcodeBuildMCP Path

When XcodeBuildMCP tools are available, start with `session_show_defaults`. If project, scheme, and simulator defaults are configured, use the MCP build/run and screenshot tools for simulator proof. If those tools are not exposed in the current session, use the package scripts above and `xcrun simctl` for runtime smoke.

## Review Checklist

Before saying an iOS change is done:

- Focused source-contract or Vitest coverage exists for the changed behavior when practical.
- `npm run drift:ios` passes.
- `npm run audit:ios:gaps` passes.
- `npm run ios:xcode:verify` passes for the touched target, or an exact sandbox blocker and equivalent direct XcodeBuildMCP test/build evidence are recorded.
- Visual or simulator smoke is captured for layout, navigation, crash, HIG, or interaction changes.
- Relevant area docs and `tasks/todo.md` record what changed and what was verified.
