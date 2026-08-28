import UserNotifications

/// Long-press (and pull-down) actions on a delivered notification.
///
/// Two rules shape this list.
///
/// First, **no action opens a mutation sheet.** `WisconsinApp.onOpenURL`
/// already refuses to route a tapped link into Extend, on the grounds that
/// extending is a decision taken deliberately on the booking page. A lock
/// screen button is a weaker signal of intent than a tapped link, not a
/// stronger one, so the same rule holds here.
///
/// Second, the **only server write offered is the blast acknowledgement**,
/// because "Got it" *is* the acknowledgement — the same idempotent call the
/// in-app banner button makes, with the same meaning. Everything else either
/// routes into the app or stays entirely on the device.
enum GearTrackerNotificationCategory: String, CaseIterable {
    /// Gear custody: due, overdue, reservations, gear prep.
    case booking = "GT_BOOKING"
    /// Shifts, call times, trades.
    case schedule = "GT_SCHEDULE"
    /// An operational broadcast the reader is expected to acknowledge.
    case blast = "GT_BLAST"

    private var actions: [UNNotificationAction] {
        switch self {
        case .booking:
            return [
                UNNotificationAction(
                    identifier: GearTrackerNotificationAction.snooze.rawValue,
                    title: "Remind Me in 1 Hour",
                    options: []
                ),
                UNNotificationAction(
                    identifier: GearTrackerNotificationAction.view.rawValue,
                    title: "View Booking",
                    options: [.foreground]
                ),
            ]
        case .schedule:
            return [
                UNNotificationAction(
                    identifier: GearTrackerNotificationAction.view.rawValue,
                    title: "View Shift",
                    options: [.foreground]
                ),
            ]
        case .blast:
            return [
                UNNotificationAction(
                    identifier: GearTrackerNotificationAction.acknowledgeBlast.rawValue,
                    title: "Got it",
                    options: []
                ),
                UNNotificationAction(
                    identifier: GearTrackerNotificationAction.view.rawValue,
                    title: "Open",
                    options: [.foreground]
                ),
            ]
        }
    }

    private var category: UNNotificationCategory {
        UNNotificationCategory(
            identifier: rawValue,
            actions: actions,
            intentIdentifiers: [],
            options: []
        )
    }

    /// Registered once at launch. A push whose `aps.category` names an
    /// identifier that is not registered simply renders without actions, which
    /// is why the server can start sending categories before this ships.
    static func register(with center: UNUserNotificationCenter = .current()) {
        center.setNotificationCategories(Set(allCases.map(\.category)))
    }
}

enum GearTrackerNotificationAction: String {
    case snooze = "GT_SNOOZE"
    case view = "GT_VIEW"
    case acknowledgeBlast = "GT_ACK_BLAST"
}

/// Re-delivers a notification later, entirely on the device.
///
/// Deliberately local: there is no "snooze" concept on the server, and
/// inventing one from a lock-screen button would put a row in the audit trail
/// that no operator asked for. The copy of the alert keeps the original
/// payload so the reminder routes exactly where the original would have.
enum NotificationSnooze {
    static let interval: TimeInterval = 60 * 60

    /// The parts of a delivered notification a reminder needs.
    ///
    /// `UNNotification` is not `Sendable` and `userInfo` is `[AnyHashable: Any]`,
    /// so neither can cross an isolation boundary under Swift 6. The routing
    /// keys are lifted out as plain strings on the delegate's actor first —
    /// which also means the reminder can only ever route somewhere the original
    /// could.
    struct Payload: Sendable {
        static let routingKeys = ["bookingId", "eventId", "blastId"]

        let identifier: String
        let title: String
        let body: String
        let categoryIdentifier: String
        let routing: [String: String]

        init(notification: UNNotification) {
            let content = notification.request.content
            identifier = notification.request.identifier
            title = content.title
            body = content.body
            categoryIdentifier = content.categoryIdentifier
            routing = Self.routingKeys.reduce(into: [:]) { result, key in
                if let value = content.userInfo[key] as? String { result[key] = value }
            }
        }
    }

    static func schedule(_ payload: Payload) async {
        let content = UNMutableNotificationContent()
        content.title = payload.title
        content.body = payload.body
        content.sound = .default
        content.userInfo = payload.routing
        content.categoryIdentifier = payload.categoryIdentifier
        // Marks the copy so the reminder is identifiable in Notification
        // Center, and so a second snooze replaces rather than stacks: the
        // request identifier below is derived from the original.
        content.subtitle = "Reminder"

        let request = UNNotificationRequest(
            identifier: "gt-snooze-\(payload.identifier)",
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        )
        try? await UNUserNotificationCenter.current().add(request)
    }
}
