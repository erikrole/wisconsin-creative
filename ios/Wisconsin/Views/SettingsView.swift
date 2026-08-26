import SwiftUI
import UIKit
import UserNotifications

// MARK: - Settings

/// Dedicated settings page pushed from the gear button on `ProfileView`.
/// Follows the system Settings app conventions: consistent destination rows,
/// short trailing values, truthful accessories, and a centered destructive
/// Sign Out row.
struct SettingsView: View {
    @Environment(SessionStore.self) private var session

    let prefsVM: NotificationPrefsViewModel
    let pushAuth: UNAuthorizationStatus

    @State private var showSignOutConfirm = false
    @AppStorage("WisconsinThemeChoice") private var themeChoice: ThemeChoice = .system

    private static let iosSettingsURL = URL(string: UIApplication.openSettingsURLString)!
    private static let privacyURL = AppEnvironment.baseURL.appending(path: "privacy")
    private static let supportURL = URL(string: "mailto:erole@athletics.wisc.edu?subject=Wisconsin%20Creative%20Support")!

    var body: some View {
        List {
            Section {
                NavigationLink(value: ProfileDestination.accountSecurity) {
                    SettingsRow(title: "Account & Security", systemImage: "lock.fill", color: .blue) {
                        EmptyView()
                    }
                }
                NavigationLink(value: ProfileDestination.notifications) {
                    SettingsRow(title: "Notifications", systemImage: "bell.badge.fill", color: .red) {
                        Text(notificationStatusText)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if canStartStudentPreview || activeRolePreview != nil {
                Section {
                    if let preview = activeRolePreview {
                        SettingsRow(title: "Current view", systemImage: "eye.slash.fill", color: .orange) {
                            Text("\(preview.roleLabel) · Read-only")
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.trailing)
                        }
                        Button {
                            Task { await session.stopRolePreview() }
                        } label: {
                            SettingsRow(title: "Exit \(preview.roleLabel) preview", systemImage: "rectangle.portrait.and.arrow.right", color: .orange) {
                                if session.isRolePreviewActionInFlight {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    EmptyView()
                                }
                            }
                        }
                        .disabled(session.isRolePreviewActionInFlight)
                    } else {
                        Button {
                            Task { await session.startStudentRolePreview() }
                        } label: {
                            SettingsRow(title: "Preview as Student", systemImage: "eye.fill", color: .orange) {
                                if session.isRolePreviewActionInFlight {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "chevron.forward")
                                        .font(.footnote.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                        .accessibilityHidden(true)
                                }
                            }
                        }
                        .disabled(session.isRolePreviewActionInFlight)
                    }
                    if let error = session.rolePreviewError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Color.statusText(.red))
                    }
                } header: {
                    Text("Presentation")
                } footer: {
                    Text("This is an Admin-only, read-only view for checking the Student experience. It does not change your account or permit writes.")
                }
            }

            Section {
                Picker(selection: $themeChoice) {
                    ForEach(ThemeChoice.allCases) { choice in
                        Text(choice.label)
                            .tag(choice)
                    }
                } label: {
                    SettingsRow(title: "Theme", systemImage: "circle.lefthalf.filled", color: .indigo) {
                        EmptyView()
                    }
                }
                .pickerStyle(.menu)
            } footer: {
                Text("Your theme choice is saved on this device only.")
            }

            Section {
                Link(destination: Self.privacyURL) {
                    SettingsRow(title: "Privacy Policy", systemImage: "hand.raised.fill", color: .blue) {
                        externalLinkIndicator
                    }
                }
                Link(destination: Self.supportURL) {
                    SettingsRow(title: "Contact Support", systemImage: "envelope.fill", color: .green) {
                        externalLinkIndicator
                    }
                }
                SettingsRow(title: "Version", systemImage: "app.badge", color: .gray) {
                    Text(appVersion)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Link(destination: Self.iosSettingsURL) {
                    SettingsRow(title: "Open iOS Settings", systemImage: "gear", color: .gray) {
                        externalLinkIndicator
                    }
                }
            } footer: {
                Text("Camera, notification, and other system permissions live in iOS Settings.")
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    showSignOutConfirm = true
                }
                .frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .preferredColorScheme(themeChoice.colorScheme)
        .confirmationDialog(
            "Sign out?",
            isPresented: $showSignOutConfirm,
            titleVisibility: .visible
        ) {
            Button("Sign Out", role: .destructive) {
                Task { await session.logout() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to come back.")
        }
    }

    // MARK: - Helpers

    private var canStartStudentPreview: Bool {
        session.currentUser?.role == "ADMIN" && session.currentUser?.preview == nil
    }

    private var activeRolePreview: RolePreviewInfo? {
        guard let preview = session.currentUser?.preview,
              preview.actualRole == "ADMIN",
              preview.readOnly else { return nil }
        return preview
    }

    private var pushAllowed: Bool {
        pushAuth == .authorized || pushAuth == .provisional || pushAuth == .ephemeral
    }

    private var notificationStatusText: String {
        guard let prefs = prefsVM.prefs else { return "" }
        return prefs.channels.push && pushAllowed ? "Push" : "In-app only"
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }

    private var externalLinkIndicator: some View {
        Image(systemName: "arrow.up.right.square")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }
}

/// Compact root-settings row with an immediately recognizable color tile.
/// Destination, value, and external-link accessories remain owned by callers.
private struct SettingsRow<Trailing: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let title: String
    let systemImage: String
    let color: Color
    @ViewBuilder let trailing: () -> Trailing

    @ScaledMetric(relativeTo: .body) private var iconSize = 30

    private var renderedIconSize: CGFloat { min(iconSize, 40) }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    rowIcon
                    rowTitle
                    trailing()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            } else {
                HStack(spacing: 12) {
                    rowIcon
                    rowTitle
                    Spacer(minLength: 8)
                    trailing()
                }
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private var rowIcon: some View {
        Image(systemName: systemImage)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: renderedIconSize, height: renderedIconSize)
            .background(color, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var rowTitle: some View {
        if dynamicTypeSize.isAccessibilitySize && !title.contains(" ") {
            Text(title)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        } else {
            Text(title)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
