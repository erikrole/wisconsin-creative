import SwiftUI

enum ScoreboardResultFilter: String, CaseIterable, Hashable {
    case all
    case wins = "WIN"
    case losses = "LOSS"
    case ties = "TIE"

    var title: String {
        switch self {
        case .all: "All"
        case .wins: "Wins"
        case .losses: "Losses"
        case .ties: "Ties"
        }
    }

    var apiValue: String? {
        self == .all ? nil : rawValue
    }
}

/// Home, away, and neutral are a fixed, complete set, so unlike sport these
/// options never have to be read back out of a response.
enum ScoreboardSiteFilter: String, CaseIterable, Hashable, Identifiable {
    case all
    case home = "HOME"
    case away = "AWAY"
    case neutral = "NEUTRAL"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All sites"
        case .home: "Home"
        case .away: "Away"
        case .neutral: "Neutral"
        }
    }

    var symbol: String {
        switch self {
        case .all: "map"
        case .home: "house.fill"
        case .away: "car.fill"
        case .neutral: "flag.fill"
        }
    }

    var apiValue: String? { self == .all ? nil : rawValue }
}

/// Which dimension the breakdown card is showing. The route sends all four at
/// once; stacking all four as separate tables made the middle of the screen
/// four identical objects the reader had to scroll past to reach their games.
enum ScoreboardDimension: String, CaseIterable, Hashable, Identifiable {
    case sport, opponent, site, venue

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sport: "Sport"
        case .opponent: "Opponent"
        case .site: "Site"
        case .venue: "Venue"
        }
    }

    /// What an empty table means for this dimension, in the reader's terms. A
    /// filtered view is empty because of the filter, not because the season has
    /// nothing in it -- saying "yet" there would be wrong.
    func emptyLabel(isFiltered: Bool) -> String {
        if isFiltered { return "No games match these filters." }
        switch self {
        case .sport: return "No sports with a resolved game yet."
        case .opponent: return "No opponents with a resolved game yet."
        case .site: return "No home, away, or neutral games yet."
        case .venue: return "No venues with a resolved game yet."
        }
    }

    func rows(in scoreboard: UserScoreboard) -> [ScoreboardBucket] {
        switch self {
        case .sport: scoreboard.bySport
        case .opponent: scoreboard.byOpponent
        case .site: scoreboard.bySite
        case .venue: scoreboard.byVenue
        }
    }
}

/// Native read-only presentation of the profile Scoreboard API. The screen is
/// deliberately independent from Profile/User Detail loading so a missing or
/// rolling-out scoreboard route cannot blank the rest of a profile.
struct ScoreboardView: View {
    let userId: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var scoreboard: UserScoreboard?
    @State private var events: [ScoreboardEvent] = []
    @State private var nextOffset: Int?
    @State private var resultFilter: ScoreboardResultFilter = .all
    @State private var sportCode: String?
    @State private var siteFilter: ScoreboardSiteFilter = .all
    /// Sport choices held from an unfiltered read. The route filters its own
    /// breakdowns, so reading the options out of the current response left the
    /// picker offering only the sport already chosen -- a filter you could not
    /// move off without clearing it first.
    @State private var sportMenuOptions: [ScoreboardBucket] = []
    /// Resolved games in the whole season, kept from an unfiltered read. A
    /// filtered response only knows its own subtotal, and the hero has to be
    /// able to say what fraction of the season the reader is looking at.
    @State private var seasonResolvedGames: Int?
    @State private var dimension: ScoreboardDimension = .sport
    @State private var showsAllBreakdownRows = false
    @State private var isLoading = true
    @State private var isLoadingMore = false
    @State private var error: String?
    @State private var loadMoreError: String?
    @State private var tapFeedback = false

    private let pageSize = 25

    private var queryKey: String {
        "\(userId)|\(resultFilter.rawValue)|\(sportCode ?? "all")|\(siteFilter.rawValue)"
    }

    private var hasFilters: Bool {
        resultFilter != .all || sportCode != nil || siteFilter != .all
    }

