import Foundation

// MARK: - Auth

/// The server-owned, signed role-preview state returned by `/api/me`.
/// `expiresAt` is an epoch-millisecond value, matching the web contract; it is
/// kept as a number so a native rollout can read the response without making
/// a client-owned expiration decision.
struct RolePreviewInfo: Codable, Equatable {
    let actualRole: String
    let role: String
    let readOnly: Bool
    let expiresAt: TimeInterval

    init(actualRole: String = "ADMIN", role: String, readOnly: Bool = true, expiresAt: TimeInterval) {
        self.actualRole = actualRole
        self.role = role
        self.readOnly = readOnly
        self.expiresAt = expiresAt
    }

    var roleLabel: String {
        switch role {
        case "STAFF": "Staff"
        case "STUDENT": "Student"
        case "COLLABORATOR": "Collaborator"
        default: role.capitalized
        }
    }

    enum CodingKeys: String, CodingKey {
        case actualRole, role, readOnly, expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        actualRole = try container.decodeIfPresent(String.self, forKey: .actualRole) ?? "ADMIN"
        role = try container.decode(String.self, forKey: .role)
        readOnly = try container.decodeIfPresent(Bool.self, forKey: .readOnly) ?? true
        expiresAt = try container.decodeIfPresent(TimeInterval.self, forKey: .expiresAt) ?? 0
    }
}

struct CurrentUser: Codable, Identifiable, Equatable {
    struct CollaboratorPolicyMetadata: Codable, Equatable {
        let id: String
        let affiliationKey: String
        let displayName: String
        let badgeLabel: String
        let status: String
        let version: Int
    }

    let id: String
    let name: String
    let email: String
    let role: String
    let affiliation: String?
    let collaboratorProfile: String?
    let capabilities: [String]?
    let collaboratorPolicy: CollaboratorPolicyMetadata?
    let staffingType: String?
    let avatarUrl: String?
    let forcePasswordChange: Bool
    let preview: RolePreviewInfo?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case email
        case role
        case affiliation
        case collaboratorProfile
        case capabilities
        case collaboratorPolicy
        case staffingType
        case avatarUrl
        case forcePasswordChange
        case preview
    }

    init(
        id: String,
        name: String,
        email: String,
        role: String,
        affiliation: String? = nil,
        collaboratorProfile: String? = nil,
        capabilities: [String]? = nil,
        collaboratorPolicy: CollaboratorPolicyMetadata? = nil,
        staffingType: String? = nil,
        avatarUrl: String?,
        forcePasswordChange: Bool = false,
        preview: RolePreviewInfo? = nil
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.role = role
        self.affiliation = affiliation
        self.collaboratorProfile = collaboratorProfile
        self.capabilities = capabilities
        self.collaboratorPolicy = collaboratorPolicy
        self.staffingType = staffingType
        self.avatarUrl = avatarUrl
        self.forcePasswordChange = forcePasswordChange
        self.preview = preview
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        email = try container.decode(String.self, forKey: .email)
        role = try container.decode(String.self, forKey: .role)
        affiliation = try container.decodeIfPresent(String.self, forKey: .affiliation)
        collaboratorProfile = try container.decodeIfPresent(String.self, forKey: .collaboratorProfile)
        capabilities = try container.decodeIfPresent([String].self, forKey: .capabilities)
        collaboratorPolicy = try container.decodeIfPresent(CollaboratorPolicyMetadata.self, forKey: .collaboratorPolicy)
        staffingType = try container.decodeIfPresent(String.self, forKey: .staffingType)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        forcePasswordChange = try container.decodeIfPresent(Bool.self, forKey: .forcePasswordChange) ?? false
        preview = try container.decodeIfPresent(RolePreviewInfo.self, forKey: .preview)
    }

    /// Preview mode is a presentation/inspection state over an Admin session,
    /// not a new authenticated identity. Keep the check tied to the server's
    /// actual-role marker so a normal Student response can never opt itself in.
    var isReadOnlyRolePreview: Bool {
        preview?.actualRole == "ADMIN" && preview?.readOnly == true
    }

    /// Changes when the effective shell or signed preview changes. Root tasks
    /// use it to cancel account-owned background work and rebuild role-adaptive
    /// navigation after preview start/stop without pretending the user id changed.
    var shellIdentity: String {
        let previewIdentity = preview.map { "\($0.role)-\($0.expiresAt)" } ?? "live"
        return "\(id)-\(role)-\(previewIdentity)"
    }
}

