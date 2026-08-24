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

    private var validationMessage: String? {
        if currentPassword.isEmpty { return nil }
        if newPassword.isEmpty { return nil }
        if newPassword.count < 8 { return "Use at least 8 characters." }
        if !confirmPassword.isEmpty && newPassword != confirmPassword { return "Passwords do not match." }
        if !newPassword.isEmpty && currentPassword == newPassword { return "Choose a password that is different from the temporary password." }
        return nil
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
        ZStack {
            BrandSplashScene()

            GeometryReader { geo in
                ScrollView {
                    VStack {
                        Spacer(minLength: 0)
                        card
                            .padding(.horizontal, 24)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: geo.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .preferredColorScheme(.dark)
        .onChange(of: session.error) { _, error in
            if let error {
                AccessibilityNotification.Announcement(error).post()
            }
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Image("Badgers")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 52, height: 52)
                    .accessibilityHidden(true)

                Text("Set your password")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.primary)

                // Renders exactly like the label it replaces, but as a real
                // account field: iOS needs one next to a new-password field to
                // file the saved credential under the right address.
                TextField("Account", text: .constant(email))
                    .textFieldStyle(.plain)
                    .textContentType(.username)
                    .multilineTextAlignment(.center)
                    .disabled(true)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityLabel("Signed in as \(email)")

                Text("Create a new password to continue on this device.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
            .padding(.top, 32)
            .padding(.bottom, 28)

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

                if let message = validationMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.orange))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }

                if let error = session.error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }

                Button {
                    submit()
                } label: {
                    ZStack {
                        if session.isLoading {
                            ProgressView()
                        } else {
                            Text("Continue")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .tint(.brandPrimary)
                .disabled(!canSubmit)

                Button("Sign out") {
                    Task { await session.logout() }
                }
                .buttonStyle(.plain)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .disabled(session.isLoading)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: Color(.sRGBLinear, white: 0, opacity: 0.4), radius: 24, y: 12)
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
                .font(.subheadline.weight(.medium))
            ZStack(alignment: .trailing) {
                Group {
                    if showPasswords {
                        TextField(title, text: text)
                    } else {
                        SecureField(title, text: text)
                    }
                }
                .textContentType(contentType)
                .focused($focused, equals: focus)
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .onChange(of: text.wrappedValue) { session.clearError() }
                .padding(.horizontal, 14)
                .padding(.trailing, 42)
                .padding(.vertical, 12)
                .background(Color(.systemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 0.5)
                )

                Button {
                    showPasswords.toggle()
                } label: {
                    Image(systemName: showPasswords ? "eye.slash" : "eye")
                        .foregroundStyle(.secondary)
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
                .foregroundStyle(.secondary)

            ForEach(requirements) { requirement in
                HStack(spacing: 8) {
                    Image(systemName: requirement.isMet ? "checkmark.circle.fill" : "circle")
                        .font(.caption)
                        .foregroundStyle(requirement.isMet ? Color.statusText(.green) : Color.secondary)
                        .accessibilityHidden(true)

                    Text(requirement.title)
                        .font(.caption)
                        .foregroundStyle(requirement.isMet ? .primary : .secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(requirement.title), \(requirement.isMet ? "met" : "not met")")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}
