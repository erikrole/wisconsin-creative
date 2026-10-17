import SwiftUI

@MainActor
@Observable
final class TeamBadgesModel {
    var definitions: [TeamBadgeDefinition] = []
    var disabled = false
    var isLoading = false
    var error: String?
    var searchText = ""

    private var loads = LatestRequestGeneration()

    var visibleBadges: [TeamBadgeDefinition] {
        definitions.filter { $0.matches(searchText) }
    }

    var showsCategory: Bool {
        Set(visibleBadges.map(\.categoryLabel)).count > 1
    }

    func load() async {
        let token = loads.begin()
        if definitions.isEmpty { isLoading = true }
        defer {
            if loads.owns(token) { isLoading = false }
        }
        do {
            let response = try await APIClient.shared.teamBadgeCatalog()
            guard loads.owns(token), !Task.isCancelled else { return }
            definitions = response.data
            disabled = response.disabled == true
            error = nil
        } catch is CancellationError {
            return
        } catch {
            guard loads.owns(token), !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

struct TeamBadgesView: View {
    var wrapsInNavigationStack = true

    @State private var model = TeamBadgesModel()

    var body: some View {
        screen
    }

    @ViewBuilder
    private var screen: some View {
        if wrapsInNavigationStack {
            NavigationStack { configured }
        } else {
            configured
        }
    }

    private var configured: some View {
        content
            .navigationTitle("Badges")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $model.searchText, prompt: "Search badges")
            .refreshable { await model.load() }
            .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        if model.isLoading, model.definitions.isEmpty {
            ProgressView("Loading badges")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.definitions.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load badges", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Try again") { Task { await model.load() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            catalog
        }
    }

    @ViewBuilder
    private var catalog: some View {
        List {
            if model.disabled {
                Section {
                    Text("Badges are turned off. Awards stay unavailable until they are turned back on.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                NavigationLink {
                    BadgeReportView()
                } label: {
                    Label("View report", systemImage: "chart.bar.xaxis")
                }
            } footer: {
                Text("Awarding a group stays on the web.")
            }

            if let error = model.error {
                Section {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Try again") { Task { await model.load() } }
                }
            }

            if showManualSection {
                Section {
                    if model.visibleBadges.isEmpty {
                        Text(emptyCopy)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.visibleBadges) { badge in
                            TeamBadgeCatalogRow(badge: badge, showsCategory: model.showsCategory)
                        }
                    }
                } header: {
                    Text("Manual badges")
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var showManualSection: Bool {
        let searching = !model.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return !model.disabled || !model.definitions.isEmpty || searching
    }

    private var emptyCopy: String {
        if !model.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "No badges match this search."
        }
        return "No badges are available to award."
    }
}

private struct TeamBadgeCatalogRow: View {
    let badge: TeamBadgeDefinition
    let showsCategory: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: BadgeArtwork.symbolName(for: badge.icon))
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.statusText(.purple))
                .frame(width: 36, height: 36)
                .background(Color.statusBackground(.purple), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(badge.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                if showsCategory {
                    Text(badge.categoryLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(badge.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
