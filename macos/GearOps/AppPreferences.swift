import AppKit
import Foundation
import Observation
import ServiceManagement

/// What the numeral beside the extra glyph counts. The glyph itself never
/// changes; only this static numeral does.
enum MenuBarCountMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case open
    case overdue
    case hidden

    var id: Self { self }

    var title: String {
        switch self {
        case .open: "Open bookings"
        case .overdue: "Overdue only"
        case .hidden: "Off"
        }
    }
}

private struct StoredAppPreferences: Codable {
    var menuBarCountMode: MenuBarCountMode
    var showsMenuBarExtra: Bool
    var usesGlobalShortcut: Bool

    init(menuBarCountMode: MenuBarCountMode, showsMenuBarExtra: Bool, usesGlobalShortcut: Bool) {
        self.menuBarCountMode = menuBarCountMode
        self.showsMenuBarExtra = showsMenuBarExtra
        self.usesGlobalShortcut = usesGlobalShortcut
    }

    private enum CodingKeys: String, CodingKey {
        case menuBarCountMode
        case showsMenuBarCount
        case showsMenuBarExtra
        case usesGlobalShortcut
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        if let mode = try values.decodeIfPresent(MenuBarCountMode.self, forKey: .menuBarCountMode) {
            menuBarCountMode = mode
        } else {
            // Installs before the count mode stored a Bool; off maps to hidden.
            let showsCount = try values.decodeIfPresent(Bool.self, forKey: .showsMenuBarCount) ?? true
            menuBarCountMode = showsCount ? .open : .hidden
        }
        // Existing installs predate the visibility control and should keep
        // their menu-bar entry until the user chooses otherwise.
        showsMenuBarExtra = try values.decodeIfPresent(Bool.self, forKey: .showsMenuBarExtra) ?? true
        usesGlobalShortcut = try values.decodeIfPresent(Bool.self, forKey: .usesGlobalShortcut) ?? true
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(menuBarCountMode, forKey: .menuBarCountMode)
        try values.encode(showsMenuBarExtra, forKey: .showsMenuBarExtra)
        try values.encode(usesGlobalShortcut, forKey: .usesGlobalShortcut)
    }
}

@MainActor
@Observable
final class AppPreferencesStore {
    private static let key = "GearOpsAppPreferencesV1"

    private let defaults: UserDefaults

    /// The count is the reason most people keep this app in the menu bar, so it
    /// shows open bookings by default; overdue narrows it to what needs action.
    var menuBarCountMode: MenuBarCountMode {
        didSet { persist() }
    }

    /// The companion is useful as a background helper, but its menu-bar item
    /// is still optional. The setting is persisted independently of the count
    /// preference so hiding one does not unexpectedly hide the other.
    var showsMenuBarExtra: Bool {
        didSet { persist() }
    }

    /// ⌃⌥⌘G opens the status window from any app, including when macOS has
    /// tucked the extra away to make room for app menus.
    var usesGlobalShortcut: Bool {
        didSet { persist() }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        guard let data = defaults.data(forKey: Self.key),
              let stored = try? JSONDecoder().decode(StoredAppPreferences.self, from: data) else {
            menuBarCountMode = .open
            showsMenuBarExtra = true
            usesGlobalShortcut = true
            return
        }
        menuBarCountMode = stored.menuBarCountMode
        showsMenuBarExtra = stored.showsMenuBarExtra
        usesGlobalShortcut = stored.usesGlobalShortcut
    }

    private func persist() {
        let stored = StoredAppPreferences(
            menuBarCountMode: menuBarCountMode,
            showsMenuBarExtra: showsMenuBarExtra,
            usesGlobalShortcut: usesGlobalShortcut
        )
        guard let data = try? JSONEncoder().encode(stored) else { return }
        defaults.set(data, forKey: Self.key)
    }

    /// Launch reads this before SwiftUI mounts so a hidden extra can still
    /// recover through the Dock instead of leaving an accessory process with
    /// no visible entry point.
    static func showsMenuBarExtra(in defaults: UserDefaults = .standard) -> Bool {
        guard let data = defaults.data(forKey: key),
              let stored = try? JSONDecoder().decode(StoredAppPreferences.self, from: data) else {
            return true
        }
        return stored.showsMenuBarExtra
    }
}

enum GearOpsActivation {
    @MainActor
    static func apply(showsMenuBarExtra visible: Bool) {
        let policy: NSApplication.ActivationPolicy = visible ? .accessory : .regular
        guard NSApp.activationPolicy() != policy else { return }
        NSApp.setActivationPolicy(policy)
    }

    @MainActor
    static func applyFromDefaults(_ defaults: UserDefaults = .standard) {
        apply(showsMenuBarExtra: AppPreferencesStore.showsMenuBarExtra(in: defaults))
    }
}

enum LoginItemState: Equatable, Sendable {
    case enabled
    case disabled
    case requiresApproval
    case unavailable

    /// Approval-pending means the login item was requested and remains
    /// registered; rendering the switch as off invited users to register it
    /// repeatedly instead of approving the existing request.
    var isOn: Bool { self == .enabled || self == .requiresApproval }

    var canChange: Bool { self != .unavailable }

    var detail: String? {
        switch self {
        case .enabled, .disabled: nil
        case .requiresApproval: "Approve Wisconsin Creative in System Settings › General › Login Items."
        case .unavailable: "macOS could not locate a registerable login item for this copy of the app. This is expected when running from a build directory rather than an installed copy."
        }
    }
}

/// Wraps `SMAppService` so the settings surface deals in one small state value.
/// macOS can hold a registration in `requiresApproval` until the user confirms
/// it in System Settings, which is a normal outcome rather than a failure.
@MainActor
@Observable
final class LoginItemController {
    var state: LoginItemState = .disabled
    var failureMessage: String?

    private let service: SMAppService

    init(service: SMAppService = .mainApp) {
        self.service = service
        refresh()
    }

    func refresh() {
        state = switch service.status {
        case .enabled: .enabled
        case .notRegistered: .disabled
        case .requiresApproval: .requiresApproval
        case .notFound: .unavailable
        @unknown default: .unavailable
        }
    }

    func setEnabled(_ enabled: Bool) {
        do {
            if enabled {
                try service.register()
            } else {
                try service.unregister()
            }
            failureMessage = nil
        } catch {
            failureMessage = error.localizedDescription
        }
        refresh()
    }

    func openLoginItemsSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }
}
