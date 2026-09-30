# Kiosk Xcode settings verification — 2026-09-28

Compilation caching is active for Kiosk and its tests. App/test targets are iPad-only; Mac is listed as incompatible. Debug coverage is scoped to Kiosk. Release uses ENABLE_CODE_COVERAGE=NO; compiler commands and binary symbols confirm instrumentation is absent, while -O, whole-module optimization and dSYM crash symbols remain.

XcodeGen owns the correct Wisconsin Kiosk.app product reference; its drift checker now copies the icon source. The verifier pins iPad Air 11-inch (M4) to iOS 26.5 and uses separate Kiosk DerivedData. Executed fixtures proved that booted 27.0 cannot override 26.5 and a missing required runtime stops verification.

## Verification

- Final simulator XCTest: 13 passed, no failures.
- Unsigned generic iOS Release build: passed.
- Focused source-contract tests: 3 passed.
- Project regeneration, iOS drift, audit inventory, docs, JavaScript lint/syntax, shell syntax and diff checks: passed.
- Local unsigned Release executable: 11,689,888 to 9,357,128 bytes (20.0% smaller). Same source/toolchain, removing coverage only. No runtime or build-speed improvement was measured.
- [Resolved settings and hashes](verification.json), [XCTest log](simulator-tests.log), [Release build log](release-build.log).

Existing UIRequiresFullScreen deprecation warning remains to preserve the landscape contract. AppIntents metadata extraction is skipped because the target does not use AppIntents. No physical installation, distribution, commit or push.

References: [Apple build settings](https://developer.apple.com/documentation/xcode/build-settings-reference) and [XcodeGen scheme generation](https://github.com/yonaskolb/XcodeGen/blob/master/Sources/XcodeGenKit/SchemeGenerator.swift).
