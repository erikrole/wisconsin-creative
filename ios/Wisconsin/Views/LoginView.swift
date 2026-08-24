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

    /// Crimson accent for focused field edges — matches the web login's
    /// `#c41230` focus ring rather than the adaptive `brandPrimary`, because
    /// the card subtree is pinned light.
    private static let focusAccent = Color(red: 0.769, green: 0.071, blue: 0.188)

    var body: some View {
        ZStack {
            BrandSplashScene()

            GeometryReader { geo in
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 24)

                        // Lockup lives on the scene, not the card — the card's
                        // only job is the form. Mirrors the web login.
                        BrandSplashLockup(subtitle: "Sign in to your account")
                            .padding(.bottom, 22)

                        card
                            .padding(.horizontal, 20)

                        footer
                            .padding(.top, 18)
                            .padding(.horizontal, 24)

                        Spacer(minLength: 24)
                    }
                    .frame(maxWidth: 468)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geo.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .preferredColorScheme(.dark)
        .task(id: PasskeyAutoFillKey(step: loginStep, attempt: passkeyAutoFillAttempt)) {
            // Offers a saved passkey in the QuickType bar over the email field,
            // so signing in does not require finding the passkey button first.
            guard loginStep == .identity else { return }
            await session.armPasskeyAutoFill()
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

    // The card is a fixed-light frosted material over the dark scene — same
    // treatment as the web login card, which pins light tokens regardless of
    // the user's theme. The `.light` environment makes materials and
    // system colors inside resolve light even though the screen is dark.
    private var card: some View {
        VStack(spacing: 14) {
            if loginStep == .identity {
                identityStep
                    .transition(.opacity)
            } else {
                passwordStep
                    .transition(.opacity)
            }

            // Error
            if let error = identityError ?? session.error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.statusText(.red))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
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
                            .accessibilityHidden(true)
                    }
                    Text(primaryButtonTitle)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .tint(.brandPrimary)
            .disabled(loginStep == .identity ? !canContinue : !canSubmit)

            if loginStep == .identity {
                HStack(spacing: 12) {
                    Rectangle()
                        .fill(.secondary.opacity(0.25))
                        .frame(height: 1)
                    Text("or")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Rectangle()
                        .fill(.secondary.opacity(0.25))
                        .frame(height: 1)
                }

                Button {
                    submitPasskey()
                } label: {
                    HStack(spacing: 8) {
                        if passkeyLoading {
                            ProgressView()
                                .controlSize(.small)
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
                .buttonStyle(.glass)
                .controlSize(.large)
                .tint(.primary)
                .disabled(authBusy)
                .accessibilityHint("Choose an account with a saved passkey")
            }
        }
        .padding(20)
        .background(
            // Frosted material plus a white wash so the card reads as a light
            // surface (web: rgba(255,255,255,0.88) + blur), not a pink one —
            // the material alone soaks up too much of the red scene.
            RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                .fill(.regularMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                        .fill(Color.white.opacity(0.58))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                .strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.7), .white.opacity(0.22)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
        )
        .environment(\.colorScheme, .light)
        .shadow(color: Color(.sRGBLinear, white: 0, opacity: 0.35), radius: 20, y: 10)
    }

    private var identityStep: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Email address")
                .font(.subheadline.weight(.semibold))

            TextField(
                text: $email,
                prompt: Text("you@wisc.edu").foregroundStyle(.secondary)
            ) {
                Text("Email address")
            }
            .accessibilityLabel("Email address")
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
                        .foregroundStyle(.secondary)
                    // The email field belongs to the previous step and is gone
                    // by now. Keeping the address here as a real account field
                    // is what lets AutoFill file the password under it.
                    TextField("Account", text: .constant(trimmedEmail))
                        .textFieldStyle(.plain)
                        .textContentType(.username)
                        .disabled(true)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .accessibilityLabel("Signing in as \(trimmedEmail)")
                }

                Spacer(minLength: 8)

                Button("Change") {
                    changeEmail()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Self.focusAccent)
                .buttonStyle(.plain)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                .disabled(authBusy)
                .accessibilityHint("Returns to email entry")
            }

            Text("Password")
                .font(.subheadline.weight(.semibold))

            ZStack(alignment: .trailing) {
                Group {
                    if showPassword {
                        TextField(
                            text: $password,
                            prompt: Text("Enter your password").foregroundStyle(.secondary)
                        ) {
                            Text("Password")
                        }
                    } else {
                        SecureField(
                            text: $password,
                            prompt: Text("Enter your password").foregroundStyle(.secondary)
                        ) {
                            Text("Password")
                        }
                    }
                }
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
                        .foregroundStyle(.secondary)
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
            .foregroundStyle(.secondary)
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
        RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous)
            .fill(Color.white)
            .strokeBorder(
                isFocused ? Self.focusAccent : Color.black.opacity(0.14),
                lineWidth: isFocused ? 1.5 : 1
            )
            .animation(.easeOut(duration: 0.15), value: isFocused)
    }

    // Quiet scene-level footer below the card, mirroring the web login.
    private var footer: some View {
        Text("Enter your invited email to get started.\nContact Erik Role to request access.")
            .multilineTextAlignment(.center)
            .foregroundStyle(.white.opacity(0.55))
            .font(.footnote)
    }
}
