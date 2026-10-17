import Foundation

enum AssetComputedStatus: String, Codable {
    case available = "AVAILABLE"
    case checkedOut = "CHECKED_OUT"
    case pendingPickup = "PENDING_PICKUP"
    case reserved = "RESERVED"
    case maintenance = "MAINTENANCE"
    case retired = "RETIRED"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let val = try decoder.singleValueContainer().decode(String.self)
        self = AssetComputedStatus(rawValue: val) ?? .unknown
    }

    var label: String {
        switch self {
        case .available: "Available"
        case .checkedOut: "Checked Out"
        case .pendingPickup: "Pending Pickup"
        case .reserved: "Reserved"
        case .maintenance: "Maintenance"
        case .retired: "Retired"
        case .unknown: "Unknown"
        }
    }

    /// The order these statuses are offered as filters, and read back in a
    /// filter summary. One owner so the menu and the summary line can never
    /// list the same selection in two different orders. `unknown` is a decoding
    /// fallback, not a thing anyone filters for, so it is absent.
    static let filterOrder: [AssetComputedStatus] = [
        .available, .checkedOut, .pendingPickup, .reserved, .maintenance, .retired,
    ]
}

struct AssetCategory: Codable, Identifiable {
    let id: String
    let name: String
}

struct AssetLocation: Codable, Identifiable {
    let id: String
    let name: String
}

struct AssetDepartment: Codable, Identifiable {
    let id: String
    let name: String
}

struct AssetActiveBooking: Codable {
    let id: String
    let kind: String
    let status: String?
    let title: String
    let requesterName: String
    let requesterAvatarUrl: String?
    let startsAt: Date?
    let endsAt: Date

    var isOverdue: Bool { endsAt < Date.now }
}

struct Asset: Codable, Identifiable, Hashable {
    let id: String
    let assetTag: String?
    let name: String?
    let brand: String
    let model: String
    let serialNumber: String?
    let imageUrl: String?
    let computedStatus: AssetComputedStatus
    let location: AssetLocation
    let category: AssetCategory?
    let department: AssetDepartment?
    let activeBooking: AssetActiveBooking?
    let purchaseDate: String?
    let purchasePrice: String?   // Prisma Decimal serializes as string
    let residualValue: String?
    let isFavorited: Bool

    var purchasePriceDecimal: Double? { purchasePrice.flatMap(Double.init) }

    var displayName: String {
        [brand, model].joined(separator: " ")
    }

    var itemListPrimaryTitle: String {
        assetTag.nonBlankText ?? displayName
    }

    var itemListSecondaryTitle: String? {
        guard let tag = assetTag.nonBlankText else { return nil }
        let candidate = name.nonBlankText ?? displayName
        return candidate.isSameListText(as: tag) ? nil : candidate
    }

    static func == (lhs: Asset, rhs: Asset) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Returns a copy with `isFavorited` overridden. Asset is immutable; this is the
    /// single source of truth for partial mutation (used by optimistic favorite toggle).
    func withFavorited(_ value: Bool) -> Asset {
        Asset(
            id: id, assetTag: assetTag, name: name, brand: brand, model: model,
            serialNumber: serialNumber, imageUrl: imageUrl, computedStatus: computedStatus,
            location: location, category: category, department: department,
            activeBooking: activeBooking, purchaseDate: purchaseDate,
            purchasePrice: purchasePrice, residualValue: residualValue,
            isFavorited: value
        )
    }
}

