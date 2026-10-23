import Foundation

/// Inbox proof stays in memory. It is never an API-host override, saved draft,
/// route description, analytics field, or account-switch instruction.
struct AuthInviteLink: Equatable, Identifiable {
    let id = UUID()
    let email: String
    let token: String

    static func parse(_ url: URL) -> AuthInviteLink? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https",
              parts.host?.lowercased() == AppEnvironment.canonicalHost,
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.fragment == nil, parts.path == "/login" else { return nil }
        let query = parts.queryItems ?? []
        guard !query.contains(where: { $0.name == "web" && $0.value == "1" }) else { return nil }
        let emails = query.filter { $0.name == "email" }
        let tokens = query.filter { $0.name == "invite" }
        guard emails.count == 1, tokens.count == 1,
              let email = emails[0].value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              email.count <= 254,
              email.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil,
              let token = tokens[0].value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !token.isEmpty, token.count <= 128 else { return nil }
        return AuthInviteLink(email: email, token: token)
    }
}
