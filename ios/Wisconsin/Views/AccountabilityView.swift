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
    @State private var showsEveryone = false
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
        let trimmedQuery = nameQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let searching = !trimmedQuery.isEmpty
        let everyone = showsEveryone || searching
        let shown = everyone ? report.matching(nameQuery) : report.repeatPeople
        let overdue = report.overdueNow()
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

            if !searching {
                if let record = yourRecord(in: report) {
                    Section("Your record") { record }
                }

                if !overdue.isEmpty {
                    Section("Overdue now") {
                        ForEach(overdue) { entry in
                            NavigationLink(value: BookingRouteId(id: entry.incident.bookingId)) {
                                AccountabilityOverdueRow(entry: entry)
                            }
                        }
                    }
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
                            AccountabilityPersonRow(
                                person: person,
                                sort: model.sort,
                                isYou: person.userId == session.currentUser?.id
                            )
                        }
                    }
                }
                if !searching, report.lateOnceCount > 0 {
                    Button(showsEveryone
                        ? "Show only repeat late returns"
                        : "Show \(report.lateOnceCount) \(report.lateOnceCount == 1 ? "person" : "people") late once") {
                        showsEveryone.toggle()
                    }
                }
            } header: {
                HStack {
                    Text(report.lateOnceCount == 0 && !report.leaderboard.contains { $0.lateEventCount >= 2 }
                        ? "Late returns"
                        : "Repeat late returns")
                    Spacer()
                    Text(report.scopeTitle)
                }
            } footer: {
                Text(report.methodology.graceSentence)
            }

            if report.truncated == true {
                Section {
                    Text("Older history was left out of this list.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

        }
        .listStyle(.insetGrouped)
        .refreshable { await model.load(force: true) }
    }

    /// Hidden when the viewer has no late returns in this list.
    private func yourRecord(in report: AccountabilityReport) -> AnyView? {
        guard let userId = session.currentUser?.id, let person = report.person(userId) else { return nil }
        return AnyView(
            NavigationLink(value: AccountabilityPersonRoute(userId: person.userId)) {
                Text(person.recordSummary)
            }
            .accessibilityLabel("Your record. \(person.recordSummary.replacingOccurrences(of: " · ", with: ", "))")
        )
    }
}

private struct AccountabilityOverdueRow: View {
    let entry: AccountabilityOverdueNow

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(entry.person.name)
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(entry.overdueLabel)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Color.statusText(.red))
            }
            Text(entry.incident.itemSummary.isEmpty ? entry.incident.title : entry.incident.itemSummary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(entry.person.name), \(entry.incident.title), \(entry.overdueLabel)")
    }
}

private struct AccountabilityPersonRow: View {
    let person: AccountabilityPerson
    let sort: AccountabilitySort
    let isYou: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    Text(person.name)
                        .font(.body.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(person.lateShortLabel)
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                    if isYou { Text("You").foregroundStyle(.secondary) }
                    if !person.active { StatusPill(label: "Inactive", tone: .gray) }
                    subtitle
                }
            } else {
                standardRow
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var standardRow: some View {
        HStack(alignment: .center, spacing: 12) {
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

            Text(person.lateShortLabel)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }

    @ViewBuilder
    private var subtitle: some View {
        if let stillOut = person.stillOutLabel {
            if let rest = quietSubtitle {
                Text("\(Text(stillOut).foregroundStyle(Color.statusText(.red))) · \(rest)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text(stillOut)
                    .font(.subheadline)
                    .foregroundStyle(Color.statusText(.red))
            }
        } else if let rest = quietSubtitle {
            Text(rest)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// On-time rate, plus the sort's own number when it is not the count shown at right.
    private var quietSubtitle: String? {
        var parts: [String] = []
        if let onTime = person.onTimePercentLabel { parts.append(onTime) }
        switch sort {
        case .events: break
        case .time: parts.append("\(accountabilityLateDuration(person.totalLateHours)) late in total")
        case .recent: parts.append("Last \(accountabilityRelativeIncident(person.lastIncidentAt))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var accessibilityText: String {
        var parts = [person.name]
        if isYou { parts.append("you") }
        if !person.active { parts.append("inactive") }
        parts.append(person.lateShortLabel)
        if let stillOut = person.stillOutLabel { parts.append(stillOut) }
        if let quiet = quietSubtitle { parts.append(quiet) }
        return parts.joined(separator: ", ")
    }
}
