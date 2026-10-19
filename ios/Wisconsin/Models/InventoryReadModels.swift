import Foundation

struct KitRoute: Hashable, Sendable {
    let id: String
}

struct BulkSkuRoute: Hashable, Sendable {
    let id: String
}

struct NamedRecord: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
}

enum InventoryReadAccess {
    static func canViewKits(role: String, capabilities: [String]?) -> Bool {
        if role == "COLLABORATOR" {
            return capabilities?.contains("RESERVATION_CREATE") == true
        }
        return role == "STUDENT" || role == "STAFF" || role == "ADMIN"
    }

    static func canOpenBatteryOps(role: String) -> Bool {
        role == "STAFF" || role == "ADMIN"
    }

    static func canReserve(role: String, capabilities: [String]?) -> Bool {
        if role == "COLLABORATOR" {
            return capabilities?.contains("RESERVATION_CREATE") == true
        }
        return role == "STUDENT" || role == "STAFF" || role == "ADMIN"
    }

    /// Kits group cameras, lenses, and audio. Other catalog rows do not need a kits link.
    static func categoryBelongsInKits(_ name: String?) -> Bool {
        let value = name?.lowercased() ?? ""
        return value.contains("camera")
            || value.contains("lens")
            || value.contains("audio")
            || value.contains("microphone")
            || value.contains("recorder")
    }

    static func categoryIsCamera(_ name: String?) -> Bool {
        name?.lowercased().contains("camera") == true
    }

    static func isBatteryFamily(name: String, category: String?) -> Bool {
        let value = "\(name) \(category ?? "")".lowercased()
        return value.contains("batter")
    }
}

enum KitShelfState: Equatable, Sendable {
    case archived
    case empty
    case ready
    case partial(Int)
    case out

    var label: String {
        switch self {
        case .archived: "Archived"
        case .empty: "Empty"
        case .ready: "Ready"
        case .partial(let count): "\(count) out"
        case .out: "Out"
        }
    }

    var tone: StatusTone {
        switch self {
        case .archived, .empty: .gray
        case .ready: .green
        case .partial: .orange
        case .out: .red
        }
    }

    /// Same rule as the web kits list: item families count as contents, and only
    /// serialized pieces that are off the shelf change Ready / "2 out" / Out.
    static func resolve(active: Bool, contentCount: Int, serialized: Int, unavailable: Int) -> KitShelfState {
        if !active { return .archived }
        if contentCount == 0 { return .empty }
        if serialized > 0 && unavailable >= serialized { return .out }
        if unavailable > 0 { return .partial(unavailable) }
        return .ready
    }
}

struct KitListAvailability: Decodable, Hashable, Sendable {
    let serialized: Int
    let unavailable: Int

    init(serialized: Int = 0, unavailable: Int = 0) {
        self.serialized = serialized
        self.unavailable = unavailable
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        serialized = try container.decodeIfPresent(Int.self, forKey: .serialized) ?? 0
        unavailable = try container.decodeIfPresent(Int.self, forKey: .unavailable) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case serialized, unavailable
    }
}

struct KitListSummary: Decodable, Hashable, Sendable {
    let total: Int
    let active: Int
    let archived: Int
    let empty: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        active = try container.decodeIfPresent(Int.self, forKey: .active) ?? 0
        archived = try container.decodeIfPresent(Int.self, forKey: .archived) ?? 0
        empty = try container.decodeIfPresent(Int.self, forKey: .empty) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case total, active, archived, empty
    }
}

