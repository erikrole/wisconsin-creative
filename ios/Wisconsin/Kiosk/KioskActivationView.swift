import SwiftUI
import UIKit

struct KioskActivationView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var code = ""
    @State private var error: String?
    @State private var isLoading = false
    /// True once the operator has explicitly asked for the software keyboard.
    @State private var wasKeyboardChosen = false
    @FocusState private var isCodeFieldFocused: Bool

    var body: some View {
        GeometryReader { proxy in
            // No base fill here — the shell's KioskBackdrop shows through.
            activationLayout(isCompact: proxy.size.width < KioskLayout.compactBreakpoint || dynamicTypeSize.isAccessibilitySize)
                .kioskScreenPadding()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // No auto-focus, and no focus-on-tap.
        //
        // Focusing the hidden field raises the software keyboard, and during a
        // first activation there is usually no scanner paired yet to suppress
        // it — so the screen opened by covering its own numpad and pushing the
        // code slots off the top edge. The numpad exists precisely so the
        // keyboard is not needed; the "Keyboard" button is there for anyone who
        // wants it, and a hardware scanner types into the field regardless of
        // whether SwiftUI thinks it is focused.
        .onChange(of: isLoading) { wasLoading, loading in
            // Only restore focus after a failed attempt if the operator had
            // chosen the keyboard in the first place.
            if wasLoading, !loading, wasKeyboardChosen { focusCodeField() }
        }
        .overlay(alignment: .center) {
            Group {
                if isLoading {
                    loadingScrim
                        .transition(.opacity)
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: isLoading)
    }

    @ViewBuilder
    private func activationLayout(isCompact: Bool) -> some View {
        if isCompact {
            ScrollView {
                VStack(spacing: 24) {
                    heroPanel
                    activationCard
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        } else {
            HStack(spacing: 42) {
                heroPanel
                    .frame(maxWidth: .infinity, alignment: .leading)
                activationCard
                    .frame(width: KioskLayout.activationCardWidth)
            }
        }
    }

    private var heroPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            KioskSectionIcon(systemImage: "barcode.viewfinder", size: 72)
            VStack(alignment: .leading, spacing: 8) {
                Text("WISCONSIN ATHLETICS")
                    .font(KioskType.overline)
                    .tracking(1.6)
                    .foregroundStyle(KioskText.muted)
                Text("Gear Room Kiosk")
                    .font(.kioskHeroTitle())
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
            }
            Text("Activate this iPad")
                .font(KioskType.screenTitle)
                .foregroundStyle(KioskText.primary)
            Text("Enter the 6-digit kiosk code.")
                .font(KioskType.body)
                .foregroundStyle(KioskText.secondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var activationCard: some View {
        VStack(spacing: 20) {
            codeEntryField
            codeSlots
            pasteAndFocusControls

            if let error {
                Text(error)
                    .foregroundStyle(KioskStatus.problem)
                    .font(KioskType.rowTitle)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
                    .accessibilityAddTraits(.updatesFrequently)
            }

            KioskNumPad(code: $code, onComplete: activate)
                .disabled(isLoading)
        }
        .padding(24)
        .kioskCard(KioskSurface.cardRaised, radius: KioskRadius.hero, stroke: KioskStroke.strong)
        .shadow(color: .black.opacity(0.35), radius: 24, y: 16)
    }

    private var codeEntryField: some View {
        TextField("Activation code", text: codeBinding)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .submitLabel(.done)
            .focused($isCodeFieldFocused)
            .onSubmit { activate() }
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .accessibilityHidden(true)
            .disabled(isLoading)
    }

    private var codeSlots: some View {
        HStack(spacing: 10) {
            let digits = Array(code)
            ForEach(0..<6, id: \.self) { i in
                RoundedRectangle(cornerRadius: KioskRadius.md)
                    .fill(KioskSurface.sunken)
                    .overlay {
                        RoundedRectangle(cornerRadius: KioskRadius.md)
                            .stroke(i < code.count ? Color.kioskRed : KioskStroke.strong, lineWidth: 2)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 70)
                    .overlay {
                        if i < digits.count {
                            Text(String(digits[i]))
                                .font(.system(size: 30, weight: .bold, design: .monospaced))
                                .foregroundStyle(KioskText.primary)
                                .transition(.opacity)
                        }
                    }
                    // Red underline marks the slot the next digit lands in.
                    .overlay(alignment: .bottom) {
                        if i == code.count, !isLoading {
                            Capsule()
                                .fill(Color.kioskRed)
                                .frame(width: 22, height: 3)
                                .padding(.bottom, 8)
                        }
                    }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(code.isEmpty
            ? "Activation code, 6 digits required"
            : "Activation code, \(code.count) of 6 digits entered"
        )
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.15), value: code)
    }

    private var pasteAndFocusControls: some View {
        HStack(spacing: 12) {
            Button {
                pasteFromClipboard()
            } label: {
                Label("Paste Code", systemImage: "doc.on.clipboard")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(KioskActivationActionButtonStyle(tint: KioskSurface.cardSelected))
            .disabled(isLoading)

            Button {
                wasKeyboardChosen = true
                focusCodeField()
            } label: {
                Label("Keyboard", systemImage: "keyboard")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(KioskActivationActionButtonStyle(tint: Color.kioskRed.opacity(0.82)))
            .disabled(isLoading)
        }
    }

    private var loadingScrim: some View {
        ZStack {
            KioskScrim.control.ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView()
                    .scaleEffect(1.4)
                    .tint(KioskText.primary)
                Text("Activating…")
                    .font(KioskType.rowDetail)
                    .foregroundStyle(KioskText.primary)
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 24)
            .background(KioskSurface.modal, in: RoundedRectangle(cornerRadius: KioskRadius.xl))
            .shadow(radius: 24)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Activating kiosk")
        }
    }

    private var codeBinding: Binding<String> {
        Binding(
            get: { code },
            set: { updateCode(from: $0, submitWhenComplete: true) }
        )
    }

    /// Extract the longest run of digits from any pasted strings, truncate to
    /// 6, and either fill the field or auto-submit (when exactly 6 digits land).
    /// Tolerates pastes like "Code: 123456" or "123-456" and extracts 123456.
    private func pasteFromClipboard() {
        guard let raw = UIPasteboard.general.string else {
            surfacePasteError("Clipboard does not contain an activation code.")
            return
        }
        let digits = raw.unicodeScalars.compactMap { $0.value >= 48 && $0.value <= 57 ? Character(String($0)) : nil }
        let trimmed = String(digits.prefix(6))
        guard !trimmed.isEmpty else {
            surfacePasteError("Clipboard does not contain an activation code.")
            return
        }
        updateCode(from: trimmed, submitWhenComplete: false)
        if trimmed.count == 6 {
            activate()
        } else {
            surfacePasteError("Clipboard only has \(trimmed.count) digit\(trimmed.count == 1 ? "" : "s").")
        }
    }

    private func updateCode(from raw: String, submitWhenComplete: Bool) {
        let digits = raw.unicodeScalars.compactMap { $0.value >= 48 && $0.value <= 57 ? Character(String($0)) : nil }
        let next = String(digits.prefix(6))
        guard next != code else { return }
        code = next
        error = nil
        if submitWhenComplete, next.count == 6 {
            activate()
        }
    }

    private func activate() {
        guard code.count == 6, !isLoading else { return }
        isLoading = true
        error = nil
        Task {
            do {
                let resp = try await KioskAPI.shared.kioskActivate(code: code)
                Haptics.success()
                store.activate(response: resp)
            } catch APIError.serverError(let msg) {
                surfaceError(msg)
            } catch APIError.unauthorized {
                surfaceError("Invalid activation code.")
            } catch {
                surfaceError("Activation failed. Check your code and try again.")
            }
            isLoading = false
        }
    }

    private func focusCodeField() {
        DispatchQueue.main.async {
            isCodeFieldFocused = true
        }
    }

    private func surfacePasteError(_ message: String) {
        error = message
        Haptics.warning()
        UIAccessibility.post(notification: .announcement, argument: message)
        focusCodeField()
    }

    /// Sets the error state, clears the code, and posts a VoiceOver
    /// announcement so blind users hear the failure without manual focus
    /// navigation. SwiftUI has no `accessibilityLiveRegion` equivalent;
    /// `UIAccessibility.post(.announcement, ...)` is the canonical path.
    private func surfaceError(_ message: String) {
        error = message
        code = ""
        Haptics.error()
        UIAccessibility.post(notification: .announcement, argument: message)
        focusCodeField()
    }
}

private struct KioskActivationActionButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(KioskType.rowTitle)
            .foregroundStyle(KioskText.primary)
            .padding(.vertical, 13)
            .padding(.horizontal, 14)
            .background(tint, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.lg)
                    .stroke(KioskStroke.standard, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.78 : 1)
    }
}

// MARK: - Numpad

private struct KioskNumPad: View {
    @Binding var code: String
    let onComplete: () -> Void

    private let layout: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["⌫", "0", "✓"],
    ]

    var body: some View {
        VStack(spacing: 12) {
            ForEach(layout, id: \.self) { row in
                HStack(spacing: 12) {
                    ForEach(row, id: \.self) { key in
                        KioskNumPadButton(
                            key: key,
                            isEnabled: isEnabled(for: key),
                            action: { handleKey(key) }
                        )
                    }
                }
            }
        }
    }

    private func isEnabled(for key: String) -> Bool {
        switch key {
        case "✓": return code.count == 6
        case "⌫": return !code.isEmpty
        default:  return code.count < 6
        }
    }

    private func handleKey(_ key: String) {
        switch key {
        case "⌫":
            if !code.isEmpty {
                code.removeLast()
            }
        case "✓":
            if code.count == 6 {
                onComplete()
            }
        default:
            if code.count < 6 {
                code.append(key)
            }
            if code.count == 6 {
                onComplete()
            }
        }
    }
}

private struct KioskNumPadButton: View {
    let key: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(key)
                .font(KioskType.screenTitle)
                .foregroundStyle(KioskText.primary)
                .frame(maxWidth: .infinity)
                .frame(height: 64)
                .kioskCard(background, radius: KioskRadius.md, stroke: KioskStroke.hairline)
        }
        .buttonStyle(KioskPressStyle())
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1.0 : 0.35)
        .accessibilityLabel(accessibilityLabel)
    }

    private var background: Color {
        switch key {
        case "✓": return Color.kioskRed
        case "⌫": return KioskSurface.cardSelected
        default:  return KioskSurface.cardRaised
        }
    }

    private var accessibilityLabel: String {
        switch key {
        case "⌫": return "Delete last digit"
        case "✓": return "Submit code"
        default:  return key
        }
    }
}
