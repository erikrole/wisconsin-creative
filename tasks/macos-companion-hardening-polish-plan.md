# macOS companion hardening and polish

Status: ACTIVE — macOS 1.0.4 installed; post-enrollment cold-restart and full interaction proof remain

## Scope and authority

- Surface: `macos/GearOps`, displayed as Wisconsin Creative.
- Accepted authority: D-047, `plans/062-gearops-menu-bar.md`, Dashboard and Notifications area docs.
- Preserve: read-only custody boundary, Upstash-only post-enrollment reads, last trusted projection, passive booking alerts, existing web deep links, and unrelated dirty iOS/web work.
- Exclude from the implementation slice: server mutations, schema work, and production deployment. Release packaging, signing, notarization, and installation were completed later under explicit shipping authorization.

## Problems being closed

- A 60-second network loop contradicts D-047's no-timer contract and spends 1,440 external-cache reads per device per quiet day.
- Duplicate IDs or unsupported projection versions can trap during indexing instead of preserving trusted state.
- Sign-out can discard its only retry credential while remote revocation fails, and private notification/avatar residue remains locally visible.
- Optional notification authorization can delay projection readiness.
- Menu, popover, and Settings derive health/count truth independently.
- Signed-out lifecycle warnings are hidden on the identity step; password retry, focus, Reduce Motion, and headings are incomplete.
- Settings updates can reactivate the accessory app and steal focus.
- Launch-at-login approval looks off, unavailable registration remains interactive, and state does not refresh after System Settings.
- Release configuration does not encode Hardened Runtime, and the installed copy is a Debug/XCTest host rather than a distribution artifact.
- Companion credentials are issued for 90 days but have no renewal path, so a normally used menu-bar session eventually falls back to the login screen.

## Implementation slices

- [x] Restore once, then refresh through APNs, explicit refresh, or Mac wake; remove periodic network polling.
- [x] Validate projection version, identity uniqueness, access state, and nonnegative counts before state mutation or cache indexing.
- [x] Use cookie-free, non-caching ephemeral transport and device-only Keychain accessibility.
- [x] Make revocation failures durable and retryable without restoring a signed-out account; compensate failed or superseded enrollment.
- [x] Purge delivered/pending notifications and avatar caches at account removal.
- [x] Move notification authorization and APNs registration off the projection critical path.
- [x] Centralize custody count and health presentation for the menu, popover, and Settings.
- [x] Keep lifecycle errors visible, scrub password state on dismissal, refocus failed authentication, and expose real focus treatment.
- [x] Prevent settings focus theft; refresh system-owned state on app activation; represent pending launch approval honestly.
- [x] Respect Reduce Motion, add accessibility headings/live error announcements, and request sound capability for the opt-in sound setting.
- [x] Enable Hardened Runtime for Release without changing signing or distribution authority.
- [x] Add an Upstash-only rolling credential renewal path; rotate only after the replacement is durable in Keychain and keep failed old-session cleanup retryable.
- [x] Never infer sign-out from a missing Keychain read; keep the trusted local projection until explicit sign-out or a server-confirmed unauthorized credential.
- [x] Keep semantic username and password controls mounted together so native password-manager autofill can populate the complete credential pair.
- [x] Store the enrolled identity in the device-only data-protection Keychain so a crash-lost preferences cache cannot make the surviving companion credential unreachable.

## Verification

- [x] Focused macOS XCTest suite (63 tests, 0 failures with the local macro sandbox workaround).
- [x] Focused macOS companion Vitest source contracts.
- [x] `xcrun swiftc -parse macos/GearOps/*.swift` and test sources.
- [x] XcodeGen regeneration is reviewed and deterministic.
- [x] Unsigned Debug test compilation, Release archive, and XCTest execution with Xcode 26.6 (all pass with the local macro sandbox workaround).
- [ ] Matched `gt-ui-review` before/after page from deterministic, non-production fixtures.
- [ ] Installed clean Release smoke: menu, Settings focus, launch approval, notifications, VoiceOver, keyboard, Reduce Motion, sleep/wake, sign-out cleanup.
- [x] Signed archive checks: Hardened Runtime, production APNs entitlement authorized by the embedded Developer ID profile, no test frameworks/debug dylibs/test entitlements, strict signature, notarization, and stapling.
- [x] `npm run verify:docs`; [x] full-worktree `git diff --check`.

## Current proof boundary

