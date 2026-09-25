# Matched native captures

Commands run from the selected isolated snapshot or repository root. Inspect the existing fixture/test harness before extending it; it may contain concurrent changes.

## Toolchain and target

Use a per-command `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` when needed; do not change global xcode-select or require sudo to repair a local command environment. Discover the available Xcode/simulator tools. A missing MCP does not prohibit supported `xcrun`/`xcodebuild` use.

List devices and select the actual UDID for the target's `AGENTS.md` destination (iPhone 18 Pro Max for `Wisconsin`; iPad Air 11-inch (M4), iOS 26.5, for `WisconsinKiosk` — use `scripts/kiosk-capture-scenarios.sh` for kiosk fixture captures). Use that same UDID explicitly for launch, screenshots, and UI tests; do not use the ambiguous `booted` target. A kiosk/iPad request needs the corresponding form-factor proof. If the required runtime is unavailable, report that gate without silently changing device models.

## Existing fixture path

Inspect `AppRuntimeMode.PerformanceScenario` in `ios/Wisconsin/Core/PerformanceInstrumentation.swift`, `ios/Wisconsin/App/PerformanceTestHarness.swift`, and `ios/WisconsinUITests/ReportsScreenshotUITests.swift` for supported scenarios and test names. Confirm the scheme includes the UI test target before selecting it; the existing fixture UI-test scheme is `WisconsinPerformance`.

Reuse an existing scenario when it covers the state. If extension is required, add only the requested surface/state and obey target membership conventions. Do not append unrelated helpers into a large file just to avoid project registration.

The fixture API must intercept the surface's API reads, including `/api/me` foreground refresh, and keep unmapped requests local with a controlled response. A missing mapping must not leak to production and tear down the fixture user. Verify current interceptor behavior before relying on it.

Hold time-relative input constant across the pair (same fixture clock, timezone, dates, content, appearance, text size, and scroll position). Relative-to-launch timestamps alone may cross a boundary between captures. Hide first-run overlays only through supported DEBUG/test hooks, applied equally to both sides.

## Capture

Prefer an existing deterministic screenshot UI test. Use the observed test class/method, not a guessed example name:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test \
  -project ios/Wisconsin.xcodeproj -scheme WisconsinPerformance \
  -destination 'platform=iOS Simulator,id=<verified-UDID>' \
  -only-testing:<verified-test-identifier> \
  -resultBundlePath /absolute/path/capture.xcresult
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun xcresulttool export attachments \
  --path /absolute/path/capture.xcresult --output-path /absolute/path/attachments
```

For a bounded manual capture, reproduce the same inputs/scroll state, use the verified scenario and bundle ID, and document the manual steps. Read the PNG and attachment manifest to identify the correct frame. Do not claim a UI test was run if the capture was manual.

## Baseline and scale

Capture before edits whenever possible. Otherwise create an isolated snapshot of the actual pre-change source, including relevant pre-existing dirty changes. Never swap files in the working checkout or reconstruct a baseline from memory. Missing baseline means an explicitly limited after-only result.

Use actual logical viewport dimensions from the selected device/app when converting pixels to points. Do not assume 393pt or infer scale from a marketing screen diagonal. The bundled row-measurement helper requires explicit width and supports only documented PNG types/background assumptions.
