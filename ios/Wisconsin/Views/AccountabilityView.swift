import SwiftUI

struct AccountabilityPersonRoute: Hashable {
    let userId: String
}

@MainActor
@Observable
final class AccountabilityListModel {
    var report: AccountabilityReport?
    var scope: AccountabilityScope = .thisYear
    var sort: AccountabilitySort = .events
    var isLoading = false
    var error: String?
    private(set) var loadedKey: String?

    @ObservationIgnored private var loads = LatestRequestGeneration()

    var requestKey: String { "\(scope.rawValue)|\(sort.rawValue)" }

    var visibleReport: AccountabilityReport? {
        guard loadedKey == requestKey else { return nil }
        return report
    }

    func load(force: Bool) async {
        let key = requestKey
        if !force, loadedKey == key, report != nil { return }
        let token = loads.begin()
        let requestedScope = scope
        let requestedSort = sort
        isLoading = true
        defer {
            if loads.owns(token) { isLoading = false }
        }
        do {
            let next = try await APIClient.shared.accountabilityReport(
                scope: requestedScope,
                sort: requestedSort
            )
            guard loads.owns(token), requestKey == key, !Task.isCancelled else { return }
            report = next
            loadedKey = key
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), requestKey == key, !Task.isCancelled else { return }
            if let previous = loadedKey, previous != key {
                self.error = "\(error.localizedDescription) The list is unchanged."
                restore(previous)
            } else {
                self.error = error.localizedDescription
            }
        }
    }

    private func restore(_ key: String) {
        let parts = key.split(separator: "|", maxSplits: 1).map(String.init)
        guard parts.count == 2,
              let scope = AccountabilityScope(rawValue: parts[0]),
              let sort = AccountabilitySort(rawValue: parts[1])
        else { return }
        self.scope = scope
        self.sort = sort
    }
}

struct AccountabilityView: View {
    var wrapsInNavigationStack = true

    @State private var navigationPath = NavigationPath()
    @State private var model = AccountabilityListModel()
    @State private var nameQuery = ""
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session

    var body: some View {
        if wrapsInNavigationStack {
            NavigationStack(path: $navigationPath) {
                configuredContent
            }
        } else {
            configuredContent
        }
    }

