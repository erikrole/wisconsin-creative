import Foundation

/// Mirrors `BlastSeverity` in prisma/schema.prisma and the badge tones in
/// src/app/(app)/blasts/_severity.ts.
enum BlastSeverity: String, Codable, Sendable {
    case info = "INFO"
    case warning = "WARNING"
    case urgent = "URGENT"
    case unknown = "UNKNOWN"

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        // A severity this build doesn't know about must still show the banner --
        // falling back to `info` is safer than failing to decode the whole blast.
        self = BlastSeverity(rawValue: value) ?? .unknown
    }

    /// Most severe first when several blasts are active at once.
    var rank: Int {
        switch self {
        case .urgent: 0
        case .warning: 1
        case .info, .unknown: 2
        }
    }
}

/// A blast the signed-in person received, as returned by `GET /api/me/blasts`.
///
/// `id` is the blast id, not the recipient row id -- the ack and read endpoints
/// are addressed by blast, and the client never needs to know the row exists.
struct ActiveBlast: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let body: String
    let severity: BlastSeverity
    let sentAt: Date?
    let senderName: String?
    let requiresAck: Bool
    let readAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, body, severity, sentAt, senderName, requiresAck, readAt
    }

    init(
        id: String,
        title: String,
        body: String,
        severity: BlastSeverity,
        sentAt: Date?,
        senderName: String?,
        requiresAck: Bool,
        readAt: Date?
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.severity = severity
        self.sentAt = sentAt
        self.senderName = senderName
        self.requiresAck = requiresAck
        self.readAt = readAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        body = try c.decode(String.self, forKey: .body)
        // Everything past the message itself is optional so a server-side field
        // addition never breaks an older build's banner.
        severity = try c.decodeIfPresent(BlastSeverity.self, forKey: .severity) ?? .info
        sentAt = try c.decodeIfPresent(Date.self, forKey: .sentAt)
        senderName = try c.decodeIfPresent(String.self, forKey: .senderName)
        requiresAck = try c.decodeIfPresent(Bool.self, forKey: .requiresAck) ?? true
        readAt = try c.decodeIfPresent(Date.self, forKey: .readAt)
    }

    static func == (lhs: ActiveBlast, rhs: ActiveBlast) -> Bool { lhs.id == rhs.id }
}

/// A blast this phone has already fetched. Acknowledged ones stay so "Got it"
/// does not throw the message away.
struct RememberedBlast: Identifiable, Equatable, Sendable {
    var blast: ActiveBlast
    var acknowledged: Bool

    var id: String { blast.id }

    static func == (lhs: RememberedBlast, rhs: RememberedBlast) -> Bool {
        lhs.acknowledged == rhs.acknowledged
            && lhs.blast.id == rhs.blast.id
            && lhs.blast.title == rhs.blast.title
            && lhs.blast.body == rhs.blast.body
            && lhs.blast.severity == rhs.blast.severity
            && lhs.blast.sentAt == rhs.blast.sentAt
            && lhs.blast.senderName == rhs.blast.senderName
            && lhs.blast.requiresAck == rhs.blast.requiresAck
            && lhs.blast.readAt == rhs.blast.readAt
    }
}

/// Pure merge for the Browse list. The server only returns blasts that still
/// need acknowledgment, so a dismissed one survives here from the last fetch.
enum BlastHistory {
    static let limit = 40

    static func merge(stored: [RememberedBlast], active: [ActiveBlast]) -> [RememberedBlast] {
        let activeIds = Set(active.map(\.id))
        var byId: [String: RememberedBlast] = [:]
        for entry in stored where !activeIds.contains(entry.id) {
            byId[entry.id] = entry
        }
        for blast in active {
            byId[blast.id] = RememberedBlast(blast: blast, acknowledged: false)
        }
        return displayOrder(Array(byId.values))
    }

    static func markAcknowledged(_ id: String, in entries: [RememberedBlast]) -> [RememberedBlast] {
        displayOrder(entries.map { entry in
            guard entry.id == id, !entry.acknowledged else { return entry }
            return RememberedBlast(blast: entry.blast, acknowledged: true)
        })
    }

    static func displayOrder(_ entries: [RememberedBlast]) -> [RememberedBlast] {
        let sorted = entries.sorted { lhs, rhs in
            if lhs.acknowledged != rhs.acknowledged { return !lhs.acknowledged && rhs.acknowledged }
            if lhs.blast.severity.rank != rhs.blast.severity.rank {
                return lhs.blast.severity.rank < rhs.blast.severity.rank
            }
            return (lhs.blast.sentAt ?? .distantPast) > (rhs.blast.sentAt ?? .distantPast)
        }
        guard sorted.count > limit else { return sorted }
        var open = sorted.filter { !$0.acknowledged }
        var dismissed = sorted.filter(\.acknowledged)
        while open.count + dismissed.count > limit && !dismissed.isEmpty {
            dismissed.removeLast()
        }
        while open.count + dismissed.count > limit && !open.isEmpty {
            open.removeLast()
        }
        return open + dismissed
    }

    static func encode(_ entries: [RememberedBlast], userId: String) throws -> Data {
        try encoder().encode(Snapshot(userId: userId, entries: entries.map(StoredBlast.init)))
    }

    static func decode(_ data: Data, userId: String) -> [RememberedBlast]? {
        guard let snapshot = try? decoder().decode(Snapshot.self, from: data),
              snapshot.userId == userId else { return nil }
        return snapshot.entries.map(\.remembered)
    }

    private struct Snapshot: Codable {
        var userId: String
        var entries: [StoredBlast]
    }

    private struct StoredBlast: Codable {
        var id: String
        var title: String
        var body: String
        var severity: BlastSeverity
        var sentAt: Date?
        var senderName: String?
        var requiresAck: Bool
        var readAt: Date?
        var acknowledged: Bool

        init(_ entry: RememberedBlast) {
            id = entry.blast.id
            title = entry.blast.title
            body = entry.blast.body
            severity = entry.blast.severity
            sentAt = entry.blast.sentAt
            senderName = entry.blast.senderName
            requiresAck = entry.blast.requiresAck
            readAt = entry.blast.readAt
            acknowledged = entry.acknowledged
        }

        var remembered: RememberedBlast {
            RememberedBlast(
                blast: ActiveBlast(
                    id: id,
                    title: title,
                    body: body,
                    severity: severity,
                    sentAt: sentAt,
                    senderName: senderName,
                    requiresAck: requiresAck,
                    readAt: readAt
                ),
                acknowledged: acknowledged
            )
        }
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