extension Asset {
    private enum SafeCodingKeys: String, CodingKey {
        case id, assetTag, name, brand, model, serialNumber, imageUrl, computedStatus
        case location, category, department, activeBooking, purchaseDate, purchasePrice
        case residualValue, isFavorited
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: SafeCodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        assetTag = try c.decodeIfPresent(String.self, forKey: .assetTag)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        brand = try c.decodeIfPresent(String.self, forKey: .brand) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        serialNumber = try c.decodeIfPresent(String.self, forKey: .serialNumber)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        computedStatus = try c.decode(AssetComputedStatus.self, forKey: .computedStatus)
        location = try c.decodeIfPresent(AssetLocation.self, forKey: .location)
            ?? AssetLocation(id: "", name: "")
        category = try c.decodeIfPresent(AssetCategory.self, forKey: .category)
        department = try c.decodeIfPresent(AssetDepartment.self, forKey: .department)
        activeBooking = try c.decodeIfPresent(AssetActiveBooking.self, forKey: .activeBooking)
        purchaseDate = try c.decodeIfPresent(String.self, forKey: .purchaseDate)
        purchasePrice = try c.decodeIfPresent(String.self, forKey: .purchasePrice)
        residualValue = try c.decodeIfPresent(String.self, forKey: .residualValue)
        isFavorited = try c.decodeIfPresent(Bool.self, forKey: .isFavorited) ?? false
    }
}

struct FamilyUnitSummary: Codable, Hashable {
    let unitNumber: Int
    let status: String
}

struct AssetFamilySearchResult: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let name: String
    let category: String
    let unit: String
    let trackByNumber: Bool
    let onHandQuantity: Int
    let availableQuantity: Int
    let checkedOutQuantity: Int
    let lostQuantity: Int
    let retiredQuantity: Int
    let matchedUnitNumber: Int?
    let matchedUnitStatus: String?
    let matchedUnitHolder: String?
    let matchedUnitHolderAvatarUrl: String?
    let matchedUnitDueAt: Date?
    let matchedUnitBookingTitle: String?
    let matchedUnitBookingId: String?
    /// Per-unit roster — present only on exact-unit scan results.
    let units: [FamilyUnitSummary]?
    let imageUrl: String?
    let locationName: String
    let locationId: String
    let categoryId: String?
    let departmentId: String?
    let departmentName: String?
    let binQrCodeValue: String

    var availabilityLabel: String {
        trackByNumber
            ? "\(availableQuantity) of \(onHandQuantity) units available"
            : "\(availableQuantity) \(unit) available"
    }

    var listAvailabilityLabel: String {
        "\(availableQuantity)/\(onHandQuantity) available"
    }

    var trackingStyleLabel: String {
        trackByNumber ? "Unit-tracked item family" : "Quantity-tracked item family"
    }

    var scannedUnitLabel: String? {
        guard let matchedUnitNumber else { return nil }
        let status = matchedUnitStatus?
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
        if let status {
            return "Unit #\(matchedUnitNumber) · \(status)"
        }
        return "Unit #\(matchedUnitNumber)"
    }
}