    var body: some View {
        Group {
            if isLoading && scoreboard == nil {
                ScoreboardSkeleton()
            } else if let error, scoreboard == nil {
                ScoreboardErrorView(message: error, retry: { Task { await load(resetEvents: true) } })
            } else if let scoreboard {
                ScrollView {
                    // Lazy so a season paged out to a hundred games only builds
                    // the rows that are on screen.
                    LazyVStack(spacing: Brand.Space.md) {
                        ScoreboardSeasonCard(
                            scoreboard: scoreboard,
                            games: events,
                            // A run of results only means something when every
                            // result is eligible; under a Wins filter "last five"
                            // is five wins by construction.
                            showsForm: resultFilter == .all,
                            isFiltered: hasFilters,
                            seasonResolvedGames: seasonResolvedGames
                        )

                        // Orientation, not analysis: once the reader has narrowed
                        // to one sport or one result, they are past the point
                        // these three facts help with.
                        if !hasFilters, !scoreboard.highlights.isEmpty {
                            ScoreboardHighlightsCard(highlights: scoreboard.highlights)
                        }

                        ScoreboardFilterBar(
                            resultFilter: $resultFilter,
                            sportCode: $sportCode,
                            siteFilter: $siteFilter,
                            sportOptions: sportMenuOptions,
                            reduceMotion: reduceMotion,
                            onChange: { tapFeedback.toggle() }
                        )

                        if let error {
                            ScoreboardInlineNotice(
                                message: error,
                                retry: { Task { await load(resetEvents: true) } }
                            )
                        }

                        ScoreboardBreakdownCard(
                            scoreboard: scoreboard,
                            isFiltered: hasFilters,
                            dimension: $dimension,
                            showsAllRows: $showsAllBreakdownRows,
                            reduceMotion: reduceMotion,
                            onChange: { tapFeedback.toggle() }
                        )

                        ScoreboardGamesCard(
                            games: events,
                            total: scoreboard.eventCount,
                            hasMore: nextOffset != nil,
                            hasFilters: hasFilters,
                            isBusy: isLoading || isLoadingMore,
                            error: loadMoreError,
                            loadMore: { Task { await loadMore() } },
                            clearFilters: clearFilters
                        )
                    }
                    .padding(.horizontal, Brand.Space.md)
                    .padding(.vertical, Brand.Space.sm)
                }
                .background(Color(.systemGroupedBackground))
            }
        }
        .navigationTitle("Scoreboard")
        .navigationBarTitleDisplayMode(.inline)
        // Nothing on a read-only record is destructive or urgent, and this
        // screen is pushed from two stacks with different tints -- Clear filters
        // rendered brand red from the Users side. `docs/COLOR_SYSTEM.md` keeps
        // red for custody and error meaning, so the controls here stay neutral.
        .tint(.primary)
        .task {
            // Its own surface in the usage counts: the Scoreboard is reached
            // from two places and folding it into "users" would hide both.
            await APIClient.shared.recordProductEvent(eventName: "surface_viewed", surface: "scoreboard")
        }
        .task(id: queryKey) { await load(resetEvents: true) }
        .refreshable { await load(resetEvents: true) }
    }

    private func clearFilters() {
        tapFeedback.toggle()
        if reduceMotion {
            resultFilter = .all
            sportCode = nil
            siteFilter = .all
        } else {
            withAnimation(.snappy(duration: 0.18)) {
                resultFilter = .all
                sportCode = nil
                siteFilter = .all
            }
        }
    }

    private func load(resetEvents: Bool) async {
        let requestKey = queryKey
        let wasUnfiltered = !hasFilters
        if resetEvents {
            isLoading = true
            error = nil
            loadMoreError = nil
        }
        defer {
            if resetEvents, requestKey == queryKey {
                isLoading = false
            }
        }

        let offset = resetEvents ? 0 : (nextOffset ?? 0)
        do {
            let fetched = try await APIClient.shared.scoreboard(
                userId: userId,
                sportCode: sportCode,
                result: resultFilter.apiValue,
                site: siteFilter.apiValue,
                limit: pageSize,
                offset: offset
            )
            // "Show more" runs outside the task that owns the filter key, so a
            // filter changed mid-flight would otherwise append the old query's
            // games to the new query's list.
            guard !Task.isCancelled, requestKey == queryKey else { return }
            if resetEvents {
                self.scoreboard = fetched
                events = fetched.events
                showsAllBreakdownRows = false
                if wasUnfiltered {
                    sportMenuOptions = fetched.bySport.filter { $0.key != nil }
                    seasonResolvedGames = fetched.summary.games
                }
                error = nil
            } else {
                // Offset paging over live data can repeat a row when the season
                // changes between pages, and a repeated id breaks the list.
                let known = Set(events.map(\.id))
                events.append(contentsOf: fetched.events.filter { !known.contains($0.id) })
                loadMoreError = nil
            }
            nextOffset = fetched.nextOffset
        } catch is CancellationError {
            return
        } catch APIError.unauthorized {
            // SessionStore owns the global login transition after a 401.
            return
        } catch {
            guard !Task.isCancelled, requestKey == queryKey else { return }
            if resetEvents {
                self.error = error.localizedDescription
            } else {
                loadMoreError = error.localizedDescription
            }
        }
    }

