import Foundation
import Security

protocol CompanionCredentialStoring: Sendable {
    func loadToken() async throws -> String?
    func saveToken(_ token: String) async throws
    func loadUser() async throws -> GearOpsUser?
    func saveUser(_ user: GearOpsUser) async throws
    func deleteToken() async throws
    func deleteToken(ifMatching token: String) async throws
    func stageTokenForRevocation(_ token: String) async throws
    func loadPendingRevocations() async throws -> [String]
    func removePendingRevocation(_ token: String) async throws
}

actor CompanionCredentialStore: CompanionCredentialStoring {
    private let service = "com.erikrole.GearOps.companion"
    private let tokenAccount = "projection-token"
    private let userAccount = "projection-user"
    private let pendingRevocationsAccount = "pending-revocations"
    private let maxPendingRevocations = 16

    func loadToken() throws -> String? {
        if let data = try loadData(account: tokenAccount, dataProtection: true) {
            let token = try decodeToken(data)
            // A previous build may have left the same credential in the
            // legacy macOS keychain, where accessibility classes do not apply.
            // Cleanup is deliberately best-effort: a readable hardened token
            // must never be discarded because an old item is unavailable.
            try? deleteItem(account: tokenAccount, dataProtection: false)
            return token
        }

        guard let legacyData = try loadData(account: tokenAccount, dataProtection: false) else {
            return nil
        }
        let token = try decodeToken(legacyData)
        // Keep a valid legacy credential usable even if migration is delayed
        // by a transient Keychain or entitlement problem. The next restore
        // retries the hardened copy and cleanup.
        try? saveHardenedData(legacyData, account: tokenAccount)
        try? deleteItem(account: tokenAccount, dataProtection: false)
        return token
    }

    func saveToken(_ token: String) throws {
        try saveHardenedData(Data(token.utf8), account: tokenAccount)
        try deleteItem(account: tokenAccount, dataProtection: false)
    }

    func loadUser() throws -> GearOpsUser? {
        guard let data = try loadData(account: userAccount, dataProtection: true) else {
            return nil
        }
        guard let user = try? JSONDecoder().decode(GearOpsUser.self, from: data),
              !user.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !user.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CredentialStoreError.invalidData
        }
        return user
    }

    func saveUser(_ user: GearOpsUser) throws {
        guard !user.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !user.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CredentialStoreError.invalidData
        }
        try saveHardenedData(try JSONEncoder().encode(user), account: userAccount)
    }

    func deleteToken() throws {
        try deleteItem(account: tokenAccount, dataProtection: true)
        try deleteItem(account: tokenAccount, dataProtection: false)
        try deleteItem(account: userAccount, dataProtection: true)
    }

    func deleteToken(ifMatching token: String) throws {
        guard try loadToken() == token else { return }
        try deleteToken()
    }

    func stageTokenForRevocation(_ token: String) throws {
        guard !token.isEmpty else { return }
        var pending = try loadPendingRevocations()
        pending.removeAll { $0 == token }
        pending.append(token)
        try savePendingRevocations(Array(pending.suffix(maxPendingRevocations)))
    }

    func loadPendingRevocations() throws -> [String] {
        guard let data = try loadData(
            account: pendingRevocationsAccount,
            dataProtection: true
        ) else {
            return []
        }
        guard let decoded = try? JSONDecoder().decode([String].self, from: data) else {
            throw CredentialStoreError.invalidData
        }

        var normalized: [String] = []
        for token in decoded where !token.isEmpty {
            normalized.removeAll { $0 == token }
            normalized.append(token)
        }
        return Array(normalized.suffix(maxPendingRevocations))
    }

    func removePendingRevocation(_ token: String) throws {
        var pending = try loadPendingRevocations()
        guard pending.contains(token) else { return }
        pending.removeAll { $0 == token }
        try savePendingRevocations(pending)
    }

    private func savePendingRevocations(_ tokens: [String]) throws {
        guard !tokens.isEmpty else {
            try deleteItem(account: pendingRevocationsAccount, dataProtection: true)
            return
        }
        try saveHardenedData(
            try JSONEncoder().encode(tokens),
            account: pendingRevocationsAccount
        )
    }

    private func query(account: String, dataProtection: Bool) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if dataProtection {
            query[kSecUseDataProtectionKeychain as String] = true
        }
        return query
    }

    private func loadData(account: String, dataProtection: Bool) throws -> Data? {
        var lookup = query(account: account, dataProtection: dataProtection)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CredentialStoreError.keychain(status) }
        guard let data = result as? Data else { throw CredentialStoreError.invalidData }
        return data
    }

    private func saveHardenedData(_ data: Data, account: String) throws {
        let lookup = query(account: account, dataProtection: true)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // Launch-at-login and background refresh need access after the
            // first unlock, but credentials must never migrate to another Mac.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = lookup
            insert.merge(attributes) { _, new in new }
            let inserted = SecItemAdd(insert as CFDictionary, nil)
            guard inserted == errSecSuccess else { throw CredentialStoreError.keychain(inserted) }
        } else if status != errSecSuccess {
            throw CredentialStoreError.keychain(status)
        }
    }

    private func deleteItem(account: String, dataProtection: Bool) throws {
        let lookup = query(account: account, dataProtection: dataProtection)
        let status = SecItemDelete(lookup as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CredentialStoreError.keychain(status)
        }
    }

    private func decodeToken(_ data: Data) throws -> String {
        guard let token = String(data: data, encoding: .utf8), !token.isEmpty else {
            throw CredentialStoreError.invalidData
        }
        return token
    }
}

private enum CredentialStoreError: LocalizedError {
    case keychain(OSStatus)
    case invalidData

    var errorDescription: String? {
        switch self {
        case .keychain(let status):
            "The companion credential could not be accessed (Keychain status \(status))."
        case .invalidData:
            "Saved companion security data could not be read."
        }
    }
}
