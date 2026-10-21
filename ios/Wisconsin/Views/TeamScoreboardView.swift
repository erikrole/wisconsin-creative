import SwiftUI

private enum TeamScoreboardRank: String, CaseIterable, Identifiable {
    case events
    case wins
    case rate

    var id: String { rawValue }

    var title: String {
        switch self {
        case .events: "Events"
        case .wins: "Wins"
        case .rate: "Win rate"
        }
    }
}

enum TeamScoreboardFilterDimension: Hashable {
    case sport
    case venue
    case opponent
    case site
}

struct TeamScoreboardFilterSelection: Equatable {
    var sportCode: String?
    var venue: String?
    var opponent: String?
    var site: String?

    var isEmpty: Bool {
        sportCode == nil && venue == nil && opponent == nil && site == nil
    }

    var count: Int {
        [sportCode, venue, opponent, site].compactMap { $0 }.count
    }
}

private struct TeamScoreboardTotals {
    let contributors: Int
    let eventsCovered: Int
    let eventCredits: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?
    let gameCredits: Int

    init(_ summary: TeamScoreboardSummary) {
        contributors = summary.contributors
        eventsCovered = summary.eventsCovered
        eventCredits = summary.eventCredits
        wins = summary.wins
        losses = summary.losses
        ties = summary.ties
        games = summary.games
        winRate = summary.winRate
        gameCredits = summary.gameCredits
    }

    init(_ breakdown: TeamScoreboardBreakdown) {
        contributors = breakdown.contributors
        eventsCovered = breakdown.eventsCovered
        eventCredits = breakdown.eventCredits
        wins = breakdown.wins
        losses = breakdown.losses
        ties = breakdown.ties
        games = breakdown.games
        winRate = breakdown.winRate
        gameCredits = breakdown.gameCredits
    }

    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

private struct TeamScoreboardLeaderboardMetrics {
    let eventsWorked: Int
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let winRate: Double?

    init(_ summary: TeamScoreboardPersonSummary) {
        eventsWorked = summary.eventsWorked
        wins = summary.wins
        losses = summary.losses
        ties = summary.ties
        games = summary.games
        winRate = summary.winRate
    }

    var recordLabel: String { ScoreboardFormat.record(wins: wins, losses: losses, ties: ties) }
    var winRateLabel: String { ScoreboardFormat.winRate(winRate) }
}

private struct TeamScoreboardRankedPerson: Identifiable {
    let person: TeamScoreboardPerson
    let metrics: TeamScoreboardLeaderboardMetrics

    var id: String { person.userId }
}

/// Shared, read-only team Scoreboard. It consumes only aggregate totals and a
/// minimal roster identity, so opening it never requires private People access.
///
/// Built to be poked at: a record that rolls when filters change, fact cards
/// that jump somewhere, a leaderboard that re-sorts in place, rows that open,
/// a head-to-head, and an explorer whose rows filter the whole screen.
struct TeamScoreboardView: View {
    var wrapsInNavigationStack = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(SessionStore.self) private var session

    @State private var scoreboard: TeamScoreboard?
    @State private var filters = TeamScoreboardFilterSelection()
    @State private var loadedFilters = TeamScoreboardFilterSelection()
    @State private var rankBy: TeamScoreboardRank = .events
    @State private var isLoading = true
    @State private var initialError: String?
    @State private var refreshError: String?
    @State private var activeRequestID: UUID?
    @State private var expandedId: String?
    @State private var comparePair: TeamScoreboardComparePair?
    @State private var explore: TeamScoreboardFilterDimension = .sport
    @State private var factPage = 0
    @State private var showsMoreFilters = false

    var body: some View {
        Group {
            if wrapsInNavigationStack {
                NavigationStack { destinationContent }
            } else {
                destinationContent
            }
        }
    }

