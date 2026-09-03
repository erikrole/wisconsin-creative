import Foundation

enum ShiftTradeStatus: String, Codable {
    case open = "OPEN"
    case claimed = "CLAIMED"
    case approved = "APPROVED"
    case completed = "COMPLETED"
    case cancelled = "CANCELLED"
    case expired = "EXPIRED"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let val = try decoder.singleValueContainer().decode(String.self)
        self = ShiftTradeStatus(rawValue: val) ?? .unknown
    }

    var label: String {
        switch self {
        case .open: "Open"
        case .claimed: "Claimed"
        case .approved: "Approved"
        case .completed: "Completed"
        case .cancelled: "Cancelled"
        case .expired: "Expired"
        case .unknown: "Unknown"
        }
    }
}

struct ShiftTradeUser: Codable, Identifiable {
    let id: String
    let name: String
    let primaryArea: String?
    let avatarUrl: String?
}

struct ShiftTradeShift: Codable {
    let id: String?
    let area: String
    let workerType: String?
    let startsAt: Date
    let endsAt: Date
    let callStartsAt: Date?
    let callEndsAt: Date?
    let shiftGroup: ShiftTradeGroup?

    var effectiveStartsAt: Date { callStartsAt ?? startsAt }
    var effectiveEndsAt: Date { callEndsAt ?? endsAt }
}

struct ShiftTradeGroup: Codable {
    let id: String?
    let publishedAt: Date?
    let event: ShiftTradeEvent?
}

struct ShiftTradeEvent: Codable {
    let id: String?
    let summary: String?
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
    let allDay: Bool?
    let startsAt: Date?
    let endsAt: Date?
    let site: String?

    var studentCallTimeAllowed: Bool {
        guard let opponent,
              !opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return true
        }
        switch site?.uppercased() {
        case "HOME": return true
        case "AWAY", "NEUTRAL": return false
        default: return isHome == true
        }
    }

    var compactTitle: String {
        if let sportCode, let opponent, !sportCode.isEmpty, !opponent.isEmpty {
            return "\(sportCode) \(isHome == false ? "at" : "vs") \(opponent)"
        }
        return summary ?? "Shift"
    }
}

extension ShiftTradeShift {
    /// Away and neutral Student rows show the event window. The effective call
    /// window stays available for ordering and review urgency; these properties
    /// are display-only.
    var displayStartsAt: Date {
        if workerType == "ST",
           let event = shiftGroup?.event,
           !event.studentCallTimeAllowed,
           let startsAt = event.startsAt {
            return startsAt
        }
        return effectiveStartsAt
    }

    var displayEndsAt: Date {
        if workerType == "ST",
           let event = shiftGroup?.event,
           !event.studentCallTimeAllowed,
           let endsAt = event.endsAt {
            return endsAt
        }
        return effectiveEndsAt
    }
}

struct ShiftTradeAssignment: Codable {
    let id: String
    let shift: ShiftTradeShift
    /// The worker's personal call window, when one is set. It takes precedence
    /// over the slot's own call window everywhere the server decides staleness
    /// or a review deadline, so anything ordering by urgency needs it too.
    let callStartsAt: Date?
    let callEndsAt: Date?
    let user: ShiftTradeUser

    var effectiveStartsAt: Date { callStartsAt ?? shift.effectiveStartsAt }
}

struct ShiftAvailabilityContext: Codable, Hashable {
    let state: String
    let label: String
    let detail: String
    let blocking: Bool
}

struct ShiftTrade: Codable, Identifiable, Hashable {
    static func == (lhs: ShiftTrade, rhs: ShiftTrade) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let status: ShiftTradeStatus
    let notes: String?
    let postedBy: ShiftTradeUser
    let claimedBy: ShiftTradeUser?
    let shiftAssignment: ShiftTradeAssignment
    let postedAt: Date?
    let claimedAt: Date?
    let createdAt: Date
    let reviewEscalatesAt: Date?
    let reviewAutoApprovesAt: Date?
    let viewerAvailabilityContext: ShiftAvailabilityContext?
    let claimedByAvailabilityContext: ShiftAvailabilityContext?
    let viewerCanClaim: Bool?
    let viewerClaimReason: String?
}

struct ShiftTradesResponse: Codable {
    let data: [ShiftTrade]
    let total: Int
}

struct OpenWorkResponse: Codable {
    let openShifts: [OpenWorkShift]
    let pickupRequests: [OpenWorkPickupRequest]

    init(openShifts: [OpenWorkShift] = [], pickupRequests: [OpenWorkPickupRequest] = []) {
        self.openShifts = openShifts
        self.pickupRequests = pickupRequests
    }

    private enum CodingKeys: String, CodingKey {
        case openShifts
        case pickupRequests
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        openShifts = try container.decodeIfPresent([OpenWorkShift].self, forKey: .openShifts) ?? []
        pickupRequests = try container.decodeIfPresent([OpenWorkPickupRequest].self, forKey: .pickupRequests) ?? []
    }
}

struct OpenWorkShift: Codable, Identifiable, Hashable {
    static func == (lhs: OpenWorkShift, rhs: OpenWorkShift) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let kind: String
    let action: String
    let canAct: Bool
    let reason: String
    let score: Int?
    let bucket: String?
    let advisoryConflict: Bool
    let advisoryConflictNote: String?
    let availabilityContext: ShiftAvailabilityContext?
    let warnings: [OpenWorkWarning]
    let ownRequestId: String?
    let requestCount: Int
    let shift: ShiftTradeShift
}

struct OpenWorkWarning: Codable, Hashable {
    let code: String
    let label: String
    let weight: Int?
}

struct OpenWorkPickupRequest: Codable, Identifiable, Hashable {
    static func == (lhs: OpenWorkPickupRequest, rhs: OpenWorkPickupRequest) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let kind: String
    let status: String
    let hasConflict: Bool
    let conflictNote: String?
    let createdAt: Date
    let reviewEscalatesAt: Date?
    let reviewAutoApprovesAt: Date?
    let user: ShiftTradeUser
    let shift: ShiftTradeShift
}

struct ShiftAssignmentActionResponse: Codable {
    let id: String
    let status: String
}
