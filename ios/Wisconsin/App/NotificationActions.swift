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
/// Second, **server writes are limited to what the alert is literally
/// about**: Mark as Read on every alert, "Got it" on a blast (the same
/// acknowledgement the in-app banner makes), and Approve / Decline on a
/// request waiting for an Admin. The server rechecks role and state for each,
/// exactly as it does in the app. By product decision these do not require
/// unlocking; `GearTrackerNotificationAction.reviewOptions` is the one place
/// to add `.authenticationRequired` back.
enum GearTrackerNotificationCategory: String, CaseIterable {
    /// Gear custody: due, overdue, reservations, gear prep.
    case booking = "GT_BOOKING"
    /// Shifts, call times, trades.
    case schedule = "GT_SCHEDULE"
    /// An operational broadcast the reader is expected to acknowledge.
    case blast = "GT_BLAST"
    /// A request waiting on an Admin decision.
    case review = "GT_REVIEW"
    /// Everything else: licenses, time off, system alerts.
    case alert = "GT_ALERT"

    private var actions: [UNNotificationAction] {
        switch self {
        case .booking:
            return [GearTrackerNotificationAction.snooze.action, GearTrackerNotificationAction.markRead.action]
        case .schedule, .alert:
            return [GearTrackerNotificationAction.markRead.action]
        case .blast:
            return [GearTrackerNotificationAction.acknowledgeBlast.action]
        case .review:
            return [GearTrackerNotificationAction.approve.action, GearTrackerNotificationAction.decline.action]
        }
    }

    private var category: UNNotificationCategory {
        UNNotificationCategory(
            identifier: rawValue,
            actions: actions,
            intentIdentifiers: [],
            hiddenPreviewsBodyPlaceholder: hiddenPreviewPlaceholder,
            options: []
        )
    }

    private var hiddenPreviewPlaceholder: String {
        switch self {
        case .booking: return "Gear and reservation update"
        case .schedule: return "Schedule update"
        case .blast: return "Operational update"
        case .review: return "Request needing review"
        case .alert: return "Account update"
        }
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
    case acknowledgeBlast = "GT_ACK_BLAST"
    case markRead = "GT_MARK_READ"
    case approve = "GT_APPROVE"
    case decline = "GT_DECLINE"

    /// Approve and Decline run from the lock screen by product decision; add
    /// `.authenticationRequired` here to require unlocking first.
    static let reviewOptions: UNNotificationActionOptions = []

    var action: UNNotificationAction {
        switch self {
        case .snooze:
            return UNNotificationAction(identifier: rawValue, title: "Remind Me in 1 Hour", options: [],
                                        icon: UNNotificationActionIcon(systemImageName: "clock"))
        case .acknowledgeBlast:
            return UNNotificationAction(identifier: rawValue, title: "Got it", options: [],
                                        icon: UNNotificationActionIcon(systemImageName: "hand.thumbsup"))
        case .markRead:
            return UNNotificationAction(identifier: rawValue, title: "Mark as Read", options: [],
                                        icon: UNNotificationActionIcon(systemImageName: "checkmark.circle"))
        case .approve:
            return UNNotificationAction(identifier: rawValue, title: "Approve", options: Self.reviewOptions,
                                        icon: UNNotificationActionIcon(systemImageName: "checkmark"))
        case .decline:
            return UNNotificationAction(identifier: rawValue, title: "Decline",
                                        options: Self.reviewOptions.union(.destructive),
                                        icon: UNNotificationActionIcon(systemImageName: "xmark"))
        }
    }
}

/// Which decision endpoint a review alert targets: a trade claim, or an
/// open-shift request (an assignment waiting for approval).
enum ReviewDecisionTarget: Equatable {
    case trade(String)
    case shiftRequest(String)

