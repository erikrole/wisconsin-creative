import SwiftUI

struct BrowseView: View {
    @State private var navigationPath = NavigationPath()
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var destinations: [BrowseDestination] {
        guard session.currentUser?.role == "COLLABORATOR" else {
            // Reports are staff analytics; the endpoints 403 anyone else, so the
            // row is hidden rather than offered and refused.
            return [.scoreboard, .items, .guides, .licenses, .users] + (isStaffOrAdmin ? [.reports] : [])
        }
        let capabilities = Set(session.currentUser?.capabilities ?? [])
        return [.scoreboard] + [
            capabilities.contains("GEAR_CATALOG_VIEW") ? .items : nil,
            capabilities.contains("PEOPLE_DIRECTORY_VIEW") ? .users : nil,
        ].compactMap { $0 }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                Section {
                    ForEach(destinations) { destination in
                        NavigationLink(value: destination) {
                            SettingsMenuRow(
                                title: destination.title,
                                subtitle: destination.subtitle,
                                systemImage: destination.systemImage,
                                tint: destination.tint
                            ) {
                                EmptyView()
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Browse")
            .navigationDestination(for: BrowseDestination.self) { destination in
                destinationView(for: destination)
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 2 else { return }
                navigationPath = NavigationPath()
            }
        }
    }

    @ViewBuilder
    private func destinationView(for destination: BrowseDestination) -> some View {
        switch destination {
        case .scoreboard:
            TeamScoreboardView(wrapsInNavigationStack: false)
        case .items:
            ItemsView(wrapsInNavigationStack: false)
        case .guides:
            GuidesView(wrapsInNavigationStack: false)
        case .licenses:
            LicensesView(wrapsInNavigationStack: false)
        case .users:
            UsersView(wrapsInNavigationStack: false)
        case .reports:
            ReportsView()
        }
    }
}

private enum BrowseDestination: String, CaseIterable, Hashable, Identifiable {
    case scoreboard
    case items
    case guides
    case licenses
    case users
    case reports

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scoreboard: "Scoreboard"
        case .items: "Items"
        case .guides: "Guides"
        case .licenses: "Licenses"
        case .users: "Users"
        case .reports: "Reports"
        }
    }

    var subtitle: String {
        switch self {
        case .scoreboard:
            "Team totals, sport breakdowns, and per-person leaderboards."
        case .items:
            "Find gear, item families, status, and availability."
        case .guides:
            "Read team reference docs, contacts, venue notes, and workflows."
        case .licenses:
            "Claim, copy, or return a Photo Mechanic license."
        case .users:
            "Find teammates, roles, titles, and work areas."
        case .reports:
            "See what is going out, what sits idle, and who is overdue."
        }
    }

    var systemImage: String {
        switch self {
        case .scoreboard: "trophy"
        case .items: "archivebox"
        case .guides: "book.closed"
        case .licenses: "key"
        case .users: "person.2"
        case .reports: "chart.bar.xaxis"
        }
    }

    var tint: Color {
        switch self {
        case .scoreboard: Color.statusText(.orange)
        case .items: Color.statusText(.blue)
        case .guides: Color.statusText(.purple)
        case .licenses: Color.statusText(.orange)
        case .users: Color.statusText(.green)
        case .reports: Color.statusText(.red)
        }
    }
}