extension AssetFamilySearchResult {
    private enum SafeCodingKeys: String, CodingKey {
        case id, kind, name, category, unit, trackByNumber, onHandQuantity, availableQuantity
        case checkedOutQuantity, lostQuantity, retiredQuantity, matchedUnitNumber, matchedUnitStatus
        case matchedUnitHolder, matchedUnitHolderAvatarUrl, matchedUnitDueAt, matchedUnitBookingTitle
        case matchedUnitBookingId, units, imageUrl, locationName, locationId, location, categoryId
        case departmentId, departmentName, binQrCodeValue
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: SafeCodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "bulk"
        name = try c.decode(String.self, forKey: .name)
        let categoryObject = try? c.decode(AssetCategory.self, forKey: .category)
        category = (try? c.decode(String.self, forKey: .category)) ?? categoryObject?.name ?? "Items"
        unit = try c.decodeIfPresent(String.self, forKey: .unit) ?? "item"
        trackByNumber = try c.decodeIfPresent(Bool.self, forKey: .trackByNumber) ?? false
        availableQuantity = try c.decodeIfPresent(Int.self, forKey: .availableQuantity) ?? 0
        onHandQuantity = try c.decodeIfPresent(Int.self, forKey: .onHandQuantity) ?? availableQuantity
        checkedOutQuantity = try c.decodeIfPresent(Int.self, forKey: .checkedOutQuantity) ?? 0
        lostQuantity = try c.decodeIfPresent(Int.self, forKey: .lostQuantity) ?? 0
        retiredQuantity = try c.decodeIfPresent(Int.self, forKey: .retiredQuantity) ?? 0
        matchedUnitNumber = try c.decodeIfPresent(Int.self, forKey: .matchedUnitNumber)
        matchedUnitStatus = try c.decodeIfPresent(String.self, forKey: .matchedUnitStatus)
        matchedUnitHolder = try c.decodeIfPresent(String.self, forKey: .matchedUnitHolder)
        matchedUnitHolderAvatarUrl = try c.decodeIfPresent(String.self, forKey: .matchedUnitHolderAvatarUrl)
        matchedUnitDueAt = try c.decodeIfPresent(Date.self, forKey: .matchedUnitDueAt)
        matchedUnitBookingTitle = try c.decodeIfPresent(String.self, forKey: .matchedUnitBookingTitle)
        matchedUnitBookingId = try c.decodeIfPresent(String.self, forKey: .matchedUnitBookingId)
        units = try c.decodeIfPresent([FamilyUnitSummary].self, forKey: .units)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        let locationObject = try? c.decode(AssetLocation.self, forKey: .location)
        locationName = try c.decodeIfPresent(String.self, forKey: .locationName) ?? locationObject?.name ?? ""
        locationId = try c.decodeIfPresent(String.self, forKey: .locationId) ?? locationObject?.id ?? ""
        categoryId = try c.decodeIfPresent(String.self, forKey: .categoryId) ?? categoryObject?.id
        departmentId = try c.decodeIfPresent(String.self, forKey: .departmentId)
        departmentName = try c.decodeIfPresent(String.self, forKey: .departmentName)
        binQrCodeValue = try c.decodeIfPresent(String.self, forKey: .binQrCodeValue) ?? ""
    }
}

enum ItemListRow: Identifiable, Hashable {
    case asset(Asset)
    case family(AssetFamilySearchResult)

    var id: String {
        switch self {
        case .asset(let asset): asset.id
        case .family(let family): "bulk-\(family.id)"
        }
    }
}

struct AssetsResponse: Codable {
    let data: [Asset]
    let bulkItems: [AssetFamilySearchResult]
    let itemOrder: [String]
    let total: Int
    let limit: Int
    let offset: Int

    init(data: [Asset], bulkItems: [AssetFamilySearchResult], itemOrder: [String] = [], total: Int, limit: Int, offset: Int) {
        self.data = data
        self.bulkItems = bulkItems
        self.itemOrder = itemOrder
        self.total = total
        self.limit = limit
        self.offset = offset
    }

    enum CodingKeys: String, CodingKey {
        case data, bulkItems, itemOrder, total, limit, offset
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        data = try container.decode([Asset].self, forKey: .data)
        bulkItems = try container.decodeIfPresent([AssetFamilySearchResult].self, forKey: .bulkItems) ?? []
        itemOrder = try container.decodeIfPresent([String].self, forKey: .itemOrder) ?? []
        total = try container.decode(Int.self, forKey: .total)
        limit = try container.decode(Int.self, forKey: .limit)
        offset = try container.decode(Int.self, forKey: .offset)
    }

    var orderedRows: [ItemListRow] {
        let assetById = Dictionary(uniqueKeysWithValues: data.map { ($0.id, $0) })
        let familyByOrderId = Dictionary(uniqueKeysWithValues: bulkItems.map { ("bulk-\($0.id)", $0) })
        var rows: [ItemListRow] = []
        var seen = Set<String>()

        for id in itemOrder {
            if let asset = assetById[id] {
                rows.append(.asset(asset))
                seen.insert(id)
            } else if let family = familyByOrderId[id] {
                rows.append(.family(family))
                seen.insert(id)
            }
        }

        for asset in data where !seen.contains(asset.id) {
            rows.append(.asset(asset))
        }
        for family in bulkItems where !seen.contains("bulk-\(family.id)") {
            rows.append(.family(family))
        }

        return rows
    }
}