// MARK: - Notification preferences

/// Mirrors `/api/me/notification-preferences`. `pausedUntil` is an ISO-8601
/// string (server validates `z.string().datetime({ offset: true })`); `nil`
/// means not paused.
///
/// The PUT schema requires the `pausedUntil` KEY to be present (nullable, not
/// optional), so `encode(to:)` writes an explicit `null` instead of the
/// synthesized encodeIfPresent omission — omitting the key 400s every save.
/// `badges`/`categories` are round-tripped untouched so a save from iOS
/// doesn't reset preferences the user customized on web (the server defaults
/// any missing field to true).
struct NotificationPreferences: Codable, Equatable {
    var pausedUntil: String?
    var channels: Channels
    var badges: Bool? = nil
    var categories: Categories? = nil

    struct Channels: Codable, Equatable {
        var email: Bool
        var push: Bool
    }

    struct Categories: Codable, Equatable {
        var checkoutDue: Bool
        var checkoutOverdue: Bool
        var reservation: Bool
        var licenseExpiry: Bool
        var schedule: Bool
        var trade: Bool
        var gearPrep: Bool
    }

    enum CodingKeys: String, CodingKey {
        case pausedUntil, channels, badges, categories
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(pausedUntil, forKey: .pausedUntil) // explicit null when nil
        try container.encode(channels, forKey: .channels)
        try container.encodeIfPresent(badges, forKey: .badges)
        try container.encodeIfPresent(categories, forKey: .categories)
    }
}

// MARK: - Bookings

enum BookingStatus: String, Codable {
    case draft = "DRAFT"
    case booked = "BOOKED"
    case pendingPickup = "PENDING_PICKUP"
    case open = "OPEN"
    case completed = "COMPLETED"
    case cancelled = "CANCELLED"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let val = try decoder.singleValueContainer().decode(String.self)
        self = BookingStatus(rawValue: val) ?? .unknown
    }

    var label: String {
        switch self {
        case .draft: "Draft"
        case .booked: "Booked"
        case .pendingPickup: "Pending Pickup"
        case .open: "Checked Out"
        case .completed: "Completed"
        case .cancelled: "Cancelled"
        case .unknown: "Unknown"
        }
    }

}

enum BookingKind: String, Codable {
    case reservation = "RESERVATION"
    case checkout = "CHECKOUT"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let val = try decoder.singleValueContainer().decode(String.self)
        self = BookingKind(rawValue: val) ?? .unknown
    }
}

struct BookingUser: Codable, Identifiable {
    let id: String
    let name: String
    let email: String?
    let avatarUrl: String?
}

struct BookingLocation: Codable, Identifiable {
    let id: String
    let name: String
}

struct BookingAsset: Codable, Identifiable {
    let id: String
    let assetTag: String?
    let name: String?
    let brand: String?
    let model: String?
    let serialNumber: String?
    let imageUrl: String?

    var displayName: String {
        [brand, model]
            .compactMap(\.nonBlankText)
            .joined(separator: " ")
    }

    var itemListPrimaryTitle: String {
        assetTag.nonBlankText ?? displayName.nonBlankText ?? "Item"
    }

    var itemListSecondaryTitle: String? {
        guard let tag = assetTag.nonBlankText else { return nil }
        let candidate = name.nonBlankText ?? displayName.nonBlankText
        return candidate?.isSameListText(as: tag) == true ? nil : candidate
    }
}

struct BookingSerializedItem: Codable, Identifiable {
    let id: String
    let assetId: String
    let allocationStatus: String?
    let asset: BookingAsset
}