    @ViewBuilder
    private var destinationContent: some View {
        Group {
            if let scoreboard {
                scoreboardScroll(scoreboard)
            } else if isLoading {
                TeamScoreboardLoadingView()
            } else {
                ContentUnavailableView {
                    Label("Scoreboard unavailable", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(initialError ?? "The shared team totals could not be loaded.")
                } actions: {
                    Button("Retry") { Task { await load(for: filters) } }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Scoreboard")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showsMoreFilters = true
                } label: {
                    Image(systemName: filters.count - (filters.sportCode == nil ? 0 : 1) > 0
                        ? "line.3.horizontal.decrease.circle.fill"
                        : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("More filters")
                .disabled(scoreboard == nil)
            }
        }
        .sheet(isPresented: $showsMoreFilters) {
            if let scoreboard {
                TeamScoreboardFilterSheet(scoreboard: scoreboard, filters: $filters)
                    .presentationDetents([.medium])
            }
        }
        .sheet(item: $comparePair) { pair in
            if let scoreboard {
                TeamScoreboardCompareSheet(people: rankedPeople(in: scoreboard).map(\.person), pair: pair)
                    .presentationDetents([.medium, .large])
            }
        }
        .nativeScrollBarMinimization()
        .task(id: filters) {
            await load(for: filters)
        }
        .task {
            await APIClient.shared.recordProductEvent(eventName: "surface_viewed", surface: "scoreboard")
        }
    }

    private var currentUserId: String? { session.currentUser?.id }

    private func scoreboardScroll(_ scoreboard: TeamScoreboard) -> some View {
        let ranked = rankedPeople(in: scoreboard)
        let facts = TeamScoreboardFunFacts.facts(for: scoreboard, currentUserId: currentUserId)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: Brand.Space.lg) {
                if let refreshError {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.statusText(.orange))
                            .accessibilityHidden(true)
                        Text(refreshError)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        Button("Retry") { Task { await load(for: filters) } }
                            .font(.caption.weight(.semibold))
                    }
                    .padding(.horizontal)
                }

                TeamScoreboardSportChips(sports: scoreboard.facets.sports, selection: $filters.sportCode)

                activeFilterChips(in: scoreboard)

                TeamScoreboardRecordCard(
                    scopeLabel: scoreboard.scope.label,
                    snapshot: snapshotTitle(in: scoreboard),
                    totals: TeamScoreboardTotals(scoreboard.summary),
                    methodology: scoreboard.methodology
                )
                .padding(.horizontal)

                if !facts.isEmpty {
                    factsSection(facts, scoreboard: scoreboard)
                }

                leaderboardSection(ranked, scoreboard: scoreboard)

                exploreSection(scoreboard)
            }
            .padding(.vertical, Brand.Space.sm)
        }
        .background(Color(.systemGroupedBackground))
        .opacity(isLoading ? 0.62 : 1)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: isLoading)
        .refreshable { await load(for: filters) }
    }

    @ViewBuilder
    private func activeFilterChips(in scoreboard: TeamScoreboard) -> some View {
        let chips: [(String, TeamScoreboardFilterDimension)] = [
            filters.venue.map { key in ("At \(scoreboard.facets.venues.first { $0.key == key }?.label ?? key)", .venue) },
            filters.opponent.map { key in ("vs \(scoreboard.facets.opponents.first { $0.key == key }?.label ?? key)", .opponent) },
            filters.site.map { key in ("\(scoreboard.facets.sites.first { $0.key == key }?.label ?? key) events", .site) },
        ].compactMap { $0 }
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(chips.enumerated()), id: \.offset) { _, chip in
                        Button {
                            clearFilter(chip.1)
                        } label: {
                            Label(chip.0, systemImage: "xmark")
                                .labelStyle(TrailingIconLabelStyle())
                                .font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .accessibilityLabel("Remove filter \(chip.0)")
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    private func factsSection(_ facts: [TeamScoreboardFunFact], scoreboard: TeamScoreboard) -> some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack {
                Text("Did you know")
                    .font(.gothamBold(size: 20, relativeTo: .title3))
                Spacer()
                if facts.count > 4 {
                    Button("More facts", systemImage: "shuffle") {
                        let advance = { factPage += 1 }
                        if reduceMotion { advance() } else { withAnimation(.snappy) { advance() } }
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
            .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(TeamScoreboardFunFacts.window(facts, page: factPage, size: 4)) { fact in
                        Button {
                            openFact(fact)
                        } label: {
                            TeamScoreboardFactCard(fact: fact)
                        }
                        .buttonStyle(.plain)
                        .disabled(fact.action == nil)
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                    }
                }
                .padding(.horizontal)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
        }
    }

    private func leaderboardSection(_ ranked: [TeamScoreboardRankedPerson], scoreboard: TeamScoreboard) -> some View {
        let minimum = scoreboard.methodology.minimumGamesForWinRate
        let topValue = ranked.map { metricValue($0.metrics) }.max() ?? 0
        let yourRank = ranked.firstIndex { $0.person.userId == currentUserId }.map { $0 + 1 }
        return VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text("Leaderboard")
                    .font(.gothamBold(size: 20, relativeTo: .title3))
                Spacer()
                if let yourRank {
                    Text("You’re \(ordinal(yourRank))")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.statusText(.blue))
                }
            }
            .padding(.horizontal)

            Picker("Rank by", selection: rankBinding) {
                ForEach(TeamScoreboardRank.allCases) { ranking in
                    Text(ranking.title).tag(ranking)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .sensoryFeedback(.selection, trigger: rankBy)

            if scoreboard.leaderboard.isEmpty {
                ContentUnavailableView(
                    filters.isEmpty ? "No Scoreboard credits yet" : "No matching Scoreboard results",
                    systemImage: "person.2.slash",
                    description: Text(filters.isEmpty
                        ? "People appear after they work an eligible Schedule event."
                        : "Remove one filter or clear them all to broaden the results.")
                )
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(ranked.enumerated()), id: \.element.id) { index, row in
                        TeamScoreboardPersonRow(
                            rank: index + 1,
                            person: row.person,
                            metrics: row.metrics,
                            rankBy: rankBy,
                            minimumRateGames: minimum,
                            share: topValue > 0 ? metricValue(row.metrics) / topValue : 0,
                            isYou: row.person.userId == currentUserId,
                            isExpanded: expandedId == row.person.userId,
                            onToggle: { toggle(row.person.userId) },
                            onCompare: { startCompare(with: row.person.userId, leader: ranked.first?.person.userId) }
                        )
                        if index < ranked.count - 1 {
                            Divider().padding(.leading, 64)
                        }
                    }
                }
                .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
                .padding(.horizontal)

                if rankBy == .rate {
                    Text("Win-rate ranking needs \(minimum) resolved games. A tie counts as half a win.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                }
            }
        }
    }

    private func exploreSection(_ scoreboard: TeamScoreboard) -> some View {
        let rows: [TeamScoreboardBreakdown] = switch explore {
        case .sport: scoreboard.bySport
        case .venue: scoreboard.byVenue
        case .opponent: scoreboard.byOpponent
        case .site: scoreboard.bySite
        }
        let maxGames = rows.map { max($0.games, $0.eventsCovered) }.max() ?? 0
        return VStack(alignment: .leading, spacing: Brand.Space.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Explore")
                    .font(.gothamBold(size: 20, relativeTo: .title3))
                Text("Tap a row to zoom the whole Scoreboard in.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)

            Picker("Explore by", selection: $explore) {
                Text("Sport").tag(TeamScoreboardFilterDimension.sport)
                Text("Venue").tag(TeamScoreboardFilterDimension.venue)
                Text("Opponent").tag(TeamScoreboardFilterDimension.opponent)
                Text("Site").tag(TeamScoreboardFilterDimension.site)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            if rows.isEmpty {
                Text("Nothing to explore in this view yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        Button {
                            if let key = row.key { selectFilter(key, dimension: explore) }
                        } label: {
                            TeamScoreboardBreakdownRow(
                                breakdown: row,
                                maxGames: maxGames,
                                isSelected: row.key != nil && selectedValue(for: explore) == row.key
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(row.key == nil)
                        .accessibilityHint("Toggles \(row.label) in the active Scoreboard filters")
                        if index < rows.count - 1 {
                            Divider().padding(.leading, Brand.Space.md)
                        }
                    }
                }
                .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Interaction

    private var rankBinding: Binding<TeamScoreboardRank> {
        Binding(
            get: { rankBy },
            set: { next in
                if reduceMotion { rankBy = next } else { withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { rankBy = next } }
            }
        )
    }

    private func toggle(_ userId: String) {
        let update = { expandedId = expandedId == userId ? nil : userId }
        if reduceMotion { update() } else { withAnimation(.snappy(duration: 0.24)) { update() } }
    }

    private func startCompare(with userId: String, leader: String?) {
        let me = currentUserId
        if let me, me != userId {
            comparePair = TeamScoreboardComparePair(left: me, right: userId)
        } else if let leader, leader != userId {
            comparePair = TeamScoreboardComparePair(left: userId, right: leader)
        } else {
            comparePair = TeamScoreboardComparePair(left: userId, right: nil)
        }
    }

    private func openFact(_ fact: TeamScoreboardFunFact) {
        switch fact.action {
        case .person(let userId):
            if reduceMotion { expandedId = userId } else { withAnimation(.snappy) { expandedId = userId } }
        case .filter(let dimension, let value):
            selectFilter(value, dimension: dimension)
        case nil:
            break
        }
    }

    private func metricValue(_ metrics: TeamScoreboardLeaderboardMetrics) -> Double {
        switch rankBy {
        case .events: Double(metrics.eventsWorked)
        case .wins: Double(metrics.wins)
        case .rate: metrics.winRate ?? 0
        }
    }

    private func ordinal(_ rank: Int) -> String {
        let remainder = rank % 100
        if (11...13).contains(remainder) { return "\(rank)th" }
        switch rank % 10 {
        case 1: return "\(rank)st"
        case 2: return "\(rank)nd"
        case 3: return "\(rank)rd"
        default: return "\(rank)th"
        }
    }

    private func rankedPeople(in scoreboard: TeamScoreboard) -> [TeamScoreboardRankedPerson] {
        scoreboard.leaderboard
            .map { person in
                TeamScoreboardRankedPerson(
                    person: person,
                    metrics: TeamScoreboardLeaderboardMetrics(person.summary)
                )
            }
            .sorted(by: ranksBefore)
    }

    private func ranksBefore(_ left: TeamScoreboardRankedPerson, _ right: TeamScoreboardRankedPerson) -> Bool {
        switch rankBy {
        case .events:
            if left.metrics.eventsWorked != right.metrics.eventsWorked {
                return left.metrics.eventsWorked > right.metrics.eventsWorked
            }
        case .wins:
            if left.metrics.wins != right.metrics.wins {
                return left.metrics.wins > right.metrics.wins
            }
        case .rate:
            let minimum = scoreboard?.methodology.minimumGamesForWinRate ?? 3
            let leftEligible = left.metrics.games >= minimum && left.metrics.winRate != nil
            let rightEligible = right.metrics.games >= minimum && right.metrics.winRate != nil
            if leftEligible != rightEligible { return leftEligible }
            if leftEligible, left.metrics.winRate != right.metrics.winRate {
                return (left.metrics.winRate ?? 0) > (right.metrics.winRate ?? 0)
            }
        }

        if left.metrics.games != right.metrics.games { return left.metrics.games > right.metrics.games }
        if left.metrics.wins != right.metrics.wins { return left.metrics.wins > right.metrics.wins }
        if left.metrics.eventsWorked != right.metrics.eventsWorked {
            return left.metrics.eventsWorked > right.metrics.eventsWorked
        }
        let nameOrder = left.person.name.localizedCaseInsensitiveCompare(right.person.name)
        if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
        return left.person.userId < right.person.userId
    }

    private func selectedValue(for dimension: TeamScoreboardFilterDimension) -> String? {
        switch dimension {
        case .sport: filters.sportCode
        case .venue: filters.venue
        case .opponent: filters.opponent
        case .site: filters.site
        }
    }

    private func selectFilter(_ value: String, dimension: TeamScoreboardFilterDimension) {
        var updated = filters
        switch dimension {
        case .sport: updated.sportCode = updated.sportCode == value ? nil : value
        case .venue: updated.venue = updated.venue == value ? nil : value
        case .opponent: updated.opponent = updated.opponent == value ? nil : value
        case .site: updated.site = updated.site == value ? nil : value
        }
        let update = { filters = updated }
        if reduceMotion { update() } else { withAnimation(.snappy(duration: 0.18), update) }
    }

    private func clearFilter(_ dimension: TeamScoreboardFilterDimension) {
        var updated = filters
        switch dimension {
        case .sport: updated.sportCode = nil
        case .venue: updated.venue = nil
        case .opponent: updated.opponent = nil
        case .site: updated.site = nil
        }
        filters = updated
    }

    private func snapshotTitle(in scoreboard: TeamScoreboard) -> String {
        let sport = filters.sportCode.map { key in
            scoreboard.facets.sports.first { $0.key == key }?.label ?? key
        }
        let venue = filters.venue.map { key in
            "at \(scoreboard.facets.venues.first { $0.key == key }?.label ?? key)"
        }
        let opponent = filters.opponent.map { key in
            "vs \(scoreboard.facets.opponents.first { $0.key == key }?.label ?? key)"
        }
        let site = filters.site.map { key in
            "\(scoreboard.facets.sites.first { $0.key == key }?.label ?? key) events"
        }
        let parts = [sport, venue, opponent, site].compactMap { $0 }
        return parts.isEmpty ? "All events, one shared Scoreboard" : parts.joined(separator: " · ")
    }

    private func load(for requestedFilters: TeamScoreboardFilterSelection) async {
        let requestID = UUID()
        activeRequestID = requestID
        let hasData = scoreboard != nil
        isLoading = true
        if hasData { refreshError = nil } else { initialError = nil }
        defer {
            if activeRequestID == requestID { isLoading = false }
        }

        do {
            let fetched = try await APIClient.shared.teamScoreboard(
                sportCode: requestedFilters.sportCode,
                venue: requestedFilters.venue,
                opponent: requestedFilters.opponent,
                site: requestedFilters.site
            )
            guard !Task.isCancelled, activeRequestID == requestID else { return }
            scoreboard = fetched
            loadedFilters = requestedFilters
            initialError = nil
            refreshError = nil
        } catch is CancellationError {
            return
        } catch APIError.unauthorized {
            // SessionStore owns the global transition back to sign-in.
            return
        } catch {
            guard !Task.isCancelled, activeRequestID == requestID else { return }
            if hasData {
                if filters == requestedFilters { filters = loadedFilters }
                refreshError = "Couldn’t apply those filters. Showing the last loaded totals."
            } else {
                initialError = error.localizedDescription
            }
        }
    }
}


// MARK: - Fun facts

enum TeamScoreboardFunFactAction: Equatable {
    case person(String)
    case filter(TeamScoreboardFilterDimension, String)
}

struct TeamScoreboardFunFact: Identifiable, Equatable {
    let id: String
    let label: String
    let value: String
    let sentence: String
    let action: TeamScoreboardFunFactAction?
}

/// Mirrors `scoreboardFunFacts` on the web: one big value and one plain
/// sentence, computed only from the aggregate the screen already loaded.
enum TeamScoreboardFunFacts {
    /// Facts that judge a record need a little more than the ranking minimum.
    static let minimumGames = 4

    static func facts(for scoreboard: TeamScoreboard, currentUserId: String?) -> [TeamScoreboardFunFact] {
        var facts: [TeamScoreboardFunFact] = []
        let people = scoreboard.leaderboard
        guard !people.isEmpty else { return facts }

        let byEvents = people.sorted { left, right in
            if left.summary.eventsWorked != right.summary.eventsWorked { return left.summary.eventsWorked > right.summary.eventsWorked }
            if left.summary.games != right.summary.games { return left.summary.games > right.summary.games }
            return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
        }

        if let leader = byEvents.first, leader.summary.eventsWorked > 0 {
            facts.append(.init(
                id: "iron-crew", label: "Iron crew", value: plural(leader.summary.eventsWorked, "event"),
                sentence: "\(leader.name) has worked more events than anyone.", action: .person(leader.userId)
            ))
            if byEvents.count > 1 {
                let runnerUp = byEvents[1]
                let gap = leader.summary.eventsWorked - runnerUp.summary.eventsWorked
                if gap <= 2 {
                    facts.append(.init(
                        id: "tight-race", label: "Tight at the top",
                        value: gap == 0 ? "Tied" : "\(gap) \(gap == 1 ? "event" : "events") apart",
                        sentence: gap == 0
                            ? "\(firstName(leader.name)) and \(firstName(runnerUp.name)) are level on events."
                            : "\(firstName(runnerUp.name)) is chasing \(firstName(leader.name)) for most events.",
                        action: .person(runnerUp.userId)
                    ))
                }
            }
        }

        let teamRate = scoreboard.summary.winRate
        let charm = people
            .filter { $0.summary.winRate != nil && $0.summary.games >= minimumGames }
            .sorted { left, right in
                if left.summary.winRate != right.summary.winRate { return (left.summary.winRate ?? 0) > (right.summary.winRate ?? 0) }
                if left.summary.games != right.summary.games { return left.summary.games > right.summary.games }
                return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
            }
            .first
        if let charm, teamRate == nil || (charm.summary.winRate ?? 0) > (teamRate ?? 0) {
            facts.append(.init(
                id: "lucky-charm", label: "Lucky charm",
                value: ScoreboardFormat.record(wins: charm.summary.wins, losses: charm.summary.losses, ties: charm.summary.ties),
                sentence: "The team is \(ScoreboardFormat.winRate(charm.summary.winRate)) when \(firstName(charm.name)) is on crew.",
                action: .person(charm.userId)
            ))
        }

        if scoreboard.filters.site == nil,
           let home = scoreboard.bySite.first(where: { $0.key == "HOME" }),
           let away = scoreboard.bySite.first(where: { $0.key == "AWAY" }),
           let homeRate = home.winRate, let awayRate = away.winRate,
           home.games > 0, away.games > 0 {
            let better = homeRate >= awayRate ? home : away
            facts.append(.init(
                id: "home-away", label: homeRate >= awayRate ? "Home cooking" : "Road warriors",
                value: ScoreboardFormat.winRate(better.winRate),
                sentence: "\(record(home)) at home, \(record(away)) away.",
                action: .filter(.site, better.key ?? "HOME")
            ))
        }

        if scoreboard.filters.opponent == nil, let rival = mostCovered(scoreboard.byOpponent), rival.eventsCovered >= 2 {
            facts.append(.init(
                id: "familiar-face", label: "Familiar face", value: rival.label,
                sentence: "\(plural(rival.eventsCovered, "event")) against them so far\(rival.games > 0 ? ", \(record(rival))" : "").",
                action: .filter(.opponent, rival.key ?? rival.label)
            ))
        }

        if scoreboard.filters.sportCode == nil, scoreboard.bySport.count > 1,
           let sport = scoreboard.bySport
            .filter({ $0.key != nil && $0.winRate != nil && $0.games >= scoreboard.methodology.minimumGamesForWinRate })
            .sorted(by: { ($0.winRate ?? 0, $0.games) > ($1.winRate ?? 0, $1.games) })
            .first {
            facts.append(.init(
                id: "hot-sport", label: "Hottest sport", value: sport.label,
                sentence: "\(record(sport)) with our crew there, \(ScoreboardFormat.winRate(sport.winRate)).",
                action: .filter(.sport, sport.key ?? sport.label)
            ))
        }

        if scoreboard.filters.venue == nil, let venue = mostCovered(scoreboard.byVenue), venue.eventsCovered >= 2 {
            facts.append(.init(
                id: "second-home", label: "Second home", value: venue.label,
                sentence: "The most-worked venue, \(plural(venue.eventsCovered, "event")).",
                action: .filter(.venue, venue.key ?? venue.label)
            ))
        }

        if scoreboard.summary.eventsCovered > 0 {
            let crew = Double(scoreboard.summary.eventCredits) / Double(scoreboard.summary.eventsCovered)
            facts.append(.init(
                id: "crew-size", label: "Average crew",
                value: "\((crew * 10).rounded() / 10) people",
                sentence: "Across \(plural(scoreboard.summary.eventsCovered, "event")) and \(plural(scoreboard.summary.contributors, "person", "people")).",
                action: nil
            ))
        }

        if let currentUserId, let index = byEvents.firstIndex(where: { $0.userId == currentUserId }) {
            let you = byEvents[index]
            if index > 0 {
                let ahead = byEvents[index - 1]
                let gap = ahead.summary.eventsWorked - you.summary.eventsWorked
                facts.insert(.init(
                    id: "your-spot", label: "Your spot", value: "#\(index + 1)",
                    sentence: gap == 0
                        ? "Level with \(firstName(ahead.name)) on events."
                        : "\(plural(gap, "event")) behind \(firstName(ahead.name)).",
                    action: .person(you.userId)
                ), at: 0)
            } else {
                facts.insert(.init(
                    id: "your-spot", label: "Your spot", value: "#1",
                    sentence: "Nobody has worked more events than you.", action: .person(you.userId)
                ), at: 0)
            }
        }

        return facts
    }

    /// A stable window, so shuffling walks through every fact before repeating.
    static func window(_ facts: [TeamScoreboardFunFact], page: Int, size: Int) -> [TeamScoreboardFunFact] {
        guard facts.count > size else { return facts }
        let start = (page * size) % facts.count
        return (0..<size).map { facts[(start + $0) % facts.count] }
    }

    private static func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
        "\(count) \(count == 1 ? one : (many ?? "\(one)s"))"
    }

    private static func firstName(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    private static func record(_ row: TeamScoreboardBreakdown) -> String {
        ScoreboardFormat.record(wins: row.wins, losses: row.losses, ties: row.ties)
    }

    private static func mostCovered(_ rows: [TeamScoreboardBreakdown]) -> TeamScoreboardBreakdown? {
        rows.filter { $0.key != nil && $0.eventsCovered > 0 }
            .sorted { left, right in
                if left.eventsCovered != right.eventsCovered { return left.eventsCovered > right.eventsCovered }
                if left.games != right.games { return left.games > right.games }
                return left.label.localizedCaseInsensitiveCompare(right.label) == .orderedAscending
            }
            .first
    }
}

// MARK: - Pieces

private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon.imageScale(.small)
        }
    }
}

struct TeamScoreboardComparePair: Identifiable, Equatable {
    var left: String?
    var right: String?
    var id: String { "\(left ?? "-")|\(right ?? "-")" }
}

private struct TeamScoreboardSportChips: View {
    let sports: [TeamScoreboardFacet]
    @Binding var selection: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("All sports", isSelected: selection == nil) { selection = nil }
                ForEach(sports) { sport in
                    chip(sport.label, isSelected: selection == sport.key) {
                        selection = selection == sport.key ? nil : sport.key
                    }
                }
            }
            .padding(.horizontal)
        }
        .sensoryFeedback(.selection, trigger: selection)
        .accessibilityLabel("Filter Scoreboard by sport")
    }

    private func chip(_ title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foregroundStyle(isSelected ? Color(.systemBackground) : .primary)
                .background(isSelected ? Color.primary : Color.cardSurface, in: Capsule())
                .overlay { Capsule().strokeBorder(Color.hairline, lineWidth: isSelected ? 0 : 1) }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct TeamScoreboardRecordCard: View {
    let scopeLabel: String
    let snapshot: String
    let totals: TeamScoreboardTotals
    let methodology: TeamScoreboardMethodology

    @State private var showsMethodology = false

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.md) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Team record · \(scopeLabel)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(totals.recordLabel)
                            .font(.system(size: 48, weight: .black, design: .default))
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                        Text(totals.winRateLabel)
                            .font(.title3.weight(.heavy))
                            .foregroundStyle(Color.statusText(.blue))
                            .monospacedDigit()
                            .contentTransition(.numericText())
                    }
                    Text(snapshot)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    showsMethodology = true
                } label: {
                    Image(systemName: "info.circle")
                }
                .accessibilityLabel("How these numbers count")
                .popover(isPresented: $showsMethodology) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("How these numbers count").font(.headline)
                        Text(methodology.eventsCovered)
                        Text(methodology.eventCredits)
                        Text(methodology.record)
                        Text(methodology.gameCredits)
                        Text("Win-rate ranking needs \(methodology.minimumGamesForWinRate) resolved games. A tie counts as half a win.")
                    }
                    .font(.footnote)
                    .padding()
                    .frame(idealWidth: 320)
                    .presentationCompactAdaptation(.popover)
                }
            }

            TeamScoreboardRecordMeter(wins: totals.wins, losses: totals.losses, ties: totals.ties)

            Divider()

            HStack(alignment: .top) {
                metric("\(totals.eventsCovered)", "Events covered")
                metric("\(totals.contributors)", "Contributors")
                metric("\(totals.eventCredits)", "Work credits")
            }
        }
        .padding(Brand.Space.lg)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title2.weight(.heavy))
                .monospacedDigit()
                .contentTransition(.numericText())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct TeamScoreboardRecordMeter: View {
    let wins: Int
    let losses: Int
    let ties: Int

    var body: some View {
        let games = max(wins + losses + ties, 1)
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                HStack(spacing: 3) {
                    segment(wins, games, proxy.size.width, .green)
                    segment(losses, games, proxy.size.width, .red)
                    segment(ties, games, proxy.size.width, .orange)
                }
            }
            .frame(height: 8)
            .background(Color.secondary.opacity(0.12), in: Capsule())
            HStack(spacing: 14) {
                key("\(wins) \(wins == 1 ? "win" : "wins")", .green)
                key("\(losses) \(losses == 1 ? "loss" : "losses")", .red)
                key("\(ties) \(ties == 1 ? "tie" : "ties")", .orange)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(wins) wins, \(losses) losses, \(ties) ties")
    }

    @ViewBuilder
    private func segment(_ value: Int, _ games: Int, _ width: CGFloat, _ tone: StatusTone) -> some View {
        if value > 0 {
            Capsule()
                .fill(Color.statusText(tone))
                .frame(width: max(4, (width - 6) * CGFloat(value) / CGFloat(games)))
        }
    }

    private func key(_ text: String, _ tone: StatusTone) -> some View {
        HStack(spacing: 5) {
            Circle().fill(Color.statusText(tone)).frame(width: 7, height: 7)
            Text(text).monospacedDigit()
        }
    }
}

