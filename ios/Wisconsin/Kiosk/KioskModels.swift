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
    var stats: Stats
    let capabilities: Capabilities
    let standby: Standby?
    let events: [KioskEvent]
    var activeItems: [ActiveItem]
    var checkouts: [KioskActiveCheckout]
    let partialFailures: [String]
    /// Redesign home (additive; older servers omit them).
    let pickups: [HomePickup]
    let today: [TodayTile]
    let nextUp: NextUp?
    /// Reservations after today (next 14 days); additive, absent = empty.
    var upcoming: [UpcomingReservation]

    enum CodingKeys: String, CodingKey {
        case stats
        case capabilities
        case standby
        case events
        case activeItems
        case checkouts
        case partialFailures
        case pickups
        case today
        case nextUp
        case upcoming
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        partialFailures = try container.decodeIfPresent([String].self, forKey: .partialFailures) ?? []
        stats = try container.decodeIfPresent(Stats.self, forKey: .stats) ?? Stats()
        capabilities = try container.decodeIfPresent(Capabilities.self, forKey: .capabilities) ?? Capabilities()
        standby = try container.decodeIfPresent(Standby.self, forKey: .standby)
        events = try container.decodeIfPresent(LossyDecodableArray<KioskEvent>.self, forKey: .events)?.elements ?? []
        activeItems = try container.decodeIfPresent(LossyDecodableArray<ActiveItem>.self, forKey: .activeItems)?.elements ?? []
        checkouts = try container.decodeIfPresent(LossyDecodableArray<KioskActiveCheckout>.self, forKey: .checkouts)?.elements ?? []
        pickups = try container.decodeIfPresent(LossyDecodableArray<HomePickup>.self, forKey: .pickups)?.elements ?? []
        today = try container.decodeIfPresent(LossyDecodableArray<TodayTile>.self, forKey: .today)?.elements ?? []
        nextUp = try? container.decodeIfPresent(NextUp.self, forKey: .nextUp)
        upcoming = (try? container.decodeIfPresent(LossyDecodableArray<UpcomingReservation>.self, forKey: .upcoming))??.elements ?? []
    }

    struct Person: Decodable, Equatable {
        let id: String
        let name: String
        let avatarUrl: String?
        let initials: String?
    }

    /// A reservation or pending pickup ready now or later today.
    struct HomePickup: Decodable, Identifiable, Equatable {
        let bookingId: String
        let title: String
        let requester: Person?
        let itemCount: Int
        let readyAt: Date
        let custodyScope: String
        let eventId: String?
        /// First few reserved items for gear thumbnails. Older servers omit it.
        let items: [KioskGearThumb]?
        var id: String { bookingId }
    }

    /// A booked reservation starting after today, shown when the home is quiet.
    struct UpcomingReservation: Decodable, Identifiable, Equatable {
        let id: String
        let title: String
        let startsAt: Date
        let endsAt: Date?
        let itemCount: Int
        let custodyScope: String
        let requester: Person?
    }

    /// Someone with something happening today.
    struct TodayTile: Decodable, Identifiable, Equatable {
        let userId: String
        let name: String
        let avatarUrl: String?
        let initials: String?
        let reasons: [String]
        let pickupAt: Date?
        let callAt: Date?
        var id: String { userId }
    }

    struct NextUp: Decodable, Equatable {
        let title: String
        let at: Date
        let kind: String
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
    /// The event's crew areas (VIDEO, PHOTO, ...), additive; older servers omit it.
    let areas: [String]
    let assignedUsers: [AssignedUser]
    let assignedUserCount: Int
    /// Assigned crew with no personal checkout linked to this event
    /// (additive; older servers omit it).
    let crewWithoutGear: [CrewMember]

    struct CrewMember: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let initials: String?
        let avatarUrl: String?
    }

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
        case areas
        case assignedUsers
        case assignedUserCount
        case crewWithoutGear
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
        areas = (try? container.decodeIfPresent([String].self, forKey: .areas)) ?? []
        assignedUsers = try container.decodeIfPresent(LossyDecodableArray<AssignedUser>.self, forKey: .assignedUsers)?.elements ?? []
        assignedUserCount = try container.decodeIfPresent(Int.self, forKey: .assignedUserCount) ?? assignedUsers.count
        crewWithoutGear = try container.decodeIfPresent(LossyDecodableArray<CrewMember>.self, forKey: .crewWithoutGear)?.elements ?? []
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

