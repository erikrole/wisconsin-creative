# Wisconsin iOS App

Native SwiftUI app for wisconsincreative.com.

## Prerequisites

- Xcode 27 (current project toolchain)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

## First-time setup

```bash
cd ios
xcodegen generate
open Wisconsin.xcodeproj
```

In Xcode:
1. Select the `Wisconsin` target → Signing & Capabilities
2. Set your **Team** to your Apple Developer account
3. Keep the **Bundle Identifier** aligned with the checked-in project (`com.erikrole.Wisconsin`) unless you intentionally want a separate install/keychain identity.

## Running on device

```bash
# Regenerate project after adding/removing files
xcodegen generate
```

Then build and run from Xcode (⌘R).

To verify the checked-in project matches `project.yml` without mutating the working tree:

```bash
npm run ios:project:check
```

For the standard debug, test, and review path, see [iOS Xcode Workflow](../docs/IOS_XCODE_WORKFLOW.md).
The default closeout command is:

```bash
npm run ios:xcode:verify
```

## Performance regression tests

The performance harness is DEBUG-only and is not present in TestFlight or App Store Release builds. Run its dedicated scheme on the required iPhone 18 Pro Max simulator:

```bash
xcodebuild \
  -project ios/Wisconsin.xcodeproj \
  -scheme WisconsinPerformance \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max,OS=27.0' \
  test CODE_SIGNING_ALLOWED=NO
```

Use the same simulator and runtime for both sides of a benchmark; record the runtime with each baseline. Do not substitute another device if the required destination is missing.

## TestFlight

1. Select **Any iOS Device (arm64)** as destination
2. Product → Archive
3. Distribute App → App Store Connect → Upload
4. In App Store Connect, add testers under TestFlight

## Architecture

```
Wisconsin/
  App/          — Entry point, root view
  Core/         — APIClient (URLSession), SessionStore (@Observable)
  Shared/       — App host/environment constants shared by Wisconsin and WisconsinKiosk
  Models/       — Codable models matching the API
  Views/        — SwiftUI screens
  Supporting/   — Info.plist (managed by XcodeGen)
```

## API

Talks directly to `https://wisconsincreative.com` using the same cookie-based session as the web app.
Authentication is shared — logging in on the app logs you in via the same session table.