    private var configuredContent: some View {
        content
            .navigationTitle("Accountability")
            .searchable(text: $nameQuery, prompt: "Search names")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort", selection: sortBinding) {
                            ForEach(AccountabilitySort.allCases) { sort in
                                Text(sort.label).tag(sort)
                            }
                        }
                        Picker("Year", selection: scopeBinding) {
                            ForEach(AccountabilityScope.allCases) { scope in
                                Text(scope.label).tag(scope)
                            }
                        }
                    } label: {
                        Label(model.sort.label, systemImage: "line.3.horizontal.decrease")
                    }
                    .accessibilityLabel("List, \(model.sort.label), \(model.scope.label)")
                }
            }
            .task(id: model.requestKey) {
                await model.load(force: false)
            }
            .navigationDestination(for: AccountabilityPersonRoute.self) { route in
                AccountabilityPersonView(userId: route.userId, model: model)
            }
            .navigationDestination(for: BookingRouteId.self) { route in
                BookingDetailView(bookingId: route.id)
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 2 else { return }
                navigationPath = NavigationPath()
            }
    }

    private var sortBinding: Binding<AccountabilitySort> {
        Binding(get: { model.sort }, set: { model.sort = $0 })
    }

    private var scopeBinding: Binding<AccountabilityScope> {
        Binding(get: { model.scope }, set: { model.scope = $0 })
    }

    @ViewBuilder
    private var content: some View {
        if let report = model.visibleReport {
            list(report)
        } else if model.isLoading {
            ProgressView("Loading accountability")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView {
                Label("Couldn't load accountability", systemImage: "clock.badge.exclamationmark")
            } description: {
                Text(model.error ?? "The late-return list is unavailable right now.")
            } actions: {
                Button("Try again") { Task { await model.load(force: true) } }
            }
        }
    }

    private func list(_ report: AccountabilityReport) -> some View {
        let shown = report.matching(nameQuery)
        let trimmedQuery = nameQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        return List {
            if let error = model.error {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("Try again") { Task { await model.load(force: true) } }
                    }
                }
            }

            if !report.leaderboard.isEmpty {
                Section {
                    standingRow(in: report)
                } footer: {
                    summary(report.metrics)
                }
            }

            Section {
                if report.leaderboard.isEmpty {
                    Text(model.scope == .thisYear
                        ? "No late returns in this academic year."
                        : "No late returns on record.")
                        .foregroundStyle(.secondary)
                } else if shown.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No one named “\(trimmedQuery)” is on this list.")
                            .foregroundStyle(.secondary)
                        Button("Clear search") { nameQuery = "" }
                    }
                } else {
                    ForEach(shown) { person in
                        NavigationLink(value: AccountabilityPersonRoute(userId: person.userId)) {
                            AccountabilityRankRow(
                                person: person,
                                rank: report.rank(of: person.userId) ?? 0,
                                sort: model.sort,
                                isYou: person.userId == session.currentUser?.id
                            )
                        }
                    }
                }
            } header: {
                Text(report.scopeTitle)
            }

            if report.truncated == true {
                Section {
                    Text("Older history was left out of this list.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Text(report.methodology.graceSentence)
                ForEach(Array(report.notes.enumerated()), id: \.offset) { _, line in
                    Text(line)
                }
                if session.currentUser?.role == "ADMIN" {
                    Text("Export and taking a checkout off this list stay on the website.")
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .listStyle(.insetGrouped)
        .refreshable { await model.load(force: true) }
    }

    @ViewBuilder
    private func standingRow(in report: AccountabilityReport) -> some View {
        if let userId = session.currentUser?.id,
           let person = report.person(userId),
           let rank = report.rank(of: userId) {
            NavigationLink(value: AccountabilityPersonRoute(userId: person.userId)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("You are \(accountabilityOrdinal(rank))")
                        .font(.body.weight(.semibold))
                    standingDetail(person)
                        .font(.subheadline)
                }
            }
            .accessibilityLabel("You are \(accountabilityOrdinal(rank)). \(standingAccessibility(person))")
        } else {
            Text("You are not on this list.")
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func standingDetail(_ person: AccountabilityPerson) -> some View {
        let late = person.lateEventCount == 1 ? "1 late return" : "\(person.lateEventCount) late returns"
        if let stillOut = person.stillOutLabel {
            Text(late).foregroundStyle(.secondary)
                + Text(" · ").foregroundStyle(.secondary)
                + Text(stillOut).foregroundStyle(Color.statusText(.red))
        } else {
            Text(late).foregroundStyle(.secondary)
        }
    }

    private func standingAccessibility(_ person: AccountabilityPerson) -> String {
        var parts = [person.lateEventCount == 1 ? "1 late return" : "\(person.lateEventCount) late returns"]
        if let stillOut = person.stillOutLabel { parts.append(stillOut) }
        return parts.joined(separator: ", ")
    }

    private func summary(_ metrics: AccountabilityMetrics) -> some View {
        Text(metrics.peoplePhrase + " · ")
            + Text(metrics.stillOutPhrase)
                .foregroundStyle(metrics.activeOverdue > 0 ? Color.statusText(.red) : Color.secondary)
            + Text(" · " + metrics.latePhrase)
    }
}

private struct AccountabilityRankRow: View {
    let person: AccountabilityPerson
    let rank: Int
    let sort: AccountabilitySort
    let isYou: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("\(rank)")
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(minWidth: 28, alignment: .trailing)

            UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: 36)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(person.name)
                        .font(.body.weight(.semibold))
                        .lineLimit(2)
                    if isYou {
                        Text("You")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if !person.active {
                        StatusPill(label: "Inactive", tone: .gray)
                    }
                }
                subtitle
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(trailing)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    @ViewBuilder
    private var subtitle: some View {
        HStack(spacing: 0) {
            Text(quietSubtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let stillOut = person.stillOutLabel {
                Text(quietSubtitle.isEmpty ? stillOut : " · \(stillOut)")
                    .font(.subheadline)
                    .foregroundStyle(Color.statusText(.red))
            }
        }
    }

    private var quietSubtitle: String {
        var parts: [String] = []
        if let area = person.areaLabel { parts.append(area) }
        parts.append(person.onTimeLabel)
        return parts.joined(separator: " · ")
    }

    private var trailing: String {
        switch sort {
        case .events:
            person.lateEventCount == 1 ? "1 late" : "\(person.lateEventCount) late"
        case .time:
            accountabilityLateDuration(person.totalLateHours)
        case .recent:
            accountabilityRelativeIncident(person.lastIncidentAt)
        }
    }

    private var accessibilityText: String {
        var parts = ["\(rank)", person.name]
        if isYou { parts.append("you") }
        if !person.active { parts.append("inactive") }
        if let area = person.areaLabel { parts.append(area) }
        parts.append(person.onTimeLabel)
        if let stillOut = person.stillOutLabel { parts.append(stillOut) }
        parts.append(trailing)
        return parts.joined(separator: ", ")
    }
}