struct KitListItem: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    let sportCode: String?
    let gamedayRole: String?
    let active: Bool
    let location: NamedRecord
    let memberCount: Int
    let bulkCount: Int
    let availability: KitListAvailability

    var contentCount: Int { memberCount + bulkCount }

    var shelf: KitShelfState {
        KitShelfState.resolve(
            active: active,
            contentCount: contentCount,
            serialized: availability.serialized,
            unavailable: availability.unavailable
        )
    }

    var subtitle: String {
        var parts: [String] = [location.name]
        if let sport = sportDisplayName(sportCode) { parts.append(sport) }
        if let job = footballGamedayKitLabel(gamedayRole), job.caseInsensitiveCompare(name) != .orderedSame {
            parts.append(job)
        }
        parts.append(contentCount == 1 ? "1 item" : "\(contentCount) items")
        return parts.joined(separator: " · ")
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Kit"
        description = try container.decodeIfPresent(String.self, forKey: .description)
        sportCode = try container.decodeIfPresent(String.self, forKey: .sportCode)
        gamedayRole = try container.decodeIfPresent(String.self, forKey: .gamedayRole)
        active = try container.decodeIfPresent(Bool.self, forKey: .active) ?? true
        location = try container.decodeIfPresent(NamedRecord.self, forKey: .location)
            ?? NamedRecord(id: "", name: "")
        let count = try container.decodeIfPresent(MemberCounts.self, forKey: .count)
        memberCount = count?.members ?? 0
        bulkCount = count?.bulkMembers ?? 0
        availability = try container.decodeIfPresent(KitListAvailability.self, forKey: .availability)
            ?? KitListAvailability()
    }

    private struct MemberCounts: Decodable {
        let members: Int
        let bulkMembers: Int

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            members = try container.decodeIfPresent(Int.self, forKey: .members) ?? 0
            bulkMembers = try container.decodeIfPresent(Int.self, forKey: .bulkMembers) ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case members, bulkMembers
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, description, sportCode, gamedayRole, active, location, availability
        case count = "_count"
    }
}

struct KitListPage: Decodable, Sendable {
    let data: [KitListItem]
    let total: Int
    let summary: KitListSummary?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        data = try container.decodeIfPresent([KitListItem].self, forKey: .data) ?? []
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? data.count
        summary = try container.decodeIfPresent(KitListSummary.self, forKey: .summary)
    }

    private enum CodingKeys: String, CodingKey {
        case data, total, summary
    }
}

struct KitMemberHolder: Decodable, Hashable, Sendable {
    let bookingId: String
    let bookingTitle: String
    let holderName: String
    let endsAt: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        bookingId = try container.decodeIfPresent(String.self, forKey: .bookingId) ?? ""
        bookingTitle = try container.decodeIfPresent(String.self, forKey: .bookingTitle) ?? ""
        holderName = try container.decodeIfPresent(String.self, forKey: .holderName) ?? ""
        endsAt = try container.decodeIfPresent(String.self, forKey: .endsAt) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case bookingId, bookingTitle, holderName, endsAt
    }
}

struct KitMemberRead: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let createdAt: String?
    let asset: Asset

    struct Asset: Decodable, Hashable, Sendable {
        let id: String
        let assetTag: String?
        let name: String?
        let brand: String
        let model: String
        let status: String
        let computedStatus: String?
        let imageUrl: String?
        let categoryName: String?
        let currentHolder: KitMemberHolder?

        var statusCode: String { computedStatus?.nonBlankText ?? status }

        var primaryTitle: String {
            assetTag.nonBlankText ?? displayName
        }

        var secondaryTitle: String? {
            let product = name.nonBlankText ?? displayName
            if let tag = assetTag.nonBlankText, product.caseInsensitiveCompare(tag) == .orderedSame {
                return nil
            }
            return product.nonBlankText
        }

        private var displayName: String {
            [brand, model].filter { !$0.isEmpty }.joined(separator: " ")
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            assetTag = try container.decodeIfPresent(String.self, forKey: .assetTag)
            name = try container.decodeIfPresent(String.self, forKey: .name)
            brand = try container.decodeIfPresent(String.self, forKey: .brand) ?? ""
            model = try container.decodeIfPresent(String.self, forKey: .model) ?? ""
            status = try container.decodeIfPresent(String.self, forKey: .status) ?? "AVAILABLE"
            computedStatus = try container.decodeIfPresent(String.self, forKey: .computedStatus)
            imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
            categoryName = try container.decodeIfPresent(NamedRecord.self, forKey: .category)?.name
            currentHolder = try container.decodeIfPresent(KitMemberHolder.self, forKey: .currentHolder)
        }

        private enum CodingKeys: String, CodingKey {
            case id, assetTag, name, brand, model, status, computedStatus, imageUrl, category, currentHolder
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? (try container.decode(Asset.self, forKey: .asset)).id
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        asset = try container.decode(Asset.self, forKey: .asset)
    }

    private enum CodingKeys: String, CodingKey {
        case id, createdAt, asset
    }
}

