import Foundation
import Observation
import ServiceManagement

private struct StoredAppPreferences: Codable {
    var showsMenuBarCount: Bool
    var showsMenuBarExtra: Bool

    init(showsMenuBarCount: Bool, showsMenuBarExtra: Bool = true) {
        self.showsMenuBarCount = showsMenuBarCount
        self.showsMenuBarExtra = showsMenuBarExtra
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        showsMenuBarCount = try values.decodeIfPresent(Bool.self, forKey: .showsMenuBarCount) ?? true
        // Existing installs predate the visibility control and should keep
        // their menu-bar entry until the user chooses otherwise.
        showsMenuBarExtra = try values.decodeIfPresent(Bool.self, forKey: .showsMenuBarExtra) ?? true
    }
}

@MainActor
@Observable
final class AppPreferencesStore {
    private static let key = "GearOpsAppPreferencesV1"

    private let defaults: UserDefaults

    /// The count is the reason most people keep this app in the menu bar, so it
    /// stays on by default; hiding it leaves just the status glyph.
    var showsMenuBarCount: Bool {
        didSet { persist() }
    }

    /// The companion is useful as a background helper, but its menu-bar item
    /// is still optional. The setting is persisted independently of the count
    /// preference so hiding one does not unexpectedly hide the other.
    var showsMenuBarExtra: Bool {
        didSet { persist() }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        guard let data = defaults.data(forKey: Self.key),
              let stored = try? JSONDecoder().decode(StoredAppPreferences.self, from: data) else {
            showsMenuBarCount = true
            showsMenuBarExtra = true
            return
        }
        showsMenuBarCount = stored.showsMenuBarCount
        showsMenuBarExtra = stored.showsMenuBarExtra
    }

    private func persist() {
        let stored = StoredAppPreferences(
            showsMenuBarCount: showsMenuBarCount,
            showsMenuBarExtra: showsMenuBarExtra
        )
        guard let data = try? JSONEncoder().encode(stored) else { return }
        defaults.set(data, forKey: Self.key)
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