struct KioskKitOption: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let sportCode: String?
    let gamedayRole: String?
    let contents: Int
}

func kioskFootballGamedayKitLabel(_ role: String?) -> String? {
    switch role {
    case "SLOW1": return "Slow 1"
    case "SLOW2": return "Slow 2"
    case "BENCH": return "Bench"
    case "ROAM1": return "Roam 1"
    case "ROAM2": return "Roam 2"
    case "ROAM3": return "Roam 3"
    case "ROAM4": return "Roam 4"
    default: return nil
    }
}

struct KioskKitDetail: Decodable, Equatable {
    let id: String
    let name: String
    let sportCode: String?
    let gamedayRole: String?
    let members: [Member]
    let bulkMembers: [BulkMember]

    struct Member: Decodable, Equatable, Identifiable {
        let id: String
        let assetTag: String?
        let name: String
        /// Additive; older servers omit it.
        var imageUrl: String? = nil
    }

    struct BulkMember: Decodable, Equatable, Identifiable {
        let bulkSkuId: String
        let name: String
        let quantity: Int
        var id: String { bulkSkuId }
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
        let conflictingBookingRequesterName: String?
        let conflictingBookingKind: String?
        let conflictingBookingStatus: String?
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
    /// Additive: set once someone nudged this booking today.
    var nudgedToday: Bool?
    let eventId: String?

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
        case nudgedToday
        case eventId
    }

    struct CheckoutItem: Decodable {
        let name: String
        /// Asset tag or bulk SKU name; older servers omit it.
        let tagName: String?
        let imageUrl: String?
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
        nudgedToday = try container.decodeIfPresent(Bool.self, forKey: .nudgedToday)
        eventId = try container.decodeIfPresent(String.self, forKey: .eventId)
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

/// `POST /api/kiosk/staff/verify`. A refusal is `success: false` with a sentence.
struct KioskStaffVerifyResult: Decodable {
    struct Proof: Decodable {
        let user: KioskUser
        let staffToken: String
    }
    let success: Bool
    let error: String?
    let data: Proof?
}

struct KioskResolveScanResult: Decodable {
    let kind: String
    let action: KioskFlowAction?
    let disposition: String?
    let code: String?
    let message: String?
    let user: KioskUser?
    let expectedRequester: KioskUser?
    /// Personal owner of gear being returned. Display only — anyone identified
    /// at the kiosk may return it, so it never restricts identity.
    let custodyOwner: KioskUser?
    let item: KioskResolvedItem?
    let booking: KioskResolvedBooking?
    let candidates: [KioskScanCandidate]?
}

/// `POST /api/kiosk/scan-lookup` (redesign B1): what an item is and when it
/// is next claimed. `freeUntil` is always null for numbered units, which are
/// reserved by count rather than by unit.
struct KioskScanLookup: Decodable, Equatable {
    let item: Item

    struct Item: Decodable, Equatable {
        let tagName: String
        let productName: String
        let type: String?
        let status: String
        let holder: String?
        let dueAt: Date?
        let bookingTitle: String?
        let freeUntil: Date?
        let lastReturnedAt: Date?
    }
}

struct KioskScanCandidate: Decodable, Identifiable {
    let booking: KioskResolvedBooking
    let expectedRequester: KioskUser?
    var id: String { booking.id }
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
    /// Whether this person can start a checkout now (additive).
    let checkoutAllowance: CheckoutAllowance?

    struct CheckoutAllowance: Decodable, Equatable {
        let openCheckoutCount: Int
        let limit: Int?
        let canCheckout: Bool
        let blockedReason: String?
        let leftoverPickupTitle: String?
        let leftoverPickupId: String?
    }