- The hardened macOS and companion service/source suites pass 50/50 focused tests, including rolling credential renewal, the event-driven pending-revocation retry path, the no-Neon session route, and recovery from a completely absent preferences cache.
- The direct shared `.icon` resource was replaced with the shared compiled `AppIcon.appiconset`; Xcode reaches Swift compilation. `xcodebuild build-for-testing` and `xcodebuild test` pass with `OTHER_SWIFT_FLAGS=-disable-sandbox` to work around the local macro-plugin sandbox; the native suite reports 63/63 passing.
- The shipped archive includes the explicit `AppIcon.icns`, production APNs entitlement, and Developer ID provisioning profile `4f4171d8-f959-4ed5-be70-7cc663253d52`; the installed 1.0.4 build is accepted by Gatekeeper and running from `/Users/role/Applications/Wisconsin Creative.app`. The user must enroll once in 1.0.4 before the new Keychain identity exists, so the next real crash/cold-restart remains the acceptance gate.
- The local visual-control service still cannot target an `LSUIElement` status item, so the matched review page and real 1Password interaction remain open. Version 1.0.4 changes recovery state rather than the signed-out visual treatment shown in the supplied screenshot.

## Release execution (2026-08-20)

- Source commit: `193ca4f0`; tag: `macos-v1.0.0`; [GitHub release](https://github.com/erikrole/wisconsin-creative/releases/tag/macos-v1.0.0).
- Developer ID profile: `Wisconsin Creative GearOps Developer ID 2026` (`4f4171d8-f959-4ed5-be70-7cc663253d52`), with production APNs entitlement and the installed `Developer ID Application: Erik Role (T26T3G8C7Q)` certificate.
- Notary submission `8aece3a6-de79-447c-8920-2d1f0a105286` was accepted; stapler validation, Gatekeeper (`Notarized Developer ID`), and strict code-signature verification passed.
- Canonical release asset: `Wisconsin-Creative-1.0.0-macos.zip`, SHA-256 `6dbc6dc28fa7f6b40c45290eb3e28bfae4fca6b246c082b536916ccf2b555f94`. The old profile-less asset was removed after its restricted APNs entitlement was killed at launch.
- The corrected app was installed over the prior debug/profile-less copies, which were preserved under `/private/tmp`, and the signed process is running from the installed Release bundle.

## Release execution (2026-08-21)

- Source commit: `0ecf2802`; tag: `macos-v1.0.2`; [GitHub release](https://github.com/erikrole/wisconsin-creative/releases/tag/macos-v1.0.2).
- Notary submission `30a15061-dcdc-4b57-bc77-9a23ec9f2f1c` was accepted; stapler validation, Gatekeeper (`Notarized Developer ID`), and strict code-signature verification passed.
- Canonical release asset: `Wisconsin-Creative-1.0.2-macos-profile.zip`, SHA-256 `10b9231550843c353bd3ffc87b4b61ef2967a9613e7c13277812fae6c950bc6f`.
- The prior installed 1.0.1 bundle was preserved under `/private/tmp`; the signed 1.0.2 build (version 1.0.2, build 3) is installed and running from `/Users/role/Applications/Wisconsin Creative.app`.

## Release execution (2026-08-29)

- Version 1.0.3 (build 4) was archived as a universal Developer ID application with Hardened Runtime, the production APNs entitlement, and provisioning profile `4f4171d8-f959-4ed5-be70-7cc663253d52`.
- Apple accepted notary submission `5b987233-c461-4c79-bd81-1477e3e2e3f7`; stapler validation, Gatekeeper (`Notarized Developer ID`), and strict code-signature verification passed on both the archive and installed copy.
- Final stapled artifact: `/private/tmp/wisconsin-creative-macos-1.0.3.cY1ikP/Wisconsin-Creative-1.0.3-macos-profile-stapled.zip`, SHA-256 `be11de2a5e485d6f3c6d35422c27060fe4ed94261c75cd48eb1994e77e6f0677`.
- The prior 1.0.2 installation was preserved at `/private/tmp/Wisconsin Creative-previous-installed-1.0.2-20260829-1348.app`. Version 1.0.3 is installed and running from `/Users/role/Applications/Wisconsin Creative.app`; an ordinary process relaunch preserved the cached trusted-state payload. No source commit, tag, push, or GitHub release was created.

## Release execution (2026-08-29, 1.0.4)

- Version 1.0.4 (build 5) was archived as a universal Developer ID application with Hardened Runtime, the production APNs entitlement, and provisioning profile `4f4171d8-f959-4ed5-be70-7cc663253d52`.
- Apple accepted notary submission `b561c2b7-5cc0-4f1a-8d5f-519284f0761e`; stapler validation, Gatekeeper (`Notarized Developer ID`), and strict code-signature verification passed on the archive and installed copy.
- Final stapled artifact: `/private/tmp/wisconsin-creative-macos-1.0.4.jPfaNU/Wisconsin-Creative-1.0.4-macos-profile-stapled.zip`, SHA-256 `dc05ab7ea36a82b900baa5000cb1d758d8192297e061e1ad2479faba294591c3`.
- The prior 1.0.3 installation was preserved at `/private/tmp/Wisconsin Creative-previous-installed-1.0.3-20260829-1947.app`. Version 1.0.4 is installed and running from `/Users/role/Applications/Wisconsin Creative.app`. No source commit, tag, push, or GitHub release was created.

## Session persistence follow-up (2026-08-20)

- **Observed contract:** `issueCompanionSession` creates a 90-day bearer credential, while the macOS client has no refresh route. A 401 therefore signs the user out even when the account and local Keychain are otherwise healthy.
- **Bounded fix:** add an authenticated Upstash-only renewal endpoint that issues a replacement credential without touching Neon; the client saves the replacement first, then revokes the old credential through the existing durable pending-revocation path. Projection failures still preserve the last trusted local data, and a failed renewal falls back to the current credential rather than signing out.
- **Verification target:** server route/store tests, macOS source contracts, native renewal/revocation regression coverage, Swift parse/build-for-testing, and focused Vitest suites. A fresh signed/notarized release is a separate shipping action after source verification.
- **Current evidence:** focused Vitest source/security contracts (28 tests), TypeScript, lint, web build, Swift parse, macOS build-for-testing, and the native XCTest suite (62 tests) pass. The installed notarized 1.0.2 build now contains the source fix; cold-restart acceptance remains a user/device gate.

## Restart recovery follow-up (2026-08-21)

- **Observed contract:** the installed 1.0.1 process made only Keychain reads after restart, then showed the sign-in screen; the prior process had continued receiving successful projection responses. A first-unlock/unavailable read was being treated as a confirmed logout and the cached identity was removed.
- **Bounded fix:** startup now preserves the trusted cached identity/projection on a missing credential, observes macOS application/workspace session activation, and retries with explicit missing-credential confirmation after activation or menu presentation. Manual sign-out and a confirmed post-activation miss still clear local state.
- **Verification target:** focused source contracts, Swift parsing, native model regression coverage, and a fresh signed/notarized release followed by a cold-restart acceptance pass.

## Restart and password-manager follow-up (2026-08-29)

- **Observed contract:** the 1.0.2 recovery path still converted a second missing Keychain read into an explicit local logout, even though repeated `nil` reads cannot distinguish a temporarily unavailable data-protection item from deliberate credential removal. The two-step login also unmounted the username field before showing the password field, leaving native password managers without a stable username/password pair to fill.
- **Bounded fix:** only explicit sign-out or a server-confirmed unauthorized credential clears trusted local state. Missing Keychain reads keep the cached identity/projection visible and retry on activation, wake, push, or menu presentation. The login card now mounts standard SwiftUI username and password fields together with `.username` and `.password` content types.
- **Current evidence:** Swift parsing, 50/50 focused macOS/companion tests, and the native XCTest suite (63/63) pass. Signed/notarized release 1.0.4 (build 5) is installed and Gatekeeper accepts it. A cold Mac restart after one new 1.0.4 enrollment and real 1Password Universal Autofill remain device acceptance gates.

## Crash-lost preferences follow-up (2026-08-29)

- **Observed contract:** after the Mac crashed and rebooted at 19:33, the installed 1.0.3 process launched at 19:34 and the on-disk `com.erikrole.GearOps` preferences contained no `GearOpsCachedStateV1`. The app therefore had no user identity, and its pre-restore `guard user != nil` made any surviving Keychain credential unreachable; the supplied 19:38 screenshot confirmed the signed-out form.
- **Bounded fix:** enrollment now stores the validated `GearOpsUser` in its own `projection-user` data-protection Keychain item using `AfterFirstUnlockThisDeviceOnly`. Restore loads that secure identity before requiring an in-memory user, then refreshes only through the existing Upstash projection. Existing cached enrollments migrate the identity on their next successful restore, and explicit sign-out removes both token and identity.
- **Current evidence:** the new native test removes the preferences cache entirely and restores the account/current projection from the in-memory Keychain equivalent. All 63 native tests and 50 focused companion/source tests pass; signed/notarized 1.0.4 is installed and running. Because 1.0.3 never stored the secure identity, the user must sign in once before a real crash/cold-restart can accept this fix.
