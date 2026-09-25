import Foundation
import Security

/// The raw shift-calendar feed token, kept on this device in the Keychain.
///
/// The server stores only a hash of the token, so it can say that a feed
/// exists but cannot hand the link back. The app keeps the raw token it
/// received when the feed was created (or upgraded) so it can reopen Apple
/// Calendar without rotating the link. Keyed by user, and removed at sign-out.
enum ShiftCalendarTokenStore {
    private static let service = "com.erikrole.Wisconsin.shift-calendar-feed"

    private static func baseQuery(userId: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: userId,
        ]
    }

    static func token(for userId: String) -> String? {
        var query = baseQuery(userId: userId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String, for userId: String) {
        let data = Data(token.utf8)
        let query = baseQuery(userId: userId)
        let update: [String: Any] = [kSecValueData as String: data]
        if SecItemUpdate(query as CFDictionary, update as CFDictionary) == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(add as CFDictionary, nil)
        }
    }

    static func remove(for userId: String) {
        SecItemDelete(baseQuery(userId: userId) as CFDictionary)
    }

    /// Every stored token, for the sign-out boundary.
    static func removeAll() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