    enum CodingKeys: String, CodingKey {
        case checkouts
        case pendingPickups
        case reservations
        case checkoutAllowance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        checkouts = try container.decodeIfPresent(LossyDecodableArray<KioskStudentCheckout>.self, forKey: .checkouts)?.elements ?? []
        pendingPickups = try container.decodeIfPresent(LossyDecodableArray<KioskPendingPickup>.self, forKey: .pendingPickups)?.elements ?? []
        reservations = try container.decodeIfPresent(LossyDecodableArray<KioskReservation>.self, forKey: .reservations)?.elements ?? []
        checkoutAllowance = try? container.decodeIfPresent(CheckoutAllowance.self, forKey: .checkoutAllowance)
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
        /// Additive; older servers omit it.
        let imageUrl: String?

        enum CodingKeys: String, CodingKey {
            case name
            case tagName
            case imageUrl
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Item"
            tagName = try container.decodeIfPresent(String.self, forKey: .tagName) ?? name
            imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
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

/// One gear thumbnail on the dashboard: asset tag (or bulk SKU name) and photo.
struct KioskGearThumb: Decodable, Equatable, Hashable {
    let tagName: String
    let imageUrl: String?
}

struct KioskPendingPickup: Decodable, Identifiable {
    let id: String
    let title: String
    let refNumber: String?
    let startsAt: Date
    /// "reservation" or "checkout" (a legacy PENDING_PICKUP). Older servers
    /// omit it; then the hub keeps offering "Change what's reserved".
    let kind: String?
    let serializedItems: [SerializedItem]
    let bulkItems: [BulkItem]

    /// Only a real reservation's items can be changed at the kiosk.
    var canChangeReservedItems: Bool { kind != "checkout" }

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
        case kind
        case serializedItems
        case bulkItems
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Pickup"
        refNumber = try container.decodeIfPresent(String.self, forKey: .refNumber)
        startsAt = try container.decode(Date.self, forKey: .startsAt)
        kind = try? container.decodeIfPresent(String.self, forKey: .kind)
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
    let errorCode: String?
    let substitution: KioskPickupSubstitution?
    let addedToPlan: Bool?

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
    let updatedAt: Date?
    let locationId: String?
    let endsAt: Date
    /// The linked event, if any (pickup "What's this for?" edit). Optional so
    /// an older server that omits it still decodes.
    let eventId: String?
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
        let quantity: Int?
        /// Additive: category name ("Cameras", "Lenses"); older servers omit it.
        var category: String? = nil
        let reservationItemId: String?
        /// Counted stock (cables, tape) has no per-unit QR, so it is returned
        /// by quantity. Absent from older servers.
        let returnsByQuantity: Bool?
        /// Return mode: a damaged/missing report on this item or battery
        /// unit. Additive; older servers omit it.
        var report: Report? = nil
        /// Return mode, counted stock: quantities already reported. Additive.
        var reportedMissingQuantity: Int? = nil
        var reportedDamagedQuantity: Int? = nil

        struct Report: Decodable, Equatable {
            let type: String
        }

        var isNumberedBulk: Bool { type == "numbered_bulk" }
        /// Counted stock is reported by quantity, not one piece.
        var isCountedStock: Bool { isBulkQuantity && returnsByQuantity == true }
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

/// `PATCH /api/kiosk/pickup/[id]/details`: the booking after a pickup
/// title / event / due-time edit.
struct KioskPickupDetailsResult: Decodable {
    let success: Bool
    let booking: Booking

    struct Booking: Decodable {
        let id: String
        let title: String
        let endsAt: Date
        let updatedAt: Date
        let eventId: String?
    }
}

/// `GET /api/kiosk/checkout/[id]/extend-window` (H1).
struct KioskExtendWindow: Decodable {
    let currentEndsAt: Date
    /// Latest time the extend PATCH accepts; nil = nothing claims the gear
    /// within a year. At or before `currentEndsAt` = it can't be extended.
    let maxEndsAt: Date?
    let limitingItem: LimitingItem?