struct BulkSku: Codable, Identifiable {
    let id: String
    let name: String
    let unit: String?
    let imageUrl: String?
    let trackByNumber: Bool?
}

/// One numbered unit (e.g. battery #19) allocated to a bulk line item. Present
/// only for unit-tracked SKUs; mirrors the web `unitAllocations[].bulkSkuUnit`.
struct BookingBulkUnitAllocation: Codable {
    let bulkSkuUnit: BulkSkuUnitRef

    struct BulkSkuUnitRef: Codable {
        let unitNumber: Int
    }
}

struct BookingBulkItem: Codable, Identifiable {
    let id: String
    let plannedQuantity: Int
    let checkedOutQuantity: Int
    let checkedInQuantity: Int
    let bulkSku: BulkSku
    let unitAllocations: [BookingBulkUnitAllocation]?

    /// Sorted unit numbers when this is a unit-tracked SKU with allocations.
    var assignedUnitNumbers: [Int] {
        guard bulkSku.trackByNumber == true else { return [] }
        return (unitAllocations ?? []).map(\.bulkSkuUnit.unitNumber).sorted()
    }

    var itemListPrimaryTitle: String {
        let unitTags = assignedUnitNumbers.map { "#\($0)" }.joined(separator: " ")
        return unitTags.nonBlankText ?? bulkSku.name
    }

    var itemListSecondaryTitle: String? {
        itemListPrimaryTitle.isSameListText(as: bulkSku.name) ? nil : bulkSku.name
    }
}

struct BookingEvent: Codable, Identifiable {
    let id: String
    let summary: String?
    let sportCode: String?
    let opponent: String?
    let isHome: Bool?
}

/// The kiosk device that handled pickup. Captured at kiosk custody transitions;
/// its location is the context for future return-to-location suggestions.
struct PickupKioskDevice: Codable, Identifiable {
    let id: String
    let name: String
    let location: BookingLocation
}

struct Booking: Codable, Identifiable, Hashable {
    static func == (lhs: Booking, rhs: Booking) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let kind: BookingKind
    let title: String
    let status: BookingStatus
    let startsAt: Date
    let endsAt: Date
    let notes: String?
    let refNumber: String?
    let requester: BookingUser
    let location: BookingLocation
    let serializedItems: [BookingSerializedItem]
    let bulkItems: [BookingBulkItem]
    let event: BookingEvent?
    var events: [BookingEvent]? = nil
    var allowedActions: [String]? = nil
    let updatedAt: Date?
    let pickupKioskDevice: PickupKioskDevice?

    /// New servers return every linked event. Older list/detail payloads only
    /// carry the legacy primary event, so keep that as a rollout-safe fallback.
    var linkedEvents: [BookingEvent] {
        if let events, !events.isEmpty { return events }
        return event.map { [$0] } ?? []
    }

    func allows(_ action: String) -> Bool? {
        allowedActions.map { $0.contains(action) }
    }
}

struct BookingStub: Codable {
    let id: String
    let creationDisposition: String?
}

struct ReservationCreationReceipt: Equatable {
    let id: String
    let consolidated: Bool
}

/// A scheduling conflict surfaced by `/api/availability/check`: another booking
/// holds `assetId` during the requested window or its serialized turnaround
/// buffer. The picker can prevent a known conflict; server enforcement at
/// create/checkout remains authoritative for races.
struct AssetConflict: Decodable {
    let assetId: String
    let conflictingBookingId: String?
    let conflictingBookingTitle: String?
    let startsAt: Date?
    let endsAt: Date?
}

struct BookingAvailabilityShortage: Decodable {
    let bulkSkuId: String
    let requested: Int
    let available: Int
}

struct BookingUnavailableAsset: Decodable {
    let assetId: String
    let status: String
}

