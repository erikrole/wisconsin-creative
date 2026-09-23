import Foundation

struct GearOpsUser: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let email: String
    let role: String
    let forcePasswordChange: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case email
        case role
        case forcePasswordChange
    }

    init(
        id: String,
        name: String,
        email: String,
        role: String,
        forcePasswordChange: Bool = false
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.role = role
        self.forcePasswordChange = forcePasswordChange
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        email = try container.decode(String.self, forKey: .email)
        role = try container.decode(String.self, forKey: .role)
        forcePasswordChange = try container.decodeIfPresent(Bool.self, forKey: .forcePasswordChange) ?? false
    }
}

struct GearOpsStats: Codable, Equatable, Sendable {
    let checkedOut: Int
    let overdue: Int
    let reserved: Int
    let dueToday: Int
}

struct DashboardStatsPayload: Codable, Equatable, Sendable {
    let role: String
    let stats: GearOpsStats
    let overdueCount: Int
    let pendingPickupTotal: Int

    enum CodingKeys: String, CodingKey {
        case role
        case stats
        case overdueCount
        case pendingPickupTotal
    }

    init(role: String, stats: GearOpsStats, overdueCount: Int, pendingPickupTotal: Int) {
        self.role = role
        self.stats = stats
        self.overdueCount = overdueCount
        self.pendingPickupTotal = pendingPickupTotal
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decode(String.self, forKey: .role)
        stats = try container.decode(GearOpsStats.self, forKey: .stats)
        overdueCount = try container.decodeIfPresent(Int.self, forKey: .overdueCount) ?? stats.overdue
        pendingPickupTotal = try container.decodeIfPresent(Int.self, forKey: .pendingPickupTotal) ?? 0
    }
}

struct DashboardStatsEnvelope: Codable, Equatable, Sendable {
    let data: DashboardStatsPayload
    let partialFailures: [String]

    enum CodingKeys: String, CodingKey {
        case data
        case partialFailures
    }

    init(data: DashboardStatsPayload, partialFailures: [String] = []) {
        self.data = data
        self.partialFailures = partialFailures
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        data = try container.decode(DashboardStatsPayload.self, forKey: .data)
        partialFailures = try container.decodeIfPresent([String].self, forKey: .partialFailures) ?? []
    }
}

struct KioskDevice: Codable, Equatable, Identifiable, Sendable {
    struct Location: Codable, Equatable, Sendable {
        let id: String
        let name: String
    }

    let id: String
    let name: String
    let location: Location
    let active: Bool
    let activated: Bool
    let lastSeenAt: Date?
    let appVersion: String?
    let appBuild: String?
    let osVersion: String?
    let deviceModel: String?
    let pendingPickupCount: Int
    let openCheckoutCount: Int
}

struct GearOpsSnapshot: Codable, Equatable, Sendable {
    let stats: GearOpsStats
    let pendingPickupTotal: Int
    let receivedAt: Date
    let partialFailures: [String]

    func freshnessLabel(at now: Date = .now) -> String {
        let age = max(0, now.timeIntervalSince(receivedAt))
        if age < 60 { return "Updated just now" }
        if age < 60 * 60 { return "Updated \(Int(age / 60))m ago" }
        if age < 24 * 60 * 60 { return "Updated \(Int(age / (60 * 60)))h ago" }
        return "Updated \(Int(age / (24 * 60 * 60)))d ago"
    }
}

struct OpenBooking: Codable, Equatable, Identifiable, Sendable {
    struct Person: Codable, Equatable, Sendable {
        let id: String
        let name: String
        let avatarUrl: String?
    }

    struct Location: Codable, Equatable, Sendable {
        let id: String
        let name: String
    }

    struct ItemReference: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let name: String?
        let assetTag: String?
        let quantity: Int?

        init(id: String, name: String? = nil, assetTag: String? = nil, quantity: Int? = nil) {
            self.id = id
            self.name = name
            self.assetTag = assetTag
            self.quantity = quantity
        }

        var hasIdentity: Bool {
            Self.nonempty(assetTag) != nil || Self.nonempty(name) != nil
        }