    struct LimitingItem: Decodable {
        let assetTag: String
        let name: String
        /// Omitted for shared holders and counted stock.
        let holderName: String?
        let startsAt: Date
        /// Additive: the booking that needs it next, its kind, and the photo.
        var bookingTitle: String? = nil
        var bookingKind: String? = nil
        var imageUrl: String? = nil
    }

    var canExtend: Bool {
        guard let maxEndsAt else { return true }
        return maxEndsAt > currentEndsAt
    }
}

/// `POST /api/kiosk/checkout/[id]/transfer` (H2, C5).
struct KioskTransferResult: Decodable {
    let success: Bool
    let targetBookingId: String
    let sourceClosed: Bool
    let itemCount: Int
    let message: String?
    let endsAt: Date?
}

/// `POST /api/kiosk/checkout/[id]/swap` (H4).
struct KioskSwapResult: Decodable {
    struct Side: Decodable {
        let tagName: String
        let name: String?
    }
    let success: Bool
    let message: String?
    let error: String?
    let removed: Side?
    let added: Side?
}

/// `GET /api/kiosk/reservation/[id]/items` (H5). `id` is the reservation
/// item id the POST takes as `itemId`; `quantity` is what is still to pick up.
struct KioskReservationManifest: Decodable {
    let id: String
    let title: String
    let updatedAt: Date
    let items: [Item]

    struct Item: Decodable, Identifiable, Equatable {
        let id: String
        let assetId: String?
        let bulkSkuId: String?
        let name: String
        let quantity: Int
        let pickedQuantity: Int

        var isBulk: Bool { bulkSkuId != nil }
    }
}

// MARK: - Checkin / Return result

/// Server-authoritative counts returned by `/api/kiosk/checkin/{id}/complete`.
/// Use these in the success message instead of local optimistic counts so the
/// kiosk doesn't lie when a sister kiosk checked in items mid-session.
struct KioskQuantityReturnResult: Decodable {
    let success: Bool
    let completed: Bool?
    let remaining: Int?
    let message: String?
}

struct KioskCheckinCompleteResult: Decodable {
    let returnedItems: Int
    let totalItems: Int
    let completed: Bool
    let earnedBadges: [EarnedBadgeReward]?
}

/// Response from `POST /api/kiosk/checkin/{id}/report` (G4, G5).
/// `heldForStaff`: a damaged item was moved to maintenance. `completed`: a
/// missing report accounted for the last item out, which finished the return.
struct KioskCheckinReportResult: Decodable {
    struct Item: Decodable {
        let id: String
        let assetTag: String
        let name: String
    }
    let success: Bool
    let reportId: String
    let type: String
    let description: String?
    let imageUrl: String?
    let item: Item
    let checkoutTitle: String
    let heldForStaff: Bool
    let completed: Bool
    /// Counted stock: the reported quantity (running total). Additive.
    var quantity: Int? = nil
}

/// Server response for a reservation pickup. `partial` is optional so a
/// newer kiosk can still read a response from an older server during rollout.
struct KioskPickupConfirmResult: Decodable {
    let success: Bool
    let bookingId: String
    let partial: Bool?
    let itemCount: Int?
    let remainingItemNames: [String]?
    let earnedBadges: [EarnedBadgeReward]?
}

/// Offered when a pickup scan is not on the reservation but can replace one
/// remaining reserved item. The operator can swap or add the scanned item too.
struct KioskPickupSubstitution: Decodable, Identifiable {
    let scanned: NamedItem
    let reserved: NamedItem

    var id: String { scanned.id }

    struct NamedItem: Decodable, Identifiable {
        let id: String
        let name: String
        let tagName: String
    }
}

struct KioskReservationMutationResult: Decodable {
    let success: Bool
    let message: String?
    let updatedAt: Date?
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
    /// The redesign's receipt card (D7, F5, G6). Optional so any caller that
    /// only has a sentence still gets a correct, simpler receipt.
    let receipt: KioskReceipt?

