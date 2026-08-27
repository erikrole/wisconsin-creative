import Foundation

/// The server-owned season window shared by team and profile Scoreboards.
struct ScoreboardScope: Codable, Equatable {
    let key: String
    let label: String
    let startsAt: String
    let endsAt: String
    let timeZone: String
}

/// One owner for how a win-loss-tie record reads. The season summary and every
/// breakdown row spell the same record the same way because they all come
/// through here.
enum ScoreboardFormat {
    static func record(wins: Int, losses: Int, ties: Int = 0) -> String {
        ties > 0 ? "\(wins)–\(losses)–\(ties)" : "\(wins)–\(losses)"
    }

    /// The server has already rounded to one decimal. Whole numbers drop it, so
    /// a clean sweep reads "100%" instead of "100.0%".
    static func winRate(_ rate: Double?) -> String {
        guard let rate else { return "—" }
        if rate.rounded() == rate { return "\(Int(rate))%" }
        return "\(rate.formatted(.number.precision(.fractionLength(1))))%"
    }

    static func games(_ count: Int) -> String { "\(count) \(count == 1 ? "game" : "games")" }
}

struct ScoreboardSummary: Codable, Equatable {
    let eventsWorked: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        eventsWorked = try container.decode(Int.self, forKey: .eventsWorked)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        ties = try container.decodeIfPresent(Int.self, forKey: .ties) ?? 0
        games = try container.decode(Int.self, forKey: .games)
        winRate = try container.decodeIfPresent(Double.self, forKey: .winRate)
    }

    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

