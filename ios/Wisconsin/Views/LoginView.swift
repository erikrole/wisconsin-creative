import SwiftUI

struct LoginView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var loginStep: LoginStep = .identity
    @State private var identityError: String?
    @State private var activeAuthMethod: AuthMethod?
    @State private var authDestination: AuthDestination?
    @State private var passkeyAutoFillAttempt = 0
    @FocusState private var focused: Field?
    @AccessibilityFocusState private var accessibilityFocused: Field?

    enum Field { case email, password }

    private enum LoginStep {
        case identity
        case password
    }

    /// Re-arms AutoFill when the step changes and after a deliberate passkey
    /// sheet replaces the armed request.
    private struct PasskeyAutoFillKey: Equatable {
        let step: LoginStep
        let attempt: Int
    }

    private enum AuthMethod {
        case discovery
        case password
        case passkey
    }

    private enum AuthDestination: Identifiable {
        case forgotPassword(email: String)
        case register(email: String)

        var id: String {
            switch self {
            case .forgotPassword:
                "forgotPassword"
            case let .register(email):
                "register-\(email)"
            }
        }
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var canSubmit: Bool {
        !trimmedEmail.isEmpty && !password.isEmpty && !authBusy
    }

    private var canContinue: Bool {
        !trimmedEmail.isEmpty && !authBusy
    }

    private var authBusy: Bool {
        activeAuthMethod != nil || session.isLoading
    }

    private var discoveryLoading: Bool {
        activeAuthMethod == .discovery
    }

    private var passwordLoading: Bool {
        activeAuthMethod == .password
    }

    private var passkeyLoading: Bool {
        activeAuthMethod == .passkey
    }

    private var primaryButtonTitle: String {
        switch loginStep {
        case .identity:
            discoveryLoading ? "Checking…" : "Continue"
        case .password:
            passwordLoading ? "Signing in…" : "Sign in"
        }
    }

    private func advanceToPassword() {
        guard canContinue else { return }
        focused = nil
        session.clearError()
        identityError = nil
        activeAuthMethod = .discovery
        let submittedEmail = trimmedEmail
        Task {
            defer { activeAuthMethod = nil }
            do {
                let result = try await APIClient.shared.discoverAuth(email: submittedEmail)
                guard !Task.isCancelled else { return }
                if result.isOnboarding {
                    authDestination = .register(email: submittedEmail)
                } else {
                    setLoginStep(.password)
                }
            } catch {
                guard !Task.isCancelled else { return }
                identityError = error.localizedDescription
            }
        }
    }

    private func changeEmail() {
        guard !authBusy else { return }
        focused = nil
        password = ""
        showPassword = false
        identityError = nil
        session.clearError()
        setLoginStep(.identity)
    }

    private func setLoginStep(_ step: LoginStep) {
        if reduceMotion {
            loginStep = step
        } else {
            withAnimation(.easeInOut(duration: 0.2)) {
                loginStep = step
            }
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focused = nil
        activeAuthMethod = .password
        Task {
            await session.login(email: trimmedEmail, password: password)
            activeAuthMethod = nil
        }
    }

    private func submitPasskey() {
        guard !authBusy else { return }
        focused = nil
        activeAuthMethod = .passkey
        Task {
            await session.loginWithPasskey()
            activeAuthMethod = nil
            // The sheet withdrew the armed AutoFill request; put it back so the
            // keyboard suggestion still works after a dismissed sheet.
            passkeyAutoFillAttempt += 1
        }
    }

    var body: some View {
        AuthScreen(
            title: "Sign in",
            subtitle: "Gear, schedules, and reservations for Wisconsin Creative."
        ) {
            card
        } footer: {
            footer
        }
        .task(id: PasskeyAutoFillKey(step: loginStep, attempt: passkeyAutoFillAttempt)) {
            // Offers a saved passkey in the QuickType bar over the email field,
            // so signing in does not require finding the passkey button first.
            guard loginStep == .identity else { return }
            await session.armPasskeyAutoFill()
        }
        .onAppear {
            if let notice = session.notice {
                AccessibilityNotification.Announcement(notice).post()
            }
        }
        .onChange(of: session.error) { _, error in
            if let error {
                AccessibilityNotification.Announcement(error).post()
            }
        }
        .onChange(of: loginStep) { _, step in
            focused = step == .identity ? .email : .password
            accessibilityFocused = step == .identity ? .email : .password
            AccessibilityNotification.Announcement(
                step == .identity ? "Enter your email address" : "Enter your password"
            ).post()
        }
        .sheet(item: $authDestination) { destination in
            NavigationStack {
                switch destination {
                case let .forgotPassword(email):
                    NativeForgotPasswordView(initialEmail: email)
                case let .register(email):
                    NativeRegistrationView(initialEmail: email)
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    // The form sits directly on the AuthScreen surface (see AuthDesign.swift).
    private var card: some View {
        VStack(spacing: 16) {
            if let notice = session.notice, identityError == nil, session.error == nil {
                AuthInlineMessage(text: notice, systemImage: "info.circle.fill", tone: .blue)
                    .accessibilityElement(children: .combine)
            }

            if loginStep == .identity {
                identityStep
                    .transition(.opacity)
            } else {
                passwordStep
                    .transition(.opacity)
            }

            // Error
            if let error = identityError ?? session.error {
                AuthInlineMessage(text: error, systemImage: "exclamationmark.circle.fill", tone: .red)
                    .accessibilityLabel("Sign in failed. \(error)")
            }

            // The page's one saturated moment remains stable across both
            // local steps so Continue becomes Sign in without layout churn.
            Button {
                switch loginStep {
                case .identity:
                    advanceToPassword()
                case .password:
                    submit()
                }
            } label: {
                HStack(spacing: 8) {
                    if discoveryLoading || passwordLoading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(AuthPalette.onPrimary)
                            .accessibilityHidden(true)
                    }
                    Text(primaryButtonTitle)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .authButton(.primary)
            .disabled(loginStep == .identity ? !canContinue : !canSubmit)

            if loginStep == .identity {
                HStack(spacing: 12) {
                    Rectangle()
                        .fill(AuthPalette.strokeStandard)
                        .frame(height: 1)
                    Text("or")
                        .font(.caption)
                        .foregroundStyle(AuthPalette.textTertiary)
                    Rectangle()
                        .fill(AuthPalette.strokeStandard)
                        .frame(height: 1)
                }

                Button {
                    submitPasskey()
                } label: {
                    HStack(spacing: 8) {
                        if passkeyLoading {
                            ProgressView()
                                .controlSize(.small)
                                .tint(AuthPalette.textPrimary)
                                .accessibilityHidden(true)
                        } else {
                            Image(systemName: "key.fill")
                                .accessibilityHidden(true)
                        }
                        Text(passkeyLoading ? "Waiting for passkey…" : "Use a passkey")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .authButton(.secondary)
                .disabled(authBusy)
                .accessibilityHint("Choose an account with a saved passkey")
            }
        }
    }

    private var identityStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Email address")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AuthPalette.textPrimary)

            TextField(
                text: $email,
                prompt: Text("you@wisc.edu").foregroundStyle(AuthPalette.textTertiary)
            ) {
                Text("Email address")
            }
            .accessibilityLabel("Email address")
            .foregroundStyle(AuthPalette.textPrimary)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
            .textContentType(.username)
            .autocorrectionDisabled()
            .focused($focused, equals: .email)
            .accessibilityFocused($accessibilityFocused, equals: .email)
            .submitLabel(.continue)
            .onSubmit { advanceToPassword() }
            .onChange(of: email) { session.clearError() }
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(fieldFill(isFocused: focused == .email))

            AuthEmailDomainNote(email: email)
        }
    }

    private var passwordStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Signing in as")
                        .font(.caption)
                        .foregroundStyle(AuthPalette.textTertiary)
                    // The email field belongs to the previous step and is gone
                    // by now. Keeping the address here as a real account field
                    // is what lets AutoFill file the password under it.
                    TextField("Account", text: .constant(trimmedEmail))
                        .textFieldStyle(.plain)
                        .textContentType(.username)
                        .disabled(true)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AuthPalette.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .accessibilityLabel("Signing in as \(trimmedEmail)")
                }

                Spacer(minLength: 8)

                Button("Change") {
                    changeEmail()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(AuthPalette.textPrimary)
                .buttonStyle(.plain)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                .disabled(authBusy)
                .accessibilityHint("Returns to email entry")
            }

            Text("Password")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AuthPalette.textPrimary)

            ZStack(alignment: .trailing) {
                Group {
                    if showPassword {
                        TextField(
                            text: $password,
                            prompt: Text("Enter your password").foregroundStyle(AuthPalette.textTertiary)
                        ) {
                            Text("Password")
                        }
                    } else {
                        SecureField(
                            text: $password,
                            prompt: Text("Enter your password").foregroundStyle(AuthPalette.textTertiary)
                        ) {
                            Text("Password")
                        }
                    }
                }
                .foregroundStyle(AuthPalette.textPrimary)
                .accessibilityLabel("Password")
                .textContentType(.password)
                .focused($focused, equals: .password)
                .accessibilityFocused($accessibilityFocused, equals: .password)
                .submitLabel(.go)
                .onSubmit { submit() }
                .onChange(of: password) { session.clearError() }
                .padding(.horizontal, 14)
                .padding(.trailing, 42)
                .frame(minHeight: 52)

                Button {
                    showPassword.toggle()
                } label: {
                    Image(systemName: showPassword ? "eye.slash" : "eye")
                        .foregroundStyle(AuthPalette.textSecondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showPassword ? "Hide password" : "Show password")
                .accessibilityValue(showPassword ? "Password visible" : "Password hidden")
            }
            .background(fieldFill(isFocused: focused == .password))

            Button("Forgot password?") {
                authDestination = .forgotPassword(email: trimmedEmail)
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(AuthPalette.textSecondary)
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
            .contentShape(Rectangle())
            .disabled(authBusy)
            .accessibilityHint("Opens password recovery in the app")
        }
    }

    // Each step owns one focused field. The email step performs the account
    // discovery request and either opens onboarding or continues to password.
    private func fieldFill(isFocused: Bool) -> some View {
        Color.clear.authFieldChrome(isFocused: isFocused)
    }

    // Quiet scene-level footer below the card, mirroring the web login.
    private var footer: some View {
        Text("Enter your invited email to get started.\nContact Erik Role to request access.")
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
