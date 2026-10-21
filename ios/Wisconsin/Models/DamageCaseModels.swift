import Foundation

enum DamageCaseView: String, CaseIterable, Identifiable {
    case open
    case closed
    var id: String { rawValue }
    var label: String { self == .open ? "Open" : "Closed" }
}

/// One row of `GET /api/damage-cases`: a damaged or missing-item report with
/// what it is about. Serialized items open their page; batteries and counted
/// stock can be closed here but their pages live on the web.
struct DamageCase: Identifiable, Hashable, Decodable {
    static func == (lhs: DamageCase, rhs: DamageCase) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    struct Item: Decodable, Hashable {
        let kind: String
        let id: String
        let label: String
        let tag: String
        let imageUrl: String?
        let status: String?

        var isAsset: Bool { kind == "asset" }
    }

    struct Booking: Decodable, Hashable {
        let id: String
        let title: String
    }

    struct Person: Decodable, Hashable {
        let id: String
        let name: String
    }

    let id: String
    let type: String
    let description: String?
    let imageUrl: String?
    let reportedAt: Date
    let item: Item
    let booking: Booking?
    let responsible: Person?
    let reportedBy: String
    let stillBookable: Bool
    let resolution: String?
    let resolvedAt: Date?
    let resolvedBy: String?
    let resolutionNote: String?

    var isMissing: Bool { type == "LOST" }
    var isOpen: Bool { resolution == nil }

    var outcomeLabel: String? {
        guard let resolution else { return nil }
        let outcome = DamageResolution(rawValue: resolution)?.label ?? "Closed"
        guard let name = resolvedBy?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return outcome }
        return "\(outcome) by \(name)"
    }

    /// The report's photo when it has one, otherwise the item's own picture.
    var thumbnailURL: URL? {
        if let photoURL { return photoURL }
        guard let raw = item.imageUrl, let url = URL(string: raw) else { return nil }
        return url
    }

    /// "Had it: Name · 2 days ago", or the closing line once resolved.
    var rowMeta: String {
        let when = reportedAt.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
        var parts: [String] = []
        if let responsible { parts.append("Had it: \(responsible.name)") } else { parts.append(reportedBy) }
        parts.append(when)
        if let outcomeLabel { parts.append(outcomeLabel) }
        return parts.joined(separator: " · ")
    }

    var note: String { description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

    var photoURL: URL? {
        guard let imageUrl, let url = URL(string: imageUrl),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        return url
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, description, imageUrl, reportedAt, item, booking, responsible, reportedBy
        case stillBookable, resolution, resolvedAt, resolvedBy, resolutionNote
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        reportedAt = try Self.date(c.decode(String.self, forKey: .reportedAt), key: .reportedAt, in: c)
        item = try c.decode(Item.self, forKey: .item)
        booking = try c.decodeIfPresent(Booking.self, forKey: .booking)
        responsible = try c.decodeIfPresent(Person.self, forKey: .responsible)
        reportedBy = try c.decodeIfPresent(String.self, forKey: .reportedBy) ?? ""
        stillBookable = try c.decodeIfPresent(Bool.self, forKey: .stillBookable) ?? false
        resolution = try c.decodeIfPresent(String.self, forKey: .resolution)
        resolvedAt = (try c.decodeIfPresent(String.self, forKey: .resolvedAt)).flatMap(Self.parse)
        resolvedBy = try c.decodeIfPresent(String.self, forKey: .resolvedBy)
        resolutionNote = try c.decodeIfPresent(String.self, forKey: .resolutionNote)
    }

    private static func date(_ raw: String, key: CodingKeys, in c: KeyedDecodingContainer<CodingKeys>) throws -> Date {
        guard let date = parse(raw) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "Not an ISO-8601 date")
        }
        return date
    }

    private static func parse(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }
}

/// The queue plus its three headline counts. One bad row is dropped so the
/// rest of the queue still loads.
struct DamageCaseList: Decodable {
    struct Counts: Decodable {
        let open: Int
        let missing: Int
        let closed: Int
    }

    private struct Lenient: Decodable {
        let value: DamageCase?
        init(from decoder: Decoder) throws { value = try? DamageCase(from: decoder) }
    }

    let counts: Counts
    let cases: [DamageCase]

    private enum CodingKeys: String, CodingKey { case counts, cases }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        counts = try c.decodeIfPresent(Counts.self, forKey: .counts) ?? Counts(open: 0, missing: 0, closed: 0)
        cases = (try c.decodeIfPresent([Lenient].self, forKey: .cases) ?? []).compactMap(\.value)
    }
}