struct ScoreboardBucket: Codable, Equatable, Identifiable {
    let key: String?
    let label: String
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        key = try container.decodeIfPresent(String.self, forKey: .key)
        label = try container.decode(String.self, forKey: .label)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        ties = try container.decodeIfPresent(Int.self, forKey: .ties) ?? 0
        games = try container.decode(Int.self, forKey: .games)
        winRate = try container.decodeIfPresent(Double.self, forKey: .winRate)
    }

    var id: String { "\(key ?? "unknown")-\(label)" }
    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var gamesLabel: String { ScoreboardFormat.games(games) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

struct ScoreboardEvent: Codable, Equatable, Identifiable {
    let id: String
    let summary: String
    let startsAt: String
    let allDay: Bool
    let result: String?
    let sportCode: String?
    let sportLabel: String?
    let opponent: String?
    let site: String?
    let venue: String?
    let shiftAreas: [String]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        summary = try container.decodeIfPresent(String.self, forKey: .summary) ?? "Worked event"
        startsAt = try container.decode(String.self, forKey: .startsAt)
        allDay = try container.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        result = try container.decodeIfPresent(String.self, forKey: .result)
        sportCode = try container.decodeIfPresent(String.self, forKey: .sportCode)
        sportLabel = try container.decodeIfPresent(String.self, forKey: .sportLabel)
        opponent = try container.decodeIfPresent(String.self, forKey: .opponent)
        site = try container.decodeIfPresent(String.self, forKey: .site)
        venue = try container.decodeIfPresent(String.self, forKey: .venue)
        // The event list was added after the initial summary response. Missing
        // shift areas should not make an otherwise valid resolved game vanish.
        shiftAreas = try container.decodeIfPresent([String].self, forKey: .shiftAreas) ?? []
    }

    // Parsing the timestamp used to build two `ISO8601DateFormatter`s on every
    // access, and a row asks for its date every time it redraws. These are the
    // same two parsers as value types, so they are made once and stay sendable.
    private static let fractionalSeconds = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let wholeSeconds = Date.ISO8601FormatStyle()

    var startsDate: Date? {
        (try? Self.fractionalSeconds.parse(startsAt)) ?? (try? Self.wholeSeconds.parse(startsAt))
    }

    var isWin: Bool { result == "WIN" }
    var isTie: Bool { result == "TIE" }

    var resultLabel: String {
        switch result {
        case .some("WIN"): "W"
        case .some("LOSS"): "L"
        case .some("TIE"): "T"
        case .some(let result): result
        case .none: "—"
        }
    }

    /// Spoken form for VoiceOver, where "W" is read as a letter.
    var resultName: String {
        switch result {
        case .some("WIN"): "Win"
        case .some("LOSS"): "Loss"
        case .some("TIE"): "Tie"
        case .some(let result): result
        case .none: "Worked event"
        }
    }

    var siteLabel: String {
        switch site {
        case "HOME": "Home"
        case "AWAY": "Away"
        case "NEUTRAL": "Neutral"
        default: "Site unknown"
        }
    }

    /// The route trims opponent and venue to null, but the app is the surface
    /// that would print "Football vs" with nothing after it, so blank-but-
    /// present text is treated the same way here as a missing value.
    var matchupLabel: String {
        if result == nil { return summary.nonBlankText ?? "Worked event" }
        let sport = sportLabel.nonBlankText ?? "Worked event"
        guard let opponent = opponent.nonBlankText else { return sport }
        return "\(sport) \(site == "AWAY" ? "at" : "vs") \(opponent)"
    }

    var venueLabel: String { venue.nonBlankText ?? "Venue not recorded" }

    /// `"Nov 28"`. The month heading above the row carries the year, and a
    /// finished game's start time is not what anyone reads a record for.
    var dayLabel: String {
        guard let startsDate else { return "—" }
        return startsDate.formatted(.dateTime.month(.abbreviated).day())
    }

    /// Sort/group key for the month heading. Undated rows keep their own group
    /// rather than being folded into whatever month is adjacent.
    var monthKey: String {
        guard let startsDate else { return "undated" }
        let parts = Calendar.current.dateComponents([.year, .month], from: startsDate)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }

    var monthLabel: String {
        guard let startsDate else { return "Undated" }
        return startsDate.formatted(.dateTime.month(.wide).year())
    }

    /// The site glyph for the metadata line, so where a game was played can be
    /// read without parsing the sentence.
    var siteSymbol: String {
        switch site {
        case "HOME": "house.fill"
        case "AWAY": "car.fill"
        case "NEUTRAL": "flag.fill"
        default: "mappin.and.ellipse"
        }
    }

    /// Server-typed area codes, named the way every other screen names them
    /// rather than title-cased here a second time.
    var areasLabel: String? {
        let labels = shiftAreas.map(\.shiftAreaLabel)
        return labels.isEmpty ? nil : labels.joined(separator: ", ")
    }
}

struct UserScoreboard: Codable, Equatable {
    let scope: ScoreboardScope
    let summary: ScoreboardSummary
    let bySport: [ScoreboardBucket]
    let byOpponent: [ScoreboardBucket]
    let bySite: [ScoreboardBucket]
    let byVenue: [ScoreboardBucket]
    let events: [ScoreboardEvent]
    let eventCount: Int
    let nextCursor: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Scope and summary are the minimum trustworthy contract. If either is
        // absent, fail the read instead of presenting a false season or record.
        scope = try container.decode(ScoreboardScope.self, forKey: .scope)
        summary = try container.decode(ScoreboardSummary.self, forKey: .summary)
        bySport = try container.decodeIfPresent([ScoreboardBucket].self, forKey: .bySport) ?? []
        byOpponent = try container.decodeIfPresent([ScoreboardBucket].self, forKey: .byOpponent) ?? []
        bySite = try container.decodeIfPresent([ScoreboardBucket].self, forKey: .bySite) ?? []
        byVenue = try container.decodeIfPresent([ScoreboardBucket].self, forKey: .byVenue) ?? []
        events = try container.decodeIfPresent([ScoreboardEvent].self, forKey: .events) ?? []
        eventCount = try container.decodeIfPresent(Int.self, forKey: .eventCount) ?? events.count
        nextCursor = (try? container.decode(String.self, forKey: .nextCursor))
            ?? (try? container.decode(Int.self, forKey: .nextCursor)).map(String.init)
    }

    /// The route's cursor is the offset of the next page. A cursor that is not
    /// an offset ends the list, rather than being read as zero and quietly
    /// serving page one again under a "Show more" button.
    var nextOffset: Int? { nextCursor.flatMap(Int.init) }
}

