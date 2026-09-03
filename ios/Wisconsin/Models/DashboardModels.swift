import Foundation

struct DashboardStats: Codable {
    let checkedOut: Int
    let overdue: Int
    let reserved: Int
    let dueToday: Int
}

struct BookingSummary: Codable, Identifiable, Hashable {
    let id: String
    let kind: BookingKind
    let title: String
    let refNumber: String?
    let eventId: String?
    let eventIds: [String]
    let linkedEventId: String?
    let sportCode: String?
    let requesterUserId: String
    let requesterName: String
    let requesterInitials: String
    let requesterAvatarUrl: String?
    let locationName: String?
    let startsAt: Date
    let endsAt: Date
    let itemCount: Int
    let status: BookingStatus
    let isOverdue: Bool

    enum CodingKeys: String, CodingKey {
        case id, kind, title, refNumber, eventId, eventIds, linkedEventId, sportCode
        case requesterUserId, requesterName, requesterInitials, requesterAvatarUrl
        case locationName, startsAt, endsAt, itemCount, status, isOverdue
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(BookingKind.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        refNumber = try c.decodeIfPresent(String.self, forKey: .refNumber)
        eventId = try c.decodeIfPresent(String.self, forKey: .eventId)
        eventIds = try c.decodeIfPresent([String].self, forKey: .eventIds) ?? eventId.map { [$0] } ?? []
        linkedEventId = try c.decodeIfPresent(String.self, forKey: .linkedEventId) ?? eventId ?? eventIds.first
        sportCode = try c.decodeIfPresent(String.self, forKey: .sportCode)
        requesterUserId = try c.decode(String.self, forKey: .requesterUserId)
        requesterName = try c.decode(String.self, forKey: .requesterName)
        requesterInitials = try c.decode(String.self, forKey: .requesterInitials)
        requesterAvatarUrl = try c.decodeIfPresent(String.self, forKey: .requesterAvatarUrl)
        locationName = try c.decodeIfPresent(String.self, forKey: .locationName)
        startsAt = try c.decode(Date.self, forKey: .startsAt)
        endsAt = try c.decode(Date.self, forKey: .endsAt)
        itemCount = try c.decode(Int.self, forKey: .itemCount)
        status = try c.decode(BookingStatus.self, forKey: .status)
        isOverdue = try c.decode(Bool.self, forKey: .isOverdue)
    }

    static func == (lhs: BookingSummary, rhs: BookingSummary) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct CheckoutGroup: Codable {
    let total: Int
    let overdue: Int
    let items: [BookingSummary]
}

struct ReservationGroup: Codable {
    let total: Int
    let items: [BookingSummary]
}

struct DashboardShiftEvent: Codable {
    let id: String
    let summary: String
    let startsAt: Date
    let allDay: Bool?
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
    let site: String?
    let locationName: String?
}

struct DashboardShift: Codable, Identifiable {
    let id: String
    let area: String
    let workerType: String
    let startsAt: Date
    let endsAt: Date
    let callStartsAt: Date?
    let callEndsAt: Date?
    let event: DashboardShiftEvent
    let gearStatus: String
    let gearItemCount: Int

    var gearLabel: String {
        switch gearStatus {
        case "checked_out": return "Gear out"
        case "pickup_ready": return "Gear ready"
        case "reserved":    return "Gear reserved"
        case "draft":       return "Gear draft"
        default:            return ""
        }
    }
    var hasGear: Bool { gearStatus != "none" }
}

struct DashboardEventWorkEvent: Codable {
    let id: String
    let summary: String
    let startsAt: Date
    let endsAt: Date
    let allDay: Bool
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
    let site: String?
    let locationId: String?
    let locationName: String?
}

struct DashboardEventWorkShift: Codable, Identifiable {
    let id: String
    let area: String
    let workerType: String
    let startsAt: Date
    let endsAt: Date
    let callStartsAt: Date?
    let callEndsAt: Date?
}

struct DashboardEventWork: Codable, Identifiable {
    let id: String
    let event: DashboardEventWorkEvent
    let shift: DashboardEventWorkShift
    let gearStatus: String
    let gearBookings: [BookingSummary]
    let needsGear: Bool

    var primaryGear: BookingSummary? { gearBookings.first }
    var hasReservedGear: Bool { !needsGear }
}

struct DashboardUpcomingEvent: Codable, Identifiable {
    let id: String
    let title: String
    let sportCode: String?
    let startsAt: Date
    let endsAt: Date
    let allDay: Bool
    let location: String?
    let locationId: String?
    let opponent: String?
    let isHome: Bool?
    let site: String?
    let totalShiftSlots: Int
    let filledShiftSlots: Int

    var coverageLabel: String { "\(filledShiftSlots)/\(totalShiftSlots)" }
    var coveragePct: Int { totalShiftSlots > 0 ? (filledShiftSlots * 100 / totalShiftSlots) : 0 }
}

struct DashboardOverdueItem: Codable, Identifiable, Hashable {
    let bookingId: String
    let bookingTitle: String
    let requesterName: String
    let requesterInitials: String
    let requesterAvatarUrl: String?
    let endsAt: Date

    var id: String { bookingId }
}

struct DashboardDraft: Codable, Identifiable {
    let id: String
    let kind: String
    let title: String
    let itemCount: Int
    let updatedAt: Date

