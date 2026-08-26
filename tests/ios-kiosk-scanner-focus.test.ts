import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS kiosk scanner focus", () => {
  it("keeps scanner capture gated while native checkout inputs own focus", () => {
    const scanner = source("ios/Wisconsin/Shared/HIDScannerField.swift");
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const shell = source("ios/Wisconsin/Kiosk/KioskShellView.swift");

    expect(scanner).toContain("let isEnabled: Bool");
    expect(scanner).toContain("guard isEnabled else {");
    expect(scanner).toContain("static func dismantleUIView");
    expect(scanner).toContain("coordinator.setEnabled(false)");
    expect(scanner).toContain("enum HIDScannerFocusGate");
    expect(scanner).toContain("static func suppressScannerFocus");
    expect(scanner).toContain("TimeInterval? = nil");
    expect(scanner).toContain("duration ?? defaultSuppressionDuration");
    expect(scanner).toContain("static func allowScannerFocusNow()");
    expect(scanner).toContain("HIDScannerFocusGate.canAcquireScannerFocus");

    // Ownership gate: the sink can never take first responder while a visible
    // UIKit text input is editing — not just during a fixed time window.
    expect(scanner).toContain("activeVisibleEditors: [ObjectIdentifier: WeakVisibleEditor]");
    expect(scanner).toContain("tracked.editor?.isFirstResponder == true");
    expect(scanner).toContain("return activeVisibleEditors.isEmpty && Date() >= suppressedUntil");
    expect(scanner).toContain("static func installEditingObserversIfNeeded()");
    expect(scanner).toContain("UITextField.textDidBeginEditingNotification");
    expect(scanner).toContain("UITextView.textDidBeginEditingNotification");
    expect(scanner).toContain("!(editor is HIDTextField)");
    expect(scanner).toContain("HIDScannerFocusGate.installEditingObserversIfNeeded()");

    // Self-healing acquisition: blocked attempts retry until the keyboard is
    // released, so the scanner is never left dead after typed-entry sheets.
    expect(scanner).toContain("func ensureScannerFocus(_ textField: UITextField)");
    expect(scanner).toContain("private func scheduleFocusRetry(_ textField: UITextField)");
    expect(scanner).toContain("pendingFocusRetry?.cancel()");
    expect(scanner).toContain("if textField.becomeFirstResponder(), textField.isFirstResponder");
    expect(scanner).toContain("else {\n                    scheduleFocusRetry(textField)");
    expect(scanner).toContain("private func reportFocus(_ focused: Bool)");

    // Plain @State, never @FocusState: the UIKit-backed booking-name field is
    // invisible to SwiftUI's focus system, so a @FocusState value for it gets
    // reset to nil on the next focus pass and the stale binding force-resigns
    // the keyboard the instant the field is tapped.
    expect(checkout).toContain("@State private var focusedCheckoutField: KioskCheckoutFocusedField? = nil");
    expect(checkout).not.toContain("@FocusState private var focusedCheckoutField");
    expect(checkout).not.toContain("FocusState<KioskCheckoutFocusedField?>.Binding");
    expect(checkout).toContain("@State private var scannerCaptureEnabled = true");
    expect(checkout).toContain("@State private var scannerHasFocus = false");
    expect(checkout).toContain("private var shouldListenForHIDScans: Bool");
    expect(checkout).toContain("scannerCaptureEnabled && focusedCheckoutField == nil");
    expect(checkout).toContain("focusedCheckoutField == nil");
    expect(checkout).toContain("if scannerCaptureEnabled {");
    expect(checkout).toContain("isEnabled: shouldListenForHIDScans");
    expect(checkout).toContain("onFocusChange: { scannerHasFocus = $0 }");
    // Checkout's scan step uses the shared KioskScanStage now; pickup and
    // return still use the badge directly. Both must report the hidden sink's
    // REAL first-responder state, never merely that the field is mounted.
    expect(checkout).toContain("KioskScanStage(");
    expect(checkout).toContain("isReady: scannerHasFocus");
    expect(checkout).toContain("isHardwareConnected: store.scanner.hardwareConnected");
    expect(checkout).toContain("KioskNativeTextField(");
    expect(checkout).toContain("focusedField.wrappedValue == .customPurpose");
    expect(checkout).toContain("HIDScannerFocusGate.allowScannerFocusNow()");
    expect(checkout).toContain("UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder)");
    expect(checkout).toContain("DispatchQueue.main.async {\n            HIDScannerFocusGate.allowScannerFocusNow()\n            scannerCaptureEnabled = true");
    expect(checkout).toContain("scannerCaptureEnabled = true");
    expect(checkout).toContain("scannerCaptureEnabled = false");
    expect(checkout).not.toContain("private struct KioskPurposeKeyboard: View");

    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const kioskReturn = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    for (const flow of [pickup, kioskReturn]) {
      expect(flow).toContain("@State private var scannerHasFocus = false");
      expect(flow).toContain("onFocusChange: { scannerHasFocus = $0 }");
      expect(flow).toContain("KioskScannerReadinessBadge(");
      expect(flow).toContain("isReady: scannerHasFocus");
    }
    expect(components).toContain("struct KioskScannerReadinessBadge: View");
    expect(components).toContain('guard isReady else { return "Scanner reconnecting" }');
    expect(components).toContain('guard let lastScanAt else { return "Scanner ready" }');

    // The scanner target itself stays geometrically stable on entrance. The
    // readiness badge owns reconnecting orange, avoiding an orange flash and
    // the iPadOS PhaseAnimator bracket translation seen on hardware.
    expect(components).not.toContain("shape.phaseAnimator");
    expect(checkout).toContain("case nil: return Color.white.opacity(0.3)");
    expect(checkout).not.toContain("case nil: return scannerHasFocus");

    // Existing-checkout equipment editing owns a separate scanner phase. It
    // submits HID scans directly and yields whenever the visible title field,
    // a custody mutation, or a removal confirmation owns interaction.
    const detailSheet = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");
    expect(detailSheet).toContain("HIDScannerField(isEnabled: shouldListenForItemScans)");
    expect(detailSheet).toContain("scannerCaptureEnabled");
    expect(detailSheet).toContain("!titleFocused");
    expect(detailSheet).toContain("!isMutating");
    expect(detailSheet).toContain("pendingRemoval == nil");
    expect(detailSheet).toContain("HIDScannerFocusGate.allowScannerFocusNow()");
    expect(detailSheet).toContain(".onChange(of: titleFocused)");
    expect(detailSheet).toContain("if !isFocused {");
    expect(detailSheet).toContain("armScannerCapture()");
    expect(detailSheet).toContain("Task { await addItem(scanValue: value) }");
    expect(detailSheet).not.toContain('placeholder: "Scan or type item"');

    expect(shell).toContain("KioskActivityMonitor { store.resetInactivity() }");
    expect(shell).toContain("private struct KioskActivityMonitor: UIViewRepresentable");
    expect(shell).toContain("recognizer.cancelsTouchesInView = false");
    expect(shell).toContain("shouldRecognizeSimultaneouslyWith otherGestureRecognizer");
    expect(shell).not.toContain(".simultaneousGesture(TapGesture");
    expect(shell).not.toContain("DragGesture(minimumDistance");
  });

  it("never bridges UIKit-backed text fields through @FocusState anywhere in the kiosk", () => {
    // Class-wide guard for the 2026-07-06 keyboard-death bug: a UIKit-backed
    // KioskNativeTextField is invisible to SwiftUI's focus system, so any
    // @FocusState value written for it gets reset to nil on the next focus
    // pass and the stale binding force-resigns the keyboard on tap.
    const kioskDir = path.join(process.cwd(), "ios/Wisconsin/Kiosk");
    const files = readdirSync(kioskDir).filter((file) => file.endsWith(".swift"));
    for (const file of files) {
      const text = source(path.join("ios/Wisconsin/Kiosk", file));
      if (text.includes("KioskNativeTextField(")) {
        // Declarations only — comments may mention @FocusState to explain the ban.
        expect(text, `${file} mounts KioskNativeTextField and must not declare @FocusState`).not.toMatch(/@FocusState\s+(private\s+)?var/);
        expect(text, `${file} must not type props as FocusState bindings`).not.toContain("FocusState<");
      }
    }
  });

  it("offers the scanner double-press tip when the keyboard never appears", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");
    const sheet = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");

    expect(components).toContain("struct KioskKeyboardHint: View");
    expect(components).toContain("Double-tap trigger to enable keyboard");
    // The missing software keyboard is the authoritative condition. Some HID
    // scanners suppress it without being exposed through GCKeyboard, so the
    // recovery must not depend on the coordinator's best-effort hardware flag.
    expect(components).toContain("isFieldFocused && !keyboardVisible");
    expect(components).not.toContain("isFieldFocused && isScannerConnected");
    // Only a real software keyboard counts — the hardware-keyboard assistant
    // strip posts keyboard notifications too, with a short frame.
    expect(components).toContain("UIResponder.keyboardDidShowNotification");
    expect(components).toContain("UIResponder.keyboardWillHideNotification");
    expect(components).toContain("frame.height > 120");
    // Grace period so a normally-appearing keyboard never flashes the tip.
    expect(components).toContain("try? await Task.sleep(nanoseconds: 750_000_000)");

    // The contract is that the hint tracks the booking-name field's focus.
    // The checkout view reads that predicate in three places now (stroke tint,
    // status line, hint), so it lives in one computed property — assert both
    // halves rather than a single inlined expression.
    expect(checkout).toContain("private var isFieldFocused: Bool { focusedField.wrappedValue == .customPurpose }");

    // The popup is centered and screen-level, so it is mounted per presentation
    // context and costs no layout inside any form. Anchored to the field it
    // either covered the field's own label or pushed the due-back stamp off the
    // bottom of the checkout step.
    const shell = source("ios/Wisconsin/Kiosk/KioskShellView.swift");
    expect(shell).toContain("KioskKeyboardHint(");
    expect(shell).toContain("isFieldFocused: store.scanner.isEditing");
    expect(components).toContain(".allowsHitTesting(false)");
    // A sheet presents above the shell, so it carries its own mount and must
    // report focus for the shell-level gate to be meaningful anywhere else.
    expect(sheet).toContain("KioskKeyboardHint(");
    expect(sheet).toContain("isFieldFocused: titleFocused");
    expect(sheet).toContain("store.scanner.setEditing(isFocused)");
    expect(sheet).not.toContain("isScannerConnected: store.scanner.hardwareConnected");
    // No field-anchored copies left behind.
    expect(checkout).not.toContain("KioskKeyboardHint(");
  });

  it("keeps kiosk native text input on the system keyboard without the assistant bar", () => {
    const nativeField = source("ios/Wisconsin/Kiosk/KioskNativeTextField.swift");
    const scanner = source("ios/Wisconsin/Shared/HIDScannerField.swift");

    expect(nativeField).toContain("struct KioskNativeTextField: UIViewRepresentable");
    expect(nativeField).toContain("field.inputAssistantItem.leadingBarButtonGroups = []");
    expect(nativeField).toContain("field.inputAssistantItem.trailingBarButtonGroups = []");
    expect(nativeField).toContain("field.autocorrectionType = .no");
    expect(nativeField).toContain("field.spellCheckingType = .no");
    expect(nativeField).toContain("HIDScannerFocusGate.suppressScannerFocus()");
    expect(nativeField).toContain("let field = KioskKeyboardTextField()");
    expect(nativeField).toContain("protectKeyboard()");
    expect(nativeField).toContain("field.forceResignFirstResponder()");
    expect(nativeField).toContain("override func resignFirstResponder() -> Bool");
    expect(nativeField).not.toContain("resignIfUnprotected()");
    expect(nativeField).not.toContain("inputView = UIView()");
    expect(nativeField).not.toContain("textField.reloadInputViews()");

    expect(scanner).toContain("field.inputAssistantItem.leadingBarButtonGroups = []");
    expect(scanner).toContain("field.inputAssistantItem.trailingBarButtonGroups = []");
  });

  it("detects whether a Bluetooth HID scanner is actually connected", () => {
    const routing = source("ios/Wisconsin/Kiosk/KioskFlowRouting.swift");
    const shell = source("ios/Wisconsin/Kiosk/KioskShellView.swift");
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");

    // A Bluetooth barcode scanner in HID mode enumerates as a hardware
    // keyboard, so GCKeyboard is the signal iPadOS gives us that the gun is
    // paired and awake. Before this, `connectionState` was a stored property
    // fixed at `.ready` that nothing ever wrote -- the kiosk reported "Scanner
    // ready" with nothing attached.
    expect(routing).toContain("import GameController");
    expect(routing).toContain("case ready, reconnecting, disconnected");
    expect(routing).toContain("var hardwareConnected = false");
    expect(routing).toContain("GCKeyboard.coalesced != nil");
    expect(routing).toContain(".GCKeyboardDidConnect");
    expect(routing).toContain(".GCKeyboardDidDisconnect");
    expect(routing).toContain('case .disconnected: return "No scanner connected"');
    expect(shell).toContain("store.scanner.startHardwareMonitoring()");
    expect(components).toContain("var isHardwareConnected: Bool = true");

    // Hardware state must never gate scan acceptance: the camera fallback and
    // typed entry also route through `receive`, and a scanner that reports
    // itself oddly must not cause a real scan to be dropped.
    expect(routing).toContain("var acceptsScans: Bool { owner != .none && !isEditing }");
  });
});