/// The top-level response from `/api/availability/check`.
///
/// The advisory arrays are optional at the wire boundary so a native build can
/// continue to render hard availability results while the server rolls out
/// timing-aware response fields.
struct AvailabilityCommitment: Decodable {
    let assetId: String
    let bookingId: String?
    let bookingTitle: String?
    let startsAt: Date?
    let endsAt: Date?
    let status: String?
    let nextLocationId: String?
    let nextLocationName: String?
}

struct AvailabilityTurnaroundRisk: Decodable {
    let assetId: String
    let code: String?
    let severity: String?
    let message: String?
    let bookingId: String?
    let bookingTitle: String?
    let startsAt: Date?
    let gapMinutes: Int?
    let nextLocationName: String?
    let reportType: String?
    let reportCreatedAt: Date?
}

struct AvailabilityBulkTurnaroundRisk: Decodable {
    let bulkSkuId: String
    let code: String?
    let severity: String?
    let message: String?
    let bookingId: String?
    let bookingTitle: String?
    let startsAt: Date?
    let gapMinutes: Int?
    let plannedQuantity: Int?
}

struct AvailabilityCheckResult: Decodable {
    let conflicts: [AssetConflict]
    let shortages: [BookingAvailabilityShortage]
    let unavailableAssets: [BookingUnavailableAsset]
    let upcomingCommitments: [AvailabilityCommitment]
    let turnaroundRisks: [AvailabilityTurnaroundRisk]
    let bulkTurnaroundRisks: [AvailabilityBulkTurnaroundRisk]

    init(
        conflicts: [AssetConflict] = [],
        shortages: [BookingAvailabilityShortage] = [],
        unavailableAssets: [BookingUnavailableAsset] = [],
        upcomingCommitments: [AvailabilityCommitment] = [],
        turnaroundRisks: [AvailabilityTurnaroundRisk] = [],
        bulkTurnaroundRisks: [AvailabilityBulkTurnaroundRisk] = []
    ) {
        self.conflicts = conflicts
        self.shortages = shortages
        self.unavailableAssets = unavailableAssets
        self.upcomingCommitments = upcomingCommitments
        self.turnaroundRisks = turnaroundRisks
        self.bulkTurnaroundRisks = bulkTurnaroundRisks
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        conflicts = try container.decodeIfPresent([AssetConflict].self, forKey: .conflicts) ?? []
        shortages = try container.decodeIfPresent([BookingAvailabilityShortage].self, forKey: .shortages) ?? []
        unavailableAssets = try container.decodeIfPresent([BookingUnavailableAsset].self, forKey: .unavailableAssets) ?? []
        upcomingCommitments = try container.decodeIfPresent([AvailabilityCommitment].self, forKey: .upcomingCommitments) ?? []
        turnaroundRisks = try container.decodeIfPresent([AvailabilityTurnaroundRisk].self, forKey: .turnaroundRisks) ?? []
        bulkTurnaroundRisks = try container.decodeIfPresent([AvailabilityBulkTurnaroundRisk].self, forKey: .bulkTurnaroundRisks) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case conflicts
        case shortages
        case unavailableAssets
        case upcomingCommitments
        case turnaroundRisks
        case bulkTurnaroundRisks
    }

    var isAvailable: Bool {
        conflicts.isEmpty && shortages.isEmpty && unavailableAssets.isEmpty
    }

    var issueSummary: String {
        let affectedCount = conflicts.count + shortages.count + unavailableAssets.count
        return affectedCount == 1
            ? "That return time conflicts with another booking."
            : "That return time creates \(affectedCount) availability conflicts."
    }

    var conflictsByAssetId: [String: AssetConflict] {
        conflicts.reduce(into: [:]) { result, conflict in
            result[conflict.assetId] = conflict
        }
    }

    var upcomingCommitmentsByAssetId: [String: AvailabilityCommitment] {
        upcomingCommitments.reduce(into: [:]) { result, commitment in
            if result[commitment.assetId] == nil {
                result[commitment.assetId] = commitment
            }
        }
    }

    var turnaroundRisksByAssetId: [String: [AvailabilityTurnaroundRisk]] {
        turnaroundRisks.reduce(into: [:]) { result, risk in
            result[risk.assetId, default: []].append(risk)
        }
    }