private struct TeamScoreboardFactCard: View {
    let fact: TeamScoreboardFunFact

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(fact.label)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.statusText(.blue))
            Text(fact.value)
                .font(.title3.weight(.heavy))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(fact.sentence)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let action = fact.action {
                Text(action.isPerson ? "See them →" : "Zoom in →")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(Brand.Space.md)
        .frame(width: 220, height: 150, alignment: .topLeading)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private extension TeamScoreboardFunFactAction {
    var isPerson: Bool {
        if case .person = self { return true }
        return false
    }
}

private struct TeamScoreboardPersonRow: View {
    let rank: Int
    let person: TeamScoreboardPerson
    let metrics: TeamScoreboardLeaderboardMetrics
    let rankBy: TeamScoreboardRank
    let minimumRateGames: Int
    let share: Double
    let isYou: Bool
    let isExpanded: Bool
    let onToggle: () -> Void
    let onCompare: () -> Void

    private var unranked: Bool { rankBy == .rate && metrics.games < minimumRateGames }

    private var metricLabel: String {
        switch rankBy {
        case .events: "\(metrics.eventsWorked)"
        case .wins: "\(metrics.wins)"
        case .rate: metrics.winRateLabel
        }
    }

    private var metricUnit: String {
        switch rankBy {
        case .events: "events"
        case .wins: "wins"
        case .rate: "win rate"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 12) {
                    TeamScoreboardRankBadge(rank: rank)
                    UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 36)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(person.name)
                                .font(.subheadline.weight(.bold))
                                .lineLimit(1)
                            if isYou {
                                Text("You")
                                    .font(.caption2.weight(.heavy))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(Color.statusText(.blue), in: Capsule())
                            }
                        }
                        GeometryReader { proxy in
                            Capsule()
                                .fill(rankBy == .events ? Color.statusText(.blue) : Color.statusText(.green))
                                .frame(width: unranked ? 0 : max(3, proxy.size.width * share))
                        }
                        .frame(height: 4)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                        Text("\(metrics.eventsWorked) \(metrics.eventsWorked == 1 ? "event" : "events") · \(metrics.recordLabel) · \(metrics.winRateLabel)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 0) {
                        if unranked {
                            Text("Not ranked yet")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("Needs \(minimumRateGames) games")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(metricLabel)
                                .font(.headline.weight(.heavy))
                                .monospacedDigit()
                                .contentTransition(.numericText())
                            Text(metricUnit)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .padding(.horizontal, Brand.Space.md)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint(isExpanded ? "Collapses \(person.name)" : "Shows \(person.name)’s sports and compare")
            .accessibilityAddTraits(isExpanded ? .isSelected : [])

            if isExpanded {
                TeamScoreboardPersonDetail(person: person, metrics: metrics, onCompare: onCompare)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(isYou ? Color.myShiftSurface : Color.clear)
    }
}

private struct TeamScoreboardRankBadge: View {
    let rank: Int

    var body: some View {
        Text("\(rank)")
            .font(.caption.weight(.black))
            .monospacedDigit()
            .foregroundStyle(rank <= 3 ? Color.black.opacity(0.72) : Color.secondary)
            .frame(width: 26, height: 26)
            .background {
                if rank <= 3 {
                    Circle().fill(medal)
                }
            }
            .accessibilityLabel("Rank \(rank)")
    }

    private var medal: Color {
        switch rank {
        case 1: Color(red: 0.96, green: 0.84, blue: 0.40)
        case 2: Color(red: 0.87, green: 0.89, blue: 0.92)
        default: Color(red: 0.94, green: 0.78, blue: 0.64)
        }
    }
}

private struct TeamScoreboardPersonDetail: View {
    let person: TeamScoreboardPerson
    let metrics: TeamScoreboardLeaderboardMetrics
    let onCompare: () -> Void

    var body: some View {
        let maxGames = person.bySport.map(\.games).max() ?? 0
        let best = person.bySport
            .filter { $0.winRate != nil && $0.games >= 2 }
            .max { ($0.winRate ?? 0, $0.games) < ($1.winRate ?? 0, $1.games) }
        VStack(alignment: .leading, spacing: Brand.Space.md) {
            HStack {
                stat("\(metrics.eventsWorked)", "Events")
                stat(metrics.recordLabel, "Record")
                stat(metrics.winRateLabel, "Win rate")
            }
            ForEach(person.bySport) { sport in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(sport.label).font(.caption.weight(.bold))
                        Spacer()
                        Text("\(sport.eventsWorked) \(sport.eventsWorked == 1 ? "event" : "events")\(sport.games > 0 ? " · \(ScoreboardFormat.record(wins: sport.wins, losses: sport.losses, ties: sport.ties))" : "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    TeamScoreboardBucketBar(wins: sport.wins, losses: sport.losses, ties: sport.ties, games: sport.games, maxGames: maxGames)
                }
            }
            if let best, person.bySport.count > 1 {
                Text("Best with \(best.label), \(ScoreboardFormat.record(wins: best.wins, losses: best.losses, ties: best.ties))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Button("Compare", systemImage: "arrow.left.arrow.right", action: onCompare)
                    .buttonStyle(.bordered)
                NavigationLink {
                    // Intentionally bypasses UserDetailView. The shared route
                    // contains Scoreboard metrics only.
                    ScoreboardView(userId: person.userId)
                } label: {
                    Label("Full page", systemImage: "arrow.up.right")
                }
                .buttonStyle(.bordered)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(.leading, 64)
        .padding(.trailing, Brand.Space.md)
        .padding(.bottom, Brand.Space.md)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.headline.weight(.heavy)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TeamScoreboardBucketBar: View {
    let wins: Int
    let losses: Int
    let ties: Int
    let games: Int
    let maxGames: Int

    var body: some View {
        GeometryReader { proxy in
            let share = maxGames > 0 ? CGFloat(games) / CGFloat(maxGames) : 0
            let width = proxy.size.width * share
            let total = CGFloat(max(games, 1))
            HStack(spacing: 0) {
                Rectangle().fill(Color.statusText(.green)).frame(width: width * CGFloat(wins) / total)
                Rectangle().fill(Color.statusText(.red)).frame(width: width * CGFloat(losses) / total)
                Rectangle().fill(Color.statusText(.orange)).frame(width: width * CGFloat(ties) / total)
            }
            .clipShape(Capsule())
        }
        .frame(height: 5)
        .background(Color.secondary.opacity(0.12), in: Capsule())
        .accessibilityHidden(true)
    }
}

private struct TeamScoreboardBreakdownRow: View {
    let breakdown: TeamScoreboardBreakdown
    let maxGames: Int
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(breakdown.label)
                    .font(.subheadline.weight(.bold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(breakdown.games > 0 ? breakdown.recordLabel : "—")
                    .font(.subheadline.weight(.bold))
                    .monospacedDigit()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.statusText(.blue))
                        .accessibilityLabel("Selected")
                }
            }
            TeamScoreboardBucketBar(
                wins: breakdown.wins,
                losses: breakdown.losses,
                ties: breakdown.ties,
                games: max(breakdown.games, 0),
                maxGames: maxGames
            )
            HStack {
                Text("\(breakdown.eventsCovered) \(breakdown.eventsCovered == 1 ? "event" : "events") · \(breakdown.contributors) \(breakdown.contributors == 1 ? "person" : "people")")
                Spacer()
                Text(breakdown.winRateLabel)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 10)
        .background(isSelected ? Color.myShiftSurface : Color.clear)
        .contentShape(Rectangle())
    }
}

private struct TeamScoreboardFilterSheet: View {
    let scoreboard: TeamScoreboard
    @Binding var filters: TeamScoreboardFilterSelection
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Venue", selection: $filters.venue) {
                        Text("All venues").tag(nil as String?)
                        ForEach(scoreboard.facets.venues) { facet in
                            Text(facet.label).tag(Optional(facet.key))
                        }
                    }
                    Picker("Opponent", selection: $filters.opponent) {
                        Text("All opponents").tag(nil as String?)
                        ForEach(scoreboard.facets.opponents) { facet in
                            Text(facet.label).tag(Optional(facet.key))
                        }
                    }
                    Picker("Site", selection: $filters.site) {
                        Text("All sites").tag(nil as String?)
                        ForEach(scoreboard.facets.sites) { facet in
                            Text(facet.label).tag(Optional(facet.key))
                        }
                    }
                } footer: {
                    Text("Selections stack. Every total, breakdown, and leaderboard row uses the same combination.")
                }
                if !filters.isEmpty {
                    Button("Clear filters", systemImage: "xmark.circle", role: .destructive) {
                        filters = TeamScoreboardFilterSelection()
                    }
                }
            }
            .navigationTitle("More filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct TeamScoreboardCompareSheet: View {
    let people: [TeamScoreboardPerson]
    @State var pair: TeamScoreboardComparePair
    @Environment(\.dismiss) private var dismiss

    private var left: TeamScoreboardPerson? { people.first { $0.userId == pair.left } }
    private var right: TeamScoreboardPerson? { people.first { $0.userId == pair.right } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Brand.Space.lg) {
                    HStack(alignment: .top) {
                        slot(left, selection: $pair.left, exclude: pair.right, alignment: .leading)
                        Text("vs")
                            .font(.headline.weight(.heavy))
                            .foregroundStyle(.secondary)
                            .padding(.top, 14)
                        slot(right, selection: $pair.right, exclude: pair.left, alignment: .trailing)
                    }
                    if let left, let right {
                        VStack(spacing: Brand.Space.md) {
                            MirroredStat(label: "Events", left: Double(left.summary.eventsWorked), right: Double(right.summary.eventsWorked), format: { "\(Int($0))" })
                            MirroredStat(label: "Wins", left: Double(left.summary.wins), right: Double(right.summary.wins), format: { "\(Int($0))" })
                            MirroredStat(label: "Games", left: Double(left.summary.games), right: Double(right.summary.games), format: { "\(Int($0))" })
                            MirroredStat(label: "Win rate", left: left.summary.winRate ?? 0, right: right.summary.winRate ?? 0, format: { $0 > 0 ? ScoreboardFormat.winRate($0) : "—" })
                        }
                        sharedSports(left, right)
                    } else {
                        Text("Pick someone to compare against.")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .navigationTitle("Head to head")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Swap", systemImage: "arrow.left.arrow.right") {
                        withAnimation(.snappy) { pair = TeamScoreboardComparePair(left: pair.right, right: pair.left) }
                    }
                    .disabled(left == nil || right == nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sensoryFeedback(.selection, trigger: pair)
        }
    }

    private func slot(
        _ person: TeamScoreboardPerson?,
        selection: Binding<String?>,
        exclude: String?,
        alignment: HorizontalAlignment
    ) -> some View {
        VStack(alignment: alignment, spacing: 8) {
            if let person {
                UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 52)
            } else {
                Circle().strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundStyle(.secondary).frame(width: 52, height: 52)
            }
            Picker("Person", selection: selection) {
                Text("Pick someone").tag(nil as String?)
                ForEach(people.filter { $0.userId != exclude }) { candidate in
                    Text(candidate.name).tag(Optional(candidate.userId))
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }

    @ViewBuilder
    private func sharedSports(_ left: TeamScoreboardPerson, _ right: TeamScoreboardPerson) -> some View {
        let shared = left.bySport.compactMap { sport -> (TeamScoreboardPersonSport, TeamScoreboardPersonSport)? in
            guard let other = right.bySport.first(where: { $0.key == sport.key }) else { return nil }
            return (sport, other)
        }
        VStack(alignment: .leading, spacing: 8) {
            Text("Sports they share")
                .font(.subheadline.weight(.bold))
            if shared.isEmpty {
                Text("No sports in common yet.").font(.footnote).foregroundStyle(.secondary)
            } else {
                ForEach(Array(shared.enumerated()), id: \.offset) { _, pair in
                    let (mine, theirs) = pair
                    HStack {
                        Text("\(sportRecord(mine)) in \(mine.eventsWorked)").frame(maxWidth: .infinity, alignment: .leading)
                        Text(mine.label).font(.footnote.weight(.bold))
                        Text("\(sportRecord(theirs)) in \(theirs.eventsWorked)").frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Brand.Space.md)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous))
    }

    private func sportRecord(_ sport: TeamScoreboardPersonSport) -> String {
        sport.games > 0 ? ScoreboardFormat.record(wins: sport.wins, losses: sport.losses, ties: sport.ties) : "—"
    }
}

private struct MirroredStat: View {
    let label: String
    let left: Double
    let right: Double
    let format: (Double) -> String

    var body: some View {
        let top = max(left, right, 1)
        VStack(spacing: 4) {
            HStack {
                Text(format(left)).fontWeight(left > right ? .heavy : .regular)
                Spacer()
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(format(right)).fontWeight(right > left ? .heavy : .regular)
            }
            .monospacedDigit()
            HStack(spacing: 4) {
                GeometryReader { proxy in
                    Capsule()
                        .fill(left > right ? Color.statusText(.blue) : Color.secondary.opacity(0.4))
                        .frame(width: proxy.size.width * left / top)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                GeometryReader { proxy in
                    Capsule()
                        .fill(right > left ? Color.statusText(.blue) : Color.secondary.opacity(0.4))
                        .frame(width: proxy.size.width * right / top)
                }
            }
            .frame(height: 6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(format(left)) versus \(format(right))")
    }
}

private struct TeamScoreboardLoadingView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Brand.Space.lg) {
                RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous)
                    .fill(Color.cardSurface)
                    .frame(height: 200)
                ForEach(0..<6, id: \.self) { _ in
                    HStack(spacing: 10) {
                        Circle().fill(Color.secondary.opacity(0.12)).frame(width: 26, height: 26)
                        Circle().fill(Color.secondary.opacity(0.12)).frame(width: 36, height: 36)
                        RoundedRectangle(cornerRadius: 5)
                            .fill(Color.secondary.opacity(0.12))
                            .frame(height: 14)
                    }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading Scoreboard")
    }
}