    init(kind: KioskSuccessKind, message: String, earnedBadges: [EarnedBadgeReward] = [], receipt: KioskReceipt? = nil) {
        self.kind = kind
        self.message = message
        self.earnedBadges = earnedBadges
        self.receipt = receipt
    }
}

/// "All set, Harper." then a card per record written.
struct KioskReceipt: Equatable {
    /// One thing on a receipt card. Numbered batteries carry their kind and
    /// number so the card can draw one chip per kind with the numbers circled.
    struct Item: Equatable {
        let tag: String
        let imageUrl: String?
        var batteryKind: String? = nil
        var batteryName: String? = nil
        var unitNumber: Int? = nil

        init(tag: String, imageUrl: String?, batteryKind: String? = nil, batteryName: String? = nil, unitNumber: Int? = nil) {
            self.tag = tag
            self.imageUrl = imageUrl
            self.batteryKind = batteryKind
            self.batteryName = batteryName
            self.unitNumber = unitNumber
        }

        init(_ item: KioskCartItem) {
            self.init(tag: item.itemListPrimaryTitle, imageUrl: item.imageUrl,
                      batteryKind: item.isNumberedBulk ? item.bulkSkuId : nil,
                      batteryName: item.name, unitNumber: item.isNumberedBulk ? item.unitNumber : nil)
        }

        init(_ item: KioskCheckoutDetail.ReturnItem, unit: Int? = nil, imageUrl: String? = nil) {
            let number = unit ?? item.unitNumber
            let numbered = (item.isNumberedBulk || unit != nil) && number != nil
            self.init(tag: item.itemListPrimaryTitle, imageUrl: imageUrl ?? item.imageUrl,
                      batteryKind: numbered ? (item.bulkSkuId ?? item.bulkSkuName ?? item.name) : nil,
                      batteryName: item.bulkSkuName ?? item.name, unitNumber: numbered ? number : nil)
        }
    }

    /// What a receipt card draws: a photo + tag, or one battery kind with its numbers.
    enum Chip: Equatable, Identifiable {
        case item(Item)
        case batteries(name: String, imageUrl: String?, units: [Int])

        var id: String {
            switch self {
            case .item(let item): "item-\(item.tag)"
            case .batteries(let name, _, _): "batt-\(name)"
            }
        }

        static func group(_ items: [Item]) -> [Chip] {
            var chips: [Chip] = []
            var kindIndex: [String: Int] = [:]
            for item in items {
                guard let kind = item.batteryKind, let unit = item.unitNumber else {
                    chips.append(.item(item))
                    continue
                }
                if let index = kindIndex[kind], case .batteries(let name, let image, let units) = chips[index] {
                    chips[index] = .batteries(name: name, imageUrl: image ?? item.imageUrl, units: units + [unit])
                } else {
                    kindIndex[kind] = chips.count
                    let name = (item.batteryName ?? item.tag)
                        .replacingOccurrences(of: #"\s*#\d+$"#, with: "", options: .regularExpression)
                    chips.append(.batteries(name: name, imageUrl: item.imageUrl, units: [unit]))
                }
            }
            return chips.map {
                if case .batteries(let name, let image, let units) = $0 { return .batteries(name: name, imageUrl: image, units: units.sorted()) }
                return $0
            }
        }
    }

    struct Card: Equatable {
        let overline: String
        let refNumber: String?
        let title: String
        let detail: String?
        let footnote: String?
        let isProblem: Bool
        /// Colors the footnote when it is something to act on later, like a
        /// pickup's leftover line (F5). Nil keeps it quiet.
        let footnoteSection: KioskSection?
        /// Drawn as photo + tag chips under the title.
        let items: [Item]

        init(overline: String, refNumber: String? = nil, title: String, items: [Item] = [], detail: String? = nil, footnote: String? = nil, isProblem: Bool = false, footnoteSection: KioskSection? = nil) {
            self.items = items
            self.overline = overline
            self.refNumber = refNumber
            self.title = title
            self.detail = detail
            self.footnote = footnote
            self.isProblem = isProblem
            self.footnoteSection = footnoteSection
        }
    }

    let firstName: String
    let avatarURL: String?
    let initials: String
    let cards: [Card]
    /// What happens next, in one or two sentences.
    let nextStep: String?
}
