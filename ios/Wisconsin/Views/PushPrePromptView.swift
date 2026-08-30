import SwiftUI
import UserNotifications

/// Soft pre-prompt shown the first time a user lands inside the app.
/// Apple only lets you ask for push permission once per install, so we frame
/// the value before the system alert appears — this materially improves opt-in.
struct PushPrePromptView: View {
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isRequesting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    Image(systemName: "bell.badge.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(Color.brandPrimary)
                        .symbolEffect(.bounce, options: .nonRepeating, isActive: !reduceMotion)
                        .accessibilityHidden(true)

                    Text("Stay in the loop")
                        .font(.title2.weight(.bold))

                    Text("Get reminders about gear that's due back, shifts coming up, and trades opening on the board.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                }

                VStack(spacing: 10) {
                    bullet("calendar.badge.clock", "Reminders before your gear is due")
                    bullet("person.fill.checkmark", "Your shift is tomorrow")
                    bullet("arrow.triangle.2.circlepath", "Trade-board posts you can claim")
                }
                .padding(.horizontal, 24)

                VStack(spacing: 10) {
                    Button {
                        Task { await requestSystemPermission() }
                    } label: {
                        Text("Turn on notifications")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 50)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color.brandPrimary)
                    .disabled(isRequesting)

                    Button("Not now") { dismiss() }
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .disabled(isRequesting)
                }
                .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 36)
            .padding(.bottom, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(Color.brandPrimary)
                .frame(width: 28)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
    }

    @MainActor
    private func requestSystemPermission() async {
        guard let userId = session.currentUser?.id else {
            dismiss()
            return
        }
        let sessionBoundary = authSessionBoundary.capture()
        isRequesting = true
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        if granted,
           session.currentUser?.id == userId,
           authSessionBoundary.owns(sessionBoundary),
           PushTokenStorage.registrationAllowed {
            appState.requestRemoteNotificationRegistration()
        }
        isRequesting = false
        dismiss()
    }
}
