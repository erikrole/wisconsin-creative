import AppIntents
import Foundation

enum GearTrackerAppIntentDestination: String, Sendable {
    case scan
    case myGear
    case todaySchedule
    case createReservation
}

@MainActor
final class GearTrackerAppIntentHandoff {
    static let shared = GearTrackerAppIntentHandoff()

    private var pendingDestination: GearTrackerAppIntentDestination?
    private var pendingBookingId: String?

    private init() {}

    func request(_ destination: GearTrackerAppIntentDestination) {
        pendingDestination = destination
        sharedAppState?.pendingAppIntentDestination = destination
    }

    func consumePendingDestination() -> GearTrackerAppIntentDestination? {
        let destination = pendingDestination
        pendingDestination = nil
        return destination
    }

    /// Booking deep-link handoff for `OpenBookingIntent`. Mirrors `request(_:)`:
    /// the sharedAppState write covers warm launches, the local copy covers cold
    /// launches where the tab shell hasn't appeared yet.
    func requestBooking(id: String) {
        pendingBookingId = id
        sharedAppState?.pendingPushBookingId = id
    }

    func consumePendingBookingId() -> String? {
        let id = pendingBookingId
        pendingBookingId = nil
        return id
    }
}

struct ScanGearCodeIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan Gear Code"
    static let description = IntentDescription("Open the scanner to look up gear, bookings, and item-family unit codes.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        try await requireIntentCapability("GEAR_CATALOG_VIEW")
        GearTrackerAppIntentHandoff.shared.request(.scan)
        return .result()
    }
}

struct ShowMyGearIntent: AppIntent {
    static let title: LocalizedStringResource = "Show My Gear"
    static let description = IntentDescription("Open the active bookings and reservations list.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        try await requireIntentCapability("MY_GEAR_VIEW")
        GearTrackerAppIntentHandoff.shared.request(.myGear)
        return .result()
    }
}

struct ShowTodayScheduleIntent: AppIntent {
    static let title: LocalizedStringResource = "Show Today's Schedule"
    static let description = IntentDescription("Open the Schedule tab for today's event and shift work.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        try await requireIntentCapability("PUBLISHED_SCHEDULE_VIEW")
        GearTrackerAppIntentHandoff.shared.request(.todaySchedule)
        return .result()
    }
}

struct CreateReservationIntent: AppIntent {
    static let title: LocalizedStringResource = "Create Reservation"
    static let description = IntentDescription("Open the new reservation workflow.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        try await requireIntentCapability("RESERVATION_CREATE")
        GearTrackerAppIntentHandoff.shared.request(.createReservation)
        return .result()
    }
}

struct GearTrackerShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ScanGearCodeIntent(),
            phrases: [
                "Scan gear with \(.applicationName)",
                "Scan a code in \(.applicationName)",
            ],
            shortTitle: "Scan Code",
            systemImageName: "qrcode.viewfinder"
        )

        AppShortcut(
            intent: ShowMyGearIntent(),
            phrases: [
                "Show my gear in \(.applicationName)",
                "Open my gear in \(.applicationName)",
            ],
            shortTitle: "Show Gear",
            systemImageName: "calendar.badge.checkmark"
        )

        AppShortcut(
            intent: ShowTodayScheduleIntent(),
            phrases: [
                "Show today's schedule in \(.applicationName)",
                "Open my schedule in \(.applicationName)",
            ],
            shortTitle: "View Schedule",
            systemImageName: "calendar"
        )

        AppShortcut(
            intent: CreateReservationIntent(),
            phrases: [
                "Create a reservation in \(.applicationName)",
                "Reserve gear in \(.applicationName)",
            ],
            shortTitle: "Reserve Gear",
            systemImageName: "plus"
        )

        AppShortcut(
            intent: MyCheckedOutGearIntent(),
            phrases: [
                "What gear do I have out in \(.applicationName)",
                "What do I have out in \(.applicationName)",
                "What's due back in \(.applicationName)",
                "Check my gear in \(.applicationName)",
            ],
            shortTitle: "Check Gear",
            systemImageName: "backpack"
        )

        AppShortcut(
            intent: NextShiftIntent(),
            phrases: [
                "When's my next shift in \(.applicationName)",
                "What's my next shift in \(.applicationName)",
                "Am I working in \(.applicationName)",
            ],
            shortTitle: "Check Shift",
            systemImageName: "clock.badge.checkmark"
        )
    }
}