    private func loadMore() async {
        guard nextOffset != nil, !isLoading, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        await load(resetEvents: false)
    }
}

/// The Scoreboard entry on a teammate's profile, which is a card stack rather
/// than a list and so carries its own chevron. The destination is the same
/// read-only screen the current user reaches from their own profile row.
struct ScoreboardLinkCard: View {
    let userId: String

    var body: some View {
        NavigationLink {
            ScoreboardView(userId: userId)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(Color.statusBackground(.orange))
                    Image(systemName: "trophy.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.statusText(.orange))
                }
                .frame(width: 38, height: 38)
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Scoreboard")
                        .font(.subheadline.weight(.semibold))
                    Text(ScoreboardLink.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
            .accessibilityHint(ScoreboardLink.hint)
            .padding(Brand.Space.md)
        }
        .buttonStyle(.plain)
        .brandCard(padding: 0)
    }
}

/// Entry copy shared by both profile surfaces. The season itself is server-owned
/// and only known once the screen loads, so neither entry names a year that
/// would go stale the moment the scope moves on.
enum ScoreboardLink {
    static let subtitle = "Season record, events worked, and venue history"
    static let hint = "Opens the season record"
}

// MARK: - Season card

/// The hero: the record, the shape of it, and how the season's two different
/// totals relate. Everything else on the screen is a way of asking this card
/// a narrower question.
private struct ScoreboardSeasonCard: View {
    let scoreboard: UserScoreboard
    let games: [ScoreboardEvent]
    let showsForm: Bool
    let isFiltered: Bool
    let seasonResolvedGames: Int?

    private var summary: ScoreboardSummary { scoreboard.summary }

    private var form: [ScoreboardEvent] { ScoreboardDigest.form(games) }

    private var streak: ScoreboardStreak? { ScoreboardDigest.streak(games) }

    /// Events worked counts every event with an active assignment; the record
    /// counts only the ones that finished with a result. Two different numbers
    /// that used to sit side by side as if they were the same kind of thing --
    /// and under a filter they are not even measuring the same set, so the
    /// filtered sentence says which is which rather than joining them.
    private var totalsSentence: String {
        let worked = summary.eventsWorked
        let events = worked == 1 ? "1 event" : "\(worked) events"
        if isFiltered {
            let shown = summary.games == 1 ? "1 game" : "\(summary.games) games"
            guard let seasonResolvedGames else {
                return "Filtered to \(shown). Events worked counts all \(worked) this season."
            }
            return "Filtered to \(shown) of the season's \(seasonResolvedGames) resolved. "
                + "Events worked counts all \(worked)."
        }
        if summary.games == 0 {
            return "\(events) worked this season, none with a recorded result yet."
        }
        return "\(events) worked this season, \(summary.games) with a recorded result."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.md) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(scoreboard.scope.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.8)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(summary.recordLabel)
                            .font(.gothamBlack(size: 36))
                            .monospacedDigit()
                        Text("record")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(summary.winRateLabel)
                        .font(.title3.weight(.semibold))
                        .monospacedDigit()
                    Text("Win rate")
                        .font(.caption2.weight(.semibold))
                        .tracking(0.5)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(
                "\(scoreboard.scope.label), \(summary.recordLabel) record, \(summary.winRateLabel) win rate"
            )

            ScoreboardRecordMeter(wins: summary.wins, losses: summary.losses, ties: summary.ties)

            if showsForm, !form.isEmpty {
                Divider()
                ScoreboardFormStrip(games: form, streak: streak)
            }

