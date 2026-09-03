import Foundation

// MARK: - Activation

struct KioskActivationResponse: Decodable {
    let kioskId: String
    let name: String
    let location: Location
    let sessionToken: String?

    struct Location: Decodable {
        let id: String
        let name: String
    }
}

struct KioskInfo: Codable {
    let kioskId: String
    let name: String
    let locationId: String
    let locationName: String
}

// MARK: - Dashboard

private struct LossyDecodableArray<Element: Decodable>: Decodable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var decoded: [Element] = []
        while !container.isAtEnd {
            do {
                decoded.append(try container.decode(Element.self))
            } catch {
                _ = try? container.decode(DiscardedElement.self)
            }
        }
        elements = decoded
    }

    private struct DiscardedElement: Decodable {}
}

struct KioskDashboard: Decodable {
    let stats: Stats
    let capabilities: Capabilities
    let standby: Standby?
    let events: [KioskEvent]
    let activeItems: [ActiveItem]
    let checkouts: [KioskActiveCheckout]

    enum CodingKeys: String, CodingKey {
        case stats
        case capabilities
        case standby
        case events
        case activeItems
        case checkouts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        stats = try container.decodeIfPresent(Stats.self, forKey: .stats) ?? Stats()
        capabilities = try container.decodeIfPresent(Capabilities.self, forKey: .capabilities) ?? Capabilities()
        standby = try container.decodeIfPresent(Standby.self, forKey: .standby)
        events = try container.decodeIfPresent(LossyDecodableArray<KioskEvent>.self, forKey: .events)?.elements ?? []
        activeItems = try container.decodeIfPresent(LossyDecodableArray<ActiveItem>.self, forKey: .activeItems)?.elements ?? []
        checkouts = try container.decodeIfPresent(LossyDecodableArray<KioskActiveCheckout>.self, forKey: .checkouts)?.elements ?? []
    }

    struct Stats: Decodable {
        let itemsOut: Int
        let checkouts: Int
        let overdue: Int

        init(itemsOut: Int = 0, checkouts: Int = 0, overdue: Int = 0) {
            self.itemsOut = itemsOut
            self.checkouts = checkouts
            self.overdue = overdue
        }
    }

    struct Capabilities: Decodable {
        let eventWorkerDetails: Bool
        let eventCallTimes: Bool

        init(eventWorkerDetails: Bool = false, eventCallTimes: Bool = false) {
            self.eventWorkerDetails = eventWorkerDetails
            self.eventCallTimes = eventCallTimes
        }
    }

    struct Standby: Decodable {
        let sleepMode: Bool
        let reason: String
        let nightHours: Bool
        let nearbyEventCount: Int
        let nearbyBookingWindowCount: Int

        enum CodingKeys: String, CodingKey {
            case sleepMode
            case reason
            case nightHours
            case nearbyEventCount
            case nearbyBookingWindowCount
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            sleepMode = try container.decodeIfPresent(Bool.self, forKey: .sleepMode) ?? false
            reason = try container.decodeIfPresent(String.self, forKey: .reason) ?? "active_window"
            nightHours = try container.decodeIfPresent(Bool.self, forKey: .nightHours) ?? false
            nearbyEventCount = try container.decodeIfPresent(Int.self, forKey: .nearbyEventCount) ?? 0
            nearbyBookingWindowCount = try container.decodeIfPresent(Int.self, forKey: .nearbyBookingWindowCount) ?? 0
        }
    }

    struct ActiveItem: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let tagName: String
        let imageUrl: String?
        let bulkSkuId: String?
        let unitNumber: Int?
        let checkoutId: String
        let checkoutTitle: String
        let custodyScope: String?
        let requesterId: String?
        let requesterName: String
        let requesterAvatarUrl: String?
        let endsAt: Date
        let isOverdue: Bool

        var isNumberedBulk: Bool { bulkSkuId != nil && unitNumber != nil }

        var itemListPrimaryTitle: String {
            tagName.nonBlankText ?? name
        }

        var itemListSecondaryTitle: String? {
            itemListPrimaryTitle.isSameListText(as: name) ? nil : name
        }

