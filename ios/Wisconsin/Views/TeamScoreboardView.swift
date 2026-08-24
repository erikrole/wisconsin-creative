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

private enum TeamScoreboardFilterDimension {
    case sport
    case venue
    case opponent
    case site
}

private struct TeamScoreboardFilterSelection: Equatable {
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
struct TeamScoreboardView: View {
    var wrapsInNavigationStack = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var scoreboard: TeamScoreboard?
    @State private var filters = TeamScoreboardFilterSelection()
    @State private var loadedFilters = TeamScoreboardFilterSelection()
    @State private var rankBy: TeamScoreboardRank = .events
    @State private var isLoading = true
    @State private var initialError: String?
    @State private var refreshError: String?
    @State private var activeRequestID: UUID?

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
                scoreboardList(scoreboard)
            } else if isLoading {
                TeamScoreboardLoadingView()
            } else {
                ContentUnavailableView {
                    Label("Scoreboard unavailable", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(initialError ?? "The shared team totals could not be loaded.")
                } actions: {
                    Button("Try Again") { Task { await load(for: filters) } }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Scoreboard")
        .navigationBarTitleDisplayMode(.inline)
        .tint(.primary)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await load(for: filters) } } label: {
                    if isLoading, scoreboard != nil {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .disabled(isLoading)
                .accessibilityLabel("Refresh Scoreboard")
            }
        }
        .task(id: filters) {
            await load(for: filters)
        }
        .task {
            await APIClient.shared.recordProductEvent(eventName: "surface_viewed", surface: "scoreboard")
        }
    }