            Text(totalsSentence)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .brandCard()
    }
}

/// The record as a proportion. The W–L–T bar mirrors the record label so the
/// tie segment stays in the same place as the tie count.
private struct ScoreboardRecordMeter: View {
    let wins: Int
    let losses: Int
    let ties: Int

    private var games: Int { wins + losses + ties }
    private var segmentCount: Int { [wins, losses, ties].filter { $0 > 0 }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { geo in
                HStack(spacing: segmentCount > 1 ? 3 : 0) {
                    if wins > 0 {
                        Capsule()
                            .fill(Color.chartFill(.available).gradient)
                            .frame(width: width(for: wins, in: geo.size.width))
                    }
                    if losses > 0 {
                        Capsule()
                            .fill(Color.chartFill(.problem).gradient)
                            .frame(width: width(for: losses, in: geo.size.width))
                    }
                    if ties > 0 {
                        Capsule()
                            .fill(Color.chartFill(.waiting).gradient)
                            .frame(width: width(for: ties, in: geo.size.width))
                    }
                    if games == 0 {
                        Capsule().fill(Color.primary.opacity(0.07))
                    }
                }
            }
            .frame(height: 10)

            HStack(spacing: 8) {
                ScoreboardMeterKey(count: wins, noun: "win", role: .available)
                Spacer(minLength: 8)
                ScoreboardMeterKey(count: losses, noun: "loss", plural: "losses", role: .problem)
                Spacer(minLength: 8)
                ScoreboardMeterKey(count: ties, noun: "tie", role: .waiting)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(games == 0
            ? "No resolved games yet"
            : "\(wins) wins, \(losses) losses, and \(ties) ties across \(games) games")
    }

    /// Segment widths preserve the true result proportions while accounting for
    /// the small gutters between visible segments.
    private func width(for count: Int, in total: CGFloat) -> CGFloat {
        guard games > 0, total > 0 else { return 0 }
        let gutter: CGFloat = segmentCount > 1 ? CGFloat(segmentCount - 1) * 3 : 0
        let usable = max(total - gutter, 0)
        return usable * CGFloat(count) / CGFloat(games)
    }
}

private struct ScoreboardMeterKey: View {
    let count: Int
    let noun: String
    var plural: String?
    let role: ChartRole

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color.chartFill(role))
                .frame(width: 7, height: 7)
            Text("\(count) \(count == 1 ? noun : (plural ?? noun + "s"))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .accessibilityHidden(true)
    }
}

/// Recent form, newest first — the question anyone with a record actually asks
/// next, and one the route's own ordering already answers.
private struct ScoreboardFormStrip: View {
    let games: [ScoreboardEvent]
    let streak: ScoreboardStreak?

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Last \(games.count)")
                    .font(.caption2.weight(.semibold))
                    .tracking(0.5)
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                if let streak {
                    Text(streak.label)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.statusText(streak.tone))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 5) {
                ForEach(games) { game in
                    Text(game.resultLabel)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.statusText(game.isWin ? .green : game.isTie ? .orange : .red))
                        .frame(width: 22, height: 22)
                        .background(
                            Color.statusBackground(game.isWin ? .green : game.isTie ? .orange : .red),
                            in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                        )
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(formAccessibilityLabel)
    }

    private var formAccessibilityLabel: String {
        let results = games.map(\.resultName).joined(separator: ", ")
        guard let streak else { return "Last \(games.count) games, newest first: \(results)" }
        return "Last \(games.count) games, newest first: \(results). \(streak.label)."
    }
}

// MARK: - Highlights

private struct ScoreboardHighlightsCard: View {
    let highlights: [ScoreboardHighlight]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(highlights.enumerated()), id: \.element.id) { index, highlight in
                if index > 0 {
                    Divider().frame(height: 38)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(highlight.label)
                        .font(.caption2.weight(.semibold))
                        .tracking(0.5)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .lineLimit(1)
                    // One line, so the three tiles keep a shared baseline. A
                    // wrapped venue name pushed its own detail row out of step
                    // with the two beside it.
                    Text(highlight.value)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .truncationMode(.tail)
                    Text(highlight.detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .lineLimit(1)
                }
                .padding(.horizontal, index == 0 ? 0 : Brand.Space.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(highlight.label): \(highlight.value), \(highlight.detail)")
            }
        }
        .brandCard()
    }
}

