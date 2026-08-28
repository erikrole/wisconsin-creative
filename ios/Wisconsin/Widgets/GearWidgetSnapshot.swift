import Foundation

/// What the Home Screen widgets render.
///
/// The widget extension runs in its own process with its own container: no
/// session cookie, no keychain item, no `APIClient`. So it never fetches.
/// Everything it shows is written here by the app after a dashboard load and
/// read back out of the shared App Group container.
///
/// Treat this as a versioned contract between two processes. A widget binary
/// stays on the Home Screen across app updates, so every field added later
/// must decode from an older payload — give new fields defaults rather than
/// making them required.
struct GearWidgetSnapshot: Codable, Equatable, Sendable {
    struct Shift: Codable, Equatable, Sendable {
        let id: String
        let title: String
        let area: String
        let startsAt: Date
        let endsAt: Date
        /// Site name carried by the event. Never derived from `isHome` — the
        /// home/away flag is not a venue (`docs/AREA_SHIFTS.md`), and a widget
        /// that guesses "Camp Randall" from a boolean is worse than a widget
        /// that says nothing.
        let locationName: String?
        /// Pre-resolved gear wording (`DashboardShift.gearLabel`), so the
        /// widget never has to know the gear status vocabulary.
        let gearLabel: String?
    }

    struct DueBooking: Codable, Equatable, Sendable {
        let id: String
        let title: String
        let endsAt: Date
        let itemCount: Int
        let isOverdue: Bool
    }

    /// When the app last wrote this. The widget shows staleness rather than
    /// asserting counts it cannot confirm.
    let generatedAt: Date
    let nextShift: Shift?
    let dueBookings: [DueBooking]
    let overdueCount: Int
    let dueTodayCount: Int

    static let empty = GearWidgetSnapshot(
        generatedAt: .distantPast,
        nextShift: nil,
        dueBookings: [],
        overdueCount: 0,
        dueTodayCount: 0
    )
}

/// Shared App Group container for the app → widget handoff.
enum GearWidgetStore {
    /// Must match `com.apple.security.application-groups` on both the app and
    /// the widget extension. A build whose profile lacks the group still runs;
    /// the widgets just render their signed-out placeholder.
    static let appGroupIdentifier = "group.com.erikrole.Wisconsin"

    private static let snapshotKey = "gearWidgetSnapshot.v1"

    /// `nil` when the App Group is not provisioned for this build. Every
    /// caller degrades instead of trapping — a missing entitlement must never
    /// be able to crash the host app.
    private static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    static func write(_ snapshot: GearWidgetSnapshot) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let defaults = sharedDefaults,
              let data = try? encoder.encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
    }

    static func read() -> GearWidgetSnapshot? {
        guard let defaults = sharedDefaults,
              let data = defaults.data(forKey: snapshotKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(GearWidgetSnapshot.self, from: data)
    }

    /// Cleared at every session boundary. A signed-out phone must never leave
    /// the previous account's shift and gear sitting on the Home Screen, where
    /// it is readable without unlocking the app.
    static func clear() {
        sharedDefaults?.removeObject(forKey: snapshotKey)
    }
}
