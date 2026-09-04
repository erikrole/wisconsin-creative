# Plan 062: Add a read-only Wisconsin Creative menu bar monitor

> **Executor instructions**: Keep custody and health semantics aligned with the existing web read models. Do not add mutations, copy credentials into source, deploy, or treat build success as authenticated runtime proof.
>
> **Drift check (run first)**: `git diff --stat 32134418..HEAD -- src/app/api/dashboard/stats/route.ts src/app/api/kiosk-devices/route.ts src/lib/services/dashboard-counts.ts src/app/\(app\)/settings/kiosk-devices/page.tsx ios/Wisconsin/Core/APIClient.swift ios/Wisconsin/Models/DashboardModels.swift`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: native macOS operations
- **Planned at**: commit `32134418`, 2026-08-08
- **Execution**: IMPLEMENTED LOCALLY; installed app repaired on 2026-09-03, production deployment and APNs delivery proof pending

## Why this matters

Staff currently open the web control room to answer two frequent questions: how much gear is in physical custody, and whether the supporting kiosk fleet is healthy. A compact menu bar monitor can surface those answers without creating another mutation surface or weakening the kiosk-owned custody boundary.

## Product contract

- The menu bar count is `CHECKOUT + OPEN`: physical custody only.
- The popover leads with every `OPEN` checkout, conditionally adds a compact waiting-for-pickup lane when work exists, then shows system health. It does not summarize bookings into metric cards.
- Open checkout rows reuse the native iOS Bookings hierarchy and are ordered by due-back time.
- Booking and pickup rows show the requester's profile image when available, with initials retained during loading, on failure, or when no image is set.
- Waiting-for-pickup follows the existing operational rule: staged checkouts plus booked reservations whose start time has arrived. The lane stays hidden when empty.
- Overdue, due today, pending pickup, and booked reservations remain separate values.
- Companion refresh success proves the external projection responded. It does not prove Neon is awake or every subsystem is healthy.
- Projection failures must remain visible and must not overwrite the last trustworthy snapshot with fallback zeroes.
- Kiosk heartbeat classification matches the web contract: online within five minutes, idle within 24 hours, offline after 24 hours or before the first heartbeat.
- Only offline is a fault. An idle kiosk is a kiosk nobody is using, so it does not escalate aggregate health, does not render in a warning colour, and does not sort above a kiosk in active use.
- Companion data shows elapsed projection freshness without treating quiet time as a health failure. Healthy kiosk rows show location-scoped pending-pickup and open-checkout workload; unhealthy rows retain last-heartbeat diagnostics.
- A permission-denied kiosk read is `Restricted`, not a kiosk outage.
- The app is read-only. All detailed work deep-links to the existing web control room.
- The user-facing app name is Wisconsin Creative and its app identity reuses the shared `ios/Wisconsin/Assets.xcassets/AppIcon.appiconset`; GearOps remains the internal module, project, and bundle identifier.
- In-app icon surfaces resolve the compiled `AppIcon` from the running bundle. `NSApplication.applicationIconImage` and `NSWorkspace.icon(forFile:)` are not used, because both return Apple's generic application placeholder rather than reporting failure. A missing icon falls back to the vector Block W from the shared icon source, never to a foreign placeholder.
- The menu bar uses a compact package SF Symbol; the repository app icon appears in the popover and system-owned app surfaces. The `Sim iPad` development record is excluded from macOS health counts, severity, and rows without changing the server record.
- Booking changes arrive through silent APNs invalidation and an Upstash-backed projection fetch. Local alerts are passive and silent, establish a no-alert baseline on enrollment, and deep-link to the affected booking.
- Any window this app opens must activate the app first. As an `LSUIElement` accessory process it never activates itself, so a `Settings` scene opens its window behind every other window and reads as a dead menu item. `SettingsLink(preAction:)` does not exist in this SDK, so settings is an explicit `Window` scene: the menu calls `NSApplication.activate()` before `openWindow(id:)`, and a one-shot window probe covers non-menu visibility without reactivating on every SwiftUI update.
- Launch at login is user-controlled through `SMAppService.mainApp`. A registration held in `requiresApproval` is a normal macOS outcome, not a failure, and is surfaced with a route into System Settings rather than an error.
- The menu bar count is optional. Hiding it leaves the status symbol alone; the count remains `CHECKOUT + OPEN` when shown.
- Booking alerts stay silent by default. Sound is an explicit per-user opt-in carried to each delivery, so the passive-by-default contract holds unless the user changes it.
- System health renders as one grouped panel. Rows that point at a real destination behave as controls with hover and button traits; rows that do not stay inert.
- Every detected change carries a `BookingChangeCategory`. The user chooses which categories alert through a Settings scene with a master switch and per-category toggles. Preferences are applied at delivery, not at detection, so a muted category still advances the baseline and cannot replay when it is switched back on. Unrecognised stored categories are ignored rather than treated as denials.
- Sign-in uses the shared Wisconsin Creative login design: crimson splash scene, brand lockup on the scene, a light card holding the form, identity-then-password steps, and a show/hide password control. The step split is local; the companion does not call the auth discovery route, so explicit enrollment remains the only Neon-backed request.
- Local booking-change alerts use the booking title as the stackable title and show `Status • Requester • Timestamp` from the projection's server `updatedAt`, so the source event time remains visible when delivery is delayed.
- Automatic launch, restore, refresh, and push handling must never call a Neon-backed route. Explicit password enrollment may wake Neon because the user initiated it.

