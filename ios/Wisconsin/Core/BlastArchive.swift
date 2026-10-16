import Foundation

/// Blasts this phone has already fetched, so dismissing one does not erase it.
///
/// `GET /api/me/blasts` only returns blasts that still need acknowledgment.
/// The archive keeps the last copy for the signed-in person and drops it at
/// sign-out. A blast this phone never fetched is not here.
@MainActor
enum BlastArchive {
    private static let key = "WisconsinBlastArchive"

    static func load(userId: String) -> [RememberedBlast] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return BlastHistory.decode(data, userId: userId) ?? []
    }

    static func recordActive(_ active: [ActiveBlast], userId: String) {
        let merged = BlastHistory.merge(stored: load(userId: userId), active: active)
        save(merged, userId: userId)
    }

    /// Marks a blast the server has accepted, or that no longer exists.
    /// No-op when this phone never stored the message.
    static func markAcknowledged(_ id: String) {
        guard let data = UserDefaults.standard.data(forKey: key),
              let owner = storedUserId(in: data) else { return }
        save(BlastHistory.markAcknowledged(id, in: load(userId: owner)), userId: owner)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func save(_ entries: [RememberedBlast], userId: String) {
        guard let data = try? BlastHistory.encode(entries, userId: userId) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private static func storedUserId(in data: Data) -> String? {
        struct Probe: Decodable { var userId: String }
        return try? JSONDecoder().decode(Probe.self, from: data).userId
    }
}