/// Copy explaining how the shared team totals relate. Keeping this in the
/// payload means web and iOS describe the same counting rules as the service
/// that owns them.
struct TeamScoreboardMethodology: Codable, Equatable {
    let eventsCovered: String
    let eventCredits: String
    let record: String
    let gameCredits: String
    let minimumGamesForWinRate: Int

    static let fallback = TeamScoreboardMethodology(
        eventsCovered: "Unique completed events worked by the team.",
        eventCredits: "One work credit per person per event.",
        record: "Unique eligible games with a recorded result.",
        gameCredits: "One record credit per person per resolved game.",
        minimumGamesForWinRate: 3
    )
}

/// Aggregate totals intentionally keep unique team events separate from
/// person-event credits. Adding the latter together is useful workload data,
/// but it is not the number of events the team covered.
struct TeamScoreboardSummary: Codable, Equatable {
    let contributors: Int
    let eventsCovered: Int
    let eventCredits: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?
    let gameCredits: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        contributors = try container.decode(Int.self, forKey: .contributors)
        eventsCovered = try container.decode(Int.self, forKey: .eventsCovered)
        eventCredits = try container.decode(Int.self, forKey: .eventCredits)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        ties = try container.decodeIfPresent(Int.self, forKey: .ties) ?? 0
        games = try container.decode(Int.self, forKey: .games)
        winRate = try container.decodeIfPresent(Double.self, forKey: .winRate)
        gameCredits = try container.decode(Int.self, forKey: .gameCredits)
    }

    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

struct TeamScoreboardPersonSummary: Codable, Equatable {
    let eventsWorked: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        eventsWorked = try container.decode(Int.self, forKey: .eventsWorked)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        ties = try container.decodeIfPresent(Int.self, forKey: .ties) ?? 0
        games = try container.decode(Int.self, forKey: .games)
        winRate = try container.decodeIfPresent(Double.self, forKey: .winRate)
    }

    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

struct TeamScoreboardPersonSport: Codable, Equatable, Identifiable {
    let key: String?
    let label: String
    let eventsWorked: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        key = try container.decodeIfPresent(String.self, forKey: .key)
        label = try container.decode(String.self, forKey: .label)
        eventsWorked = try container.decode(Int.self, forKey: .eventsWorked)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        ties = try container.decodeIfPresent(Int.self, forKey: .ties) ?? 0
        games = try container.decode(Int.self, forKey: .games)
        winRate = try container.decodeIfPresent(Double.self, forKey: .winRate)
    }

    var id: String { key ?? "__unknown__" }
    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

/// Only the work-safe identity required to render a leaderboard row. This is
/// deliberately not an `AppUser` or profile model: the shared Scoreboard must
/// never become a side door into contact, schedule, or activity data.
struct TeamScoreboardPerson: Codable, Equatable, Identifiable {
    let userId: String
    let name: String
    let avatarUrl: String?
    let summary: TeamScoreboardPersonSummary
    let bySport: [TeamScoreboardPersonSport]

    var id: String { userId }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userId = try container.decode(String.self, forKey: .userId)
        name = try container.decode(String.self, forKey: .name)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        summary = try container.decode(TeamScoreboardPersonSummary.self, forKey: .summary)
        bySport = try container.decodeIfPresent([TeamScoreboardPersonSport].self, forKey: .bySport) ?? []
    }
}