// MARK: - Filters

/// The route applies both filters to its breakdowns as well as its game list.
/// What that means for the numbers is said once, in the season card, next to the
/// numbers it qualifies -- not in a second note down here.
private struct ScoreboardFilterBar: View {
    @Binding var resultFilter: ScoreboardResultFilter
    @Binding var sportCode: String?
    @Binding var siteFilter: ScoreboardSiteFilter
    let sportOptions: [ScoreboardBucket]
    let reduceMotion: Bool
    let onChange: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            Picker("Result", selection: $resultFilter) {
                ForEach(ScoreboardResultFilter.allCases, id: \.self) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Filter scoreboard results")
            .onChange(of: resultFilter) { _, _ in onChange() }

            // A visible strip rather than a dropdown: the sports a person works
            // are few, and a menu hid both the options and which one was on.
            if !sportOptions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        FilterChip(
                            label: "All sports",
                            systemImage: "square.grid.2x2",
                            isOn: sportCode == nil,
                            tone: .blue
                        ) {
                            select(nil)
                        }
                        ForEach(sportOptions) { sport in
                            FilterChip(
                                label: sport.label,
                                isOn: sportCode == sport.key,
                                tone: .blue
                            ) {
                                select(sport.key)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .scrollClipDisabled()
            }

            // The site breakdown already sits below this bar; this is the
            // control that row invites -- "how do they do on the road".
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ScoreboardSiteFilter.allCases) { option in
                        FilterChip(
                            label: option.title,
                            systemImage: option.symbol,
                            isOn: siteFilter == option,
                            tone: .blue
                        ) {
                            select(site: option)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollClipDisabled()
            .accessibilityLabel("Filter scoreboard site")
        }
        .brandCard(padding: Brand.Space.sm)
    }

    private func select(_ code: String?) {
        guard sportCode != code else { return }
        onChange()
        if reduceMotion {
            sportCode = code
        } else {
            withAnimation(.snappy(duration: 0.18)) { sportCode = code }
        }
    }

    private func select(site option: ScoreboardSiteFilter) {
        guard siteFilter != option else { return }
        onChange()
        if reduceMotion {
            siteFilter = option
        } else {
            withAnimation(.snappy(duration: 0.18)) { siteFilter = option }
        }
    }
}

// MARK: - Breakdown

private struct ScoreboardBreakdownCard: View {
    let scoreboard: UserScoreboard
    let isFiltered: Bool
    @Binding var dimension: ScoreboardDimension
    @Binding var showsAllRows: Bool
    let reduceMotion: Bool
    let onChange: () -> Void

    /// Long seasons produce long opponent and venue tables. Five rows answer
    /// the question; the rest are there when asked for.
    private let collapsedRowCount = 5

    private var rows: [ScoreboardBucket] { dimension.rows(in: scoreboard) }

    private var visibleRows: [ScoreboardBucket] {
        showsAllRows ? rows : Array(rows.prefix(collapsedRowCount))
    }

