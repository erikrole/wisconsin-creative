import SwiftUI
import UIKit

struct AccountSecuritySettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let manageAccountURL: URL

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var revokeOtherSessions = true
    @State private var showPasswords = false
    @State private var isSaving = false
    @State private var error: String?
    @State private var successMessage: String?
    @State private var showDeleteAccount = false
    @State private var passkeys: [PasskeyCredentialSummary] = []
    @State private var passkeysLoading = false
    @State private var passkeyCurrentPassword = ""
    @State private var passkeyName = ""
    @State private var passkeyError: String?
    @State private var passkeySuccessMessage: String?
    @State private var passkeyServiceAvailable: Bool?
    @State private var isPasskeySaving = false
    @State private var passkeyToRemove: PasskeyCredentialSummary?
    @State private var showPasskeyRemovalConfirmation = false
    @FocusState private var focusedField: Field?

    private enum Field {
        case currentPassword
        case newPassword
        case confirmPassword
    }

    var body: some View {
        List {
            Section("Account") {
                accountIdentity
                .padding(.vertical, 4)

                Link(destination: manageAccountURL) {
                    SettingsMenuRow(
                        title: "Manage profile on web",
                        subtitle: "Edit profile fields and review active sessions.",
                        systemImage: "globe",
                        tint: Color.statusText(.blue)
                    ) {
                        Image(systemName: "arrow.up.right.square")
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Section {
                Text("Use Face ID, Touch ID, or your device security to sign in without typing a password.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if passkeyServiceAvailable == false {
                    Label(
                        "Passkey setup is not available on this server yet. You can continue using your password.",
                        systemImage: "info.circle"
                    )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if passkeysLoading {
                    ProgressView("Loading passkeys…")
                } else {
                    SecureField("Current password", text: $passkeyCurrentPassword)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(isPasskeySaving)

                    TextField("Passkey name (optional)", text: $passkeyName)
                        .textContentType(nil)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .disabled(isPasskeySaving)
                        .onChange(of: passkeyName) { _, value in
                            if value.count > 80 {
                                passkeyName = String(value.prefix(80))
                            }
                        }

                    if let passkeyError {
                        Text(passkeyError)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }

                    if let passkeySuccessMessage {
                        Text(passkeySuccessMessage)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.green))
                    }

                    Button {
                        Task { await addPasskey() }
                    } label: {
                        HStack {
                            if isPasskeySaving {
                                ProgressView().controlSize(.small)
                            }
                            Text(isPasskeySaving ? "Waiting for passkey…" : "Add Passkey")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.brandPrimary)
                    .disabled(isPasskeySaving || passkeyCurrentPassword.isEmpty)

                    if passkeys.isEmpty {
                        Text("No passkeys added yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(passkeys) { passkey in
                            HStack(spacing: 12) {
                                Image(systemName: "key.fill")
                                    .foregroundStyle(Color.statusText(.blue))
                                    .frame(width: 26, height: 26)
                                    .background(Color.statusText(.blue).opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                    .accessibilityHidden(true)

                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text(passkey.name ?? "Passkey")
                                            .font(.subheadline.weight(.medium))
                                        if let storage = passkeyStorageLabel(passkey) {
                                            StatusPill(label: storage, tone: passkey.backedUp ? .green : .gray)
                                        }
                                    }
                                    Text(passkeyDetail(passkey))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer(minLength: 8)

                                Button {
                                    requestPasskeyRemoval(passkey)
                                } label: {
                                    Image(systemName: "trash")
                                        .foregroundStyle(Color.statusText(.red))
                                        .frame(width: 44, height: 44)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Remove \(passkey.name ?? "passkey")")
                                .disabled(isPasskeySaving)
                            }
                        }
                    }
                }
            } header: {
                Text("Passkeys")
            } footer: {
                Text("Passkeys use the same Gear Tracker account and session as password sign-in. Your current password is required to add or remove one. Leave the name blank to name it after this device.")
            }

            Section {
                // The account these boxes belong to. Without a username field
                // beside them, iOS has nothing to file an updated password
                // under when it offers to save one.
                HStack(spacing: 12) {
                    Text("Account")
                    Spacer(minLength: 8)
                    TextField("Account", text: .constant(session.currentUser?.email ?? ""))
                        .textContentType(.username)
                        .disabled(true)
                        .multilineTextAlignment(.trailing)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Account \(session.currentUser?.email ?? "")")

                passwordField(
                    title: "Current password",
                    text: $currentPassword,
                    contentType: .password,
                    focus: .currentPassword,
                    submitLabel: .next
                ) {
                    focusedField = .newPassword
                }

                passwordField(
                    title: "New password",
                    text: $newPassword,
                    contentType: .newPassword,
                    focus: .newPassword,
                    submitLabel: .next
                ) {
                    focusedField = .confirmPassword
                }

                passwordField(
                    title: "Confirm new password",
                    text: $confirmPassword,
                    contentType: .newPassword,
                    focus: .confirmPassword,
                    submitLabel: .go
                ) {
                    Task { await savePassword() }
                }

                Button {
                    // Swapping SecureField <-> TextField changes view identity and
                    // drops keyboard focus; restore it on the next runloop pass.
                    let focus = focusedField
                    showPasswords.toggle()
                    if let focus {
                        DispatchQueue.main.async { focusedField = focus }
                    }
                } label: {
                    Label(showPasswords ? "Hide passwords" : "Show passwords", systemImage: showPasswords ? "eye.slash" : "eye")
                }
                .accessibilityValue(showPasswords ? "Passwords visible" : "Passwords hidden")
                .disabled(isSaving)

                Toggle("Sign out other devices", isOn: $revokeOtherSessions)
                    .tint(Color.statusText(.green))
                    .disabled(isSaving)

                if let validationMessage {
                    Text(validationMessage)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.orange))
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.red))
                }

                if let successMessage {
                    Text(successMessage)
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(.green))
                }

                Button {
                    Task { await savePassword() }
                } label: {
                    HStack {
                        if isSaving {
                            ProgressView().controlSize(.small)
                        }
                        Text(isSaving ? "Saving…" : "Change Password")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.brandPrimary)
                .disabled(!canSubmit)
            } header: {
                Text("Password")
            } footer: {
                Text("New passwords must be at least 8 characters and different from the current password.")
            }

            Section {
                Button("Delete Account", role: .destructive) {
                    showDeleteAccount = true
                }
            } header: {
                Text("Account Access")
            } footer: {
                Text("Deleting your account removes access and signs out every device. Historical custody and audit records may be retained.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Account & Security")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(isSaving)
        .sheet(isPresented: $showDeleteAccount) {
            DeleteAccountView()
        }
        .confirmationDialog(
            "Remove \(passkeyToRemove?.name ?? "this passkey")?",
            isPresented: $showPasskeyRemovalConfirmation,
            titleVisibility: .visible
        ) {
            Button("Remove Passkey", role: .destructive) {
                guard let passkeyToRemove else { return }
                Task { await removePasskey(passkeyToRemove) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This passkey will no longer sign in to Gear Tracker.")
        }
        .task {
            await loadPasskeys()
        }
        .onChange(of: error) { _, error in
            if let error {
                AccessibilityNotification.Announcement(error).post()
            }
        }
        .onChange(of: successMessage) { _, successMessage in
            if let successMessage {
                AccessibilityNotification.Announcement(successMessage).post()
            }
        }
        .onChange(of: passkeySuccessMessage) { _, passkeySuccessMessage in
            if let passkeySuccessMessage {
                AccessibilityNotification.Announcement(passkeySuccessMessage).post()
            }
        }
    }

    @ViewBuilder
    private var accountIdentity: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    AccountAvatar(size: 48)
                    StatusPill.role(session.currentUser?.role ?? "")
                }
                Text(session.currentUser?.name ?? "Account")
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text(session.currentUser?.email ?? "")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            HStack(spacing: 14) {
                AccountAvatar(size: 48)
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.currentUser?.name ?? "Account")
                        .font(.headline)
                    Text(session.currentUser?.email ?? "")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 12)
                StatusPill.role(session.currentUser?.role ?? "")
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
        Group {
            if showPasswords {
                TextField(title, text: text)
            } else {
                SecureField(title, text: text)
            }
        }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .textContentType(contentType)
        .submitLabel(submitLabel)
        .focused($focusedField, equals: focus)
        .disabled(isSaving)
        .onSubmit(onSubmit)
    }

    private var validationMessage: String? {
        if currentPassword.isEmpty && newPassword.isEmpty && confirmPassword.isEmpty { return nil }
        if currentPassword.isEmpty { return "Current password is required." }
        if newPassword.count < 8 { return "Use at least 8 characters." }
        if !confirmPassword.isEmpty && newPassword != confirmPassword { return "Passwords do not match." }
        if !newPassword.isEmpty && currentPassword == newPassword { return "Choose a password that is different from your current password." }
        return nil
    }

    private var canSubmit: Bool {
        !currentPassword.isEmpty &&
        newPassword.count >= 8 &&
        newPassword == confirmPassword &&
        currentPassword != newPassword &&
        !isSaving
    }

    private func passkeyDetail(_ passkey: PasskeyCredentialSummary) -> String {
        let added = "Added \(passkey.createdAt.formatted(date: .abbreviated, time: .omitted))"
        guard let lastUsedAt = passkey.lastUsedAt else { return "\(added) · Not used yet" }
        return "\(added) · Used \(lastUsedAt.formatted(date: .abbreviated, time: .omitted))"
    }

    /// A synced passkey survives losing this iPhone; a device-bound one does
    /// not, which changes whether removing it is recoverable.
    private func passkeyStorageLabel(_ passkey: PasskeyCredentialSummary) -> String? {
        if passkey.backedUp || passkey.deviceType == "multiDevice" { return "Synced" }
        if passkey.deviceType == "singleDevice" { return "This device only" }
        return nil
    }

    private func loadPasskeys() async {
        passkeysLoading = true
        defer { passkeysLoading = false }
        do {
            passkeys = try await APIClient.shared.passkeys()
            passkeyServiceAvailable = true
            passkeyError = nil
        } catch APIError.notFound {
            passkeys = []
            passkeyServiceAvailable = false
            passkeyError = nil
        } catch {
            passkeyServiceAvailable = true
            passkeyError = error.localizedDescription
        }
    }

    private func addPasskey() async {
        guard !isPasskeySaving, !passkeyCurrentPassword.isEmpty else { return }
        isPasskeySaving = true
        passkeyError = nil
        passkeySuccessMessage = nil
        defer { isPasskeySaving = false }

        do {
            let options = try await APIClient.shared.passkeyRegistrationOptions(
                currentPassword: passkeyCurrentPassword
            )
            let registration = try await PasskeyService.shared.register(options: options)
            _ = try await APIClient.shared.verifyPasskeyRegistration(
                registration,
                name: passkeyName
            )
            passkeyCurrentPassword = ""
            passkeyName = ""
            passkeySuccessMessage = "Passkey added."
            Haptics.success()

            do {
                passkeys = try await APIClient.shared.passkeys()
            } catch {
                passkeyError = "Passkey added, but the list could not refresh. Reopen Account & Security to refresh it."
            }
        } catch APIError.notFound {
            passkeys = []
            passkeyServiceAvailable = false
            passkeyError = nil
            Haptics.warning()
        } catch PasskeyServiceError.cancelled {
            // Dismissing the system sheet is a choice, not a failure.
        } catch {
            passkeyError = error.localizedDescription
            Haptics.warning()
        }
    }

    private func requestPasskeyRemoval(_ passkey: PasskeyCredentialSummary) {
        guard !passkeyCurrentPassword.isEmpty else {
            passkeyError = "Enter your current password before removing a passkey."
            return
        }
        passkeyToRemove = passkey
        showPasskeyRemovalConfirmation = true
    }

    private func removePasskey(_ passkey: PasskeyCredentialSummary) async {
        guard !isPasskeySaving else { return }
        isPasskeySaving = true
        passkeyError = nil
        passkeySuccessMessage = nil
        defer { isPasskeySaving = false }

        do {
            try await APIClient.shared.revokePasskey(
                id: passkey.id,
                currentPassword: passkeyCurrentPassword
            )
            passkeys.removeAll { $0.id == passkey.id }
            passkeyCurrentPassword = ""
            passkeyToRemove = nil
            passkeySuccessMessage = "Passkey removed."
            Haptics.success()
        } catch {
            passkeyError = error.localizedDescription
            Haptics.warning()
        }
    }

    private func savePassword() async {
        guard canSubmit else {
            Haptics.warning()
            return
        }

        isSaving = true
        withAnimation {
            error = nil
            successMessage = nil
        }

        do {
            try await APIClient.shared.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword,
                revokeOtherSessions: revokeOtherSessions
            )
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
            focusedField = nil
            withAnimation {
                successMessage = revokeOtherSessions
                    ? "Password changed. Other devices were signed out."
                    : "Password changed."
            }
            Haptics.success()
        } catch {
            withAnimation {
                self.error = error.localizedDescription
            }
            Haptics.warning()
        }

        isSaving = false
    }
}