struct TeamScoreboardBreakdown: Codable, Equatable, Identifiable {
    let key: String?
    let label: String
    let contributors: Int
    let eventsCovered: Int
    let eventCredits: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?
    let gameCredits: Int

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        key = try container.decodeIfPresent(String.self, forKey: .key)
        label = try container.decode(String.self, forKey: .label)
        contributors = try container.decode(Int.self, forKey: .contributors)
        eventsCovered = try container.decode(Int.self, forKey: .eventsCovered)
        eventCredits = try container.decode(Int.self, forKey: .eventCredits)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        ties = try container.decodeIfPresent(Int.self, forKey: .ties) ?? 0
        games = try container.decode(Int.self, forKey: .games)
        winRate = try container.decodeIfPresent(Double.self, forKey: .winRate)
        gameCredits = try container.decode(Int.self, forKey: .gameCredits)
    }

    var id: String { key ?? "__unknown__" }
    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

typealias TeamScoreboardSport = TeamScoreboardBreakdown

struct TeamScoreboardFacet: Codable, Equatable, Identifiable {
    let key: String
    let label: String

    var id: String { key }
}

struct TeamScoreboardAppliedFilters: Codable, Equatable {
    let sportCode: String?
    let venue: String?
    let opponent: String?
    let site: String?

    static let empty = TeamScoreboardAppliedFilters(
        sportCode: nil,
        venue: nil,
        opponent: nil,
        site: nil
    )
}

struct TeamScoreboardFacets: Codable, Equatable {
    let sports: [TeamScoreboardFacet]
    let venues: [TeamScoreboardFacet]
    let opponents: [TeamScoreboardFacet]
    let sites: [TeamScoreboardFacet]

    static let empty = TeamScoreboardFacets(
        sports: [],
        venues: [],
        opponents: [],
        sites: []
    )

    init(
        sports: [TeamScoreboardFacet],
        venues: [TeamScoreboardFacet],
        opponents: [TeamScoreboardFacet],
        sites: [TeamScoreboardFacet]
    ) {
        self.sports = sports
        self.venues = venues
        self.opponents = opponents
        self.sites = sites
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sports = try container.decodeIfPresent([TeamScoreboardFacet].self, forKey: .sports) ?? []
        venues = try container.decodeIfPresent([TeamScoreboardFacet].self, forKey: .venues) ?? []
        opponents = try container.decodeIfPresent([TeamScoreboardFacet].self, forKey: .opponents) ?? []
        sites = try container.decodeIfPresent([TeamScoreboardFacet].self, forKey: .sites) ?? []
    }
}

struct TeamScoreboard: Codable, Equatable {
    let generatedAt: String?
    let scope: ScoreboardScope
    let methodology: TeamScoreboardMethodology
    let filters: TeamScoreboardAppliedFilters
    let facets: TeamScoreboardFacets
    let summary: TeamScoreboardSummary
    let bySport: [TeamScoreboardSport]
    let byVenue: [TeamScoreboardBreakdown]
    let byOpponent: [TeamScoreboardBreakdown]
    let bySite: [TeamScoreboardBreakdown]
    let leaderboard: [TeamScoreboardPerson]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        // Scope and summary are the trustworthy minimum. Missing optional
        // supporting collections should produce an empty state, not a decode
        // failure during a rolling server/client release.
        scope = try container.decode(ScoreboardScope.self, forKey: .scope)
        summary = try container.decode(TeamScoreboardSummary.self, forKey: .summary)
        methodology = try container.decodeIfPresent(TeamScoreboardMethodology.self, forKey: .methodology) ?? .fallback
        filters = try container.decodeIfPresent(TeamScoreboardAppliedFilters.self, forKey: .filters) ?? .empty
        facets = try container.decodeIfPresent(TeamScoreboardFacets.self, forKey: .facets) ?? .empty
        bySport = try container.decodeIfPresent([TeamScoreboardSport].self, forKey: .bySport) ?? []
        byVenue = try container.decodeIfPresent([TeamScoreboardBreakdown].self, forKey: .byVenue) ?? []
        byOpponent = try container.decodeIfPresent([TeamScoreboardBreakdown].self, forKey: .byOpponent) ?? []
        bySite = try container.decodeIfPresent([TeamScoreboardBreakdown].self, forKey: .bySite) ?? []
        leaderboard = try container.decodeIfPresent([TeamScoreboardPerson].self, forKey: .leaderboard) ?? []
    }
}