struct KitBulkMemberRead: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let quantity: Int
    let bulkSku: Sku

    struct Sku: Decodable, Hashable, Sendable, Identifiable {
        let id: String
        let name: String
        let category: String?
        let unit: String?
        let imageUrl: String?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Item family"
            category = try container.decodeIfPresent(String.self, forKey: .category)
            unit = try container.decodeIfPresent(String.self, forKey: .unit)
            imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
        }

        private enum CodingKeys: String, CodingKey {
            case id, name, category, unit, imageUrl
        }
    }

    var quantityLabel: String {
        let unitName = bulkSku.unit.nonBlankText ?? "units"
        return "\(quantity) \(unitName)"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        bulkSku = try container.decode(Sku.self, forKey: .bulkSku)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? bulkSku.id
        quantity = try container.decodeIfPresent(Int.self, forKey: .quantity) ?? 1
    }

    private enum CodingKeys: String, CodingKey {
        case id, quantity, bulkSku
    }
}

struct KitReadDetail: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    let sportCode: String?
    let gamedayRole: String?
    let active: Bool
    let createdAt: String?
    let location: NamedRecord
    let members: [KitMemberRead]
    let bulkMembers: [KitBulkMemberRead]

    var contentCount: Int { members.count + bulkMembers.count }

    var shelf: KitShelfState {
        let unavailable = members.filter { $0.asset.statusCode != "AVAILABLE" }.count
        return KitShelfState.resolve(
            active: active,
            contentCount: contentCount,
            serialized: members.count,
            unavailable: unavailable
        )
    }

    var canCall: Bool { active && contentCount > 0 }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Kit"
        description = try container.decodeIfPresent(String.self, forKey: .description)
        sportCode = try container.decodeIfPresent(String.self, forKey: .sportCode)
        gamedayRole = try container.decodeIfPresent(String.self, forKey: .gamedayRole)
        active = try container.decodeIfPresent(Bool.self, forKey: .active) ?? true
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        location = try container.decodeIfPresent(NamedRecord.self, forKey: .location)
            ?? NamedRecord(id: "", name: "")
        members = try container.decodeIfPresent([KitMemberRead].self, forKey: .members) ?? []
        bulkMembers = try container.decodeIfPresent([KitBulkMemberRead].self, forKey: .bulkMembers) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, description, sportCode, gamedayRole, active, createdAt, location, members, bulkMembers
    }
}

struct BulkUnitRead: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let unitNumber: Int
    let status: String
    let notes: String?
    let labelPrintedAt: String?
    let productName: String?
    let holderName: String?
    let bookingTitle: String?

    var presentation: (label: String, tone: StatusTone) { inventoryStatusPresentation(status) }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        unitNumber = try container.decodeIfPresent(Int.self, forKey: .unitNumber) ?? 0
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "AVAILABLE"
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        labelPrintedAt = try container.decodeIfPresent(String.self, forKey: .labelPrintedAt)
        productName = try container.decodeIfPresent(BulkProductName.self, forKey: .product)?.display
        let allocation = try container.decodeIfPresent([BulkAllocationPeek].self, forKey: .allocations)?.first
        holderName = allocation?.holderName
        bookingTitle = allocation?.bookingTitle
    }

    private enum CodingKeys: String, CodingKey {
        case id, unitNumber, status, notes, labelPrintedAt, product, allocations
    }
}

private struct BulkProductName: Decodable {
    let display: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decodeIfPresent(String.self, forKey: .name)
        let brand = try container.decodeIfPresent(String.self, forKey: .brand)
        let model = try container.decodeIfPresent(String.self, forKey: .model)
        let branded = [brand, model].compactMap { $0?.nonBlankText }.joined(separator: " ")
        display = branded.nonBlankText ?? name.nonBlankText
    }

    private enum CodingKeys: String, CodingKey {
        case name, brand, model
    }
}

private struct BulkAllocationPeek: Decodable {
    let holderName: String?
    let bookingTitle: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let booking = try container.decodeIfPresent(Item.self, forKey: .bookingBulkItem)?.booking
        holderName = booking?.requester?.name
        bookingTitle = booking?.title
    }

    private struct Item: Decodable {
        let booking: Booking?
    }

    private struct Booking: Decodable {
        let title: String?
        let requester: Requester?
    }

    private struct Requester: Decodable {
        let name: String?
    }

    private enum CodingKeys: String, CodingKey {
        case bookingBulkItem
    }
}