## Scope

**In scope**:

- A separate XcodeGen macOS project under `macos/`
- SwiftUI `MenuBarExtra` with window-style content and no Dock icon
- Native password enrollment that returns a revocable companion credential and initial projection
- Local-only restoration through Keychain and the last trusted cache
- External projection stats, kiosk fleet health, and freshness
- Every visible `OPEN` checkout in one bounded projection
- Manual Upstash-only refresh plus silent APNs invalidation, with no timer or polling loop
- Projection snapshot comparison plus native local alerts for reservation, pickup-ready, checkout, check-in, cancellation, extension, time, and generic booking updates
- Deep links to Dashboard, active Checkouts, and Kiosk Devices
- Unit tests for decoding, custody semantics, health thresholds, permission handling, and stale-data preservation
- Source-contract tests that pin the macOS target and route usage
- Dashboard area documentation and task/plan lifecycle updates

**Out of scope**:

- Checkout, reservation, kiosk, Schedule, database, or deployment mutations
- A database-backed companion read route
- Frequent database diagnostics polling
- Background agents or auto-update infrastructure
- Passkey runtime support until the macOS bundle identifier is added to the production webcredentials association and signed-device proof is available
- App distribution, notarization, production deployment, commit, or push

## Architecture

1. Explicit password enrollment authenticates against Neon once, builds the initial projection while compute is already awake, and returns a signed 90-day companion credential stored in Keychain.
2. Successful booking, custody, kiosk, and avatar mutations rebuild the bounded projection after commit, write it to Upstash, and send a silent APNs invalidation. A committed kiosk last-seen touch publishes in the same deferred chain.
3. Companion projection and device-registration routes authenticate from a signed credential plus an Upstash allowlist. They do not import the database or use the normal database-backed session middleware.
4. `GearOpsModel` restores only local cache and Keychain state. APNs and manual refresh fetch only the external projection, retain trusted data on failure, and never fall through to Neon-backed routes.
5. Pure health helpers classify kiosk heartbeat and aggregate menu bar severity so tests do not need SwiftUI or networking.
6. `BookingChangeDetector` maps projection snapshots to operational alert copy. `BookingNotificationCenter` schedules passive notifications with no sound and opens the affected booking when clicked.

## Steps

1. Scaffold the separate native macOS project and test target.
   - **Verify**: XcodeGen creates the project and the empty target builds without changing `ios/Wisconsin.xcodeproj`.
2. Implement response models, explicit enrollment, local-only session restoration, and external refresh state.
   - **Verify**: focused tests decode current server envelopes and prove a failed refresh cannot replace trusted counts.
3. Implement the menu bar label and window content.
   - **Verify**: signed-out, loading, healthy, partial, restricted, stale, and failed states compile and have accessibility labels.
4. Add exact kiosk health classification and web deep links.
   - **Verify**: tests pin five-minute and 24-hour boundaries and no mutation route appears in the macOS source.
5. Add silent APNs invalidation and projection-based booking notifications with a quiet baseline and no custody mutation surface.
   - **Verify**: tests prove the baseline emits nothing and later status or due-time changes produce the expected passive alert copy.
6. Run the focused tests, source contracts, macOS build, docs gate, and whitespace checks; update this plan with exact proof and remaining runtime gaps.

## Verification

| Purpose | Command | Expected on success |
|---|---|---|
| Generate project | `cd macos && xcodegen generate` | `GearOps.xcodeproj` generated |
| macOS tests | `xcodebuild -project macos/GearOps.xcodeproj -scheme GearOps -destination 'platform=macOS' test` | tests pass |
| macOS build | `xcodebuild -project macos/GearOps.xcodeproj -scheme GearOps -destination 'platform=macOS' build` | build succeeds |
| Source contracts | `npx vitest run tests/macos-gearops-source.test.ts` | focused contracts pass |
| Docs | `npm run verify:docs` | codemap check passes |
| Whitespace | `git diff --check` | exit 0 |

## Done criteria

