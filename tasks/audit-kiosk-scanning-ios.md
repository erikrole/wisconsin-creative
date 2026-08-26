# Audit: kiosk scanning (iOS) - 2026-07-13

**MVP verdict:** REPORTED SCAN FAILURE FIXED AND VERIFIED ON HARDWARE. The connected canonical M2 iPad Air receives HID item scans again after the checkout details handoff.

**Audit type:** source and history diagnosis, focused contract tests, dedicated kiosk target simulator/device builds, and install/launch on the connected canonical M2 iPad Air running iPadOS 26.5.2. The former iPadOS 17 kiosk is retired and is not a verification target.

## Diagnosis

### P0 root cause: shared HID focus acquisition could fail silently and stay dead

The shared `HIDScannerField` depends on an invisible `UITextField` becoming first responder. Its `ensureScannerFocus` method called `becomeFirstResponder()` but ignored the returned `Bool`. When UIKit rejected the attempt during a SwiftUI mount or screen transition, the method scheduled no retry because the focus gate was open. The field remained mounted but unfocused, so scanner keystrokes went nowhere.

This exactly matches the report:

- `HIDScannerField` never invokes `onScan`.
- `KioskCheckoutView.handleScan` never runs.
- No API request begins.
- No success, duplicate, or error banner appears.

The July 6 focus-ownership change added a second permanent-block path. `HIDScannerFocusGate` stored visible editor identities in a process-global `Set<ObjectIdentifier>` and removed them only after a matching `textDidEndEditing` notification. `allowScannerFocusNow()` cleared only the timer. If a SwiftUI-owned editor left the hierarchy without the expected end notification, `canAcquireScannerFocus` remained false and the 300 ms retry loop ran forever without exposing state to the screen.

Evidence:

- `ios/Wisconsin/Shared/HIDScannerField.swift:10-35` owns the process-global gate and cannot clear tracked editor ownership from the checkout handoff.
- `ios/Wisconsin/Shared/HIDScannerField.swift:46-72` relies on balanced begin/end notifications to maintain that gate.
- `ios/Wisconsin/Shared/HIDScannerField.swift:122-127` attempts focus only from the representable update.
- `ios/Wisconsin/Shared/HIDScannerField.swift:174-190` retries only while the gate is closed; a failed `becomeFirstResponder()` call while the gate is open is treated as success.
- `ios/Wisconsin/Kiosk/KioskCheckoutView.swift:625-637` performs a text-input-to-hidden-scanner handoff across a SwiftUI state transition, which is the vulnerable timing window.
- Pickup and return mount the same shared hidden field, so the defect is not limited to direct checkout: `ios/Wisconsin/Kiosk/KioskPickupView.swift:53-63` and `ios/Wisconsin/Kiosk/KioskReturnView.swift:52-62`.

The most likely regression point is commit `122b5a6a` (`fix: HID scanner can no longer steal the iPad keyboard mid-typing`, 2026-07-06), which introduced the global editor-ownership set and retry coordinator. The earlier implementation used only a time gate.

## Implemented correction

- `ensureScannerFocus` now treats the return value from `becomeFirstResponder()` and the resulting `isFirstResponder` state as authoritative. A rejected attempt enters the existing single-work-item retry loop.
- Visible editor ownership is weakly tracked. Every gate read prunes editors that disappeared or no longer own first responder, so a missing UIKit end-editing notification cannot block the scanner forever.
- The coordinator reports focus transitions once and clears readiness when scanner capture is disabled.
- Checkout, pickup, and return render the shared `KioskScannerReadinessBadge`. It shows `Scanner reconnecting` until the hidden sink truly owns first responder, `Scanner ready` when capture is live, and scan-recency feedback after input arrives.
- Hardware follow-up found a presentation defect in `KioskScanTarget`: its `PhaseAnimator` translated the corner-bracket shape on entrance, while the transient reconnecting state painted the whole target orange. The brackets are now static and neutral before the first scan; the readiness badge alone owns reconnecting orange.

### P1 resolved: the kiosk previously had no observable scanner-ready state

The scanner representable exposes `onFocusChange`, but the kiosk checkout, pickup, and return screens do not use it. They show scanning instructions even when the hidden sink is not first responder. The existing troubleshooting badge is driven by `lastScanAt`, not current focus ownership, so it cannot distinguish an idle scanner from a dead capture field.

This turns the focus defect into a silent failure instead of a visible recovery state.

### P1 partially resolved: source contracts now pin the recovery branches

`tests/ios-kiosk-scanner-focus.test.ts` now pins the failed-`becomeFirstResponder()` retry branch, stale editor pruning, focus reporting, and readiness UI wiring across checkout, pickup, and return. It remains a source contract rather than an executable UIKit focus test, so the actual HID scan on the connected iPad remains the final behavioral proof.

