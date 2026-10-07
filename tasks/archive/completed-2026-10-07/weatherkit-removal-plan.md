# WeatherKit Removal Plan - 2026-08-14

## Goal
- Replace App Store candidate Build 25 with Build 26 that has no WeatherKit code, framework, entitlement, weather UI, or location-related weather behavior.

## Route
- Owner area: Native iOS / App Store submission readiness.
- Ledger: This bounded plan and `tasks/app-store-connect-submission-content.md`.
- Existing reference: Build 25 is the binary attached to submission `1d932540-4f64-4439-a0cb-f7d30af5f4cb`.

## Source Checks
- Build 25 links `WeatherKit.framework` and enables `com.apple.developer.weatherkit` in `ios/project.yml`.
- `EventWeatherService.swift` requests hourly forecasts for upcoming home events using fixed venue coordinates.
- `EventDetailSheet.swift` fetches and displays the result with an attribution link.
- The worktree contains unrelated launch, authentication, analytics, docs, and schema changes that must remain intact.

## Stop Conditions
- Stop if removing WeatherKit breaks another target, an App Extension depends on the service, or the iPhone 16 Pro simulator destination is unavailable.
- Do not upload, select, or resubmit Build 26 without separate user authorization.

## Slices
- [x] Remove WeatherKit code, UI, framework linkage, and entitlement.
- [x] Increment the main app and Live Activities extension to Build 26 and regenerate the Xcode project.
- [x] Update native area and App Store review documentation for the replacement candidate.

## Verification
- [x] WeatherKit reference sweep returns no target, source, entitlement, or generated-project references.
- [x] Focused iOS source-contract tests.
- [x] `npm run ios:project:check`
- [x] `npm run drift:ios`
- [x] `npm run audit:ios:gaps`
- [x] Xcode build for `platform=iOS Simulator,name=iPhone 16 Pro`.
- [x] Signed Release archive and archived entitlement inspection.
- [x] `npm run verify:docs`
- [x] `git diff --check`

## Review
- Shipped: Build 26 was packaged from an isolated candidate based on the Build 25 source plus only the WeatherKit removal and verified Swift 6 archive fix. It uploaded successfully and is attached to version 1.0.
- Verified: Sixteen focused tests pass; project generation, iOS drift, iOS audit coverage, docs, whitespace, exact iPhone 16 Pro compilation, Release archive, App Store export, IPA inspection, upload, and App Store Connect processing all pass. Apple reports Build 26 as `VALID`, App Store eligible, and exempt from non-exempt encryption.
- Deferred: The Resolution Center reply and final resubmission require an authenticated App Store Connect web session.
- Blocked: The collaborative browser and `asc` web session are signed out. The public App Store Connect API cannot send the reviewer-thread reply or resolve the outstanding review issue.
- Proof artifacts: `/private/tmp/Wisconsin-26-clean-v2.xcarchive`; `/private/tmp/Wisconsin-26-export-v3/Wisconsin Creative.ipa`; SHA-256 `5356ef3efdce14c5054bf7a5bfe657a34d5847b13c4c6ac498836a7f3ceead61`; Build ID `e5e5505f-9deb-4cc7-b440-df047f8fd9a8`.
- Next slice or stop: Sign in to App Store Connect, send the documented Resolution Center reply, then resubmit version 1.0 with Build 26. Release remains manual after approval.