        var requesterInitials: String {
            requesterName.split(separator: " ").prefix(2)
                .compactMap { $0.first }
                .map { String($0) }
                .joined()
                .uppercased()
        }
    }
}

struct KioskEvent: Decodable, Identifiable {
    let id: String
    let title: String
    let sportCode: String?
    let startsAt: Date
    let endsAt: Date?
    let allDay: Bool
    let callStartsAt: Date?
    let callEndsAt: Date?
    let shiftCount: Int
    let assignedUsers: [AssignedUser]
    let assignedUserCount: Int

    struct AssignedUser: Decodable, Identifiable {
        let id: String
        let name: String
        let initials: String
        let avatarUrl: String?
        let area: String?
        let callStartsAt: Date?
        let callEndsAt: Date?
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case sportCode
        case startsAt
        case endsAt
        case allDay
        case callStartsAt
        case callEndsAt
        case shiftCount
        case assignedUsers
        case assignedUserCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        sportCode = try container.decodeIfPresent(String.self, forKey: .sportCode)
        startsAt = try container.decode(Date.self, forKey: .startsAt)
        endsAt = try container.decodeIfPresent(Date.self, forKey: .endsAt)
        allDay = try container.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        callStartsAt = try container.decodeIfPresent(Date.self, forKey: .callStartsAt)
        callEndsAt = try container.decodeIfPresent(Date.self, forKey: .callEndsAt)
        shiftCount = try container.decodeIfPresent(Int.self, forKey: .shiftCount) ?? 0
        assignedUsers = try container.decodeIfPresent(LossyDecodableArray<AssignedUser>.self, forKey: .assignedUsers)?.elements ?? []
        assignedUserCount = try container.decodeIfPresent(Int.self, forKey: .assignedUserCount) ?? assignedUsers.count
    }

    var displayAllDay: Bool {
        allDay || hasLocalMidnightSpan
    }

    private var hasLocalMidnightSpan: Bool {
        guard let endsAt, endsAt > startsAt else { return false }
        let calendar = Calendar.current
        let startOfStartDay = calendar.startOfDay(for: startsAt)
        let startOfEndDay = calendar.startOfDay(for: endsAt)
        guard startOfEndDay > startOfStartDay else { return false }
        return abs(startsAt.timeIntervalSince(startOfStartDay)) < 60 &&
            abs(endsAt.timeIntervalSince(startOfEndDay)) < 60
    }
}

struct KioskCheckoutEvent: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String?
    let sportCode: String?
    let startsAt: Date
    let endsAt: Date?
    let allDay: Bool
    let locationName: String?
    /// True when the identified requester is working a published shift on this
    /// event. Optional for rollout tolerance: a kiosk build newer than the
    /// server simply sees every event as unassigned rather than failing to
    /// decode the whole list.
    let isAssigned: Bool?

    var isMyShift: Bool { isAssigned == true }
}

struct KioskCheckoutAvailabilityResult: Decodable, Equatable {
    let conflicts: [SerializedConflict]
    let shortages: [BulkShortage]
    let unavailableAssets: [UnavailableAsset]
    let turnaroundRisks: [TurnaroundRisk]
    let bulkTurnaroundRisks: [BulkTurnaroundRisk]

    var hasBlockingIssue: Bool {
        !conflicts.isEmpty || !shortages.isEmpty || !unavailableAssets.isEmpty
    }

    var hasWarning: Bool {
        !turnaroundRisks.isEmpty || !bulkTurnaroundRisks.isEmpty
    }

    struct SerializedConflict: Decodable, Equatable {
        let assetId: String
        let conflictingBookingId: String
        let conflictingBookingTitle: String?
        let startsAt: Date
        let endsAt: Date
    }

    struct BulkShortage: Decodable, Equatable {
        let bulkSkuId: String
        let requested: Int
        let available: Int
    }

    struct UnavailableAsset: Decodable, Equatable {
        let assetId: String
        let status: String
    }

    struct TurnaroundRisk: Decodable, Equatable {
        let assetId: String
        let code: String?
        let severity: String
        let message: String
        let bookingTitle: String?
        let startsAt: Date?
        let gapMinutes: Int?
        let nextLocationName: String?
        let reportType: String?
    }