## API and backend boundary

The checkout, pickup, and return handlers all show explicit feedback after `onScan` fires, including caught API errors. A backend rejection therefore does not fit the immediate silent symptom as closely as pre-handler focus loss. Production runtime logs could have confirmed whether scan requests reached Vercel, but the connected Vercel account returned 403 for runtime-log access. No absence-of-traffic claim is made.

The current uncommitted five-minute idle polling and heartbeat changes are not the direct cause of HID keystrokes disappearing. They could increase first-request latency after Neon scales down, but a request timeout would eventually reach the existing error banner. The reported zero-feedback path occurs before that.

## Acceptance status

- [x] Hardware HID scan reliably reaches checkout after typed checkout details on the connected M2 iPad Air.
- [ ] Hardware HID scan reliably reaches pickup and return after sheet or keyboard transitions.
- [x] Failed focus acquisition retries until `isFirstResponder == true`.
- [x] Scanner-ready UI reflects actual first-responder ownership.
- [x] Source-contract coverage pins failed acquisition retry and stale editor-gate recovery.
- [ ] An executable UIKit test covers failed acquisition and stale editor-gate recovery.
- [x] Camera and typed recovery still route through the same custody scan handlers.
- [x] Kiosk scan API and session contract tests pass.
- [x] Dedicated `WisconsinKiosk` simulator target builds.

## Verification

- `npx vitest run tests/ios-kiosk-scanner-focus.test.ts tests/ios-kiosk-rapid-scan-atomicity.test.ts tests/kiosk-checkout-scan-badges.test.ts tests/kiosk-checkin-routes.test.ts tests/kiosk-session-auth.test.ts` - 5 files, 20 tests passed.
- `xcodebuild -scheme WisconsinKiosk -destination 'generic/platform=iOS Simulator' -configuration Debug build` from `ios/` - `BUILD SUCCEEDED`; one App Intents metadata warning because the target has no AppIntents dependency.
- `xcodebuild -scheme WisconsinKiosk -destination 'id=00008112-00160582223BA01E' -configuration Debug -allowProvisioningUpdates build` from `ios/` - `BUILD SUCCEEDED` for the connected M2 iPad Air.
- Installed and launched `com.erikrole.WisconsinKiosk` on connected device `00008112-00160582223BA01E` (iPad14,8, iPadOS 26.5.2).
- `npm run ios:xcode:verify:kiosk` - XcodeGen parity, iOS drift, 49/49 audit coverage, simulator build, and generic iOS build passed.
- `npm run verify:docs` - codemaps are current.
- `git diff --check` - passed after implementation and documentation sync.
- Physical HID checkout scan - user-confirmed successful on the connected M2 iPad Air.
- Scanner-target entrance defect - user observed orange brackets translating downward; the follow-up removes bracket `PhaseAnimator` and keeps the no-result target neutral. Corrected-build hardware confirmation pending.
- Corrected scanner-target verification - focused scanner contracts, iOS drift, 49/49 audit coverage, XcodeGen parity, simulator build, generic-device build, docs verification, and `git diff --check` passed. Physical reinstall is pending because the canonical iPad became unavailable to Xcode after the first hardware confirmation.

## Files and contracts read

- `docs/NORTH_STAR.md`
- `docs/AREA_MOBILE.md`
- `docs/AREA_KIOSK.md`
- `docs/DECISIONS.md` (D-030, D-039, D-040 and current index/change material)
- `docs/GAPS_AND_RISKS.md`
- `ios/Wisconsin/App/WisconsinApp.swift`
- `ios/Wisconsin/App/AppDelegate.swift`
- `ios/Wisconsin/Shared/HIDScannerField.swift`
- `ios/Wisconsin/Kiosk/KioskNativeTextField.swift`
- `ios/Wisconsin/Kiosk/KioskCheckoutView.swift`
- `ios/Wisconsin/Kiosk/KioskPickupView.swift`
- `ios/Wisconsin/Kiosk/KioskReturnView.swift`
- `ios/Wisconsin/Kiosk/KioskIdleView.swift`
- `ios/Wisconsin/Kiosk/KioskAPIClient.swift`
- Kiosk scan API routes and `src/lib/services/kiosk-scan.ts`
- Current scanner/session/scan-route tests
- Prior kiosk checkout, pickup, return, battery recovery, debugger, and broad kiosk audit records

## 2026-08-14 numbered-battery crash follow-up

### Crash evidence and bounded route

