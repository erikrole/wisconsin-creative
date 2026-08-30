import SwiftUI
import UserNotifications

struct NotificationSettingsView: View {
    @Environment(AppState.self) private var appState
    let prefsVM: NotificationPrefsViewModel
    @Binding var pushAuth: UNAuthorizationStatus
    let iosSettingsURL: URL
    let showPushPrompt: () -> Void

    @AppStorage(PushTokenStorage.currentTokenKey) private var currentPushToken = ""
    @State private var isSendingTestPush = false
    @State private var testPushMessage: String?
    @State private var testPushSucceeded = false

    var body: some View {
        List {
            Section {
                SettingsMenuRow(
                    title: "Delivery status",
                    subtitle: notificationSummaryText,
                    systemImage: notificationSummaryIcon,
                    tint: notificationSummaryTint
                ) {
                    Text(pushStatusText)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(pushStatusTone)
                        .multilineTextAlignment(.trailing)
                }

                pushPermissionRow

                if pushAuth == .authorized || pushAuth == .provisional || pushAuth == .ephemeral {
                    pushRegistrationRow
                }

                if prefsVM.loading && prefsVM.prefs == nil {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("Loading preferences…")
                            .foregroundStyle(.secondary)
                            .font(.subheadline)
                    }
                } else if let err = prefsVM.error {
                    preferenceErrorRow(
                        err,
                        buttonTitle: prefsVM.prefs == nil ? "Retry" : "Reload"
                    )
                }
            } footer: {
                Text("In-app notifications always show in your inbox, regardless of these settings.")
            }

            if prefsVM.prefs != nil {
                quietHoursSection
            }

            if let prefs = prefsVM.prefs {
                Section {
                    channelToggle(
                        title: "Push alerts",
                        description: "Send push notifications to this device.",
                        isOn: prefs.channels.push,
                        onChange: { v in Task { await prefsVM.setChannel(.push, value: v) } }
                    )

                    if canSendTestPush {
                        Button {
                            Task { await sendTestPush() }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "paperplane.fill")
                                    .foregroundStyle(Color.statusText(.blue))
                                    .frame(width: 22)
                                Text("Send Test Notification")
                                    .foregroundStyle(.primary)
                                Spacer()
                                if isSendingTestPush {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                            }
                        }
                        .disabled(isSendingTestPush)
                        .accessibilityHint("Sends a real push notification to this device.")
                    } else {
                        Label(testPushUnavailableText, systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let testPushMessage {
                        Label(
                            testPushMessage,
                            systemImage: testPushSucceeded ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(testPushSucceeded ? Color.statusText(.green) : Color.statusText(.orange))
                        .fixedSize(horizontal: false, vertical: true)
                    }
                } header: {
                    Text("Delivery")
                } footer: {
                    Text("Push alerts go to devices signed in to this account. The test checks this device only.")
                }

                Section {
                    categoryToggle(
                        title: "Checkout due reminders",
                        description: "Notified before gear is due back.",
                        category: .checkoutDue
                    )

                    categoryToggle(
                        title: "Checkout overdue alerts",
                        description: "Notified when gear is past due.",
                        category: .checkoutOverdue
                    )

                    categoryToggle(
                        title: "Reservation updates",
                        description: "Confirmation, pickup-ready, and cancellation notices.",
                        category: .reservation
                    )

                    categoryToggle(
                        title: "License expiry reminders",
                        description: "Notified when one of your licenses is approaching expiry.",
                        category: .licenseExpiry
                    )

                    categoryToggle(
                        title: "Schedule updates",
                        description: "Published shift assignments, removals, and call-time changes.",
                        category: .schedule
                    )

                    categoryToggle(
                        title: "Trade updates",
                        description: "Claimed, approved, declined, completed, and expired shift trades.",
                        category: .trade
                    )

                    categoryToggle(
                        title: "Gear prep nudges",
                        description: "Staff-triggered reminders to reserve or prepare gear.",
                        category: .gearPrep
                    )
                } header: {
                    Text("Notification Types")
                } footer: {
                    Text("Choose which push alerts can reach you.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if prefsVM.prefs == nil {
                await prefsVM.load()
            }
            await refreshPushAuth()
        }
        .onChange(of: testPushMessage) { _, message in
            if let message {
                AccessibilityNotification.Announcement(message).post()
            }
        }
        .onChange(of: prefsVM.error) { _, message in
            if let message {
                AccessibilityNotification.Announcement(message).post()
            }
        }
    }

    @ViewBuilder
    private var quietHoursSection: some View {
        Section {
            if let pauseDate = prefsVM.pausedUntilDate {
                HStack(spacing: 12) {
                    Image(systemName: "moon.zzz.fill")
                        .foregroundStyle(Color.statusText(.orange))
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Alerts paused")
                            .font(.subheadline.weight(.medium))
                        Text("Until \(pauseDate.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Button {
                    Task { await prefsVM.resume() }
                } label: {
                    Label("Resume now", systemImage: "bell.fill")
                }
                .disabled(prefsVM.saving)
            } else {
                pauseButton(title: "Pause 1 hour", seconds: 60 * 60)
                pauseButton(title: "Pause 1 day", seconds: 24 * 60 * 60)
                pauseButton(title: "Pause 1 week", seconds: 7 * 24 * 60 * 60)
            }
        } header: {
            Text("Quiet hours")
        } footer: {
            Text("Pausing mutes push and email alerts until the selected time. In-app notifications remain available.")
        }
    }

    private func pauseButton(title: String, seconds: TimeInterval) -> some View {
        Button {
            Task { await prefsVM.pause(for: seconds) }
        } label: {
            Text(title)
        }
        .disabled(prefsVM.saving)
    }

    private func preferenceErrorRow(_ message: String, buttonTitle: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(message)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.statusText(.orange))
            }

            Button(buttonTitle) {
                Task { await prefsVM.load() }
            }
            .buttonStyle(.bordered)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var pushRegistrationRow: some View {
        switch appState.pushRegistrationState {
        case .unknown:
            registrationRecoveryRow(
                title: "This device is not registered for push",
                message: "Push is allowed in iOS, but this device hasn't finished connecting for alerts yet."
            )
        case .registering:
            HStack(spacing: 12) {
                ProgressView()
                    .controlSize(.small)
                Text("Registering this device for push…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .registered:
            if deviceRegistrationReady {
                Label("This device is registered for push", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Color.statusText(.green))
            } else {
            registrationRecoveryRow(
                title: "This device's push registration is unavailable",
                message: "This device was registered before, but its current alert connection is unavailable."
                )
            }
        case .failed:
            registrationRecoveryRow(
                title: "Push registration needs attention",
                message: "This device couldn't finish connecting for push alerts."
            )
        }
    }

    private func registrationRecoveryRow(title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.medium))
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.statusText(.orange))
            }

            Button {
                appState.requestRemoteNotificationRegistration()
            } label: {
                Label("Retry registration", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityHint("Attempts to register this device for push notifications again.")
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var pushPermissionRow: some View {
        switch pushAuth {
        case .denied:
            Link(destination: iosSettingsURL) {
                HStack(spacing: 12) {
                    Image(systemName: "bell.slash.fill")
                        .foregroundStyle(Color.statusText(.orange))
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Push disabled in iOS Settings")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Tap to open Settings and re-enable.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(.tertiary)
                }
            }
            .accessibilityLabel("Push disabled in iOS Settings. Tap to open Settings.")
        case .notDetermined:
            Button {
                showPushPrompt()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "bell.badge")
                        .foregroundStyle(Color.statusText(.blue))
                        .frame(width: 22)
                    Text("Turn on notifications")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                }
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func channelToggle(
        title: String,
        description: String,
        isOn: Bool,
        onChange: @escaping (Bool) -> Void
    ) -> some View {
        let binding = Binding(
            get: { isOn },
            set: { onChange($0) }
        )
        Toggle(isOn: binding) {
            Text(title)
                .font(.subheadline.weight(.medium))
        }
        .tint(Color.statusText(.green))
        .disabled(prefsVM.saving || prefsVM.isPaused)
        .accessibilityHint(
            prefsVM.isPaused
                ? "\(description) Alert delivery is paused until \(pauseEndText). Resume alerts before changing this channel."
                : description
        )
    }

    @ViewBuilder
    private func categoryToggle(
        title: String,
        description: String,
        category: NotificationPrefsViewModel.Category
    ) -> some View {
        let binding = Binding(
            get: { prefsVM.categoryValue(category) },
            set: { value in Task { await prefsVM.setCategory(category, value: value) } }
        )
        Toggle(isOn: binding) {
            Text(title)
                .font(.subheadline.weight(.medium))
        }
        .tint(Color.statusText(.green))
        .disabled(prefsVM.saving)
        .accessibilityHint(
            prefsVM.isPaused
                ? "\(description) Alerts are currently paused; this choice applies when alerts resume."
                : description
        )
    }

    private var notificationSummaryText: String {
        if prefsVM.loading && prefsVM.prefs == nil {
            return "Loading push and notification type preferences."
        }
        if prefsVM.error != nil && prefsVM.prefs == nil {
            return "Preferences could not load. Retry below before changing alert behavior."
        }
        guard let prefs = prefsVM.prefs else {
            return "In-app notifications are always available."
        }
        if prefsVM.isPaused {
            return "Paused until \(pauseEndText). Inbox remains available."
        }
        guard prefs.channels.push else {
            return "Push is off. Inbox remains available."
        }
        guard pushAllowed else {
            return "Push is on, but iOS notifications are off. Inbox remains available."
        }
        switch appState.pushRegistrationState {
        case .registered where deviceRegistrationReady:
            return "Push is on and this device is registered."
        case .registering:
            return "Push is on; this device is registering."
        case .failed:
            return "Push is on, but this device needs registration attention."
        case .unknown, .registered:
            return "Push is on, but this device is not registered yet."
        }
    }

    private var notificationSummaryIcon: String {
        if prefsVM.error != nil { return "exclamationmark.triangle.fill" }
        return "bell.badge"
    }

    private var notificationSummaryTint: Color {
        if prefsVM.error != nil { return Color.statusText(.orange) }
        return Color.statusText(.blue)
    }

    private var pushStatusText: String {
        if prefsVM.isPaused { return "Paused" }
        if let prefs = prefsVM.prefs, !prefs.channels.push { return "Push off" }
        switch pushAuth {
        case .authorized, .provisional, .ephemeral:
            switch appState.pushRegistrationState {
            case .unknown: return "Not registered"
            case .registering: return "Registering"
            case .registered where deviceRegistrationReady: return "Ready"
            case .registered, .failed: return "Needs attention"
            }
        case .denied:
            return "iOS off"
        case .notDetermined:
            return "Not set"
        @unknown default:
            return "Unknown"
        }
    }

    private var pushStatusTone: Color {
        if prefsVM.isPaused { return Color.statusText(.orange) }
        if let prefs = prefsVM.prefs, !prefs.channels.push { return .secondary }
        switch pushAuth {
        case .authorized, .provisional, .ephemeral:
            switch appState.pushRegistrationState {
            case .registered where deviceRegistrationReady: return Color.statusText(.green)
            case .registering: return Color.statusText(.blue)
            case .unknown, .registered, .failed: return Color.statusText(.orange)
            }
        case .denied:
            return Color.statusText(.orange)
        case .notDetermined:
            return .secondary
        @unknown default:
            return .secondary
        }
    }

    private var pushAllowed: Bool {
        pushAuth == .authorized || pushAuth == .provisional || pushAuth == .ephemeral
    }

    private var deviceRegistrationReady: Bool {
        appState.pushRegistrationState == .registered && !currentPushToken.isEmpty
    }

    private var canSendTestPush: Bool {
        guard let prefs = prefsVM.prefs else { return false }
        return prefs.channels.push && !prefsVM.isPaused && pushAllowed && deviceRegistrationReady
    }

    private var testPushUnavailableText: String {
        guard let prefs = prefsVM.prefs else {
            return "Load notification preferences before testing delivery."
        }
        if prefsVM.isPaused {
            return "Resume alerts before sending a test notification."
        }
        if !prefs.channels.push {
            return "Turn on Push alerts before sending a test notification."
        }
        if !pushAllowed {
            return "Enable notifications in iOS Settings before sending a test notification."
        }
        switch appState.pushRegistrationState {
        case .registering:
            return "This device is still registering for push."
        case .unknown, .registered, .failed:
            return "Register this device for push before sending a test notification."
        }
    }

    private var pauseEndText: String {
        prefsVM.pausedUntilDate?.formatted(date: .abbreviated, time: .shortened) ?? "the selected time"
    }

    @MainActor
    private func sendTestPush() async {
        guard !isSendingTestPush else { return }
        isSendingTestPush = true
        testPushMessage = nil
        defer { isSendingTestPush = false }

        guard canSendTestPush else {
            testPushSucceeded = false
            testPushMessage = testPushUnavailableText
            Haptics.warning()
            return
        }

        do {
            let result = try await APIClient.shared.sendTestPush(deviceToken: currentPushToken)
            if result.delivered > 0 {
                testPushSucceeded = true
                testPushMessage = "Test notification sent to this device."
                Haptics.success()
            } else if result.devices == 0 {
                testPushSucceeded = false
                testPushMessage = "No registered device was found. Retry push registration above."
                Haptics.warning()
            } else {
                testPushSucceeded = false
                testPushMessage = "The test notification was not delivered. Retry registration and try again."
                Haptics.warning()
            }
        } catch {
            testPushSucceeded = false
            testPushMessage = error.localizedDescription
            Haptics.warning()
        }
    }

    private func refreshPushAuth() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        pushAuth = settings.authorizationStatus
    }
}
