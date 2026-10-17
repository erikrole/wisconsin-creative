import Foundation

/// One badge from `GET /api/badges?manualOnly=true`, the catalog the website
/// shows on `/badges`.
struct TeamBadgeDefinition: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let key: String
    let name: String
    let description: String
    let icon: String
    let category: String
    let kind: String
    let trigger: String
    let threshold: Int?
    let ruleKey: String?
    let active: Bool
    let sortOrder: Int

    /// Same title case the website uses for a category chip.
    var categoryLabel: String {
        category
            .lowercased()
            .split(separator: "_")
            .filter { !$0.isEmpty }
            .map { part in
                part.prefix(1).uppercased() + part.dropFirst()
            }
            .joined(separator: " ")
    }

    func matches(_ query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return true }
        return name.lowercased().contains(needle)
            || description.lowercased().contains(needle)
            || categoryLabel.lowercased().contains(needle)
    }
}

struct TeamBadgeCatalog: Decodable, Sendable {
    let data: [TeamBadgeDefinition]
    let disabled: Bool?
}