struct BulkProductRead: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let brand: String?
    let model: String?
    let active: Bool
    let assignedUnitCount: Int

    var line: String {
        let branded = [brand, model].compactMap { $0?.nonBlankText }.joined(separator: " ")
        return branded.nonBlankText ?? name
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Product"
        brand = try container.decodeIfPresent(String.self, forKey: .brand)
        model = try container.decodeIfPresent(String.self, forKey: .model)
        active = try container.decodeIfPresent(Bool.self, forKey: .active) ?? true
        assignedUnitCount = try container.decodeIfPresent(Count.self, forKey: .count)?.units ?? 0
    }

    private struct Count: Decodable {
        let units: Int
        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            units = try container.decodeIfPresent(Int.self, forKey: .units) ?? 0
        }
        private enum CodingKeys: String, CodingKey { case units }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, brand, model, active
        case count = "_count"
    }
}

struct BulkSkuReadDetail: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let categoryName: String
    let locationId: String
    let locationName: String
    let unitLabel: String
    let trackByNumber: Bool
    let active: Bool
    let imageUrl: String?
    let binQrCodeValue: String?
    let minThreshold: Int
    let notes: String?
    let availableQuantity: Int
    let onHandQuantity: Int
    let products: [BulkProductRead]
    let units: [BulkUnitRead]

    var checkedOutQuantity: Int { units.filter { $0.status == "CHECKED_OUT" }.count }
    var missingQuantity: Int { units.filter { $0.status == "LOST" }.count }
    var retiredQuantity: Int { units.filter { $0.status == "RETIRED" }.count }

    var activeTotal: Int {
        trackByNumber ? units.filter { $0.status != "RETIRED" }.count : onHandQuantity
    }

    var isLow: Bool { minThreshold > 0 && availableQuantity <= minThreshold }

    var isBattery: Bool { InventoryReadAccess.isBatteryFamily(name: name, category: categoryName) }

    var labelsPrinted: Int { units.filter { $0.labelPrintedAt != nil && $0.status != "RETIRED" }.count }

    var labelsNeeded: Int {
        units.filter { $0.labelPrintedAt == nil && $0.status != "RETIRED" }.count
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Item family"
        let relation = try container.decodeIfPresent(NamedRecord.self, forKey: .categoryRel)
        let loose = try container.decodeIfPresent(FlexibleCatalogName.self, forKey: .category)
        categoryName = relation?.name.nonBlankText ?? loose?.name ?? ""
        let location = try container.decodeIfPresent(NamedRecord.self, forKey: .location)
        locationId = location?.id ?? ""
        locationName = location?.name ?? ""
        unitLabel = try container.decodeIfPresent(String.self, forKey: .unit) ?? "units"
        units = try container.decodeIfPresent([BulkUnitRead].self, forKey: .units) ?? []
        trackByNumber = try container.decodeIfPresent(Bool.self, forKey: .trackByNumber) ?? false
        active = try container.decodeIfPresent(Bool.self, forKey: .active) ?? true
        imageUrl = try container.decodeIfPresent(String.self, forKey: .imageUrl)
        binQrCodeValue = try container.decodeIfPresent(String.self, forKey: .binQrCodeValue)
        minThreshold = try container.decodeIfPresent(Int.self, forKey: .minThreshold) ?? 0
        notes = try container.decodeIfPresent(String.self, forKey: .notes)
        products = try container.decodeIfPresent([BulkProductRead].self, forKey: .products) ?? []
        let decodedAvailable = try container.decodeIfPresent(Int.self, forKey: .availableQuantity)
        let decodedOnHand = try container.decodeIfPresent(Int.self, forKey: .onHand)
        if trackByNumber {
            availableQuantity = decodedAvailable ?? units.filter { $0.status == "AVAILABLE" }.count
            onHandQuantity = decodedOnHand ?? units.filter { $0.status != "RETIRED" }.count
        } else {
            availableQuantity = decodedAvailable ?? 0
            onHandQuantity = decodedOnHand ?? availableQuantity
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, category, categoryRel, location, unit, trackByNumber, active, imageUrl
        case binQrCodeValue, minThreshold, notes, products, units, availableQuantity, onHand
    }
}

struct BatteryOpsTotals: Decodable, Hashable, Sendable {
    let total: Int
    let available: Int
    let checkedOut: Int
    let lost: Int
    let retired: Int
    let lowSkus: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        available = try container.decodeIfPresent(Int.self, forKey: .available) ?? 0
        checkedOut = try container.decodeIfPresent(Int.self, forKey: .checkedOut) ?? 0
        lost = try container.decodeIfPresent(Int.self, forKey: .lost) ?? 0
        retired = try container.decodeIfPresent(Int.self, forKey: .retired) ?? 0
        lowSkus = try container.decodeIfPresent(Int.self, forKey: .lowSkus) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case total, available, checkedOut, lost, retired, lowSkus
    }
}

