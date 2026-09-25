import Foundation

/// The last Schedule window on disk, so the tab opens on real rows instead of a
/// skeleton while the fresh load runs behind it.
///
/// Keyed to the signed-in user and deleted at the session boundary with the
/// other per-user caches. It is a display cache only: nothing acts on it, and
/// the network load replaces it as soon as it lands.
enum ScheduleWindowCache {
    struct Snapshot: Codable {
        let userId: String
        let savedAt: Date
        let events: [ScheduleEvent]
        let shifts: [MyShift]
    }

    /// Older snapshots are dropped rather than shown; a week-old schedule is
    /// more likely to mislead than help.
    static let maxAge: TimeInterval = 7 * 24 * 60 * 60

    private static var fileURL: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("schedule-window.json")
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

    static func encode(_ snapshot: Snapshot) throws -> Data {
        try encoder().encode(snapshot)
    }

    /// The snapshot in `data`, if it belongs to this user and is fresh enough.
    static func usableSnapshot(from data: Data, userId: String, now: Date = .now) -> Snapshot? {
        guard let snapshot = try? decoder().decode(Snapshot.self, from: data),
              snapshot.userId == userId,
              now.timeIntervalSince(snapshot.savedAt) < maxAge else { return nil }
        return snapshot
    }

    static func load(userId: String, now: Date = .now) -> Snapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return usableSnapshot(from: data, userId: userId, now: now)
    }

    /// Writes and the sign-out delete run in order on one serial queue, so an
    /// older snapshot cannot land after a newer one, and a write queued just
    /// before sign-out cannot recreate the file after it was deleted.
    private static let queue = DispatchQueue(label: "schedule-window-cache", qos: .utility)

    static func save(_ snapshot: Snapshot) {
        guard let url = fileURL else { return }
        queue.async {
            guard let data = try? encode(snapshot) else { return }
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    static func clear() {
        guard let url = fileURL else { return }
        // Synchronous, so the file is gone before the next account's session
        // starts; any write already queued runs first and is removed here.
        queue.sync {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