        /// Tag-first, matching iOS item lists.
        var listPrimaryTitle: String {
            Self.nonempty(assetTag) ?? Self.nonempty(name) ?? "Item"
        }

        var listSecondaryTitle: String? {
            guard let name = Self.nonempty(name) else { return nil }
            return name.compare(listPrimaryTitle, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
                ? nil
                : name
        }

        private static func nonempty(_ value: String?) -> String? {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    let id: String
    let title: String
    let endsAt: Date
    let refNumber: String?
    let requester: Person
    let location: Location
    let serializedItems: [ItemReference]
    let bulkItems: [ItemReference]

    var items: [ItemReference] { serializedItems + bulkItems }
    var itemCount: Int { items.count }
    func isOverdue(at now: Date = .now) -> Bool { endsAt < now }

    /// Past-tense once overdue, so the row never reads as a future deadline.
    func dueLabel(at now: Date = .now) -> String {
        let when = endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
        return isOverdue(at: now) ? "Was due \(when)" : "Due \(when)"
    }
}

struct OpenBookingsPage: Decodable, Sendable {
    let data: [OpenBooking]
    let total: Int
    let limit: Int
    let offset: Int
}

struct OpenBookingsResult: Equatable, Sendable {
    let bookings: [OpenBooking]
    let total: Int
}

enum BookingKind: String, Codable, Equatable, Sendable {
    case checkout = "CHECKOUT"
    case reservation = "RESERVATION"
}

enum BookingStatus: String, Codable, Equatable, Sendable {
    case draft = "DRAFT"
    case booked = "BOOKED"
    case pendingPickup = "PENDING_PICKUP"
    case open = "OPEN"
    case completed = "COMPLETED"
    case cancelled = "CANCELLED"
}

struct BookingActivitySnapshot: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let kind: BookingKind
    let status: BookingStatus
    let startsAt: Date
    let endsAt: Date
    let updatedAt: Date
    let requester: OpenBooking.Person
    let location: OpenBooking.Location
    let serializedItems: [OpenBooking.ItemReference]
    let bulkItems: [OpenBooking.ItemReference]

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case kind
        case status
        case startsAt
        case endsAt
        case updatedAt
        case requester
        case location
        case serializedItems
        case bulkItems
    }

    init(
        id: String,
        title: String,
        kind: BookingKind,
        status: BookingStatus,
        startsAt: Date,
        endsAt: Date,
        updatedAt: Date,
        requester: OpenBooking.Person,
        location: OpenBooking.Location,
        serializedItems: [OpenBooking.ItemReference] = [],
        bulkItems: [OpenBooking.ItemReference] = []
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.status = status
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.updatedAt = updatedAt
        self.requester = requester
        self.location = location
        self.serializedItems = serializedItems
        self.bulkItems = bulkItems
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        kind = try container.decode(BookingKind.self, forKey: .kind)
        status = try container.decode(BookingStatus.self, forKey: .status)
        startsAt = try container.decode(Date.self, forKey: .startsAt)
        endsAt = try container.decode(Date.self, forKey: .endsAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        requester = try container.decode(OpenBooking.Person.self, forKey: .requester)
        location = try container.decode(OpenBooking.Location.self, forKey: .location)
        serializedItems = try container.decodeIfPresent([OpenBooking.ItemReference].self, forKey: .serializedItems) ?? []
        bulkItems = try container.decodeIfPresent([OpenBooking.ItemReference].self, forKey: .bulkItems) ?? []
    }

    var items: [OpenBooking.ItemReference] { serializedItems + bulkItems }
    var itemCount: Int { items.count }

    func pickupLabel(at now: Date = .now) -> String {
        let when = startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
        if kind == .reservation, status == .booked, startsAt < now {
            return "Pickup was due \(when)"
        }
        return "Pickup \(when)"
    }

    func isWaitingForPickup(at now: Date = .now) -> Bool {
        status == .pendingPickup || (kind == .reservation && status == .booked && startsAt <= now)
    }
}

struct BookingActivityPage: Decodable, Sendable {
    let data: [BookingActivitySnapshot]
    let total: Int
    let limit: Int
    let offset: Int
}

struct BookingActivityEnvelope: Decodable, Sendable {
    let data: BookingActivitySnapshot
}

struct BookingChanges: Codable, Equatable, Sendable {
    let cursor: String
    let changedBookingIds: [String]
}

struct BookingChangesEnvelope: Decodable, Sendable {
    let data: BookingChanges
}

struct CompanionProjection: Codable, Equatable, Sendable {
    private static let maxCount = 1_000_000