struct BatteryOpsUnit: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let unitNumber: Int
    let status: String
    let checkedOutDays: Int?
    let booking: Booking?

    struct Booking: Decodable, Hashable, Sendable {
        let id: String
        let title: String
        let endsAt: String?
        let requesterName: String?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decodeIfPresent(String.self, forKey: .id) ?? ""
            title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
            endsAt = try container.decodeIfPresent(String.self, forKey: .endsAt)
            requesterName = try container.decodeIfPresent(String.self, forKey: .requesterName)
        }

        private enum CodingKeys: String, CodingKey {
            case id, title, endsAt, requesterName
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        unitNumber = try container.decodeIfPresent(Int.self, forKey: .unitNumber) ?? 0
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "AVAILABLE"
        checkedOutDays = try container.decodeIfPresent(Int.self, forKey: .checkedOutDays)
        booking = try container.decodeIfPresent(Booking.self, forKey: .booking)
    }

    private enum CodingKeys: String, CodingKey {
        case id, unitNumber, status, checkedOutDays, booking
    }
}

struct BatteryOpsFamily: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let category: String
    let trackByNumber: Bool
    let locationName: String
    let counts: Counts
    let isLow: Bool
    let labelPrintedCount: Int
    let labelNeededCount: Int
    let units: [BatteryOpsUnit]

    struct Counts: Decodable, Hashable, Sendable {
        let available: Int
        let checkedOut: Int
        let lost: Int
        let retired: Int

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            available = try container.decodeIfPresent(Int.self, forKey: .available) ?? 0
            checkedOut = try container.decodeIfPresent(Int.self, forKey: .checkedOut) ?? 0
            lost = try container.decodeIfPresent(Int.self, forKey: .lost) ?? 0
            retired = try container.decodeIfPresent(Int.self, forKey: .retired) ?? 0
        }

        private enum CodingKeys: String, CodingKey {
            case available, checkedOut, lost, retired
        }
    }

    var availabilityLine: String {
        if trackByNumber {
            return "\(counts.available) available · \(counts.checkedOut) out · \(locationName)"
        }
        return "\(counts.available) on hand · \(locationName)"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Battery"
        category = try container.decodeIfPresent(String.self, forKey: .category) ?? ""
        trackByNumber = try container.decodeIfPresent(Bool.self, forKey: .trackByNumber) ?? true
        locationName = try container.decodeIfPresent(NamedRecord.self, forKey: .location)?.name ?? ""
        counts = try container.decodeIfPresent(Counts.self, forKey: .counts) ?? Counts(fromEmpty: ())
        isLow = try container.decodeIfPresent(Bool.self, forKey: .isLow) ?? false
        labelPrintedCount = try container.decodeIfPresent(Int.self, forKey: .labelPrintedCount) ?? 0
        labelNeededCount = try container.decodeIfPresent(Int.self, forKey: .labelNeededCount) ?? 0
        units = try container.decodeIfPresent([BatteryOpsUnit].self, forKey: .units) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, category, trackByNumber, location, counts, isLow
        case labelPrintedCount, labelNeededCount, units
    }
}

private extension BatteryOpsFamily.Counts {
    init(fromEmpty: Void) {
        available = 0
        checkedOut = 0
        lost = 0
        retired = 0
    }
}

struct BatteryCompatibilityRead: Decodable, Identifiable, Hashable, Sendable {
    let ruleId: String
    let label: String
    let cameraModels: [String]
    let cameraCount: Int
    let batterySkuIds: [String]
    let availableQuantity: Int
    let threshold: Int
    let isLow: Bool

    var id: String { ruleId }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ruleId = try container.decodeIfPresent(String.self, forKey: .ruleId) ?? UUID().uuidString
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? "Batteries"
        cameraModels = try container.decodeIfPresent([String].self, forKey: .cameraModels) ?? []
        cameraCount = try container.decodeIfPresent(Int.self, forKey: .cameraCount) ?? 0
        batterySkuIds = try container.decodeIfPresent([String].self, forKey: .batterySkuIds) ?? []
        availableQuantity = try container.decodeIfPresent(Int.self, forKey: .availableQuantity) ?? 0
        threshold = try container.decodeIfPresent(Int.self, forKey: .threshold) ?? 0
        isLow = try container.decodeIfPresent(Bool.self, forKey: .isLow) ?? true
    }

    private enum CodingKeys: String, CodingKey {
        case ruleId, label, cameraModels, cameraCount, batterySkuIds, availableQuantity, threshold, isLow
    }
}

