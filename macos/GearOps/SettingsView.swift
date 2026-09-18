import AppKit
import SwiftUI

struct GearOpsSettingsView: View {
    let model: GearOpsModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        TabView {
            GeneralSettingsTab(model: model)
                .tabItem { Label("General", systemImage: "gearshape") }
            NotificationSettingsTab(model: model)
                .tabItem { Label("Notifications", systemImage: "bell.badge") }
            AccountSettingsTab(model: model)
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
        }
        .frame(width: 480)
        .background(SettingsWindowActivator())
        .onReceive(NotificationCenter.default.publisher(for: .gearOpsOpenSettings)) { _ in
            NSApplication.shared.activate()
            openWindow(id: GearOpsWindow.settings)
        }
    }
}

/// Second half of the accessory-app activation fix. Ordering the window from
/// the menu covers the common path; this covers every other way the window can
/// appear, including a re-open while the app is in the background.
private struct SettingsWindowActivator: NSViewRepresentable {
    func makeNSView(context: Context) -> SettingsWindowActivationProbe {
        SettingsWindowActivationProbe()
    }

    func updateNSView(_ nsView: SettingsWindowActivationProbe, context: Context) {}

    static func dismantleNSView(_ nsView: SettingsWindowActivationProbe, coordinator: ()) {}
}

/// Activates only when the settings window becomes visible. SwiftUI can update
/// an `NSViewRepresentable` for unrelated model changes; activating from
/// `updateNSView` made those refreshes steal focus from the user's current app.
@MainActor
private final class SettingsWindowActivationProbe: NSView {
    private weak var observedWindow: NSWindow?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard observedWindow !== window else { return }
        observedWindow = window

        guard let window else { return }
        if window.isVisible {
            bringForward(window)
        }
    }

    private func bringForward(_ window: NSWindow?) {
        guard let window, !window.isKeyWindow else { return }
        NSApplication.shared.activate()
        window.makeKeyAndOrderFront(nil)
    }

}

private struct GeneralSettingsTab: View {
    let model: GearOpsModel

    @Environment(\.scenePhase) private var scenePhase
    @State private var loginItem = LoginItemController()