- [x] Menu bar label shows the last trustworthy physical-custody checkout count.
- [x] Signed-out users can explicitly enroll the companion without storing a password.
- [x] Automatic launch, restore, APNs handling, and manual refresh use only external-cache routes.
- [x] Projection failures stay visible without zeroing trusted counts.
- [x] Permission-denied kiosk health is represented as restricted.
- [x] macOS unit tests, source contracts, build, docs, and whitespace gates pass. The 2026-09-03 run passed 63 native tests, 29 source/security contracts, `npm run verify:docs`, and `git diff --check`.
- [x] Authenticated runtime proof is either completed against an isolated target or retained as an explicit gap.

## Execution result

- Added the independent `macos/GearOps.xcodeproj` XcodeGen project without changing the iOS project.
- Implemented a native window-style menu bar surface, explicit password enrollment, Keychain credential restoration, APNs-triggered Upstash refresh, cache-only startup, manual external refresh, and web deep links.
- Added pure heartbeat classification and a main-actor state model that preserves trusted counts across partial or failed refreshes.
- Added 20 Swift tests, thirteen repository source-contract tests, and three projection tests.
- Replaced the initial metric-card concept with a due-sorted, fully paginated list of `OPEN` checkout rows modeled on the native iOS Bookings tab, followed by one health section.
- Made the popover size to short content up to a 500-point scrolling cap, moved aggregate severity into System Health, added tested kiosk fleet counts and last-seen-first diagnostics, and used interactive Liquid Glass booking rows on macOS 26 with the prior custom-material fallback.
- Added passive, soundless native booking notifications backed by silent APNs invalidation and the external projection. The baseline is quiet; later reservations, pickup-ready changes, checkouts, check-ins, cancellations, extensions, time changes, and generic updates are classified from booking snapshots.
- Added stackable booking-title notifications whose body is `Status • Requester • Timestamp`, using each projection row's server `updatedAt` rather than the local delivery time.
- Added a conditional waiting-for-pickup lane, compact projection freshness, and location-scoped workload counts on healthy kiosk rows.
- Added requester profile images to open-booking and waiting-pickup rows with a native asynchronous loader and initials fallback.
- Performance hardening downsamples profile photos off the main actor to their rendered pixel size, bounds decoded and URL caches, sorts pickup activity only when data changes, and persists each accepted projection once. The former 60-second database polling loop is removed.
- The signed Debug app launched as a background-only `LSUIElement` process and restored its authenticated session. Visual inspection confirmed two bookings first, System Health second, a neutral header, Critical health next to that section, `0 online · 2 stale · 1 offline`, last-seen-first kiosk rows, and no large footer dead zone.
- macOS granted GearOps alert authorization at runtime. No real booking was mutated to manufacture a delivery event, so actual Notification Center presentation remains event-dependent rather than visually forced.
- The no-wake slice passes the production-shaped Next.js build, 20 focused web contracts, all 20 macOS unit tests, generated codemap check, ESLint, and whitespace validation. The full repository suite passes 2,999 of 3,002 tests; three unrelated pre-existing assertions remain in App Store submission copy, the retired iOS forgot-password URL contract, and sport-config default count.
- Unsigned macOS compilation and tests pass. A push-capable signed build is blocked because this Mac has no Apple developer account configured and no `com.erikrole.GearOps` Mac App Development profile. Production deployment and real APNs invalidation delivery were not attempted.

## Follow-up execution: 2026-08-18 app identity and popover polish

- Fixed the popover and sign-in icon by resolving `AppIcon` from the running bundle instead of `NSApplication.applicationIconImage`. Added `BlockWMark`, a vector Block W built from the shared icon source's polygon, as the fallback.
- Added four `WisconsinCreativeIconTests`, including a host-bundle guard that fails when a build ships without compiled icon resources, and three source contracts covering icon resolution, popover width and footer controls, and overdue/hover affordances.
- Popover polish: single 380-point width across all states, projection freshness in the header, an overdue badge derived from the rendered rows rather than generation-time `stats.overdue`, hover feedback on both row types, state-tinted kiosk glyphs, a hidden redundant menu disclosure indicator, and ⌘R, ⌘D, and ⌘Q shortcuts.
- Verified with Xcode 26.6: build succeeds, 41 macOS unit tests pass, 16 source contracts pass. Offscreen `NSHostingView` renders confirmed the icon, header freshness, empty state, kiosk tints, footer, and the removed menu chevron. Booking rows do not appear in offscreen capture because `GlassEffectContainer` does not composite through `cacheDisplay`; the empty-state render confirms the surrounding section paints.
- Added a General settings tab with launch-at-login (`SMAppService`, including the approval-pending state), an optional menu bar count, and an opt-in alert sound. Grouped system health into one panel whose health and kiosk rows open their Wisconsin Creative destinations. 56 macOS unit tests and 21 source contracts pass.
- Settings previously used a `Settings` scene and never appeared: the window opened at layer 0 behind all other windows with the app inactive. Replaced with an activated `Window` scene and verified against the window server — window frontmost of nine normal windows with the app active.
- Login-item registration itself is unproven: `SMAppService.mainApp` reports `notFound` from a DerivedData test host, so real `register()` behaviour needs a toggle on an installed copy.
- Reclassified idle kiosk heartbeats as normal, added user-configurable booking alert categories behind a native Settings scene, and rebuilt sign-in on the shared login design. 52 macOS unit tests and 19 source contracts pass.
- Remaining gap: the copy at `~/Applications/Wisconsin Creative.app` predates working icon resources and has no `Contents/Resources` at all. Notification and Dock identity need a reinstall of a current build; live Notification Center presentation remains event-dependent.