struct BatteryOpsSnapshot: Decodable, Sendable {
    let totals: BatteryOpsTotals
    let families: [BatteryOpsFamily]
    let compatibility: [BatteryCompatibilityRead]
    let staleCheckedOutCount: Int

    var checkedOutUnits: [(family: BatteryOpsFamily, unit: BatteryOpsUnit)] {
        families.flatMap { family in
            family.units
                .filter { $0.status == "CHECKED_OUT" }
                .map { (family, $0) }
        }
        .sorted { ($0.unit.checkedOutDays ?? 0) > ($1.unit.checkedOutDays ?? 0) }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        totals = try container.decodeIfPresent(BatteryOpsTotals.self, forKey: .totals)
            ?? BatteryOpsTotals(fromEmpty: ())
        families = try container.decodeIfPresent([BatteryOpsFamily].self, forKey: .skus) ?? []
        compatibility = (try container.decodeIfPresent([BatteryCompatibilityRead].self, forKey: .compatibility) ?? [])
            .filter(\.isLow)
        staleCheckedOutCount = try container.decodeIfPresent(Integrity.self, forKey: .integrity)?.staleCheckedOutCount ?? 0
    }

    private struct Integrity: Decodable {
        let staleCheckedOutCount: Int
        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            staleCheckedOutCount = try container.decodeIfPresent(Int.self, forKey: .staleCheckedOutCount) ?? 0
        }
        private enum CodingKeys: String, CodingKey { case staleCheckedOutCount }
    }

    private enum CodingKeys: String, CodingKey {
        case totals, skus, compatibility, integrity
    }
}

private extension BatteryOpsTotals {
    init(fromEmpty: Void) {
        total = 0
        available = 0
        checkedOut = 0
        lost = 0
        retired = 0
        lowSkus = 0
    }
}

struct FlexibleCatalogName: Decodable, Hashable, Sendable {
    let name: String

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let text = try? single.decode(String.self) {
            name = text
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case name }
}

func inventoryStatusPresentation(_ raw: String) -> (label: String, tone: StatusTone) {
    if raw == "LOST" { return ("Missing", .red) }
    switch AssetComputedStatus(rawValue: raw) ?? .unknown {
    case .available: return ("Available", .green)
    case .checkedOut: return ("Checked Out", .blue)
    case .pendingPickup: return ("Pending Pickup", .purple)
    case .reserved: return ("Reserved", .purple)
    case .maintenance: return ("Maintenance", .orange)
    case .retired: return ("Retired", .gray)
    case .unknown: return ("Unknown", .gray)
    }
}

func sportDisplayName(_ code: String?) -> String? {
    guard let code = code?.trimmingCharacters(in: .whitespacesAndNewlines), !code.isEmpty else { return nil }
    let names = [
        "MBB": "Men's Basketball",
        "MXC": "Men's Cross Country",
        "FB": "Football",
        "MGOLF": "Men's Golf",
        "MHKY": "Men's Hockey",
        "MROW": "Men's Rowing",
        "MSOC": "Men's Soccer",
        "MSWIM": "Men's Swimming & Diving",
        "MTEN": "Men's Tennis",
        "MTRACK": "Men's Track & Field",
        "WRES": "Wrestling",
        "WBB": "Women's Basketball",
        "WXC": "Women's Cross Country",
        "WGOLF": "Women's Golf",
        "WHKY": "Women's Hockey",
        "LROW": "Lightweight Rowing",
        "WROW": "Women's Rowing",
        "WSOC": "Women's Soccer",
        "SB": "Softball",
        "WSWIM": "Women's Swimming & Diving",
        "WTEN": "Women's Tennis",
        "WTRACK": "Women's Track & Field",
        "VB": "Volleyball",
    ]
    return names[code.uppercased()] ?? code
}

@MainActor
enum InventoryReadFormatting {
    static func date(from raw: String?) -> Date? {
        guard let raw, !raw.isEmpty else { return nil }
        return fractional.date(from: raw) ?? standard.date(from: raw)
    }

    static func dayLabel(from raw: String?) -> String? {
        date(from: raw)?.formatted(date: .abbreviated, time: .omitted)
    }

    private nonisolated(unsafe) static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private nonisolated(unsafe) static let standard: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
