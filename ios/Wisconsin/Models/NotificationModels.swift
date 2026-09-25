import Foundation

struct AppNotification: Codable, Identifiable {
    let id: String
    let type: String
    let title: String
    let body: String?
    let readAt: Date?
    let createdAt: Date
    let payload: NotificationPayload?
    /// When delivery happened; older rows only have `createdAt`.
    var sentAt: Date? = nil

    var isUnread: Bool { readAt == nil }
    /// The time a person experienced the notification, matching the web inbox.
    var displayDate: Date { sentAt ?? createdAt }
}

struct NotificationPayload: Codable {
    let blastId: String?
    let bookingId: String?
    let checkoutId: String?
    let assignmentId: String?
    let assetId: String?
    let eventId: String?
    let tradeId: String?
    let shiftId: String?
    let userId: String?
    let badgeDefinitionId: String?
    let studentBadgeId: String?
    let skuName: String?
    let href: String?

    var effectiveBookingId: String? { bookingId ?? checkoutId }
}

struct NotificationsResponse: Codable {
    let data: [AppNotification]
    let total: Int
    let limit: Int
    let offset: Int
    let unreadCount: Int
}