- The Camp Randall IPS report records `EXC_BREAKPOINT` / `SIGTRAP` on `com.apple.SwiftUI.AsyncRenderer`, not a memory-pressure termination or API failure.
- The first app frame is `closure #1 in KioskUnitChips.chipContent.getter`, reached from SwiftUI `ForEach` while the numbered-unit summary is being rendered.
- `KioskUnitChips` is shared by pickup and return after the first numbered battery unit is scanned. Its `ViewThatFits` candidates both defer the same main-actor-inherited `ForEach` content closure.
- The other kiosk `ViewThatFits` call sites do not embed this dynamic reusable content closure and are outside the crash stack, so this correction stays scoped to `KioskUnitChips`.
- No scanner transport, API, custody state, or completion behavior changes. Exact scanned unit tags remain visible.

### Planned correction and proof

- [x] Replace the deferred `ViewThatFits` / `ForEach` chip builder with one wrapping unit-tag summary.
- [x] Add a source-contract regression that bans the async-renderer crash shape from `KioskUnitChips` while preserving pickup and return wiring.
- [x] Run focused Vitest coverage, iOS drift/gap/project checks, the dedicated kiosk Xcode verification, and `git diff --check`. Docs verification is blocked by unrelated dirty codemaps already present in the worktree.
- [ ] **Hardware-gated.** Re-run numbered-battery pickup and return on the managed M2 iPad Air. Source/build proof does not replace that device confirmation. The kiosk XCTest suite passed on simulator 2026-08-20 (6 tests), which covers the model layer but not the physical scanner.

### Verification evidence

- `npx vitest run tests/ios-kiosk-numbered-battery-rendering.test.ts tests/ios-kiosk-scanner-focus.test.ts tests/ios-kiosk-reservation-pickup-contract.test.ts tests/kiosk-checkin-routes.test.ts` - 4 files, 21 tests passed.
- `npm run ios:project:check` - XcodeGen output matches the checked-in project.
- `npm run drift:ios` - no anti-patterns across 85 Swift files.
- `npm run audit:ios:gaps` - 54/54 audit-worthy surfaces covered.
- `npm run ios:xcode:verify:kiosk` - simulator build, kiosk XCTest suite, and generic iOS build passed. The existing `UIRequiresFullScreen` iOS 26 deprecation warning remains.
- `git diff --check` - passed.
- `npm run verify:docs` - blocked by pre-existing drift in `docs/CODEMAPS/architecture.md` and `docs/CODEMAPS/areas.md`. Codemap generation was not run because both files contain unrelated user work.

## Stop recommendation

Do not change API or custody logic for this crash. The source/build correction is complete. Stop after replaying numbered-battery pickup and return on the managed M2 iPad Air and confirming no new crash report is produced.

## 2026-08-26 booking-detail keyboard-hint follow-up

### Goal and diagnosis

- [x] Show the existing double-trigger recovery popup when an active-checkout title field has focus and the paired HID scanner suppresses the iPad software keyboard.
- [x] Keep the popup hidden whenever a real software keyboard appears or the field loses focus.
- [x] Preserve scanner focus ownership, scan-add behavior, API contracts, custody behavior, and the unrelated availability work already present in the checkout source.

`KioskKeyboardHint` previously required both a focused field and `KioskScannerCoordinator.hardwareConnected`. The latter is derived only from `GCKeyboard`, but the reported scanner is already suppressing the software keyboard without satisfying that signal. The missing software keyboard after a focused-field grace period is the direct observable condition this recovery UI exists to explain; gating that condition on a second, incomplete hardware signal prevented the popup from appearing on the booking-detail sheet.

### Stop conditions

- Stop if the booking-detail field is not reporting `titleFocused`, if a real software-keyboard notification is present, or if the popup is mounted behind the sheet rather than inside it.
- Do not change hidden HID focus acquisition, scanner ownership, active-checkout mutations, or kiosk API behavior for this presentation defect.

### Verification

- [x] Focused source-contract coverage for the keyboard-hint predicate and booking-detail sheet mount: 9 focused scanner tests pass.
- [x] `npm run ios:project:check` passes. `npm run drift:ios` reaches one unrelated pre-existing `SettingsView.swift` raw `.red` literal and remains open outside this slice.
- [x] `WisconsinKiosk` generic Simulator build and the shared `Wisconsin` iPhone 16 Pro Simulator build pass with cached packages.
- [x] `git diff --check`, docs verification, and final scoped diff review pass.
- [ ] Physical managed-iPad confirmation with the affected HID scanner; source/build proof does not replace this acceptance gate.

The managed M2 iPad Air and iPad Pro were unavailable to Xcode on 2026-08-26. The existing `keyboard-tip` fixture hard-codes the popup visible, so it cannot produce an honest affected-state before/after for this regression; visual/device acceptance remains open rather than using a misleading capture.
