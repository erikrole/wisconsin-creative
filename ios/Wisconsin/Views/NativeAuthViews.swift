import SwiftUI

enum AuthEmailGuidance {
    static let note = "Login using your @wisc.edu email address."

    static func shouldSuggestWiscEmail(_ email: String) -> Bool {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .hasSuffix("@athletics.wisc.edu")
    }
}

struct AuthEmailDomainNote: View {
    let email: String

    @ViewBuilder
    var body: some View {
        if AuthEmailGuidance.shouldSuggestWiscEmail(email) {
            Label(AuthEmailGuidance.note, systemImage: "info.circle.fill")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct NativeRegistrationView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var showsPassword = false
    @State private var formError: String?
    @State private var isSubmitting = false
    private let emailIsLocked: Bool
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case name
        case email
        case password
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            Self.isValidEmail(normalizedEmail) &&
            password.count >= 8 &&
            !isSubmitting
    }

    init(initialEmail: String = "") {
        let normalizedEmail = initialEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        _email = State(initialValue: normalizedEmail)
        emailIsLocked = !normalizedEmail.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                WelcomeStepHeading(
                    symbol: "person.crop.circle.badge.plus",
                    title: "Welcome to the team",
                    detail: "Start with your name and a password. We’ll help you set up your profile next."
                )

                WelcomeFormCard {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 8) {
                            WelcomeFieldLabel(title: "Full name")
                            TextField("Full name", text: $name)
                                .textContentType(.name)
                                .focused($focusedField, equals: .name)
                                .submitLabel(.next)
                                .onSubmit { focusedField = emailIsLocked ? .password : .email }
                                .modifier(WelcomeTextFieldStyle())
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            WelcomeFieldLabel(title: "Email", detail: emailIsLocked ? "Your invitation" : nil)
                            TextField("Email", text: $email)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.emailAddress)
                                .textContentType(.username)
                                .autocorrectionDisabled()
                                .focused($focusedField, equals: .email)
                                .submitLabel(.next)
                                .onSubmit { focusedField = .password }
                                .disabled(emailIsLocked)
                                .modifier(WelcomeTextFieldStyle())
                        }
                        AuthEmailDomainNote(email: email)
                        VStack(alignment: .leading, spacing: 8) {
                            WelcomeFieldLabel(title: "Password")
                            HStack(spacing: 0) {
                                Group {
                                    if showsPassword {
                                        TextField("Password", text: $password)
                                    } else {
                                        SecureField("Password", text: $password)
                                    }
                                }
                                .textContentType(.newPassword)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focusedField, equals: .password)
                                .submitLabel(.go)
                                .onSubmit { submit() }

                                Button {
                                    showsPassword.toggle()
                                    focusedField = .password
                                } label: {
                                    Image(systemName: showsPassword ? "eye.slash" : "eye")
                                        .foregroundStyle(.secondary)
                                        .frame(minWidth: 44, minHeight: 44)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(showsPassword ? "Hide password" : "Show password")
                                .accessibilityValue(showsPassword ? "Password visible" : "Password hidden")
                            }
                            .padding(.leading, 14)
                            .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            Label("At least 8 characters", systemImage: password.count >= 8 ? "checkmark.circle.fill" : "info.circle")
                                .font(.footnote)
                                .foregroundStyle(password.count >= 8 ? Color.statusText(.green) : .secondary)
                        }
                    }
                }

                if let formError {
                    Label(formError, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(Color.statusBackground(.red), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 12) {
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if isSubmitting { ProgressView() }
                        Text(isSubmitting ? "Creating account…" : "Create account")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 18))
                .controlSize(.large)
                .disabled(!canSubmit)
                Text("You can finish your profile at your own pace.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 16)
            .background(.regularMaterial)
        }
        .navigationTitle("Account setup")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
                    .disabled(isSubmitting)
            }
        }
        .interactiveDismissDisabled(isSubmitting)
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: name) { _, _ in formError = nil }
        .onChange(of: email) { _, _ in
            formError = nil
        }
        .onChange(of: password) { _, _ in formError = nil }
    }

    private func submit() {
        guard !isSubmitting else { return }
        guard let validationError else {
            focusedField = nil
            formError = nil
            isSubmitting = true

            let submittedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let submittedEmail = normalizedEmail
            let submittedPassword = password
            Task {
                await session.register(
                    name: submittedName,
                    email: submittedEmail,
                    password: submittedPassword
                )
                guard !Task.isCancelled else { return }
                isSubmitting = false
                if session.currentUser != nil {
                    dismiss()
                } else {
                    formError = session.error ?? "Your account couldn't be created. Please try again."
                }
            }
            return
        }

        formError = validationError
    }

    private var validationError: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter your name."
        }
        if !Self.isValidEmail(normalizedEmail) {
            return "Enter a valid email address."
        }
        if password.count < 8 {
            return "Password must be at least 8 characters."
        }
        return nil
    }

    private static func isValidEmail(_ value: String) -> Bool {
        value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }
}

struct NativeForgotPasswordView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var email: String
    @State private var result: PasswordResetRequestResult?
    @State private var formError: String?
    @State private var isSubmitting = false
    @FocusState private var emailFocused: Bool

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    init(initialEmail: String = "") {
        _email = State(initialValue: initialEmail)
    }

    var body: some View {
        Form {
            if let result {
                Section {
                    Label(
                        result.resetEmailConfigured ? "Check your email" : "Contact Erik Role",
                        systemImage: result.resetEmailConfigured ? "checkmark.circle.fill" : "info.circle.fill"
                    )
                    .foregroundStyle(result.resetEmailConfigured ? Color.statusText(.green) : .secondary)

                    Text(result.message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button("Done") { dismiss() }
                }
            } else {
                Section {
                    Text("Enter your account email. If password recovery is available, a reset link will be sent.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    TextField("Email", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .focused($emailFocused)
                        .submitLabel(.go)
                        .onSubmit { submit() }

                    AuthEmailDomainNote(email: email)

                    if let formError {
                        Label(formError, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section {
                    Button {
                        submit()
                    } label: {
                        HStack {
                            Spacer()
                            if isSubmitting {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Sending…")
                            } else {
                                Text("Request password reset")
                            }
                            Spacer()
                        }
                    }
                    .disabled(isSubmitting)
                }

                Section {
                    Text("If email recovery is unavailable, contact Erik Role for help.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Reset password")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
                    .disabled(isSubmitting)
            }
        }
        .interactiveDismissDisabled(isSubmitting)
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: email) { _, _ in
            formError = nil
        }
        .onAppear { emailFocused = true }
    }

    private func submit() {
        guard Self.isValidEmail(normalizedEmail) else {
            formError = "Enter a valid email address."
            return
        }

        emailFocused = false
        formError = nil
        isSubmitting = true
        let submittedEmail = normalizedEmail
        Task {
            do {
                result = try await APIClient.shared.requestPasswordReset(email: submittedEmail)
            } catch {
                formError = error.localizedDescription
            }
            isSubmitting = false
        }
    }

    private static func isValidEmail(_ value: String) -> Bool {
        value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }
}