    struct BulkTurnaroundRisk: Decodable, Equatable {
        let bulkSkuId: String
        let code: String?
        let severity: String
        let message: String
        let bookingTitle: String?
        let startsAt: Date
        let gapMinutes: Int?
        let plannedQuantity: Int?
    }

    enum CodingKeys: String, CodingKey {
        case conflicts
        case shortages
        case unavailableAssets
        case turnaroundRisks
        case bulkTurnaroundRisks
    }

    init(
        conflicts: [SerializedConflict] = [],
        shortages: [BulkShortage] = [],
        unavailableAssets: [UnavailableAsset] = [],
        turnaroundRisks: [TurnaroundRisk] = [],
        bulkTurnaroundRisks: [BulkTurnaroundRisk] = []
    ) {
        self.conflicts = conflicts
        self.shortages = shortages
        self.unavailableAssets = unavailableAssets
        self.turnaroundRisks = turnaroundRisks
        self.bulkTurnaroundRisks = bulkTurnaroundRisks
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conflicts = try container.decodeIfPresent([SerializedConflict].self, forKey: .conflicts) ?? []
        shortages = try container.decodeIfPresent([BulkShortage].self, forKey: .shortages) ?? []
        unavailableAssets = try container.decodeIfPresent([UnavailableAsset].self, forKey: .unavailableAssets) ?? []
        turnaroundRisks = try container.decodeIfPresent([TurnaroundRisk].self, forKey: .turnaroundRisks) ?? []
        bulkTurnaroundRisks = try container.decodeIfPresent([BulkTurnaroundRisk].self, forKey: .bulkTurnaroundRisks) ?? []
    }
}

struct KioskActiveCheckout: Decodable, Identifiable {
    let id: String
    let title: String
    let requesterName: String
    let requesterId: String?
    let requesterAvatarUrl: String?
    let requesterInitials: String
    let custodyScope: String
    let items: [CheckoutItem]
    let itemCount: Int
    let endsAt: Date
    let isOverdue: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case requesterName
        case requesterId
        case requesterAvatarUrl
        case requesterInitials
        case custodyScope
        case items
        case itemCount
        case endsAt
        case isOverdue
    }

    struct CheckoutItem: Decodable {
        let name: String
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Checkout"
        requesterName = try container.decodeIfPresent(String.self, forKey: .requesterName) ?? "Student"
        requesterId = try container.decodeIfPresent(String.self, forKey: .requesterId)
        requesterAvatarUrl = try container.decodeIfPresent(String.self, forKey: .requesterAvatarUrl)
        requesterInitials = try container.decodeIfPresent(String.self, forKey: .requesterInitials) ?? Self.initials(for: requesterName)
        custodyScope = try container.decodeIfPresent(String.self, forKey: .custodyScope) ?? "PERSON"
        items = try container.decodeIfPresent(LossyDecodableArray<CheckoutItem>.self, forKey: .items)?.elements ?? []
        itemCount = try container.decodeIfPresent(Int.self, forKey: .itemCount) ?? items.count
        endsAt = try container.decode(Date.self, forKey: .endsAt)
        isOverdue = try container.decodeIfPresent(Bool.self, forKey: .isOverdue) ?? (endsAt < Date())
    }

    private static func initials(for name: String) -> String {
        name.split(separator: " ").prefix(2)
            .compactMap { $0.first }
            .map { String($0) }
            .joined()
            .uppercased()
    }
}

// MARK: - Users

struct KioskUser: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let avatarUrl: String?
    let role: String
    let affiliation: String?
    let affiliationBadge: String?

    var isAffiliatedCollaborator: Bool {
        role == "COLLABORATOR" && affiliationBadge != nil
    }

    var initials: String {
        name.split(separator: " ").prefix(2).compactMap { $0.first }.map { String($0) }.joined().uppercased()
    }
}

struct KioskIdentifyResult: Decodable {
    let success: Bool
    let error: String?
    let data: KioskUser?
}

