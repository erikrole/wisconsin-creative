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