/// One month of resolved games, in the order the route returned them.
struct ScoreboardMonth: Identifiable, Equatable {
    let id: String
    let label: String
    let games: [ScoreboardEvent]
}

/// A run of the same result at the top of the game list.
struct ScoreboardStreak: Equatable {
    let count: Int
    let result: String
    let isWin: Bool

    var label: String {
        let noun = result == "WIN" ? "wins" : result == "LOSS" ? "losses" : "ties"
        return "\(count) straight \(noun)"
    }
    var tone: StatusTone {
        if result == "WIN" { return .green }
        if result == "LOSS" { return .red }
        return .orange
    }
}

/// One orienting fact about a season, in the shape the highlight row draws.
struct ScoreboardHighlight: Identifiable, Equatable {
    let id: String
    let label: String
    let value: String
    let detail: String
}

/// Season shape the route does not send: recency, streaks, and month grouping
/// are all derivable from the game list it already returns, and they are what
/// makes a record read like a season rather than a total.
enum ScoreboardDigest {
    /// Games grouped under their month heading, preserving the route's
    /// newest-first order both between groups and inside them.
    static func months(_ games: [ScoreboardEvent]) -> [ScoreboardMonth] {
        var order: [String] = []
        var grouped: [String: [ScoreboardEvent]] = [:]
        var labels: [String: String] = [:]
        for game in games {
            let key = game.monthKey
            if grouped[key] == nil {
                order.append(key)
                labels[key] = game.monthLabel
            }
            grouped[key, default: []].append(game)
        }
        return order.map { key in
            ScoreboardMonth(id: key, label: labels[key] ?? key, games: grouped[key] ?? [])
        }
    }

    /// The most recent results, newest first.
    static func form(_ games: [ScoreboardEvent], limit: Int = 5) -> [ScoreboardEvent] {
        Array(games.filter { $0.result != nil }.prefix(limit))
    }

    /// The current run, or nil when the last two games disagree. A run of one
    /// is not a streak and does not get announced as one.
    static func streak(_ games: [ScoreboardEvent]) -> ScoreboardStreak? {
        let resolved = games.filter { $0.result != nil }
        guard let first = resolved.first, let result = first.result else { return nil }
        let run = resolved.prefix { $0.result == result }.count
        return run >= 2
            ? ScoreboardStreak(count: run, result: result, isWin: first.isWin)
            : nil
    }
}

extension UserScoreboard {
    /// Three facts worth reading before the tables: what this person works
    /// most, where they win most, and who they see most. Empty when the season
    /// has no resolved games to draw them from.
    var highlights: [ScoreboardHighlight] {
        guard summary.games > 0 else { return [] }
        var found: [ScoreboardHighlight] = []

        if let sport = bySport.first {
            found.append(ScoreboardHighlight(
                id: "sport",
                label: "Most worked",
                value: sport.label,
                detail: sport.gamesLabel
            ))
        }
        // Rank sustained success by win margin, then rate and volume. A
        // perfect one-game sample should not outrank a venue where the person
        // is 6–1.
        let bestVenue = byVenue
            .filter { $0.key != nil }
            .max { left, right in
                let leftRank = (left.wins - left.losses, left.winRate ?? -1, left.games)
                let rightRank = (right.wins - right.losses, right.winRate ?? -1, right.games)
                return leftRank < rightRank
            }
        if let bestVenue {
            found.append(ScoreboardHighlight(
                id: "venue",
                label: "Best venue",
                value: bestVenue.label,
                detail: "\(bestVenue.recordLabel) · \(bestVenue.winRateLabel)"
            ))
        }
        if let opponent = byOpponent.first(where: { $0.key != nil }) {
            found.append(ScoreboardHighlight(
                id: "opponent",
                label: "Top matchup",
                value: opponent.label,
                detail: "\(opponent.recordLabel) · \(opponent.gamesLabel)"
            ))
        }
        return found
    }
}
