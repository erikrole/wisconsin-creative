import Foundation

/// Announcements this phone has dismissed for the signed-in person.
///
/// The server is the source of truth (`POST /api/announcements/{id}/dismiss`).
/// This only keeps a dismissal from being lost when that request fails in the
/// moment (airplane mode, a timeout), so the same splash does not rise again
/// on the next foreground. Ids the server has not accepted yet stay in
/// `pending` and are retried on the next load. Cleared at sign-out with the
/// other per-account caches.
@MainActor
enum AnnouncementDismissalMemory {
    private static let key = "WisconsinAnnouncementDismissals"
    /// Enough to cover every announcement a person could plausibly dismiss
    /// before the server catches up, without growing UserDefaults forever.
    private static let maxRemembered = 50

    private struct Stored: Codable {
        var scope: String
        var dismissed: [String]
        var pending: [String]
    }

    static func isDismissed(_ id: String, scope: String) -> Bool {
        load(scope: scope).dismissed.contains(id)
    }

    static func pending(scope: String) -> [String] {
        load(scope: scope).pending
    }

    /// Records a dismissal the person made, before the server has heard of it.
    static func recordDismissed(_ id: String, scope: String) {
        var stored = load(scope: scope)
        stored.dismissed.removeAll { $0 == id }
        stored.dismissed.append(id)
        if stored.dismissed.count > maxRemembered {
            stored.dismissed.removeFirst(stored.dismissed.count - maxRemembered)
        }
        save(stored)
    }

    /// The dismiss request failed; try again on the next load.
    static func markPending(_ id: String, scope: String) {
        var stored = load(scope: scope)
        guard !stored.pending.contains(id) else { return }
        stored.pending.append(id)
        save(stored)
    }

    /// The server accepted the dismissal, or the announcement no longer exists.
    static func clearPending(_ id: String, scope: String) {
        var stored = load(scope: scope)
        guard stored.pending.contains(id) else { return }
        stored.pending.removeAll { $0 == id }
        save(stored)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    private static func load(scope: String) -> Stored {
        guard let data = UserDefaults.standard.data(forKey: key),
              let stored = try? JSONDecoder().decode(Stored.self, from: data),
              stored.scope == scope else {
            return Stored(scope: scope, dismissed: [], pending: [])
        }
        return stored
    }

    private static func save(_ stored: Stored) {
        guard let data = try? JSONEncoder().encode(stored) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
