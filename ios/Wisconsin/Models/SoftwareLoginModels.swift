import Foundation

/// One department login from `GET /api/software`. The list never includes the
/// password. A password arrives only from the separate reveal request.
struct SoftwareLogin: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let category: String?
    let websiteUrl: String?
    let accountEmail: String
    let hasPassword: Bool
    let visibleTo: [String]
    let archivedAt: String?
    let updatedAt: String

    init(
        id: String,
        name: String,
        category: String?,
        websiteUrl: String?,
        accountEmail: String,
        hasPassword: Bool = true,
        visibleTo: [String],
        archivedAt: String? = nil,
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.category = category
        self.websiteUrl = websiteUrl
        self.accountEmail = accountEmail
        self.hasPassword = hasPassword
        self.visibleTo = visibleTo
        self.archivedAt = archivedAt
        self.updatedAt = updatedAt
    }

    /// Archived rows stay on the website. A missing or blank timestamp is active.
    var isActive: Bool {
        guard let archivedAt else { return true }
        return archivedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var categoryLabel: String {
        let trimmed = category?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Department account" : trimmed
    }

    var audiencePhrase: String {
        SoftwareLoginFormatting.audiencePhrase(visibleTo)
    }

    var safeWebsiteURL: URL? {
        SoftwareLoginFormatting.websiteURL(websiteUrl)
    }

    func matches(query: String) -> Bool {
        SoftwareLoginFormatting.matches(self, query: query)
    }
}

enum SoftwareLoginFormatting {
    /// Same audience sentence as the website cards, in the order the server sent.
    static func audiencePhrase(_ visibleTo: [String]) -> String {
        let labels = visibleTo.map(audienceLabel)
        switch labels.count {
        case 0:
            return "no audience"
        case 1:
            return labels[0]
        case 2:
            return "\(labels[0]) and \(labels[1])"
        default:
            let head = labels.dropLast().joined(separator: ", ")
            return "\(head), and \(labels[labels.count - 1])"
        }
    }

    static func audienceLabel(_ code: String) -> String {
        switch code {
        case "STAFF": "Staff"
        case "STUDENT": "Students"
        case "COLLABORATOR": "Collaborators"
        default: code
        }
    }

    /// Only http and https links open. Anything else stays off the row.
    static func websiteURL(_ raw: String?) -> URL? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              let host = url.host,
              !host.isEmpty
        else { return nil }
        return url
    }

    static func matches(_ login: SoftwareLogin, query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return true }
        let host = login.safeWebsiteURL?.host ?? ""
        let haystack = [
            login.name,
            login.categoryLabel,
            login.accountEmail,
            login.audiencePhrase,
            host,
        ].joined(separator: " ").lowercased()
        return haystack.contains(needle)
    }
}