    var bulkTurnaroundRisksBySkuId: [String: [AvailabilityBulkTurnaroundRisk]] {
        bulkTurnaroundRisks.reduce(into: [:]) { result, risk in
            result[risk.bulkSkuId, default: []].append(risk)
        }
    }
}

/// Compatibility name used by the booking-edit availability flow.
typealias BookingAvailabilityResult = AvailabilityCheckResult

// MARK: - Users

struct AppUser: Codable, Identifiable {
    struct CollaboratorPolicy: Codable {
        let status: String
        let capabilities: [String]?
    }

    let id: String
    let name: String
    let email: String
    let role: String
    let staffingType: String?
    let location: String?
    let avatarUrl: String?
    let primaryArea: String?
    let title: String?
    let active: Bool?
    let gradYear: Int?
    let studentYearOverride: String?
    let collaboratorPolicy: CollaboratorPolicy?
}

struct AppUserDetail: Codable, Identifiable {
    let id: String
    let name: String
    let email: String
    let role: String
    let locationId: String?
    let location: String?
    let phone: String?
    let primaryArea: String?
    let avatarUrl: String?
    let active: Bool
    let createdAt: String?
    // The list row leads with title (or student year) and area. The detail
    // endpoint has always returned these; the model just never decoded them, so
    // a profile could say less about a person than the row you tapped to reach
    // it. Optional-decoded because older payloads predate them.
    let title: String?
    let gradYear: Int?
    let studentYearOverride: String?
}

/// How a person is described in one line. One owner so the Users list row and
/// the profile it opens can never introduce the same person two different ways.
enum UserIdentity {
    /// Staff lead with their job title; students with the academic year their
    /// graduation date implies, since a student's title is almost always blank.
    static func standing(role: String, title: String?, gradYear: Int?, studentYearOverride: String?) -> String? {
        if role == "STUDENT" {
            return studentYear(gradYear: gradYear, override: studentYearOverride)
        }
        guard let title, !title.isEmpty else { return nil }
        return title
    }

    static func studentYear(gradYear: Int?, override: String?) -> String? {
        if let override, let label = yearLabel(override) { return label }
        guard let gradYear else { return nil }
        let calendar = Calendar.current
        let now = Date()
        // The academic year rolls in August, so a May graduate is still a
        // senior in April and a grad the following September.
        let academicYearEnd = calendar.component(.month, from: now) >= 8
            ? calendar.component(.year, from: now) + 1
            : calendar.component(.year, from: now)
        switch gradYear - academicYearEnd {
        case ...(-1): return "Grad"
        case 0: return "Senior"
        case 1: return "Junior"
        case 2: return "Sophomore"
        case 3...: return "Freshman"
        default: return nil
        }
    }

