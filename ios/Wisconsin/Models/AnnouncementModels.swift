import Foundation

/// One block of announcement body text. The server only emits these two today;
/// anything newer decodes to nothing and is skipped rather than failing the splash.
enum AnnouncementBlock: Equatable, Sendable {
    case paragraph(String)
    case list([String])
}

/// The one announcement `GET /api/announcements/active?platform=ios` hands back.
/// Mirrors `ActiveAnnouncement` in `src/lib/announcements.ts`.
struct ActiveAnnouncement: Identifiable, Equatable, Sendable {
    let id: String
    /// FEATURE, UPDATE, or NOTICE. Kept as a string so a future kind still decodes.
    let kind: String
    let kindLabel: String
    let title: String
    let blocks: [AnnouncementBlock]
    let ctaLabel: String?
    let ctaUrl: String?
    let imageUrls: [String]
    let imageAlt: String?
    let publishedAt: String
    /// How many more unseen announcements wait behind this one.
    let remaining: Int

    var hasCta: Bool {
        guard let label = ctaLabel, let url = ctaUrl else { return false }
        return !label.isEmpty && !url.isEmpty
    }

    /// SF Symbol for the kind tile, matching the web card's icon per kind.
    var kindSymbol: String {
        switch kind {
        case "FEATURE": return "sparkles"
        case "UPDATE": return "arrow.clockwise"
        default: return "megaphone"
        }
    }

    var publishedDate: Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: publishedAt) { return date }
        return ISO8601DateFormatter().date(from: publishedAt)
    }
}

extension ActiveAnnouncement: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, kind, kindLabel, title, blocks, ctaLabel, ctaUrl
        case imageUrls, imageAlt, publishedAt, remaining
    }

    private struct LossyBlock: Decodable {
        let block: AnnouncementBlock?

        private enum Keys: String, CodingKey { case type, text, items }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: Keys.self)
            switch try container.decodeIfPresent(String.self, forKey: .type) {
            case "paragraph":
                block = (try container.decodeIfPresent(String.self, forKey: .text)).map(AnnouncementBlock.paragraph)
            case "list":
                block = (try container.decodeIfPresent([String].self, forKey: .items)).map(AnnouncementBlock.list)
            default:
                block = nil
            }
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(String.self, forKey: .kind)
        kindLabel = try container.decodeIfPresent(String.self, forKey: .kindLabel) ?? ""
        title = try container.decode(String.self, forKey: .title)
        blocks = (try container.decodeIfPresent([LossyBlock].self, forKey: .blocks) ?? []).compactMap(\.block)
        ctaLabel = try container.decodeIfPresent(String.self, forKey: .ctaLabel)
        ctaUrl = try container.decodeIfPresent(String.self, forKey: .ctaUrl)
        imageUrls = try container.decodeIfPresent([String].self, forKey: .imageUrls) ?? []
        imageAlt = try container.decodeIfPresent(String.self, forKey: .imageAlt)
        publishedAt = try container.decode(String.self, forKey: .publishedAt)
        remaining = try container.decodeIfPresent(Int.self, forKey: .remaining) ?? 0
    }
}

/// One row of `GET /api/announcements/history?platform=ios`: the same payload
/// the splash shows, plus whether this person already dismissed it. Decoded
/// from the one container so the splash decoder stays the single parser.
struct AnnouncementHistoryEntry: Identifiable, Equatable, Sendable, Decodable {
    let announcement: ActiveAnnouncement
    let endsAt: String?
    let seenAt: String?

    var id: String { announcement.id }
    var isUnseen: Bool { seenAt == nil }

    private enum CodingKeys: String, CodingKey { case endsAt, seenAt }

    init(from decoder: Decoder) throws {
        announcement = try ActiveAnnouncement(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        endsAt = try container.decodeIfPresent(String.self, forKey: .endsAt)
        seenAt = try container.decodeIfPresent(String.self, forKey: .seenAt)
    }
}