// Asset detail — superset of Asset with history
struct UpcomingReservation: Codable, Identifiable {
    let bookingId: String
    let title: String
    let status: BookingStatus
    let startsAt: Date
    let endsAt: Date
    let requesterName: String

    var id: String { bookingId }
}

/// One booking-history record already returned by `/api/assets/[id]`.
/// The API can contain more than one serialized-item row for a booking, so
/// Item Detail de-duplicates these by `booking.id` before presentation.
struct AssetBookingHistoryEntry: Codable, Identifiable {
    let id: String
    let createdAt: Date
    let booking: AssetBookingHistoryBooking
}

struct AssetBookingHistoryBooking: Codable {
    let id: String
    let kind: BookingKind
    let status: BookingStatus
    let title: String
    let startsAt: Date
    let endsAt: Date
    let requester: AssetBookingHistoryRequester?
    let location: AssetBookingHistoryLocation?
}

struct AssetBookingHistoryRequester: Codable {
    let name: String
    let avatarUrl: String?
}

struct AssetBookingHistoryLocation: Codable {
    let name: String
}

/// Compact link to a parent asset — the gear this accessory is attached to
/// (e.g., the camera body that owns this charger). Mirrors the `parentAsset`
/// field on `/api/assets/[id]`.
struct AssetParentLink: Codable, Hashable {
    let id: String
    let assetTag: String
    let name: String?
    let brand: String
    let model: String

    var displayName: String { [brand, model].joined(separator: " ") }
}

/// One accessory hanging off this asset — same shape the web detail page reads
/// from `/api/assets/[id]`'s `accessories` array. The `type` is the catalog
/// type (CAMERA / LENS / CABLE / etc.) so we can label children semantically.
struct AssetAccessory: Codable, Identifiable, Hashable {
    let id: String
    let assetTag: String
    let name: String?
    let brand: String
    let model: String
    // Nullable on the server (Asset.serialNumber String?) — a required field
    // here would fail the whole /api/assets/[id] decode for any asset whose
    // accessory has no serial.
    let serialNumber: String?
    let status: String
    let type: String
    let imageUrl: String?

    var displayName: String { [brand, model].joined(separator: " ") }
}

/// Free-form asset metadata parsed out of the legacy `notes` JSON column on
/// the server. iOS only decodes the fields the floor surface uses; ignore the
/// rest so future server additions don't break the build.
struct AssetMetadata: Codable, Hashable {
    let uwAssetTag: String?

    init(from decoder: Decoder) throws {
        // Legacy notes JSON is arbitrary user data: `metadata` may not be an
        // object and `uwAssetTag` may not be a string. A type mismatch here
        // must degrade to nil, not fail the whole asset-detail decode.
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        uwAssetTag = (try? container?.decodeIfPresent(String.self, forKey: .uwAssetTag)) ?? nil
    }
}

/// One damage or missing-item report from `GET /api/assets/:id`.
/// Staff and admin receive the five most recent. Students and collaborators
/// omit the key. A single bad row is dropped so the rest of the item still loads.
struct AssetConditionReport: Identifiable {
    let id: String
    /// `DAMAGED`, `LOST`, or an unrecognized server value.
    let typeRaw: String
    let description: String?
    let imageUrl: String?
    let createdAt: Date
    let lastReportedAt: Date?
    let reporterName: String
    let bookingId: String
    let bookingTitle: String

    var reportedAt: Date { lastReportedAt ?? createdAt }

    var isMissing: Bool { typeRaw == "LOST" }
    var isDamaged: Bool { typeRaw == "DAMAGED" }

