import Foundation
import Observation

/// The kinds of booking change the companion can alert on. Categories are the
/// unit the user opts in and out of, so classification lives with the change
/// itself rather than being re-derived from display copy.
enum BookingChangeCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case reservation
    case pickupReady
    case checkout
    case checkIn
    case cancellation
    case timeChange
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .reservation: "New reservations"
        case .pickupReady: "Ready for pickup"
        case .checkout: "Checked out"
        case .checkIn: "Checked in"
        case .cancellation: "Cancellations"
        case .timeChange: "Time changes"
        case .other: "Other updates"
        }
    }

    var detail: String {
        switch self {
        case .reservation: "Gear reserved for a future date."
        case .pickupReady: "A booking is staged and waiting to be collected."
        case .checkout: "Gear left the cage and is now in physical custody."
        case .checkIn: "Gear came back and the booking closed."
        case .cancellation: "A booking was cancelled."
        case .timeChange: "A return time moved, including extensions."
        case .other: "Title, requester, and location edits."
        }
    }

    var symbol: String {
        switch self {
        case .reservation: "calendar.badge.plus"
        case .pickupReady: "shippingbox.and.arrow.backward"
        case .checkout: "arrow.up.forward.circle"
        case .checkIn: "arrow.down.backward.circle"
        case .cancellation: "xmark.circle"
        case .timeChange: "clock.arrow.circlepath"
        case .other: "pencil.circle"
        }
    }

    var notificationRelevance: Double {
        switch self {
        case .pickupReady, .checkout: 1
        case .cancellation, .timeChange: 0.7
        case .reservation, .checkIn, .other: 0.4
        }
    }
}

/// Persisted shape. Categories are stored as an explicit allow list so a
/// category added in a later build defaults to on rather than silently
/// inheriting an older user's empty set.
private struct StoredNotificationPreferences: Codable {
    var isEnabled: Bool
    var disabledCategories: [String]
    var playsSound: Bool?
}

@MainActor
@Observable
final class NotificationSettingsStore {
    private static let key = "GearOpsNotificationPreferencesV1"

    private let defaults: UserDefaults

    /// Master switch. Off suppresses every category without losing the
    /// per-category choices underneath it.
    var isEnabled: Bool {
        didSet { persist() }
    }

    private var disabledCategories: Set<BookingChangeCategory> {
        didSet { persist() }
    }

    /// Alerts stay silent by default: this app reports on other people's work
    /// and should not interrupt. Sound is an explicit opt-in.
    var playsSound: Bool {
        didSet { persist() }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults

        guard let data = defaults.data(forKey: Self.key),
              let stored = try? JSONDecoder().decode(StoredNotificationPreferences.self, from: data) else {
            isEnabled = true
            disabledCategories = []
            playsSound = false
            return
        }
        isEnabled = stored.isEnabled
        disabledCategories = Set(stored.disabledCategories.compactMap(BookingChangeCategory.init(rawValue:)))
        playsSound = stored.playsSound ?? false
    }

    func allows(_ category: BookingChangeCategory) -> Bool {
        isEnabled && !disabledCategories.contains(category)
    }

    func isEnabled(_ category: BookingChangeCategory) -> Bool {
        !disabledCategories.contains(category)
    }

    func setCategory(_ category: BookingChangeCategory, enabled: Bool) {
        if enabled {
            disabledCategories.remove(category)
        } else {
            disabledCategories.insert(category)
        }
    }

    var enabledCategoryCount: Int {
        BookingChangeCategory.allCases.count(where: isEnabled)
    }

    /// Copy for the popover and settings summary. The master switch and an
    /// all-off category list are different states and read differently.
    var summary: String {
        guard isEnabled else { return "Booking alerts are off" }
        let count = enabledCategoryCount
        if count == BookingChangeCategory.allCases.count { return "Alerting on all booking changes" }
        if count == 0 { return "No booking changes selected" }
        return "Alerting on \(count) of \(BookingChangeCategory.allCases.count) change types"
    }

    private func persist() {
        let stored = StoredNotificationPreferences(
            isEnabled: isEnabled,
            disabledCategories: disabledCategories.map(\.rawValue).sorted(),
            playsSound: playsSound
        )
        guard let data = try? JSONEncoder().encode(stored) else { return }
        defaults.set(data, forKey: Self.key)
    }
}
