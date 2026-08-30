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
    @State private var confirmPassword = ""
    @State private var formError: String?
    @State private var isSubmitting = false
    private let emailIsLocked: Bool
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case name
        case email
        case password
        case confirmPassword
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            Self.isValidEmail(normalizedEmail) &&
            password.count >= 8 &&
            password == confirmPassword &&
            !isSubmitting
    }

    init(initialEmail: String = "") {
        let normalizedEmail = initialEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        _email = State(initialValue: normalizedEmail)
        emailIsLocked = !normalizedEmail.isEmpty
    }

    var body: some View {
        Form {
            Section {
                Text("Your invited email is approved. Create a password, then add the details needed for work.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                TextField("Full name", text: $name)
                    .textContentType(.name)
                    .focused($focusedField, equals: .name)
                    .submitLabel(.next)
                    .onSubmit { focusedField = emailIsLocked ? .password : .email }

                if !name.isEmpty && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Enter your name.")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }

                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    // `.username`, not `.emailAddress`: this is the account the
                    // password below belongs to, and it is what iOS files the
                    // saved credential under.
                    .textContentType(.username)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .password }
                    .disabled(emailIsLocked)

                if !email.isEmpty && !Self.isValidEmail(normalizedEmail) {
                    Text("Use a valid email address.")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }

                AuthEmailDomainNote(email: email)

                SecureField("Password", text: $password)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .password)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .confirmPassword }

                if !password.isEmpty && password.count < 8 {
                    Text("Use at least 8 characters.")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }

                SecureField("Confirm password", text: $confirmPassword)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .confirmPassword)
                    .submitLabel(.done)
                    .onSubmit { submit() }

                if !confirmPassword.isEmpty && password != confirmPassword {
                    Text("Passwords do not match.")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }

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
                            Text("Creating account…")
                        } else {
                            Text("Create account")
                        }
                        Spacer()
                    }
                }
                .disabled(!canSubmit)
            }
        }
        .navigationTitle("Set up account")
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
        .onChange(of: confirmPassword) { _, _ in formError = nil }
        .onAppear { focusedField = .name }
    }

    private func submit() {
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
        if password != confirmPassword {
            return "Passwords do not match."
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