    let version: Int
    let revision: Int?
    let generatedAt: Date
    let stats: GearOpsStats
    let pendingPickupTotal: Int
    let openBookings: [OpenBooking]
    let bookingActivity: [BookingActivitySnapshot]
    let kioskDevices: [KioskDevice]
    let kioskAccess: String

    /// The external cache is trusted only after its structural invariants are
    /// checked. Duplicate identities are especially dangerous in SwiftUI and
    /// previously trapped the process when activity was indexed with
    /// `Dictionary(uniqueKeysWithValues:)`.
    func validate() throws {
        guard version == 1,
              revision.map({ $0 >= 0 }) ?? true,
              openBookings.count <= 1_000,
              bookingActivity.count <= 2_000,
              kioskDevices.count <= 256,
              stats.checkedOut >= 0,
              stats.checkedOut <= Self.maxCount,
              stats.overdue >= 0,
              stats.overdue <= Self.maxCount,
              stats.reserved >= 0,
              stats.reserved <= Self.maxCount,
              stats.dueToday >= 0,
              stats.dueToday <= Self.maxCount,
              pendingPickupTotal >= 0,
              pendingPickupTotal <= Self.maxCount,
              Self.hasUniqueNonemptyIDs(openBookings.map(\.id)),
              Self.hasUniqueNonemptyIDs(bookingActivity.map(\.id)),
              Self.hasUniqueNonemptyIDs(kioskDevices.map(\.id)),
              kioskDevices.allSatisfy({
                  $0.pendingPickupCount >= 0 && $0.pendingPickupCount <= Self.maxCount
                      && $0.openCheckoutCount >= 0 && $0.openCheckoutCount <= Self.maxCount
              }),
              kioskAccess == "available" || kioskAccess == "restricted" || kioskAccess == "failed" else {
            throw GearOpsClientError.invalidResponse
        }
    }

    private static func hasUniqueNonemptyIDs(_ ids: [String]) -> Bool {
        ids.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            && Set(ids).count == ids.count
    }
}

struct CompanionProjectionEnvelope: Decodable, Sendable {
    let data: CompanionProjection
}

struct LoginResponse: Decodable, Sendable {
    let user: GearOpsUser
    let companionToken: String
    let companionProjection: CompanionProjection
}

struct CompanionSessionResponse: Decodable, Sendable {
    let companionToken: String
}

struct MeResponse: Decodable, Sendable {
    let user: GearOpsUser
}

struct KioskDevicesResponse: Decodable, Sendable {
    let data: [KioskDevice]
}

struct ServerErrorResponse: Decodable, Sendable {
    let error: String
}

extension Date {
    var gearTime: String {
        formatted(date: .omitted, time: .shortened)
    }

    func operationalDayLabel(now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDate(self, inSameDayAs: now) { return "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
           calendar.isDate(self, inSameDayAs: tomorrow) {
            return "Tomorrow"
        }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(self, inSameDayAs: yesterday) {
            return "Yesterday"
        }

        let dayDistance = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: self)
        ).day ?? 7
        return abs(dayDistance) < 7
            ? formatted(.dateTime.weekday(.wide))
            : formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// Same wording as iOS booking cards: "today at 3:00 PM".
    func operationalDateTimeLabel(now: Date = .now, capitalizesRelativeDay: Bool = true) -> String {
        let day = operationalDayLabel(now: now)
        let displayDay = !capitalizesRelativeDay && ["Today", "Tomorrow", "Yesterday"].contains(day)
            ? day.lowercased()
            : day
        return "\(displayDay) at \(gearTime)"
    }
}