    var photoURL: URL? {
        guard let imageUrl,
              let url = URL(string: imageUrl),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http"
        else { return nil }
        return url
    }

    var photoAccessibilityLabel: String {
        isMissing
            ? "Open evidence photo for missing item report"
            : "Open evidence photo for damage report"
    }
}

extension AssetConditionReport: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, type, description, imageUrl, createdAt, lastReportedAt, reportedBy, booking
    }

    private struct Person: Codable { let name: String }
    private struct Booking: Codable {
        let id: String
        let title: String?
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        typeRaw = try container.decodeIfPresent(String.self, forKey: .type) ?? ""
        description = try container.decodeIfPresent(String.self, forKey: .description)
        imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
        guard let created = Self.parseDate(try container.decode(String.self, forKey: .createdAt)) else {
            throw DecodingError.dataCorruptedError(
                forKey: .createdAt,
                in: container,
                debugDescription: "Condition report createdAt is not an ISO-8601 date"
            )
        }
        createdAt = created
        if let raw = try container.decodeIfPresent(String.self, forKey: .lastReportedAt) {
            lastReportedAt = Self.parseDate(raw)
        } else {
            lastReportedAt = nil
        }
        reporterName = try container.decode(Person.self, forKey: .reportedBy).name
        let booking = try container.decode(Booking.self, forKey: .booking)
        bookingId = booking.id
        bookingTitle = booking.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(typeRaw, forKey: .type)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(imageUrl, forKey: .imageUrl)
        try container.encode(Self.isoString(createdAt), forKey: .createdAt)
        if let lastReportedAt {
            try container.encode(Self.isoString(lastReportedAt), forKey: .lastReportedAt)
        }
        try container.encode(Person(name: reporterName), forKey: .reportedBy)
        try container.encode(Booking(id: bookingId, title: bookingTitle), forKey: .booking)
    }

    private static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func parseDate(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) { return date }
        return ISO8601DateFormatter().date(from: raw)
    }
}

private struct LenientConditionReport: Decodable {
    let report: AssetConditionReport?

    init(from decoder: Decoder) throws {
        report = try? AssetConditionReport(from: decoder)
    }
}

struct AssetDetail: Codable, Identifiable, Hashable {
    let id: String
    let assetTag: String?
    let name: String?
    let brand: String
    let model: String
    let serialNumber: String?
    let imageUrl: String?
    let qrCodeValue: String?
    let linkUrl: String?
    let computedStatus: AssetComputedStatus
    let location: AssetLocation
    let category: AssetCategory?
    let department: AssetDepartment?
    let activeBooking: AssetActiveBooking?
    let upcomingReservations: [UpcomingReservation]
    let history: [AssetBookingHistoryEntry]
    let parentAsset: AssetParentLink?
    let accessories: [AssetAccessory]?
    var checkinReports: [AssetConditionReport] = []
    let metadata: AssetMetadata?
    let purchaseDate: String?
    let purchasePrice: String?   // Prisma Decimal serializes as string
    let residualValue: String?
    let notes: String?
    let isFavorited: Bool

    var displayName: String { [brand, model].joined(separator: " ") }

    var itemListPrimaryTitle: String {
        assetTag.nonBlankText ?? displayName
    }

    var itemListSecondaryTitle: String? {
        guard let tag = assetTag.nonBlankText else { return nil }
        let candidate = name.nonBlankText ?? displayName
        return candidate.isSameListText(as: tag) ? nil : candidate
    }