    /// Standing plus area: "Senior · Video", "Digital Producer · Video".
    static func line(role: String, title: String?, gradYear: Int?, studentYearOverride: String?, primaryArea: String?) -> String? {
        var parts: [String] = []
        if let standing = standing(role: role, title: title, gradYear: gradYear, studentYearOverride: studentYearOverride) {
            parts.append(standing)
        }
        if let primaryArea, !primaryArea.isEmpty { parts.append(primaryArea.shiftAreaLabel) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private static func yearLabel(_ year: String) -> String? {
        switch year {
        case "FRESHMAN": "Freshman"
        case "SOPHOMORE": "Sophomore"
        case "JUNIOR": "Junior"
        case "SENIOR": "Senior"
        case "GRAD": "Grad"
        default: nil
        }
    }
}

/// A streak the server is already keeping. `current` is the run in force now,
/// `longest` the best it has ever been.
struct BadgeStreakSummary: Codable, Identifiable {
    let type: String
    let current: Int
    let longest: Int
    let lastEventAt: String?

    var id: String { type }

    /// A streak nobody has started is not a fact worth a row.
    var isWorthShowing: Bool { current > 0 || longest > 0 }

    var label: String {
        switch type {
        case "ON_TIME_RETURN": current == 1 ? "1 on-time return in a row" : "\(current) on-time returns in a row"
        case "SCAN_CLEAN": current == 1 ? "1 clean scan in a row" : "\(current) clean scans in a row"
        default: "\(current) in a row"
        }
    }

    var systemImage: String {
        switch type {
        case "ON_TIME_RETURN": "clock.badge.checkmark.fill"
        case "SCAN_CLEAN": "barcode.viewfinder"
        default: "flame.fill"
        }
    }
}

struct BadgeProfile: Codable {
    let userId: String
    let peerVisible: Bool
    let earnedCount: Int
    let totalCount: Int
    let badges: [UserBadge]
    let disabled: Bool?
    let streaks: [BadgeStreakSummary]?

    var earnedBadges: [UserBadge] {
        badges.filter(\.earned)
    }
}

struct UserBadge: Codable, Identifiable {
    let id: String
    let key: String
    let name: String
    let description: String
    let icon: String
    let category: String
    let kind: String
    let trigger: String
    let threshold: Int?
    let ruleKey: String?
    let active: Bool
    let sortOrder: Int
    let earned: Bool
    let awardedAt: String?
    let source: String?
    let note: String?
    /// Who gave a manual award. Served on every badge row; without it a Staff
    /// Picks award arrived on the phone anonymous while the web tab named the
    /// person who gave it.
    let awardedByName: String?
    let progressCurrent: Int?
    let progressTarget: Int?
    /// Served rarity, computed from how many people actually hold the badge.
    /// Optional so an older payload still decodes; the `rarity` accessor falls
    /// back to a local difficulty rating when it is absent. Stored under a
    /// different name because `rarity` itself is that accessor.
    let servedRarity: String?
    let holders: Int?

    enum CodingKeys: String, CodingKey {
        case id, key, name, description, icon, category, kind, trigger
        case threshold, ruleKey, active, sortOrder, earned, awardedAt
        case source, note, awardedByName, progressCurrent, progressTarget, holders
        case servedRarity = "rarity"
    }
}

// MARK: - Licenses

enum LicenseCodeStatus: String, Codable {
    case available = "AVAILABLE"
    case partial = "PARTIAL"
    case claimed = "CLAIMED"
    case retired = "RETIRED"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = LicenseCodeStatus(rawValue: rawValue) ?? .unknown
    }

    var label: String {
        switch self {
        case .available: "Available"
        case .partial: "Partially Claimed"
        case .claimed: "Full"
        case .retired: "Retired"
        case .unknown: "Unknown"
        }
    }
}

struct LicenseClaimUser: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let avatarUrl: String?
}

struct LicenseCodeClaim: Codable, Identifiable, Equatable {
    let id: String
    let userId: String?
    let occupantLabel: String?
    let claimedAt: String?
    let releasedAt: String?
    let releasedById: String?
    let user: LicenseClaimUser?
}

struct LicenseCode: Codable, Identifiable, Equatable {
    let id: String
    let code: String
    let label: String?
    let accountEmail: String?
    let expiresAt: String?
    let status: LicenseCodeStatus
    let claimedById: String?
    let claimedAt: String?
    let nagSentAt: String?
    let createdAt: String?
    let updatedAt: String?
    let createdById: String?
    let claims: [LicenseCodeClaim]

    enum CodingKeys: String, CodingKey {
        case id
        case code
        case label
        case accountEmail
        case expiresAt
        case status
        case claimedById
        case claimedAt
        case nagSentAt
        case createdAt
        case updatedAt
        case createdById
        case claims
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        code = try container.decodeIfPresent(String.self, forKey: .code) ?? ""
        label = try container.decodeIfPresent(String.self, forKey: .label)
        accountEmail = try container.decodeIfPresent(String.self, forKey: .accountEmail)
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        status = try container.decodeIfPresent(LicenseCodeStatus.self, forKey: .status) ?? .unknown
        claimedById = try container.decodeIfPresent(String.self, forKey: .claimedById)
        claimedAt = try container.decodeIfPresent(String.self, forKey: .claimedAt)
        nagSentAt = try container.decodeIfPresent(String.self, forKey: .nagSentAt)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        createdById = try container.decodeIfPresent(String.self, forKey: .createdById)
        claims = try container.decodeIfPresent([LicenseCodeClaim].self, forKey: .claims) ?? []
    }
}