## STOP conditions

- Existing routes cannot supply the data without weakening permissions.
- The app would need a production-only credential, copied session cookie, or committed secret.
- Correctness would require changing custody lifecycle or deriving checkout state independently on macOS.
- The macOS target would require modifying or regenerating the existing iOS project.

## Follow-up execution: 2026-08-20 reliability, privacy, and release hardening

- Removed the model's 60-second network loop. Launch restore is one bounded task; APNs invalidation, explicit refresh, and `NSWorkspace.didWakeNotification` are the only subsequent refresh paths.
- Added projection and cache validation for version, bounded collection sizes, nonnegative counters/workloads, allowed access states, nonempty unique IDs, and nontrapping activity indexing. Invalid data preserves the last trusted state.
- Hardened transport to an ephemeral, cookie-free, no-store URL session. Companion revocation now propagates failures; pending revocation credentials are stored in a device-only data-protection Keychain slot, retried at launch, and capped at 16 entries. Release enables Hardened Runtime. The broken direct `.icon` source was replaced with the shared compiled `AppIcon.appiconset` so the project reaches Swift compilation.
- Sign-out and identity-removal paths clear local booking notifications and avatar caches. Remote revocation and optional APNs/notification setup are generation-fenced and do not block projection installation or sign-in completion.
- Centralized custody count and companion/kiosk severity, represented failed/restricted kiosk access honestly, fixed settings focus theft, exposed login lifecycle errors and password scrubbing, made pending login approval honest, refreshed System Settings state on activation, and added reduced-motion/focus/accessibility polish. Avatar fetches require HTTPS image responses and a 2 MB byte cap.
- Proof: `xcrun swiftc -parse macos/GearOps/*.swift` and `macos/GearOpsTests/*.swift` pass; unsigned Debug test compilation, unsigned Release build, and `xcodebuild build-for-testing` pass with `OTHER_SWIFT_FLAGS=-disable-sandbox` in this restricted environment; 27 focused macOS Vitest source/security contracts pass. `xcodebuild test` cannot establish `testmanagerd` communication under the sandbox, and clean Release signing, APNs, installed-app smoke, and matched `gt-ui-review` captures remain open.

## Follow-up execution: 2026-09-03 local menu-bar install repair

- Reproduced the reported failure against `/Users/role/Applications/Wisconsin Creative.app`: the installed 1.0.4 build 5 executable failed `codesign --verify --deep --strict` with `code or signature have been modified`, despite the older release record describing a notarized copy.
- Built a clean Release replacement from the current source with the local `Developer ID Application: Erik Role (T26T3G8C7Q)` identity and the matching `Wisconsin Creative GearOps Developer ID 2026` profile. The bundle is valid on disk, hardened-runtime signed, carries the production APNs entitlement, has no `get-task-allow`, and includes `Assets.car` plus `AppIcon.icns`.
- Moved the invalid bundle to `/private/tmp/wisconsin-creative-broken-app-backup-20260903-2215/Wisconsin Creative.app`, installed the replacement at the original path, launched it, and confirmed exactly one process remained from the repaired installed bundle. The old bundle is recoverable from the backup path.
- Added `script/build_and_run.sh` plus `.codex/environments/environment.toml` so the macOS project has a repeatable kill/build/run/verify path. `./script/build_and_run.sh --verify` passes.
- Current proof: `xcodebuild ... test` reports 63 passed native tests; the macOS source/security contracts report 29 passed tests; `npm run verify:docs`, `bash -n script/build_and_run.sh`, and `git diff --check` pass.
- Remaining gates: the local replacement is Developer ID signed but not notarized or stapled (`spctl` reports `source=Unnotarized Developer ID`); authenticated projection data, real APNs delivery, and direct visual status-item interaction were not manufactured or claimed.
