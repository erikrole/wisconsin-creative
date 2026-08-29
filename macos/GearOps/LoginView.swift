import SwiftUI

struct GearOpsLoginView: View {
    let model: GearOpsModel

    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var step: LoginStep = .identity
    @State private var identityError: String?
    @FocusState private var focusedField: Field?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum LoginStep: Hashable {
        case identity
        case password
    }

    private enum Field: Hashable {
        case email
        case password
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var authBusy: Bool {
        model.isSigningIn || model.isSigningOut
    }

    private var canContinue: Bool {
        trimmedEmail.contains("@") && !authBusy
    }

    private var canSubmit: Bool {
        canContinue && !password.isEmpty
    }

    private var errorMessage: String? {
        step == .identity ? (identityError ?? model.statusMessage) : model.statusMessage
    }

    var body: some View {
        ZStack {
            BrandSplashScene()

            VStack(spacing: 0) {
                BrandSplashLockup(subtitle: "Sign in to your account")
                    .padding(.bottom, 18)

                BrandLoginCard {
                    VStack(alignment: .leading, spacing: 12) {
                        if step == .identity {
                            identityFields
                        } else {
                            passwordFields
                        }

                        if let errorMessage {
                            errorBanner(errorMessage)
                        }

                        primaryButton
                    }
                }

                footer
                    .padding(.top, 14)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
        }
        .frame(width: GearOpsLayout.popoverWidth)
        .onAppear { focusedField = .email }
        .onChange(of: step) { _, newStep in
            focusedField = newStep == .identity ? .email : .password
        }
        .onDisappear {
            // Menu-bar content can be torn down whenever the popover closes.
            // Never retain a password or a revealed-password state across that
            // boundary, even if authentication was interrupted.
            password = ""
            showPassword = false
            focusedField = nil
        }
    }

    // The web and iOS logins split identity from password so a returning user
    // confirms the account before typing a secret. This app deliberately does
    // not call the discovery route to do it: enrollment is the only Neon-backed
    // request the companion is allowed to make.
    private var identityFields: some View {
        VStack(alignment: .leading, spacing: 5) {
            fieldLabel("Email")
            TextField("you@wisc.edu", text: $email)
                .textContentType(.username)
                .textFieldStyle(.plain)
                .modifier(BrandFieldChrome(isFocused: focusedField == .email))
                .focused($focusedField, equals: .email)
                .disabled(authBusy)
                .onSubmit(advance)
        }
    }

    private var passwordFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(trimmedEmail)
                    .font(.callout)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                Button("Change", action: changeEmail)
                    .buttonStyle(.plain)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(BrandPalette.accent)
                    .disabled(authBusy)
                    .accessibilityHint("Return to the email step")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color.black.opacity(0.05), in: .rect(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 5) {
                fieldLabel("Password")
                HStack(spacing: 6) {
                    Group {
                        if showPassword {
                            TextField("Enter your password", text: $password)
                        } else {
                            SecureField("Enter your password", text: $password)
                        }
                    }
                    .textContentType(.password)
                    .textFieldStyle(.plain)
                    .focused($focusedField, equals: .password)
                    .onSubmit(submit)

                    Button {
                        showPassword.toggle()
                        focusedField = .password
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
        Button(action: performPrimaryAction) {
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

    private func performPrimaryAction() {
        if step == .identity {
            advance()
        } else {
            submit()
        }
    }

    private var primaryEnabled: Bool {
        step == .identity ? canContinue : canSubmit
    }

    private var primaryTitle: String {
        if model.isSigningOut { return "Signing out…" }
        if model.isSigningIn { return "Signing in…" }
        return step == .identity ? "Continue" : "Sign in"
    }

    private var footer: some View {
        HStack {
            Button("Open Wisconsin Creative") { model.openDashboard() }
            Spacer()
            Button("Quit") { model.quit() }
                .keyboardShortcut("q", modifiers: .command)
        }
        .buttonStyle(.plain)
        .font(.footnote)
        .foregroundStyle(.white.opacity(0.7))
    }

    private func advance() {
        guard canContinue else { return }
        identityError = nil
        model.clearStatusMessage()
        setStep(.password)
    }

    private func changeEmail() {
        guard !authBusy else { return }
        password = ""
        showPassword = false
        identityError = nil
        model.clearStatusMessage()
        setStep(.identity)
    }

    private func setStep(_ newStep: LoginStep) {
        if reduceMotion {
            step = newStep
        } else {
            withAnimation(.easeInOut(duration: 0.2)) { step = newStep }
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focusedField = nil
        let submittedEmail = trimmedEmail
        let submittedPassword = password
        password = ""
        showPassword = false
        Task {
            await model.signIn(email: submittedEmail, password: submittedPassword)
            if model.user == nil {
                focusedField = .password
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