struct KioskResolveScanResult: Decodable {
    let kind: String
    let action: KioskFlowAction?
    let disposition: String?
    let code: String?
    let message: String?
    let user: KioskUser?
    let expectedRequester: KioskUser?
    let item: KioskResolvedItem?
    let booking: KioskResolvedBooking?
}

struct KioskResolvedItem: Decodable, Equatable {
    let id: String
    let name: String
    let tagName: String
    let type: String?
    let bulkSkuId: String?
    let unitNumber: Int?
}

struct KioskResolvedBooking: Decodable, Equatable {
    let id: String
    let title: String
    let startsAt: Date?
    let endsAt: Date?
}

// MARK: - Student Context

struct KioskStudentContext: Decodable {
    let checkouts: [KioskStudentCheckout]
    let pendingPickups: [KioskPendingPickup]
    let reservations: [KioskReservation]

    enum CodingKeys: String, CodingKey {
        case checkouts
        case pendingPickups
        case reservations
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        checkouts = try container.decodeIfPresent(LossyDecodableArray<KioskStudentCheckout>.self, forKey: .checkouts)?.elements ?? []
        pendingPickups = try container.decodeIfPresent(LossyDecodableArray<KioskPendingPickup>.self, forKey: .pendingPickups)?.elements ?? []
        reservations = try container.decodeIfPresent(LossyDecodableArray<KioskReservation>.self, forKey: .reservations)?.elements ?? []
    }
}

struct KioskStudentCheckout: Decodable, Identifiable {
    let id: String
    let title: String
    let refNumber: String?
    let items: [StudentItem]
    let endsAt: Date
    let isOverdue: Bool

    struct StudentItem: Decodable {
        let name: String
        let tagName: String

        enum CodingKeys: String, CodingKey {
            case name
            case tagName
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Item"
            tagName = try container.decodeIfPresent(String.self, forKey: .tagName) ?? name
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case refNumber
        case items
        case endsAt
        case isOverdue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Checkout"
        refNumber = try container.decodeIfPresent(String.self, forKey: .refNumber)
        items = try container.decodeIfPresent(LossyDecodableArray<StudentItem>.self, forKey: .items)?.elements ?? []
        endsAt = try container.decode(Date.self, forKey: .endsAt)
        isOverdue = try container.decodeIfPresent(Bool.self, forKey: .isOverdue) ?? (endsAt < Date())
    }
}

struct KioskPendingPickup: Decodable, Identifiable {
    let id: String
    let title: String
    let refNumber: String?
    let startsAt: Date
    let serializedItems: [SerializedItem]
    let bulkItems: [BulkItem]

    struct SerializedItem: Decodable, Identifiable {
        let id: String
        let tagName: String
        let name: String

        enum CodingKeys: String, CodingKey {
            case id
            case tagName
            case name
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Item"
            tagName = try container.decodeIfPresent(String.self, forKey: .tagName) ?? name
        }
    }

    struct BulkItem: Decodable {
        let name: String
        let quantity: Int

        enum CodingKeys: String, CodingKey {
            case name
            case quantity
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Item"
            quantity = try container.decodeIfPresent(Int.self, forKey: .quantity) ?? 0
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case refNumber
        case startsAt
        case serializedItems
        case bulkItems
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Pickup"
        refNumber = try container.decodeIfPresent(String.self, forKey: .refNumber)
        startsAt = try container.decode(Date.self, forKey: .startsAt)
        serializedItems = try container.decodeIfPresent(LossyDecodableArray<SerializedItem>.self, forKey: .serializedItems)?.elements ?? []
        bulkItems = try container.decodeIfPresent(LossyDecodableArray<BulkItem>.self, forKey: .bulkItems)?.elements ?? []
    }

    var itemCount: Int {
        serializedItems.count + bulkItems.reduce(0) { $0 + $1.quantity }
    }
}

struct KioskReservation: Decodable, Identifiable {
    let id: String
    let title: String
    let startsAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case startsAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Reservation"
        startsAt = try container.decode(Date.self, forKey: .startsAt)
    }
}

// MARK: - Scan

struct KioskScanResult: Decodable {
    let success: Bool
    let error: String?
    let item: ScannedItem?
    let locationMismatch: Bool?
    let expectedLocationId: String?
    let actualLocationId: String?
    let expectedLocationName: String?
    let actualLocationName: String?
    let locationMessage: String?
    let earnedBadges: [EarnedBadgeReward]?