struct ActiveLicenseClaim: Codable, Identifiable, Equatable {
    let id: String
    let code: String
    let label: String?
    let expiresAt: String?
    let claimedAt: String?
    let claimId: String
}

struct LicenseClaimResult: Codable, Equatable {
    let id: String
    let code: String
}

// MARK: - Resources

enum ResourceType: String, Codable, CaseIterable, Identifiable {
    case contacts = "CONTACTS"
    case buildingNumbers = "BUILDING_NUMBERS"
    case mediaDrive = "MEDIA_DRIVE"
    case serverPaths = "SERVER_PATHS"
    case sop = "SOP"
    case howTo = "HOW_TO"
    case troubleshooting = "TROUBLESHOOTING"
    case accountNote = "ACCOUNT_NOTE"
    case eventOps = "EVENT_OPS"
    case general = "GENERAL"
    case unknown = "UNKNOWN"

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let rawValue = try decoder.singleValueContainer().decode(String.self)
        self = ResourceType(rawValue: rawValue) ?? .unknown
    }

    var label: String {
        switch self {
        case .contacts: "Contacts"
        case .buildingNumbers: "Building numbers"
        case .mediaDrive: "Media Drive"
        case .serverPaths: "Server paths"
        case .sop: "SOP"
        case .howTo: "How-to"
        case .troubleshooting: "Troubleshooting"
        case .accountNote: "Account note"
        case .eventOps: "Event ops"
        case .general: "General"
        case .unknown: "Guide"
        }
    }

    var systemImage: String {
        switch self {
        case .contacts: "phone"
        case .buildingNumbers: "building.2"
        case .mediaDrive: "externaldrive"
        case .serverPaths: "folder"
        case .sop: "checklist"
        case .howTo: "book"
        case .troubleshooting: "wrench.and.screwdriver"
        case .accountNote: "person.text.rectangle"
        case .eventOps: "video"
        case .general, .unknown: "doc.text"
        }
    }

    var tone: StatusTone {
        switch self {
        case .contacts: .blue
        case .buildingNumbers: .orange
        case .mediaDrive: .purple
        case .serverPaths: .green
        case .sop: .blue
        case .howTo: .purple
        case .troubleshooting: .orange
        case .accountNote: .gray
        case .eventOps: .red
        case .general, .unknown: .gray
        }
    }
}

struct GuideAuthor: Codable, Identifiable, Equatable {
    let id: String
    let name: String
}

struct GuideVerifier: Codable, Identifiable, Equatable {
    let id: String
    let name: String
}

struct GuideListItem: Codable, Identifiable, Hashable {
    static func == (lhs: GuideListItem, rhs: GuideListItem) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    let id: String
    let title: String
    let slug: String
    let type: ResourceType
    let category: String
    let summary: String
    let searchText: String
    let markdown: String
    let targetRoles: [String]
    let targetAreas: [String]
    let featured: Bool
    let featuredRank: Int?
    let lastVerifiedAt: String?
    let lastVerifiedBy: GuideVerifier?
    let personalizationReason: String
    let published: Bool
    let createdAt: String?
    let updatedAt: String?
    let author: GuideAuthor

