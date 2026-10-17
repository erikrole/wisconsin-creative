import Foundation

// Read-only shapes for `GET /api/accountability`. The route returns the report
// object itself (no `data` envelope) and ignores unknown keys, so admin-only
// `excluded` rows and `capabilities` never have to be modeled here.

enum AccountabilityScope: String, CaseIterable, Identifiable {
    case thisYear
    case allTime

    var id: String { rawValue }

    var label: String {
        switch self {
        case .thisYear: "This year"
        case .allTime: "All time"
        }
    }

    /// Omitted for the server's current academic year. `"all"` is the only
    /// other value this screen sends; a client-picked year could disagree
    /// with the server's timezone.
    var yearQuery: String? {
        self == .allTime ? "all" : nil
    }
}

enum AccountabilitySort: String, CaseIterable, Identifiable {
    case events
    case time
    case recent

    var id: String { rawValue }

    var label: String {
        switch self {
        case .events: "Late returns"
        case .time: "Late time"
        case .recent: "Most recent"
        }
    }
}

enum AccountabilityQuery {
    /// Query items the route already validates. Location, incident state,
    /// user state, and `format=csv` stay off this screen.
    static func items(scope: AccountabilityScope, sort: AccountabilitySort) -> [URLQueryItem] {
        var items = [URLQueryItem(name: "sort", value: sort.rawValue)]
        if let year = scope.yearQuery {
            items.append(URLQueryItem(name: "year", value: year))
        }
        return items
    }
}

struct AccountabilityReport: Decodable, Sendable {
    let generatedAt: String
    let truncated: Bool?
    let academicYear: AccountabilityAcademicYear?
    let methodology: AccountabilityMethodology
    let metrics: AccountabilityMetrics
    let spotlightJeers: [String]?
    let leaderboard: [AccountabilityPerson]

    var notes: [String] { spotlightJeers ?? [] }

    func rank(of userId: String) -> Int? {
        guard let index = leaderboard.firstIndex(where: { $0.userId == userId }) else { return nil }
        return index + 1
    }

    func person(_ userId: String) -> AccountabilityPerson? {
        leaderboard.first { $0.userId == userId }
    }

    func matching(_ query: String) -> [AccountabilityPerson] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return leaderboard }
        return leaderboard.filter { $0.name.localizedStandardContains(needle) }
    }

    var scopeTitle: String {
        academicYear?.label ?? "All time"
    }
}

struct AccountabilityAcademicYear: Decodable, Sendable {
    let startYear: Int
    let label: String
}

struct AccountabilityMethodology: Decodable, Sendable {
    let gracePeriodHours: Int
    let minimumCheckoutsForRate: Int
    let sort: String
    let ranking: String

    var graceSentence: String {
        let unit = gracePeriodHours == 1 ? "hour" : "hours"
        return "A return is late after \(gracePeriodHours) \(unit) past due."
    }
}

struct AccountabilityMetrics: Decodable, Sendable {
    let peopleNeedingAttention: Int
    let lateEvents: Int
    let activeOverdue: Int
    let totalLateHours: Int

    var summary: String {
        "\(peoplePhrase) · \(stillOutPhrase) · \(latePhrase)"
    }

    var peoplePhrase: String {
        peopleNeedingAttention == 1 ? "1 person" : "\(peopleNeedingAttention) people"
    }

    var stillOutPhrase: String {
        activeOverdue == 1 ? "1 still out" : "\(activeOverdue) still out"
    }

    var latePhrase: String {
        lateEvents == 1 ? "1 late return" : "\(lateEvents) late returns"
    }
}

struct AccountabilityPerson: Decodable, Identifiable, Sendable {
    let userId: String
    let name: String
    let avatarUrl: String?
    let active: Bool
    let primaryArea: String?
    let checkoutCount: Int
    let completedCount: Int
    let lateEventCount: Int
    let activeOverdueCount: Int
    let totalLateHours: Int
    let medianLateHours: Int
    let worstLateHours: Int
    let onTimeRate: Int?
    let lastIncidentAt: String
    let incidents: [AccountabilityIncident]

    var id: String { userId }

    var areaLabel: String? {
        guard let primaryArea, !primaryArea.isEmpty else { return nil }
        return primaryArea.shiftAreaLabel
    }

    var onTimeLabel: String {
        guard let onTimeRate else { return "Not enough checkouts" }
        return "\(onTimeRate)% on time"
    }

    var stillOutLabel: String? {
        guard activeOverdueCount > 0 else { return nil }
        return activeOverdueCount == 1 ? "1 still out" : "\(activeOverdueCount) still out"
    }
}

struct AccountabilityIncident: Decodable, Identifiable, Sendable {
    let incidentId: String
    let bookingId: String
    let title: String
    let dueAt: String
    let returnedAt: String?
    let extendedAt: String?
    let extendedTo: String?
    let lateHours: Int
    let state: String
    let location: AccountabilityLocation
    let itemSummary: String

    var id: String { incidentId }

    var style: AccountabilityIncidentStyle {
        switch state {
        case "active":
            AccountabilityIncidentStyle(label: "Currently overdue", tone: .red)
        case "extended":
            AccountabilityIncidentStyle(label: "Extended after overdue", tone: .orange)
        case "resolved":
            AccountabilityIncidentStyle(label: "Returned", tone: .gray)
        default:
            AccountabilityIncidentStyle(label: "Late return", tone: .gray)
        }
    }

    var detailLine: String {
        var parts = ["Due \(accountabilityWhen(dueAt))"]
        if let extendedTo, !extendedTo.isEmpty {
            parts.append("moved to \(accountabilityWhen(extendedTo))")
        }
        if !location.name.isEmpty {
            parts.append(location.name)
        }
        parts.append("\(accountabilityLateDuration(lateHours)) late")
        return parts.joined(separator: " · ")
    }
}

struct AccountabilityIncidentStyle: Equatable {
    let label: String
    let tone: StatusTone
}

struct AccountabilityLocation: Decodable, Sendable {
    let id: String
    let name: String
}

func accountabilityLateDuration(_ hours: Int) -> String {
    let safe = max(hours, 0)
    if safe < 24 { return "\(safe)h" }
    let days = safe / 24
    let remainder = safe % 24
    return remainder == 0 ? "\(days)d" : "\(days)d \(remainder)h"
}

func accountabilityOrdinal(_ rank: Int) -> String {
    let teen = rank % 100
    if (11...13).contains(teen) { return "\(rank)th" }
    switch rank % 10 {
    case 1: return "\(rank)st"
    case 2: return "\(rank)nd"
    case 3: return "\(rank)rd"
    default: return "\(rank)th"
    }
}

func accountabilityWhen(_ iso: String) -> String {
    guard let date = ReportFormatting.parsedTimestamp(iso) else { return iso }
    return date.compactReservationDateTime()
}

func accountabilityRelativeIncident(_ iso: String, now: Date = .now) -> String {
    guard let date = ReportFormatting.parsedTimestamp(iso) else { return iso }
    let seconds = now.timeIntervalSince(date)
    if seconds < 60 { return "Just now" }
    let minutes = Int(seconds / 60)
    if minutes < 60 { return "\(minutes)m ago" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h ago" }
    let days = hours / 24
    if days < 14 { return "\(days)d ago" }
    return date.compactReservationDateTime(now: now)
}