    init?(userInfo: [AnyHashable: Any]) {
        if let tradeId = userInfo["tradeId"] as? String, !tradeId.isEmpty {
            self = .trade(tradeId)
        } else if let assignmentId = userInfo["assignmentId"] as? String, !assignmentId.isEmpty {
            self = .shiftRequest(assignmentId)
        } else {
            return nil
        }
    }
}

/// Background actions can't show UI. When one fails, say so with a local
/// notification that opens the inbox, rather than failing silently.
enum NotificationActionFeedback {
    static func reportFailure(_ message: String) async {
        let content = UNMutableNotificationContent()
        content.title = message
        content.body = "Open the app to try again."
        content.threadIdentifier = "action-failures"
        let request = UNNotificationRequest(identifier: "gt-action-failure-\(UUID().uuidString)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// Notification telemetry sent through the existing privacy-first product
/// events: tags only, no titles or bodies, actor hashed server-side.
enum NotificationTelemetry {
    private static let pushStatusDayKey = "WisconsinPushStatusReportedDay"

    /// How long between delivery and the person acting on it.
    static func timeToActBucket(deliveredAt: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(deliveredAt)
        if seconds < 60 { return "under_1m" }
        if seconds < 600 { return "1_10m" }
        if seconds < 3_600 { return "10_60m" }
        return "over_1h"
    }

    /// A tap or lock-screen action on a delivered alert. `category` is the
    /// server's snake-case preference category, e.g. "checkout_overdue".
    static func recordAction(_ action: String, category: String?, deliveredAt: Date) async {
        var properties = ["mode": action, "reason": timeToActBucket(deliveredAt: deliveredAt)]
        if let category, category.range(of: "^[a-z0-9_-]{1,32}$", options: .regularExpression) != nil {
            properties["source"] = category
        }
        await APIClient.shared.recordProductEvent(
            eventName: action == "tap" ? "notification_opened" : "notification_action",
            surface: "notifications",
            properties: properties
        )
    }

    /// How long a key screen took to load, as a coarse bucket.
    static func loadBucket(since start: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(start)
        if seconds < 1 { return "under_1s" }
        if seconds < 3 { return "1_3s" }
        if seconds < 10 { return "3_10s" }
        return "over_10s"
    }

    static func recordSurfaceLoad(_ surface: String, startedAt: Date, succeeded: Bool) async {
        await APIClient.shared.recordProductEvent(
            eventName: "surface_loaded",
            surface: surface,
            outcome: succeeded ? "succeeded" : "failed",
            properties: ["reason": loadBucket(since: startedAt)]
        )
    }

    /// Once a day: can this install receive pushes? Separates "turned it off"
    /// from "registration broke" when someone says they got nothing.
    @MainActor
    static func recordPushStatusIfDue(registration: PushRegistrationState, now: Date = Date()) async {
        let day = Calendar.current.startOfDay(for: now).timeIntervalSince1970
        guard UserDefaults.standard.double(forKey: pushStatusDayKey) != day else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let permission: String = switch settings.authorizationStatus {
        case .authorized: "authorized"
        case .provisional: "provisional"
        case .ephemeral: "ephemeral"
        case .denied: "denied"
        case .notDetermined: "not_determined"
        @unknown default: "unknown"
        }
        let state: String = switch registration {
        case .unknown: "unregistered"
        case .registering: "registering"
        case .registered: "registered"
        case .failed: "failed"
        }
        UserDefaults.standard.set(day, forKey: pushStatusDayKey)
        await APIClient.shared.recordProductEvent(
            eventName: "push_status",
            surface: "notifications",
            properties: ["mode": permission, "reason": state]
        )
    }
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
        static let routingKeys = [
            "bookingId", "checkoutId", "eventId", "blastId", "assignmentId",
            "shiftId", "tradeId", "type", "href", "url", "assetId", "userId",
            "skuName", "licenseCodeId", "notificationId", "category",
        ]

        let identifier: String
        let title: String
        let subtitle: String
        let body: String
        let categoryIdentifier: String
        let routing: [String: String]
        let threadIdentifier: String

        init(notification: UNNotification) {
            let content = notification.request.content
            identifier = notification.request.identifier
            title = content.title
            subtitle = content.subtitle
            body = content.body
            categoryIdentifier = content.categoryIdentifier
            threadIdentifier = content.threadIdentifier
            routing = Self.routingKeys.reduce(into: [:]) { result, key in
                if let value = content.userInfo[key] as? String { result[key] = value }
            }
        }
    }

    static func reminderIdentifier(for identifier: String) -> String {
        var original = identifier
        while original.hasPrefix("gt-snooze-") { original.removeFirst("gt-snooze-".count) }
        return "gt-snooze-\(original)"
    }

    @MainActor
    static func schedule(_ payload: Payload, sessionBoundary: UUID) async {
        guard PushTokenStorage.registrationAllowed,
              authSessionBoundary.owns(sessionBoundary) else { return }
        let content = UNMutableNotificationContent()
        // Marks the copy as a reminder while keeping the checkout or event in
        // the subtitle; a second snooze doesn't stack another prefix.
        content.title = payload.title.hasPrefix("Reminder: ") ? payload.title : "Reminder: \(payload.title)"
        content.subtitle = payload.subtitle
        content.body = payload.body
        content.sound = .default
        content.userInfo = payload.routing
        content.categoryIdentifier = payload.categoryIdentifier
        content.threadIdentifier = payload.threadIdentifier
        // A second snooze replaces rather than stacks: the request identifier
        // below is derived from the original.

        let request = UNNotificationRequest(
            identifier: reminderIdentifier(for: payload.identifier),
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        )
        let center = UNUserNotificationCenter.current()
        try? await center.add(request)
        // Logout may clear pending requests while add is suspended.
        if !PushTokenStorage.registrationAllowed || !authSessionBoundary.owns(sessionBoundary) {
            center.removePendingNotificationRequests(withIdentifiers: [request.identifier])
        }
    }

    static func cancelPending() async {
        let center = UNUserNotificationCenter.current()
        let requests = await center.pendingNotificationRequests()
        let identifiers = requests
            .map(\.identifier)
            .filter { $0.hasPrefix("gt-snooze-") }
        guard !identifiers.isEmpty else { return }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }
}