    private var maxGames: Int { rows.map(\.games).max() ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Picker("Breakdown", selection: $dimension) {
                ForEach(ScoreboardDimension.allCases) { option in
                    Text(option.title).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .padding(Brand.Space.sm)
            .accessibilityLabel("Breakdown dimension")
            .onChange(of: dimension) { _, _ in
                onChange()
                if showsAllRows {
                    if reduceMotion {
                        showsAllRows = false
                    } else {
                        withAnimation(.snappy(duration: 0.18)) { showsAllRows = false }
                    }
                }
            }

            Divider()

            if rows.isEmpty {
                Text(dimension.emptyLabel(isFiltered: isFiltered))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(Brand.Space.md)
            } else {
                ForEach(visibleRows) { row in
                    ScoreboardBreakdownRow(row: row, maxGames: maxGames)
                    if row.id != visibleRows.last?.id {
                        Divider().padding(.leading, Brand.Space.md)
                    }
                }

                if rows.count > collapsedRowCount {
                    Divider()
                    Button {
                        onChange()
                        if reduceMotion {
                            showsAllRows.toggle()
                        } else {
                            withAnimation(.snappy(duration: 0.2)) { showsAllRows.toggle() }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(showsAllRows ? "Show fewer" : "Show all \(rows.count)")
                                .font(.caption.weight(.semibold))
                            Image(systemName: showsAllRows ? "chevron.up" : "chevron.down")
                                .font(.caption2.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(padding: 0)
    }
}

private struct ScoreboardBreakdownRow: View {
    let row: ScoreboardBucket
    let maxGames: Int

    var body: some View {
        HStack(alignment: .center, spacing: Brand.Space.sm) {
            VStack(alignment: .leading, spacing: 7) {
                Text(row.label)
                    .font(.subheadline)
                    .lineLimit(1)
                    .truncationMode(.tail)
                // Length is how much of the season this row is; the split
                // inside it is how that went. One mark, both questions.
                ScoreboardBucketBar(wins: row.wins, losses: row.losses, ties: row.ties, maxGames: maxGames)
            }
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.recordLabel)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                Text(row.winRateLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .frame(width: 58, alignment: .trailing)
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.label), \(row.recordLabel), \(row.gamesLabel), \(row.winRateLabel) win rate")
    }
}

private struct ScoreboardBucketBar: View {
    let wins: Int
    let losses: Int
    let ties: Int
    let maxGames: Int

    private var games: Int { wins + losses + ties }

    var body: some View {
        GeometryReader { geo in
            let scale = maxGames > 0 ? CGFloat(games) / CGFloat(maxGames) : 0
            let filled = max(geo.size.width * scale, games > 0 ? 6 : 0)
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.06))
                HStack(spacing: 0) {
                    if wins > 0 {
                        Rectangle().fill(Color.chartFill(.available))
                            .frame(width: filled * CGFloat(wins) / CGFloat(max(games, 1)))
                    }
                    if losses > 0 {
                        Rectangle().fill(Color.chartFill(.problem))
                            .frame(width: filled * CGFloat(losses) / CGFloat(max(games, 1)))
                    }
                    if ties > 0 {
                        Rectangle().fill(Color.chartFill(.waiting))
                            .frame(width: filled * CGFloat(ties) / CGFloat(max(games, 1)))
                    }
                }
                .clipShape(Capsule())
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

// MARK: - Games

private struct ScoreboardGamesCard: View {
    let games: [ScoreboardEvent]
    let total: Int
    let hasMore: Bool
    let hasFilters: Bool
    let isBusy: Bool
    let error: String?
    let loadMore: () -> Void
    let clearFilters: () -> Void

    private var months: [ScoreboardMonth] { ScoreboardDigest.months(games) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Label("Worked events", systemImage: "calendar")
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                if isBusy {
                    ProgressView().controlSize(.small)
                } else if !games.isEmpty {
                    Text(showingLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            .padding(Brand.Space.md)

            Divider()

            if games.isEmpty {
                ScoreboardGamesEmptyState(hasFilters: hasFilters, clearFilters: clearFilters)
            } else {
                ForEach(months) { month in
                    // A season reads by month. A flat list of forty games does
                    // not tell you when the busy stretch was.
                    Text(month.label)
                        .font(.caption2.weight(.semibold))
                        .tracking(0.5)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Brand.Space.md)
                        .padding(.vertical, 7)
                        .background(Color.primary.opacity(0.035))

                    ForEach(month.games) { game in
                        ScoreboardGameRow(game: game)
                        if game.id != month.games.last?.id {
                            Divider().padding(.leading, ScoreboardGameRow.copyInset)
                        }
                    }
                }

                if hasMore {
                    Divider()
                    VStack(spacing: 6) {
                        Button(isBusy ? "Loading…" : "Show more events", action: loadMore)
                            .font(.caption.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                            .disabled(isBusy)
                        if let error {
                            Text(error)
                                .font(.caption2)
                                .foregroundStyle(Color.statusText(.red))
                                .multilineTextAlignment(.center)
                                .padding(.bottom, Brand.Space.sm)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard(padding: 0)
    }

    private var showingLabel: String {
        games.count >= total ? "\(games.count)" : "\(games.count) of \(total)"
    }
}

private struct ScoreboardGamesEmptyState: View {
    let hasFilters: Bool
    let clearFilters: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: hasFilters ? "line.3.horizontal.decrease.circle" : "trophy")
                .font(.title3)
                .foregroundStyle(.tertiary)
            Text(hasFilters ? "No games match these filters" : "No worked events on record")
                .font(.subheadline.weight(.semibold))
            Text(hasFilters
                ? "Try another result, sport, or site filter."
                : "Completed events will appear here when this person has worked them.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if hasFilters {
                Button("Clear filters", action: clearFilters)
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 28)
    }
}

private struct ScoreboardGameRow: View {
    let game: ScoreboardEvent

    private static let resultColumnWidth: CGFloat = 46
    private static let columnSpacing: CGFloat = 12
    /// Where the matchup copy starts, so row dividers line up under it.
    static let copyInset: CGFloat = Brand.Space.md + resultColumnWidth + columnSpacing

    private var tone: StatusTone {
        if game.result == nil { return .gray }
        if game.isWin { return .green }
        if game.isTie { return .orange }
        return .red
    }

    var body: some View {
        HStack(alignment: .top, spacing: Self.columnSpacing) {
            VStack(spacing: 5) {
                Text(game.resultLabel)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color.statusText(tone))
                    .frame(width: 30, height: 30)
                    .background(Color.statusBackground(tone), in: Circle())
                    .overlay(
                        Circle().strokeBorder(Color.statusText(tone).opacity(0.22), lineWidth: 1)
                    )
                Text(game.dayLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .frame(width: Self.resultColumnWidth)

            VStack(alignment: .leading, spacing: 4) {
                Text(game.matchupLabel)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 5) {
                    Image(systemName: game.siteSymbol)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                    Text("\(game.siteLabel) · \(game.venueLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let areasLabel = game.areasLabel {
                    Text(areasLabel)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Brand.Space.md)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(game.resultName), \(game.matchupLabel), \(game.dayLabel), \(game.siteLabel), \(game.venueLabel)"
        )
    }
}

// MARK: - Loading and failure

/// The real layout in grey. A spinner on an empty screen says "wait"; this says
/// what is coming, and stops the card stack from popping into place.
private struct ScoreboardSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Brand.Space.md) {
                VStack(alignment: .leading, spacing: Brand.Space.md) {
                    Skeleton().frame(width: 120, height: 11)
                    Skeleton().frame(width: 148, height: 34)
                    Skeleton(cornerRadius: 5).frame(height: 10)
                    HStack {
                        Skeleton().frame(width: 64, height: 11)
                        Spacer()
                        Skeleton().frame(width: 64, height: 11)
                    }
                    Skeleton().frame(width: 240, height: 11)
                }
                .brandCard()

                HStack(spacing: Brand.Space.md) {
                    ForEach(0..<3, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: 6) {
                            Skeleton().frame(width: 56, height: 9)
                            Skeleton().frame(width: 74, height: 13)
                            Skeleton().frame(width: 44, height: 9)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .brandCard()

                VStack(spacing: 0) {
                    Skeleton(cornerRadius: 8).frame(height: 32).padding(Brand.Space.sm)
                    Divider()
                    ForEach(0..<4, id: \.self) { row in
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Skeleton().frame(width: 110, height: 13)
                                Spacer()
                                Skeleton().frame(width: 40, height: 13)
                            }
                            Skeleton(cornerRadius: 3).frame(height: 6)
                        }
                        .padding(.horizontal, Brand.Space.md)
                        .padding(.vertical, 11)
                        if row < 3 { Divider().padding(.leading, Brand.Space.md) }
                    }
                }
                .brandCard(padding: 0)
            }
            .padding(.horizontal, Brand.Space.md)
            .padding(.vertical, Brand.Space.sm)
        }
        .background(Color(.systemGroupedBackground))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct ScoreboardErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Scoreboard unavailable", systemImage: "trophy.fill")
        } description: {
            Text(message)
        } actions: {
            Button("Retry", action: retry)
                .buttonStyle(.borderedProminent)
        }
    }
}

private struct ScoreboardInlineNotice: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(Color.statusText(.orange))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Couldn't refresh Scoreboard")
                    .font(.subheadline.weight(.semibold))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button("Retry", action: retry)
                .font(.caption.weight(.semibold))
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(12)
        .background(Color.statusBackground(.orange), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
