import Foundation

enum KioskConnectionState: String, Equatable, Sendable {
    case online
    case stale
    case offline
    case inactive

    var label: String {
        switch self {
        case .online: "Online"
        case .stale: "Idle"
        case .offline: "Offline"
        case .inactive: "Inactive"
        }
    }

    /// A kiosk between five minutes and 24 hours since its last heartbeat is
    /// simply not in use. Only a device past 24 hours, or one that has never
    /// checked in, represents an actual fault.
    var isFault: Bool { self == .offline }

    /// The extra lists devices staff can act on. Inactive stays in the fleet
    /// summary so the count is honest, without occupying a glance row.
    var appearsInGlance: Bool { self != .inactive }
}

extension KioskDevice {
    var isIncludedInMonitoring: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .caseInsensitiveCompare("Sim iPad") != .orderedSame
    }

    func connectionState(at now: Date = .now) -> KioskConnectionState {
        guard active, activated else { return .inactive }
        guard let lastSeenAt else { return .offline }

        let age = max(0, now.timeIntervalSince(lastSeenAt))
        if age <= 5 * 60 { return .online }
        if age <= 24 * 60 * 60 { return .stale }
        return .offline
    }

    var buildLabel: String? {
        guard let appVersion else { return nil }
        return appBuild.map { "\(appVersion) (\($0))" } ?? appVersion
    }
}

enum GearOpsHealthSeverity: Int, Comparable, Sendable {
    case healthy
    case attention
    case critical

    static func < (lhs: GearOpsHealthSeverity, rhs: GearOpsHealthSeverity) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var symbol: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .attention: "exclamationmark.triangle.fill"
        case .critical: "xmark.octagon.fill"
        }
    }
}

struct KioskFleetCounts: Equatable, Sendable {
    let online: Int
    let stale: Int
    let offline: Int
    let inactive: Int

    init(devices: [KioskDevice], at now: Date = .now) {
        var online = 0
        var stale = 0
        var offline = 0
        var inactive = 0

        for device in devices where device.isIncludedInMonitoring {
            switch device.connectionState(at: now) {
            case .online: online += 1
            case .stale: stale += 1
            case .offline: offline += 1
            case .inactive: inactive += 1
            }
        }

        self.online = online
        self.stale = stale
        self.offline = offline
        self.inactive = inactive
    }

    var summary: String {
        let total = online + stale + offline + inactive
        guard total > 0 else { return "0 configured" }

        var parts = ["\(online) online"]
        if stale > 0 { parts.append("\(stale) idle") }
        if offline > 0 { parts.append("\(offline) offline") }
        if inactive > 0 { parts.append("\(inactive) inactive") }
        return parts.joined(separator: " · ")
    }
}
