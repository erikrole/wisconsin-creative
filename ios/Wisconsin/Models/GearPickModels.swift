import Foundation

struct GearPickStyleRoute: Hashable, Sendable {
    let style: String
}

struct GearPickSaveLine: Encodable, Sendable {
    let sku: String
    let size: String?
    let quantity: Int
}

struct GearPicksMePayload: Decodable, Sendable {
    let cycle: GearPickCycle?
    let participant: GearPickParticipant?
    let submission: GearPickSubmission?
    let catalog: GearPickPhoneCatalog?
}

struct GearPickCycle: Decodable, Sendable {
    let id: String
    let title: String
    let deadline: String?
    let isOpen: Bool
    let launchedAt: String?
}

struct GearPickParticipant: Decodable, Sendable {
    let id: String
    let fit: String
    let allowanceCents: Int
}

struct GearPickSubmission: Decodable, Sendable {
    let version: Int
    let totalCents: Int
    let submittedAt: String?
    let updatedAt: String
    let lines: [GearPickServerLine]
}

struct GearPickServerLine: Decodable, Sendable {
    let sku: String
    let style: String
    let colorCode: String
    let size: String?
    let quantity: Int
    let unitPriceCents: Int
    let lineTotalCents: Int
    let itemName: String
    let colorLabel: String
    let category: String?
}

struct GearPickPhoneCatalog: Decodable, Sendable {
    let maxQuantity: Int
    let categories: [String]
    let items: [GearPickPhoneItem]
}

struct GearPickPhoneItem: Decodable, Identifiable, Hashable, Sendable {
    let style: String
    let name: String
    let fit: String
    let category: String
    let priceCents: Int
    let sizeLabel: String
    let sizes: [String]
    let sizesAreExact: Bool
    let oneSize: Bool
    let defaultSize: String?
    let kit: GearPickPhoneKit?
    let colors: [GearPickPhoneColor]

    var id: String { style }
}

struct GearPickPhoneKit: Decodable, Hashable, Sendable {
    let kind: String
    let colorCode: String

    var title: String {
        kind == "CORE_KIT" ? "Included in your core kit" : "Included in your standard issue"
    }

    var shortLabel: String {
        kind == "CORE_KIT" ? "core kit" : "standard issue"
    }
}

struct GearPickPhoneColor: Decodable, Identifiable, Hashable, Sendable {
    let code: String
    let label: String
    let swatch: String
    let image: String

    var id: String { code }
}

struct GearPickDraftLine: Identifiable, Hashable, Sendable {
    let id: UUID
    var sku: String
    var style: String
    var colorCode: String
    var size: String?
    var quantity: Int
    var itemName: String
    var colorLabel: String
    var unitPriceCents: Int
    var category: String?
}

/// The signed-in person's own kit (`GET /api/gear-picks/me/kit`). Decoded
/// defensively: `source` stays a string so a value this build does not know
/// still renders, and everything but a piece's sku has a default.
struct GearMyKit: Decodable, Sendable {
    struct Order: Decodable, Sendable {
        let placedAt: String?
        let expectedAt: String?

        init(placedAt: String?, expectedAt: String?) {
            self.placedAt = placedAt
            self.expectedAt = expectedAt
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            placedAt = try c.decodeIfPresent(String.self, forKey: .placedAt)
            expectedAt = try c.decodeIfPresent(String.self, forKey: .expectedAt)
        }

        private enum CodingKeys: String, CodingKey { case placedAt, expectedAt }
    }

    let group: String
    let order: Order
    let pieces: [GearMyKitPiece]

    init(group: String, order: Order, pieces: [GearMyKitPiece]) {
        self.group = group
        self.order = order
        self.pieces = pieces
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        group = try c.decodeIfPresent(String.self, forKey: .group) ?? ""
        order = try c.decodeIfPresent(Order.self, forKey: .order) ?? Order(placedAt: nil, expectedAt: nil)
        pieces = try c.decodeIfPresent([GearMyKitPiece].self, forKey: .pieces) ?? []
    }

    private enum CodingKeys: String, CodingKey { case group, order, pieces }

    /// Counted by line, the same unit the list shows ("Show all 5"), so the
    /// summary and the list never disagree about a ×2 piece.
    var totalPieces: Int { pieces.count }
    var handedPieces: Int { pieces.filter(\.handed).count }
    var needsSize: Bool { pieces.contains { $0.needsSize } }

    /// Where the whole kit stands, as one sentence.
    var headline: String {
        if totalPieces > 0, handedPieces >= totalPieces { return "Everything is in your hands." }
        if handedPieces > 0 { return "\(handedPieces) of \(totalPieces) in hand." }
        if let placed = GearPickDate.shortDay(order.placedAt) {
            if let expected = GearPickDate.shortDay(order.expectedAt) {
                return "Ordered \(placed). Expected around \(expected)."
            }
            return "Ordered \(placed). We'll tell you when it arrives."
        }
        return "Planned. The order goes in during October."
    }
}

struct GearMyKitPiece: Decodable, Identifiable, Sendable {
    /// Mirrors `SIZE_NEEDED` in `src/lib/gear-picks/order.ts`.
    static let sizeNeeded = "Size needed"

    enum Status: Equatable { case needsSize, planned, onOrder(expected: String?), inHand(on: String?) }

    let sku: String
    let itemName: String
    let colorLabel: String
    let source: String
    let size: String
    let quantity: Int
    let handed: Bool
    let handedOutAt: String?

    var id: String { "\(source)|\(sku)|\(size)" }
    var needsSize: Bool { size == Self.sizeNeeded }