    struct ScannedItem: Decodable, Identifiable {
        let id: String
        let name: String
        let tagName: String
        let type: String?
        let imageUrl: String?
        let bulkSkuId: String?
        let unitNumber: Int?

        var itemListPrimaryTitle: String {
            tagName.nonBlankText ?? name
        }

        var itemListSecondaryTitle: String? {
            itemListPrimaryTitle.isSameListText(as: name) ? nil : name
        }
    }
}

// MARK: - Checkout Detail (return flow)

struct KioskCheckoutDetail: Decodable {
    let id: String
    let title: String
    let refNumber: String?
    let status: String
    let requesterId: String?
    let custodyScope: String?
    let endsAt: Date
    let scanSummary: ScanSummary?
    let items: [ReturnItem]

    struct ScanSummary: Decodable {
        let serializedTotal: Int
        let numberedBulkTotal: Int
        let numberedBulkCompleted: Int
    }

    struct ReturnItem: Decodable, Identifiable {
        let id: String
        let tagName: String
        let name: String
        let returned: Bool
        let type: String?
        let bulkSkuId: String?
        let bulkSkuName: String?
        let unitNumber: Int?
        let imageUrl: String?

        var isNumberedBulk: Bool { type == "numbered_bulk" }
        var isBulkQuantity: Bool { type == "bulk_quantity" }
        var isBulkDisplay: Bool { isNumberedBulk || isBulkQuantity || bulkSkuId != nil }

        var itemListPrimaryTitle: String {
            tagName.nonBlankText ?? name
        }

        var itemListSecondaryTitle: String? {
            itemListPrimaryTitle.isSameListText(as: name) ? nil : name
        }
    }

    var numberedBulkItems: [ReturnItem] {
        items.filter(\.isNumberedBulk)
    }
}

struct KioskActiveCheckoutMutationResult: Decodable {
    let success: Bool
    let message: String?
    let error: String?
}

// MARK: - Checkin / Return result

/// Server-authoritative counts returned by `/api/kiosk/checkin/{id}/complete`.
/// Use these in the success message instead of local optimistic counts so the
/// kiosk doesn't lie when a sister kiosk checked in items mid-session.
struct KioskCheckinCompleteResult: Decodable {
    let returnedItems: Int
    let totalItems: Int
    let completed: Bool
    let earnedBadges: [EarnedBadgeReward]?
}

/// Server response for a reservation pickup. `partial` is optional so a
/// newer kiosk can still read a response from an older server during rollout.
struct KioskPickupConfirmResult: Decodable {
    let success: Bool
    let bookingId: String
    let partial: Bool?
    let earnedBadges: [EarnedBadgeReward]?
}

// MARK: - Screen State

enum KioskScreen: Equatable {
    case activation
    case idle
    case operatorHub(KioskUser)
    case identity
    case checkout(user: KioskUser)
    case pickup(bookingId: String, userId: String)
    case `return`(bookingId: String, userId: String)
    case success(KioskSuccessInfo)
}

/// The action a success screen is confirming, so it can show the right icon,
/// accent, and label instead of a one-size-fits-all green check.
enum KioskSuccessKind: String, Equatable {
    case checkout
    case returned
    case pickup

    var icon: String {
        switch self {
        case .checkout: return "arrow.up.circle.fill"
        case .returned: return "arrow.down.circle.fill"
        case .pickup:   return "tray.and.arrow.down.fill"
        }
    }

    var label: String {
        switch self {
        case .checkout: return "Checked Out"
        case .returned: return "Returned"
        case .pickup:   return "Picked Up"
        }
    }
}

struct KioskSuccessInfo: Equatable {
    let kind: KioskSuccessKind
    let message: String
    let earnedBadges: [EarnedBadgeReward]

    init(kind: KioskSuccessKind, message: String, earnedBadges: [EarnedBadgeReward] = []) {
        self.kind = kind
        self.message = message
        self.earnedBadges = earnedBadges
    }
}