    var body: some View {
        @Bindable var preferences = model.appPreferences

        Form {
            Section {
                Toggle("Open at login", isOn: loginItemBinding)
                    .toggleStyle(.switch)
                    .disabled(!loginItem.state.canChange)
                if let detail = loginItem.state.detail {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "info.circle")
                            .foregroundStyle(.secondary)
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if loginItem.state == .requiresApproval {
                    Button("Open Login Items…") { loginItem.openLoginItemsSettings() }
                }
                if let failure = loginItem.failureMessage {
                    Label(failure, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Startup")
            } footer: {
                Text("Open Wisconsin Creative automatically after you log in to this Mac.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                Toggle("Show in menu bar", isOn: $preferences.showsMenuBarExtra)
                    .toggleStyle(.switch)
                Toggle("Show open booking count", isOn: $preferences.showsMenuBarCount)
                    .toggleStyle(.switch)
                    .disabled(!preferences.showsMenuBarExtra)
            } header: {
                Text("Menu bar")
            } footer: {
                Text("You choose whether the icon stays in the menu bar. Command-dragging it out also turns this off, and macOS may hide extras when space is tight. Wisconsin Creative then appears in the Dock, where Dashboard, Refresh, Show in Menu Bar, and Settings stay available.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear { loginItem.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { loginItem.refresh() }
        }
        .onChange(of: preferences.showsMenuBarExtra) { _, visible in
            GearOpsActivation.apply(showsMenuBarExtra: visible)
        }
    }

    private var loginItemBinding: Binding<Bool> {
        Binding(
            get: { loginItem.state.isOn },
            set: { loginItem.setEnabled($0) }
        )
    }
}

private struct NotificationSettingsTab: View {
    let model: GearOpsModel

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var settings = model.notificationSettings

        Form {
            Section {
                Toggle("Booking alerts", isOn: $settings.isEnabled)
                    .toggleStyle(.switch)
            } footer: {
                Text("Alerts are silent by default and open the affected booking in Wisconsin Creative. Wisconsin Creative never changes custody from this app.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Alert me about") {
                ForEach(BookingChangeCategory.allCases) { category in
                    Toggle(isOn: binding(for: category)) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Image(systemName: category.symbol)
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(.tint)
                                .frame(width: 18, alignment: .center)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(category.title)
                                Text(category.detail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .accessibilityLabel(category.title)
                    .accessibilityHint(category.detail)
                }
                .disabled(!settings.isEnabled)
            }

            Section("Delivery") {
                Toggle("Play a sound", isOn: $settings.playsSound)
                    .toggleStyle(.switch)
                    .disabled(!settings.isEnabled)
            }

            Section("Permission") {
                LabeledContent("System notifications") {
                    HStack(spacing: 6) {
                        Image(systemName: authorizationSymbol)
                            .foregroundStyle(authorizationColor)
                        Text(model.notificationAuthorization.label)
                            .foregroundStyle(.secondary)
                    }
                }
                if model.notificationAuthorization.needsSystemSettings {
                    Button("Open Notification Settings…") {
                        model.openSystemNotificationSettings()
                    }
                }
            }
        }
        .formStyle(.grouped)
        .task { await model.refreshNotificationAuthorization() }
        .onChange(of: settings.isEnabled) { _, enabled in
            Task {
                if enabled {
                    await model.requestNotificationAccess()
                } else {
                    await model.clearBookingAlerts()
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await model.refreshNotificationAuthorization() }
        }
    }

    private func binding(for category: BookingChangeCategory) -> Binding<Bool> {
        Binding(
            get: { model.notificationSettings.isEnabled(category) },
            set: { model.notificationSettings.setCategory(category, enabled: $0) }
        )
    }

    private var authorizationSymbol: String {
        switch model.notificationAuthorization {
        case .authorized, .provisional: "checkmark.circle.fill"
        case .denied: "exclamationmark.triangle.fill"
        case .notDetermined, .unknown: "questionmark.circle.fill"
        }
    }

    private var authorizationColor: Color {
        switch model.notificationAuthorization {
        case .authorized, .provisional: .green
        case .denied: .orange
        case .notDetermined, .unknown: .secondary
        }
    }
}

private struct AccountSettingsTab: View {
    let model: GearOpsModel

    var body: some View {
        Form {
            if let user = model.user {
                Section {
                    LabeledContent("Signed in as") {
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(user.name)
                            Text(user.email)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    LabeledContent("Role", value: user.role.capitalized)
                }
            } else {
                SettingsSignInForm(model: model)
            }

            Section {
                LabeledContent("Companion data") {
                    Text(model.user == nil
                        ? "Not signed in"
                        : model.snapshot?.freshnessLabel() ?? "No data yet")
                        .foregroundStyle(.secondary)
                }
                LabeledContent(
                    "Kiosks",
                    value: model.user == nil ? "Not signed in" : model.kioskStatusSummary
                )
            } header: {
                Text("Status")
            } footer: {
                Text("Wisconsin Creative reads a cached projection. It never writes to Wisconsin Creative.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                Button("Open Wisconsin Creative") { model.openDashboard() }
                if model.user != nil {
                    Button("Sign Out", role: .destructive) {
                        Task { await model.signOut() }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}

/// Settings is the recovery surface when the extra is hidden, so sign-in cannot
/// live only in the menu bar popover.
private struct SettingsSignInForm: View {
    let model: GearOpsModel

    @State private var email = ""
    @State private var password = ""
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case email
        case password
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var authBusy: Bool {
        model.isSigningIn || model.isSigningOut
    }

    private var canSubmit: Bool {
        trimmedEmail.contains("@") && !password.isEmpty && !authBusy
    }

    var body: some View {
        Section {
            TextField("Email", text: $email)
                .textContentType(.username)
                .focused($focusedField, equals: .email)
                .disabled(authBusy)
                .onSubmit { focusedField = .password }
            SecureField("Password", text: $password)
                .textContentType(.password)
                .focused($focusedField, equals: .password)
                .disabled(authBusy)
                .onSubmit(submit)
            if let message = model.statusMessage {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Sign-in problem: \(message)")
                    .accessibilityAddTraits(.updatesFrequently)
            }
            Button(authBusy ? "Signing in…" : "Sign in") { submit() }
                .disabled(!canSubmit)
        } header: {
            Text("Account")
        } footer: {
            Text("Sign in here if the menu bar icon is hidden or macOS has tucked it away.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .onDisappear {
            password = ""
            focusedField = nil
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focusedField = nil
        let submittedEmail = trimmedEmail
        let submittedPassword = password
        password = ""
        Task {
            await model.signIn(email: submittedEmail, password: submittedPassword)
            if model.user == nil {
                focusedField = .password
            }
        }
    }
}