private struct DeleteAccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var currentPassword = ""
    @State private var isDeleting = false
    @State private var error: String?
    @State private var showFinalConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This immediately removes your access, cancels future reservations, and signs out every device. You must return any checked-out gear first.")
                    Text("Historical custody, scheduling, and audit records may be retained for operational and legal accountability.")
                }

                Section("Confirm Your Identity") {
                    SecureField("Current password", text: $currentPassword)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(isDeleting)

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                }

                Section {
                    Button("Delete Account", role: .destructive) {
                        showFinalConfirmation = true
                    }
                    .frame(maxWidth: .infinity)
                    .disabled(currentPassword.isEmpty || isDeleting)
                }
            }
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isDeleting)
                }
            }
            .interactiveDismissDisabled(isDeleting)
            .confirmationDialog("Permanently delete this account?", isPresented: $showFinalConfirmation, titleVisibility: .visible) {
                Button("Delete Account", role: .destructive) {
                    Task { await deleteAccount() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone from the app.")
            }
        }
    }

    private func deleteAccount() async {
        isDeleting = true
        error = nil
        do {
            try await APIClient.shared.deleteAccount(currentPassword: currentPassword)
            Haptics.success()
            await session.clearDeletedAccountLocally()
        } catch {
            self.error = error.localizedDescription
            Haptics.warning()
            isDeleting = false
        }
    }
}