    enum CodingKeys: String, CodingKey {
        case id, title, slug, type, category, summary, searchText, markdown, targetRoles, targetAreas
        case featured, featuredRank, lastVerifiedAt, lastVerifiedBy, personalizationReason
        case published, createdAt, updatedAt, author
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        slug = try container.decode(String.self, forKey: .slug)
        type = try container.decodeIfPresent(ResourceType.self, forKey: .type) ?? .general
        category = try container.decodeIfPresent(String.self, forKey: .category) ?? ""
        summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? ""
        searchText = try container.decodeIfPresent(String.self, forKey: .searchText) ?? ""
        markdown = try container.decodeIfPresent(String.self, forKey: .markdown) ?? ""
        targetRoles = try container.decodeIfPresent([String].self, forKey: .targetRoles) ?? []
        targetAreas = try container.decodeIfPresent([String].self, forKey: .targetAreas) ?? []
        featured = try container.decodeIfPresent(Bool.self, forKey: .featured) ?? false
        featuredRank = try container.decodeIfPresent(Int.self, forKey: .featuredRank)
        lastVerifiedAt = try container.decodeIfPresent(String.self, forKey: .lastVerifiedAt)
        lastVerifiedBy = try container.decodeIfPresent(GuideVerifier.self, forKey: .lastVerifiedBy)
        personalizationReason = try container.decodeIfPresent(String.self, forKey: .personalizationReason) ?? "General"
        published = try container.decodeIfPresent(Bool.self, forKey: .published) ?? true
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        author = try container.decode(GuideAuthor.self, forKey: .author)
    }
}

// MARK: - Reports

struct OverdueBookingSummary: Codable, Identifiable {
    let id: String
    let title: String
    let endsAt: String
    let overdueHours: Int
    let location: String
    let itemCount: Int
    let items: [String]
}

struct OverdueLeaderboardEntry: Codable, Identifiable {
    let userId: String
    let name: String
    let overdueCount: Int
    let totalOverdueHours: Int
    let bookings: [OverdueBookingSummary]?
    var id: String { userId }
}

struct OverdueReport: Codable {
    let totalOverdueBookings: Int
    let leaderboard: [OverdueLeaderboardEntry]
}

/// Most-used asset over the report window, ranked by days spent in custody.
struct UtilizationTopUsedAsset: Codable, Identifiable, Sendable {
    let assetId: String
    let assetTag: String
    let name: String
    let checkouts: Int
    let custodyDays: Double
    let utilizationRate: Double

    var id: String { assetId }
}

/// Custody half of `/api/reports/utilization`. The web payload also carries
/// idle-asset rows and breakdown tables; iOS decodes only what it draws, and
/// Codable ignores the rest.
struct UtilizationCustody: Codable, Sendable {
    let utilizationRate: Double
    let custodyDays: Double
    let assetsUsed: Int
    let checkoutCount: Int
    let idleCount: Int
    let neverCheckedOutCount: Int
    let topUsed: [UtilizationTopUsedAsset]
}

/// The custody block, `days`, and `activeAssets` arrived with the custody
/// rebuild of the web report. A shipped build can outrun the server it talks to
/// — during a deploy window, or after a rollback — so they decode as optional
/// and the screen renders whatever the server actually knows about. The status
/// snapshot predates the rebuild and is always present.
struct UtilizationReport: Codable, Sendable {
    let days: Int?
    let activeAssets: Int?
    let partialFailures: [String]?
    let totalAssets: Int
    let statusCounts: [String: Int]
    let custody: UtilizationCustody?
}

struct CheckoutTrendPoint: Codable, Identifiable, Sendable {
    /// `YYYY-MM-DD`, already bucketed per UTC day by the server.
    let date: String
    let count: Int

    var id: String { date }
}

/// Trend half of `/api/reports/checkouts`. The heatmap, requester ranking, and
/// row list stay on web; iOS shows the activity shape and the period delta.
struct CheckoutActivityReport: Codable, Sendable {
    let days: Int
    let partialFailures: [String]?
    let totalCheckouts: Int
    let previousTotalCheckouts: Int?
    let overdueCheckouts: Int
    let dailyTrend: [CheckoutTrendPoint]?
}

// MARK: - API Responses

struct PaginatedResponse<T: Codable & Sendable>: Codable, Sendable {
    let data: [T]
    let total: Int
    let limit: Int
    let offset: Int
}

struct APIResponse<T: Codable>: Codable {
    let data: T?
    let error: String?
}
