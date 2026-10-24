import SwiftUI

/// Shared native recovery for a missing link and a link retired during signup.
/// A successful generic reply never exposes whether an address is invited.
struct InviteLinkResendButton: View {
    let email: String
    @State private var sending = false
    @State private var result: InviteResendResult?
    @State private var error: String?

    private var title: String {
        if sending { return "Sending…" }
        if let result { return result.inviteEmailConfigured ? "Link sent" : "Email unavailable" }
        return "Email me my invite link"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let result {
                AuthInlineMessage(text: result.message, systemImage: "envelope.fill", tone: .blue)
            }
            if let error {
                AuthInlineMessage(text: error, systemImage: "exclamationmark.circle.fill", tone: .red)
            }
            Button {
                guard !sending, result == nil else { return }
                sending = true
                error = nil
                Task {
                    defer { sending = false }
                    do {
                        result = try await APIClient.shared.resendInviteLink(email: email)
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    if sending {
                        ProgressView().controlSize(.small).tint(AuthPalette.onPrimary)
                    }
                    Text(title).fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .authButton(.primary)
            .disabled(sending || result != nil)
        }
    }
}