    private func scoreboardList(_ scoreboard: TeamScoreboard) -> some View {
        List {
            if let refreshError {
                Section {
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
                }
            }

            Section {
                TeamScoreboardOverview(
                    scopeLabel: scoreboard.scope.label,
                    filterLabel: filterSummary(in: scoreboard),
                    totals: TeamScoreboardTotals(scoreboard.summary)
                )
            }

            Section {
                Picker("Sport", selection: $filters.sportCode) {
                    Text("All sports").tag(nil as String?)
                    ForEach(scoreboard.facets.sports) { facet in
                        Text(facet.label).tag(Optional(facet.key))
                    }
                }
                .pickerStyle(.menu)

                Picker("Venue", selection: $filters.venue) {
                    Text("All venues").tag(nil as String?)
                    ForEach(scoreboard.facets.venues) { facet in
                        Text(facet.label).tag(Optional(facet.key))
                    }
                }
                .pickerStyle(.menu)

                Picker("Opponent", selection: $filters.opponent) {
                    Text("All opponents").tag(nil as String?)
                    ForEach(scoreboard.facets.opponents) { facet in
                        Text(facet.label).tag(Optional(facet.key))
                    }
                }
                .pickerStyle(.menu)

                Picker("Site", selection: $filters.site) {
                    Text("All sites").tag(nil as String?)
                    ForEach(scoreboard.facets.sites) { facet in
                        Text(facet.label).tag(Optional(facet.key))
                    }
                }
                .pickerStyle(.menu)

                if !filters.isEmpty {
                    Button("Clear filters", systemImage: "xmark.circle") {
                        filters = TeamScoreboardFilterSelection()
                    }
                }
            } header: {
                Text("Filters")
            } footer: {
                Text("Selections stack. Every total, breakdown, and leaderboard row uses the same combination.")
            }

            Section {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(snapshotTitle(in: scoreboard))
                            .font(.headline)
                        Text(snapshotMetrics(in: scoreboard))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "sparkles")
                        .foregroundStyle(Color.statusText(.orange))
                }

                if let leader = mostEventsPerson(in: scoreboard) {
                    NavigationLink {
                        ScoreboardView(userId: leader.userId)
                    } label: {
                        LabeledContent("Most events") {
                            Text("\(leader.name) · \(leader.summary.eventsWorked)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text("Snapshot")
            } footer: {
                Text(filters.isEmpty
                    ? "Apply filters to uncover a more specific story."
                    : "This snapshot combines all \(filters.count) active \(filters.count == 1 ? "filter" : "filters").")
            }

            Section("Rank") {
                Picker("Rank by", selection: $rankBy) {
                    ForEach(TeamScoreboardRank.allCases) { ranking in
                        Text(ranking.title).tag(ranking)
                    }
                }
                .pickerStyle(.segmented)
            }

            if scoreboard.leaderboard.isEmpty {
                Section("Leaderboard") {
                    ContentUnavailableView(
                        filters.isEmpty ? "No Scoreboard credits yet" : "No matching Scoreboard results",
                        systemImage: "person.2.slash",
                        description: Text(filters.isEmpty
                            ? "People appear after they work an eligible Schedule event."
                            : "Remove one filter or clear the stack to broaden the results.")
                    )
                }
            } else {
                let rankedPeople = rankedPeople(in: scoreboard)
                Section {
                    if rankedPeople.isEmpty {
                        ContentUnavailableView(
                            "No matching Scoreboard results",
                            systemImage: "person.2.slash",
                            description: Text("Remove one filter or clear the stack to broaden the results.")
                        )
                    } else {
                        ForEach(Array(rankedPeople.enumerated()), id: \.element.id) { index, row in
                            NavigationLink {
                                // Intentionally bypasses UserDetailView. The
                                // shared route contains Scoreboard metrics only.
                                ScoreboardView(userId: row.person.userId)
                            } label: {
                                TeamScoreboardPersonRow(
                                    rank: index + 1,
                                    person: row.person,
                                    metrics: row.metrics,
                                    rankBy: rankBy,
                                    minimumRateGames: scoreboard.methodology.minimumGamesForWinRate
                                )
                            }
                        }
                    }
                } header: {
                    Text("Leaderboard")
                } footer: {
                    if rankBy == .rate {
                        Text("Win-rate ranking requires at least \(scoreboard.methodology.minimumGamesForWinRate) resolved games.")
                    } else {
                        Text("Open a person to see only their shared Scoreboard.")
                    }
                }
            }

            breakdownSection("By sport", rows: scoreboard.bySport, dimension: .sport)
            breakdownSection("At venues", rows: scoreboard.byVenue, dimension: .venue)
            breakdownSection("Against teams", rows: scoreboard.byOpponent, dimension: .opponent)
            breakdownSection("By site", rows: scoreboard.bySite, dimension: .site)

            Section("How totals work") {
                Text(scoreboard.methodology.eventsCovered)
                Text(scoreboard.methodology.eventCredits)
                Text(scoreboard.methodology.record)
                Text(scoreboard.methodology.gameCredits)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .listStyle(.insetGrouped)
        .opacity(isLoading ? 0.62 : 1)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: isLoading)
        .refreshable { await load(for: filters) }
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

    @ViewBuilder
    private func breakdownSection(
        _ title: String,
        rows: [TeamScoreboardBreakdown],
        dimension: TeamScoreboardFilterDimension
    ) -> some View {
        if !rows.isEmpty {
            Section(title) {
                ForEach(rows) { row in
                    if let key = row.key {
                        Button {
                            selectFilter(key, dimension: dimension)
                        } label: {
                            TeamScoreboardBreakdownRow(
                                breakdown: row,
                                isSelected: selectedValue(for: dimension) == key
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Toggles \(row.label) in the active Scoreboard filters")
                    } else {
                        TeamScoreboardBreakdownRow(breakdown: row, isSelected: false)
                    }
                }
            }
        }
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

    private func filterSummary(in scoreboard: TeamScoreboard) -> String {
        let parts = [
            filters.sportCode.map { key in scoreboard.facets.sports.first { $0.key == key }?.label ?? key },
            filters.venue.map { key in scoreboard.facets.venues.first { $0.key == key }?.label ?? key },
            filters.opponent.map { key in scoreboard.facets.opponents.first { $0.key == key }?.label ?? key },
            filters.site.map { key in scoreboard.facets.sites.first { $0.key == key }?.label ?? key },
        ].compactMap { $0 }
        return parts.isEmpty ? "All events" : parts.joined(separator: " · ")
    }

    private func snapshotTitle(in scoreboard: TeamScoreboard) -> String {
        let sport = filters.sportCode.map { key in
            scoreboard.facets.sports.first { $0.key == key }?.label ?? key
        }
        let venue = filters.venue.map { key in
            "At \(scoreboard.facets.venues.first { $0.key == key }?.label ?? key)"
        }
        let opponent = filters.opponent.map { key in
            "Against \(scoreboard.facets.opponents.first { $0.key == key }?.label ?? key)"
        }
        let site = filters.site.map { key in
            "\(scoreboard.facets.sites.first { $0.key == key }?.label ?? key) events"
        }
        let parts = [sport, venue, opponent, site].compactMap { $0 }
        return parts.isEmpty ? "All events, one shared Scoreboard" : parts.joined(separator: " · ")
    }

    private func snapshotMetrics(in scoreboard: TeamScoreboard) -> String {
        let totals = TeamScoreboardTotals(scoreboard.summary)
        let eventLabel = totals.eventsCovered == 1 ? "event" : "events"
        let contributorLabel = totals.contributors == 1 ? "contributor" : "contributors"
        return "\(totals.eventsCovered) \(eventLabel) · \(totals.recordLabel) record · \(totals.contributors) \(contributorLabel)"
    }

    private func mostEventsPerson(in scoreboard: TeamScoreboard) -> TeamScoreboardPerson? {
        scoreboard.leaderboard.sorted { left, right in
            if left.summary.eventsWorked != right.summary.eventsWorked {
                return left.summary.eventsWorked > right.summary.eventsWorked
            }
            if left.summary.games != right.summary.games {
                return left.summary.games > right.summary.games
            }
            if left.summary.wins != right.summary.wins {
                return left.summary.wins > right.summary.wins
            }
            let nameOrder = left.name.localizedCaseInsensitiveCompare(right.name)
            if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
            return left.userId < right.userId
        }.first
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

private struct TeamScoreboardOverview: View {
    let scopeLabel: String
    let filterLabel: String
    let totals: TeamScoreboardTotals

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.md) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.statusBackground(.orange))
                    Image(systemName: "trophy.fill")
                        .font(.headline)
                        .foregroundStyle(Color.statusText(.orange))
                }
                .frame(width: 44, height: 44)
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(scopeLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.7)
                    Text("Team Scoreboard")
                        .font(.gothamBold(size: 20, relativeTo: .title3))
                    Text("Shared with everyone signed in · \(filterLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                TeamScoreboardMetric(value: "\(totals.eventsCovered)", label: "Events covered")
                TeamScoreboardMetric(
                    value: totals.recordLabel,
                    label: "Team record",
                    detail: totals.winRateLabel
                )
                TeamScoreboardMetric(value: "\(totals.eventCredits)", label: "Work credits")
                TeamScoreboardMetric(value: "\(totals.contributors)", label: "Contributors")
            }

            Text("\(totals.games) resolved \(totals.games == 1 ? "game" : "games") · \(totals.gameCredits) person-game credits")
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .padding(.vertical, 4)
    }
}

private struct TeamScoreboardMetric: View {
    let value: String
    let label: String
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let detail {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TeamScoreboardPersonRow: View {
    let rank: Int
    let person: TeamScoreboardPerson
    let metrics: TeamScoreboardLeaderboardMetrics
    let rankBy: TeamScoreboardRank
    let minimumRateGames: Int

    private var rateDetail: String {
        if rankBy == .rate, metrics.games < minimumRateGames {
            return "Needs \(minimumRateGames) games"
        }
        return metrics.winRateLabel
    }

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(rank <= 3 ? Color.statusBackground(rank == 1 ? .orange : .blue) : Color.clear)
                if rank == 1 {
                    Image(systemName: "trophy.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(.orange))
                } else {
                    Text("\(rank)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(rank <= 3 ? Color.statusText(.blue) : .secondary)
                }
            }
            .frame(width: 30, height: 30)
            .accessibilityLabel("Rank \(rank)")

            UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(person.name)
                    .font(.gothamBold(size: 16))
                    .lineLimit(1)
                Text("\(metrics.eventsWorked) \(metrics.eventsWorked == 1 ? "event" : "events") · \(metrics.recordLabel) record")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            Spacer(minLength: 8)

            Text(rateDetail)
                .font(.caption.weight(.semibold))
                .foregroundStyle(metrics.games >= minimumRateGames ? .primary : .secondary)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens \(person.name)’s shared Scoreboard")
    }
}

private struct TeamScoreboardBreakdownRow: View {
    let breakdown: TeamScoreboardBreakdown
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(breakdown.label)
                    .font(.subheadline.weight(.semibold))
                Text("\(breakdown.eventsCovered) covered · \(breakdown.eventCredits) work credits · \(breakdown.contributors) people")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(breakdown.recordLabel)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                Text(breakdown.winRateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color.statusText(.blue))
                    .accessibilityLabel("Selected")
            }
        }
        .contentShape(Rectangle())
        .padding(.vertical, 2)
    }
}

private struct TeamScoreboardLoadingView: View {
    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Loading the team Scoreboard…")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 96, alignment: .center)
            }

            Section("Leaderboard") {
                ForEach(0..<5, id: \.self) { _ in
                    HStack(spacing: 10) {
                        Circle().fill(Color.secondary.opacity(0.12)).frame(width: 30, height: 30)
                        Circle().fill(Color.secondary.opacity(0.12)).frame(width: 38, height: 38)
                        RoundedRectangle(cornerRadius: 5)
                            .fill(Color.secondary.opacity(0.12))
                            .frame(height: 14)
                    }
                    .redacted(reason: .placeholder)
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityLabel("Loading Scoreboard")
    }
}
