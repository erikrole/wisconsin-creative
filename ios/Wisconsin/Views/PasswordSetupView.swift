import SwiftUI

struct PasswordSetupView: View {
    @Environment(SessionStore.self) private var session
    let email: String

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var showPasswords = false
    @FocusState private var focused: Field?

    private enum Field {
        case currentPassword
        case newPassword
        case confirmPassword
    }

    private var canSubmit: Bool {
        !currentPassword.isEmpty &&
        newPassword.count >= 8 &&
        newPassword == confirmPassword &&
        currentPassword != newPassword &&
        !session.isLoading
    }

    private var passwordRequirements: [PasswordRequirement] {
        [
            PasswordRequirement(
                title: "Temporary password entered",
                isMet: !currentPassword.isEmpty
            ),
            PasswordRequirement(
                title: "At least 8 characters",
                isMet: newPassword.count >= 8
            ),
            PasswordRequirement(
                title: "Passwords match",
                isMet: !confirmPassword.isEmpty && newPassword == confirmPassword
            ),
            PasswordRequirement(
                title: "Different from temporary password",
                isMet: !newPassword.isEmpty && currentPassword != newPassword
            ),
        ]
    }

    var body: some View {
        AuthScreen(
            title: "Set your password",
            subtitle: "Create a new password to continue on this device."
        ) {
            card
        } footer: {
            Button("Sign out") {
                Task { await session.logout() }
            }
            .buttonStyle(.plain)
            .font(.footnote.weight(.medium))
            .foregroundStyle(AuthPalette.textSecondary)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
            .disabled(session.isLoading)
        }
        .onChange(of: session.error) { _, error in
            if let error {
                AccessibilityNotification.Announcement(error).post()
            }
        }
    }

    private var card: some View {
        VStack(spacing: 16) {
            // Renders as a plain label, but is a real account field: iOS needs
            // one next to a new-password field to file the saved credential
            // under the right address.
            TextField("Account", text: .constant(email))
                .textFieldStyle(.plain)
                .textContentType(.username)
                .disabled(true)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AuthPalette.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("Signed in as \(email)")

            VStack(spacing: 16) {
                passwordField(
                    title: "Temporary password",
                    text: $currentPassword,
                    contentType: .password,
                    focus: .currentPassword,
                    submitLabel: .next
                ) {
                    focused = .newPassword
                }

                passwordField(
                    title: "New password",
                    text: $newPassword,
                    contentType: .newPassword,
                    focus: .newPassword,
                    submitLabel: .next
                ) {
                    focused = .confirmPassword
                }

                passwordField(
                    title: "Confirm new password",
                    text: $confirmPassword,
                    contentType: .newPassword,
                    focus: .confirmPassword,
                    submitLabel: .go
                ) {
                    submit()
                }

                PasswordRequirementChecklist(requirements: passwordRequirements)

                if let error = session.error {
                    AuthInlineMessage(text: error, systemImage: "exclamationmark.circle.fill", tone: .red)
                        .accessibilityLabel("Couldn't set password. \(error)")
                }

                Button {
                    submit()
                } label: {
                    ZStack {
                        if session.isLoading {
                            ProgressView()
                                .tint(AuthPalette.onPrimary)
                        } else {
                            Text("Continue")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .authButton(.primary)
                .disabled(!canSubmit)
            }
        }
    }

    @ViewBuilder
    private func passwordField(
        title: String,
        text: Binding<String>,
        contentType: UITextContentType,
        focus: Field,
        submitLabel: SubmitLabel,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AuthPalette.textPrimary)
            ZStack(alignment: .trailing) {
                Group {
                    if showPasswords {
                        TextField(text: text, prompt: Text(title).foregroundStyle(AuthPalette.textTertiary)) { Text(title) }
                    } else {
                        SecureField(text: text, prompt: Text(title).foregroundStyle(AuthPalette.textTertiary)) { Text(title) }
                    }
                }
                .foregroundStyle(AuthPalette.textPrimary)
                .textContentType(contentType)
                .focused($focused, equals: focus)
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .onChange(of: text.wrappedValue) { session.clearError() }
                .padding(.horizontal, 14)
                .padding(.trailing, 42)
                .frame(minHeight: 52)
                .authFieldChrome(isFocused: focused == focus)

                Button {
                    showPasswords.toggle()
                } label: {
                    Image(systemName: showPasswords ? "eye.slash" : "eye")
                        .foregroundStyle(AuthPalette.textSecondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showPasswords ? "Hide passwords" : "Show passwords")
                .accessibilityValue(showPasswords ? "Passwords visible" : "Passwords hidden")
            }
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focused = nil
        Task {
            await session.completeForcedPasswordChange(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
        }
    }
}

private struct PasswordRequirement: Identifiable {
    let title: String
    let isMet: Bool

    var id: String { title }
}

private struct PasswordRequirementChecklist: View {
    let requirements: [PasswordRequirement]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Password requirements")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AuthPalette.textTertiary)

            ForEach(requirements) { requirement in
                HStack(spacing: 8) {
                    Image(systemName: requirement.isMet ? "checkmark.circle.fill" : "circle")
                        .font(.caption)
                        .foregroundStyle(requirement.isMet ? Color.statusText(.green) : AuthPalette.textTertiary)
                        .accessibilityHidden(true)

                    Text(requirement.title)
                        .font(.caption)
                        .foregroundStyle(requirement.isMet ? AuthPalette.textPrimary : AuthPalette.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(requirement.title), \(requirement.isMet ? "met" : "not met")")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AuthPalette.field, in: RoundedRectangle(cornerRadius: Brand.Radius.sm, style: .continuous))
    }
}
