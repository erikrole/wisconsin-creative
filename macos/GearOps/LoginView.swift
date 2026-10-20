import AppKit
import SwiftUI

struct GearOpsLoginView: View {
    let model: GearOpsModel
    /// The menu bar extra closes as soon as another app takes focus, which is
    /// what a password manager's item picker does. Only there does the form
    /// offer to move into the Status window, which stays open.
    var isMenuBarExtra = true

    @Environment(\.openWindow) private var openWindow
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var fields = CredentialFieldPair()
    @State private var focusedField: CredentialField?

    // Read the controls, not only the bindings: AutoFill can fill the field
    // that is not being edited without sending it a change notification.
    private var trimmedEmail: String {
        let value = fields.email.stringValue.isEmpty ? email : fields.email.stringValue
        return value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var currentPassword: String {
        let value = fields.field(for: .password).stringValue
        return value.isEmpty ? password : value
    }

    private var authBusy: Bool {
        model.isSigningIn || model.isSigningOut
    }

    private var canSubmit: Bool {
        trimmedEmail.contains("@") && !currentPassword.isEmpty && !authBusy
    }

    var body: some View {
        ZStack {
            BrandSplashScene()

            VStack(spacing: 0) {
                BrandSplashLockup(subtitle: "Sign in to your account")
                    .padding(.bottom, 18)

                BrandLoginCard {
                    VStack(alignment: .leading, spacing: 12) {
                        credentialFields

                        if let errorMessage = model.statusMessage {
                            errorBanner(errorMessage)
                        }

                        primaryButton

                        if isMenuBarExtra {
                            windowFallback
                        }
                    }
                }

                footer
                    .padding(.top, 14)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
        }
        .frame(width: GearOpsLayout.popoverWidth)
        .onAppear { fields.focus(.email) }
        .onDisappear {
            // Menu-bar content can be torn down whenever the popover closes.
            // Never retain a password or a revealed-password state across that
            // boundary, even if authentication was interrupted.
            password = ""
            showPassword = false
            fields.clearPassword()
            focusedField = nil
        }
    }

    // macOS AutoFill (Apple Passwords or 1Password) fills the username and
    // password together only when it finds them as a real AppKit pair: an
    // NSTextField with the username content type whose next key view is an
    // NSSecureTextField with the password content type. SwiftUI's fields
    // were each filled on their own, so both are AppKit controls here.
    private var credentialFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                fieldLabel("Email")
                CredentialFieldView(
                    pair: fields,
                    field: .email,
                    text: $email,
                    focusedField: $focusedField,
                    isEnabled: !authBusy,
                    // macOS AutoFill fills only the field it was picked in.
                    // Move on so its password suggestion opens right away.
                    onBulkFill: {
                        if currentPassword.isEmpty { fields.focus(.password) }
                    },
                    onSubmit: { fields.focus(.password) }
                )
                .modifier(BrandFieldChrome(isFocused: focusedField == .email))
            }

            VStack(alignment: .leading, spacing: 5) {
                fieldLabel("Password")
                HStack(spacing: 6) {
                    CredentialFieldView(
                        pair: fields,
                        field: .password,
                        text: $password,
                        focusedField: $focusedField,
                        isEnabled: !authBusy,
                        revealsPassword: showPassword,
                        // A picked login is complete; sign in without a
                        // third step.
                        onBulkFill: {
                            // After the field's own change handling finishes.
                            if trimmedEmail.contains("@") {
                                DispatchQueue.main.async { submit() }
                            }
                        },
                        onSubmit: submit
                    )

                    Button {
                        showPassword.toggle()
                        fields.focus(.password)
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(showPassword ? "Hide password" : "Show password")
                    .accessibilityLabel(showPassword ? "Hide password" : "Show password")
                }
                .modifier(BrandFieldChrome(isFocused: focusedField == .password))
                .disabled(authBusy)
            }
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(BrandPalette.accent)
            Text(message)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(BrandPalette.accent.opacity(0.10), in: .rect(cornerRadius: 8))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sign-in problem: \(message)")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var primaryButton: some View {
        Button(action: submit) {
            primaryButtonLabel
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.defaultAction)
        .disabled(!primaryEnabled)
    }

    private var primaryButtonLabel: some View {
        let fill = BrandPalette.accent.opacity(primaryEnabled ? 1 : 0.4)
        return HStack(spacing: 6) {
            Spacer()
            if authBusy {
                ProgressView().controlSize(.small)
            }
            Text(primaryTitle).font(.body.weight(.semibold))
            Spacer()
        }
        .padding(.vertical, 7)
        .foregroundStyle(.white)
        .background(fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(.rect)
    }

    private var windowFallback: some View {
        Button {
            NSApplication.shared.activate()
            openWindow(id: GearOpsWindow.status)
        } label: {
            Text("Using a password manager? Sign in in a window")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help("Opens sign-in in a window that stays open while your password manager fills it")
    }

    private var primaryEnabled: Bool {
        canSubmit
    }

    private var primaryTitle: String {
        if model.isSigningOut { return "Signing out…" }
        if model.isSigningIn { return "Signing in…" }
        return "Sign in"
    }

    private var footer: some View {
        HStack {
            Button("Open Wisconsin Creative") { model.openDashboard() }
            Button("Settings…") {
                NSApplication.shared.activate()
                openWindow(id: GearOpsWindow.settings)
            }
            Spacer()
            Button("Quit") { model.quit() }
                .keyboardShortcut("q", modifiers: .command)
        }
        .buttonStyle(.plain)
        .font(.footnote)
        .foregroundStyle(.white.opacity(0.7))
    }

    private func submit() {
        guard canSubmit else { return }
        let submittedEmail = trimmedEmail
        let submittedPassword = currentPassword
        password = ""
        showPassword = false
        fields.clearPassword()
        Task {
            await model.signIn(email: submittedEmail, password: submittedPassword)
            if model.user == nil {
                fields.focus(.password)
            }
        }
    }
}

/// Solid white wells with a crimson focus ring, matching the web `.login-field`
/// override. The app's default control chrome reads as gray-on-gray here.
private struct BrandFieldChrome: ViewModifier {
    let isFocused: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.white, in: .rect(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(
                        isFocused ? BrandPalette.accent : Color.black.opacity(0.16),
                        lineWidth: isFocused ? 2 : 1
                    )
            }
            .shadow(
                color: isFocused ? BrandPalette.accent.opacity(0.18) : .clear,
                radius: 3
            )
    }
}

enum CredentialField: Hashable {
    case email
    case password
}

/// The AppKit controls behind the sign-in form, owned together so the
/// username field's next key view is the password field AutoFill pairs it with.
@MainActor
final class CredentialFieldPair {
    let email: NSTextField
    let securePassword: NSSecureTextField
    let plainPassword: NSTextField

    init() {
        email = NSTextField()
        securePassword = NSSecureTextField()
        plainPassword = NSTextField()

        Self.style(email, placeholder: "you@wisc.edu")
        Self.style(securePassword, placeholder: "Enter your password")
        Self.style(plainPassword, placeholder: "Enter your password")
        email.contentType = .username
        securePassword.contentType = .password
        plainPassword.contentType = .password
        plainPassword.isHidden = true
        email.nextKeyView = securePassword
    }

    func field(for kind: CredentialField) -> NSTextField {
        switch kind {
        case .email: email
        case .password: securePassword.isHidden ? plainPassword : securePassword
        }
    }

    func reveal(_ revealed: Bool) {
        guard plainPassword.isHidden == revealed else { return }
        plainPassword.isHidden = !revealed
        securePassword.isHidden = revealed
        email.nextKeyView = revealed ? plainPassword : securePassword
    }

    func focus(_ kind: CredentialField) {
        // The window may not exist yet on first appearance.
        DispatchQueue.main.async { [self] in
            let target = field(for: kind)
            target.window?.makeFirstResponder(target)
        }
    }

    func clearPassword() {
        securePassword.stringValue = ""
        plainPassword.stringValue = ""
        reveal(false)
    }

    private static func style(_ field: NSTextField, placeholder: String) {
        field.placeholderString = placeholder
        field.isBordered = false
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: NSFont.systemFontSize)
        field.textColor = .black
        field.usesSingleLineMode = true
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    }
}

/// Hosts one field of a `CredentialFieldPair`. The password view holds both
/// the secure and the revealed control and shows one at a time.
private struct CredentialFieldView: NSViewRepresentable {
    let pair: CredentialFieldPair
    let field: CredentialField
    @Binding var text: String
    @Binding var focusedField: CredentialField?
    var isEnabled: Bool
    var revealsPassword = false
    /// A change that turned an empty field into a whole value at once: an
    /// AutoFill pick or a paste, never typing.
    var onBulkFill: () -> Void = {}
    var onSubmit: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        let controls: [NSTextField] = switch field {
        case .email: [pair.email]
        case .password: [pair.securePassword, pair.plainPassword]
        }
        for control in controls {
            control.delegate = context.coordinator
            control.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(control)
            NSLayoutConstraint.activate([
                control.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                control.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                control.centerYAnchor.constraint(equalTo: container.centerYAnchor),
                container.heightAnchor.constraint(greaterThanOrEqualTo: control.heightAnchor),
            ])
        }
        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.parent = self
        if field == .password {
            let wasRevealed = !pair.plainPassword.isHidden
            if wasRevealed != revealsPassword {
                // Carry the typed or filled value across the swap.
                let current = pair.field(for: .password).stringValue
                pair.reveal(revealsPassword)
                pair.field(for: .password).stringValue = current
            }
        }
        // Values flow only from the controls to SwiftUI. Pushing state back
        // here could overwrite a value AutoFill set without a notification.
        pair.email.isEnabled = isEnabled
        pair.securePassword.isEnabled = isEnabled
        pair.plainPassword.isEnabled = isEnabled
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 200, height: pair.email.intrinsicContentSize.height)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: CredentialFieldView

        init(_ parent: CredentialFieldView) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            guard let control = notification.object as? NSTextField else { return }
            let wasEmpty = parent.text.isEmpty
            parent.text = control.stringValue
            if wasEmpty, control.stringValue.count > 1 { parent.onBulkFill() }
        }

        func controlTextDidBeginEditing(_ notification: Notification) {
            parent.focusedField = parent.field
        }

        func controlTextDidEndEditing(_ notification: Notification) {
            guard let control = notification.object as? NSTextField else { return }
            // AutoFill can set the value without a change notification.
            parent.text = control.stringValue
            if parent.focusedField == parent.field { parent.focusedField = nil }
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard selector == #selector(NSResponder.insertNewline(_:)) else { return false }
            parent.text = (control as? NSTextField)?.stringValue ?? parent.text
            parent.onSubmit()
            return true
        }
    }
}