    /// `/api/dashboard` passes the raw Prisma enum through, so this is
    /// `RESERVATION` / `CHECKOUT`. Compared case-insensitively because the
    /// list APIs lowercase the same field.
    var isReservation: Bool {
        kind.caseInsensitiveCompare("RESERVATION") == .orderedSame
    }
}

struct DashboardFlaggedItem: Codable, Identifiable {
    let id: String
    let assetId: String
    let assetTag: String
    let assetName: String?
    let type: String
    let bookingTitle: String?
    let reportedBy: String?
    let createdAt: Date

    var typeLabel: String {
        switch type {
        case "DAMAGED": return "Damaged"
        case "LOST": return "Lost"
        case "MAINTENANCE": return "Maintenance"
        default: return type
        }
    }
}

struct DashboardLostBulkUnit: Codable {
    let skuName: String
    let count: Int
}

struct DashboardData: Codable {
    let role: String
    let stats: DashboardStats
    let myCheckouts: CheckoutGroup
    let teamCheckouts: CheckoutGroup
    let teamReservations: ReservationGroup
    let pendingPickups: ReservationGroup
    let myReservations: [BookingSummary]
    let overdueCount: Int
    let overdueItems: [DashboardOverdueItem]
    let myShifts: [DashboardShift]
    let upcomingEvents: [DashboardUpcomingEvent]
    let drafts: [DashboardDraft]
    let flaggedItems: [DashboardFlaggedItem]
    let lostBulkUnits: [DashboardLostBulkUnit]
    let myEventWork: [DashboardEventWork]

    enum CodingKeys: String, CodingKey {
        case role, stats, myCheckouts, teamCheckouts, teamReservations, pendingPickups
        case myReservations, overdueCount, overdueItems, myShifts, upcomingEvents
        case drafts, flaggedItems, lostBulkUnits, myEventWork
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        role = try c.decode(String.self, forKey: .role)
        stats = try c.decode(DashboardStats.self, forKey: .stats)
        myCheckouts = try c.decode(CheckoutGroup.self, forKey: .myCheckouts)
        teamCheckouts = try c.decode(CheckoutGroup.self, forKey: .teamCheckouts)
        teamReservations = try c.decode(ReservationGroup.self, forKey: .teamReservations)
        pendingPickups = try c.decode(ReservationGroup.self, forKey: .pendingPickups)
        myReservations = try c.decode([BookingSummary].self, forKey: .myReservations)
        overdueCount = try c.decode(Int.self, forKey: .overdueCount)
        overdueItems = try c.decode([DashboardOverdueItem].self, forKey: .overdueItems)
        myShifts = try c.decode([DashboardShift].self, forKey: .myShifts)
        upcomingEvents = try c.decode([DashboardUpcomingEvent].self, forKey: .upcomingEvents)
        drafts = try c.decode([DashboardDraft].self, forKey: .drafts)
        flaggedItems = try c.decode([DashboardFlaggedItem].self, forKey: .flaggedItems)
        lostBulkUnits = try c.decode([DashboardLostBulkUnit].self, forKey: .lostBulkUnits)
        myEventWork = try c.decodeIfPresent([DashboardEventWork].self, forKey: .myEventWork) ?? []
    }

    var isStaff: Bool { role == "STAFF" || role == "ADMIN" }
    var isAdmin: Bool { role == "ADMIN" }
}

// MARK: - Schedule bridges

extension DashboardUpcomingEvent {
    /// Convert to ScheduleEvent so EventDetailSheet can be presented from the dashboard.
    var asScheduleEvent: ScheduleEvent {
        ScheduleEvent(
            id: id,
            summary: title,
            startsAt: startsAt,
            endsAt: endsAt,
            allDay: allDay,
            status: "CONFIRMED",
            sportCode: sportCode,
            opponent: opponent,
            isHome: isHome,
            site: site,
            location: locationId.map { EventLocation(id: $0, name: location ?? "") }
        )
    }
}

extension DashboardShift {
    /// Convert the shift's event to ScheduleEvent so Event detail can be presented.
    /// Uses shift.endsAt as a proxy for event end time (close enough for the detail view to load).
    ///
    /// `DashboardShiftEvent` carries the venue name but no location id, so the
    /// name rides in on `rawLocationText` — `scheduleEventVenueName` falls back
    /// to it, which is the same path an unmapped calendar venue takes. Dropping
    /// it left the detail header with no venue line.
    var asScheduleEvent: ScheduleEvent {
        var scheduleEvent = ScheduleEvent(
            id: event.id,
            summary: event.summary,
            startsAt: event.startsAt,
            endsAt: endsAt,
            allDay: event.allDay ?? false,
            status: "CONFIRMED",
            sportCode: event.sportCode,
            opponent: event.opponent,
            isHome: event.isHome,
            site: event.site,
            location: nil
        )
        scheduleEvent.rawLocationText = event.locationName
        return scheduleEvent
    }
}

extension DashboardEventWork {
    /// Convert to ScheduleEvent so EventDetailSheet can be presented from Home.
    var asScheduleEvent: ScheduleEvent {
        ScheduleEvent(
            id: event.id,
            summary: event.summary,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
            status: "CONFIRMED",
            sportCode: event.sportCode,
            opponent: event.opponent,
            isHome: event.isHome,
            site: event.site,
            location: event.locationId.map { EventLocation(id: $0, name: event.locationName ?? "") }
        )
    }
}

/// Lightweight payload from `/api/dashboard/stats`. Used by AppState to refresh
/// badges without re-running the heavy `/api/dashboard` query.
struct DashboardStatsPayload: Codable {
    let role: String
    let stats: DashboardStats
    let overdueCount: Int
    let myShiftsCount: Int
    let myShiftsTodayCount: Int?
}