    static func == (lhs: AssetDetail, rhs: AssetDetail) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Project the detail back into a regular `Asset` for surfaces (like
    /// `CreateBookingViewModel.prefillReservation(for:)`) that take the
    /// list-shape struct.
    var asAsset: Asset {
        Asset(
            id: id, assetTag: assetTag, name: name, brand: brand, model: model,
            serialNumber: serialNumber, imageUrl: imageUrl, computedStatus: computedStatus,
            location: location, category: category, department: department,
            activeBooking: activeBooking, purchaseDate: purchaseDate,
            purchasePrice: purchasePrice, residualValue: residualValue,
            isFavorited: isFavorited
        )
    }
}

/// The fields returned authoritatively by `PATCH /api/assets/[id]` that the
/// native edit sheet can change.
struct AssetUpdateConfirmation: Decodable {
    let id: String
    let name: String?
    let serialNumber: String?
    let notes: String?
}

extension AssetDetail {
    private enum SafeCodingKeys: String, CodingKey {
        case id, assetTag, name, brand, model, serialNumber, imageUrl, qrCodeValue, linkUrl
        case computedStatus, location, category, department, activeBooking, upcomingReservations, history
        case parentAsset, accessories, checkinReports, metadata, purchaseDate, purchasePrice, residualValue, notes, isFavorited
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: SafeCodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        assetTag = try c.decodeIfPresent(String.self, forKey: .assetTag)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        brand = try c.decodeIfPresent(String.self, forKey: .brand) ?? ""
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        serialNumber = try c.decodeIfPresent(String.self, forKey: .serialNumber)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        qrCodeValue = try c.decodeIfPresent(String.self, forKey: .qrCodeValue)
        linkUrl = try c.decodeIfPresent(String.self, forKey: .linkUrl)
        computedStatus = try c.decode(AssetComputedStatus.self, forKey: .computedStatus)
        location = try c.decodeIfPresent(AssetLocation.self, forKey: .location)
            ?? AssetLocation(id: "", name: "")
        category = try c.decodeIfPresent(AssetCategory.self, forKey: .category)
        department = try c.decodeIfPresent(AssetDepartment.self, forKey: .department)
        activeBooking = try c.decodeIfPresent(AssetActiveBooking.self, forKey: .activeBooking)
        upcomingReservations = try c.decodeIfPresent([UpcomingReservation].self, forKey: .upcomingReservations) ?? []
        history = try c.decodeIfPresent([AssetBookingHistoryEntry].self, forKey: .history) ?? []
        parentAsset = try c.decodeIfPresent(AssetParentLink.self, forKey: .parentAsset)
        accessories = try c.decodeIfPresent([AssetAccessory].self, forKey: .accessories)
        // Absent for students and collaborators. One malformed row is skipped
        // instead of failing the item the person just scanned.
        checkinReports = (try? c.decodeIfPresent([LenientConditionReport].self, forKey: .checkinReports))?
            .compactMap(\.report) ?? []
        metadata = try c.decodeIfPresent(AssetMetadata.self, forKey: .metadata)
        purchaseDate = try c.decodeIfPresent(String.self, forKey: .purchaseDate)
        purchasePrice = try c.decodeIfPresent(String.self, forKey: .purchasePrice)
        residualValue = try c.decodeIfPresent(String.self, forKey: .residualValue)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        isFavorited = try c.decodeIfPresent(Bool.self, forKey: .isFavorited) ?? false
    }

    func applying(_ update: AssetUpdateConfirmation) -> AssetDetail {
        guard update.id == id else { return self }
        return AssetDetail(
            id: id,
            assetTag: assetTag,
            name: update.name,
            brand: brand,
            model: model,
            serialNumber: update.serialNumber,
            imageUrl: imageUrl,
            qrCodeValue: qrCodeValue,
            linkUrl: linkUrl,
            computedStatus: computedStatus,
            location: location,
            category: category,
            department: department,
            activeBooking: activeBooking,
            upcomingReservations: upcomingReservations,
            history: history,
            parentAsset: parentAsset,
            accessories: accessories,
            checkinReports: checkinReports,
            metadata: metadata,
            purchaseDate: purchaseDate,
            purchasePrice: purchasePrice,
            residualValue: residualValue,
            notes: update.notes,
            isFavorited: isFavorited
        )
    }
}