    init(sku: String, itemName: String, colorLabel: String = "", source: String, size: String,
         quantity: Int = 1, handed: Bool = false, handedOutAt: String? = nil) {
        self.sku = sku
        self.itemName = itemName
        self.colorLabel = colorLabel
        self.source = source
        self.size = size
        self.quantity = quantity
        self.handed = handed
        self.handedOutAt = handedOutAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sku = try c.decode(String.self, forKey: .sku)
        itemName = try c.decodeIfPresent(String.self, forKey: .itemName) ?? sku
        colorLabel = try c.decodeIfPresent(String.self, forKey: .colorLabel) ?? ""
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? ""
        size = try c.decodeIfPresent(String.self, forKey: .size) ?? Self.sizeNeeded
        quantity = max(1, try c.decodeIfPresent(Int.self, forKey: .quantity) ?? 1)
        handed = try c.decodeIfPresent(Bool.self, forKey: .handed) ?? false
        handedOutAt = try c.decodeIfPresent(String.self, forKey: .handedOutAt)
    }

    private enum CodingKeys: String, CodingKey {
        case sku, itemName, colorLabel, source, size, quantity, handed, handedOutAt
    }

    /// Same precedence as the web card: handed, then missing size, then ordered.
    func status(order: GearMyKit.Order) -> Status {
        if handed { return .inHand(on: GearPickDate.shortDay(handedOutAt)) }
        if needsSize { return .needsSize }
        if GearPickDate.parse(order.placedAt) != nil { return .onOrder(expected: GearPickDate.shortDay(order.expectedAt)) }
        return .planned
    }

    /// One quiet detail line: size, plus colour when there is one.
    var detail: String {
        var parts = [needsSize ? "No size yet" : "Size \(size)"]
        if !colorLabel.isEmpty { parts.append(colorLabel) }
        if quantity > 1 { parts.append("×\(quantity)") }
        return parts.joined(separator: " · ")
    }
}

enum GearPickMoney {
    static func format(_ cents: Int) -> String {
        let sign = cents < 0 ? "-" : ""
        let absolute = abs(cents)
        return "\(sign)$\(absolute / 100).\(String(format: "%02d", absolute % 100))"
    }
}

enum GearPickDate {
    static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    /// "Oct 21", for the dates a kit status mentions.
    static func shortDay(_ value: String?) -> String? {
        parse(value)?.formatted(.dateTime.month(.abbreviated).day())
    }

    static func label(_ value: String?) -> String? {
        parse(value)?.formatted(date: .abbreviated, time: .shortened)
    }
}

enum GearPickImage {
    static func url(for path: String) -> URL? {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let absolute = URL(string: trimmed), absolute.scheme != nil {
            return absolute
        }
        return URL(string: trimmed, relativeTo: AppEnvironment.activeAPIBaseURL)?.absoluteURL
    }
}

enum GearPickValidation {
    static let sizeLimit = 12

    static func normalizedSize(_ size: String?) -> String? {
        let value = size?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
        return value.isEmpty ? nil : value
    }

    static func sku(style: String, colorCode: String) -> String {
        "\(style)-\(colorCode)"
    }

    static func sizeChoices(item: GearPickPhoneItem, current: String?) -> [String] {
        var sizes = item.sizes
        if let current = normalizedSize(current), !sizes.contains(current) {
            sizes.insert(current, at: 0)
        }
        return sizes
    }

    static func totalCents(lines: [GearPickDraftLine], catalog: GearPickPhoneCatalog?) -> Int {
        lines.reduce(0) { sum, line in
            let price = catalog?.items.first { $0.style == line.style }?.priceCents ?? line.unitPriceCents
            return sum + price * line.quantity
        }
    }

    /// Problems the server would reject, in the same product language.
    static func problems(lines: [GearPickDraftLine], catalog: GearPickPhoneCatalog?, allowanceCents: Int) -> [String] {
        var problems: [String] = []
        var seen = Set<String>()
        let maxQuantity = catalog?.maxQuantity ?? 5
        for line in lines {
            let item = catalog?.items.first { $0.style == line.style }
            let name = item?.name ?? line.itemName
            let color = item?.colors.first { $0.code == line.colorCode }?.label ?? line.colorLabel
            if catalog != nil, item == nil {
                problems.append("\(line.sku) is no longer in the catalog. Remove it to continue.")
                continue
            }
            if line.quantity < 1 || line.quantity > maxQuantity {
                problems.append("Choose between 1 and \(maxQuantity) of \(name).")
            }
            let size = normalizedSize(line.size) ?? (item?.oneSize == true ? "OSFA" : nil)
            if let item {
                if item.oneSize {
                    if let size, size != "OSFA" {
                        problems.append("Choose one size for \(name) (\(color)).")
                    }
                } else if size == nil {
                    problems.append("Choose a size for \(name) (\(color)).")
                } else if let size, size.count > sizeLimit {
                    problems.append("Sizes can be up to \(sizeLimit) characters.")
                } else if let size, item.sizesAreExact, !item.sizes.contains(size) {
                    problems.append("Choose an available size for \(name) (\(color)).")
                }
            }
            let key = "\(line.sku)|\(size ?? "")"
            if seen.contains(key) {
                let sizeLabel = size.map { ", \($0)" } ?? ""
                problems.append("\(name) (\(color)\(sizeLabel)) is listed twice. Combine the quantities.")
            }
            seen.insert(key)
        }
        let total = totalCents(lines: lines, catalog: catalog)
        if total > allowanceCents {
            problems.append("Your picks total \(GearPickMoney.format(total)), which is over your \(GearPickMoney.format(allowanceCents)) allowance. Remove something to continue.")
        }
        return problems
    }
}

enum GearPickFitLabel {
    static func name(_ fit: String?) -> String {
        switch fit {
        case "WOMEN": "Women's and unisex"
        case "MEN": "Men's and unisex"
        default: "Your fit"
        }
    }
}
