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
            // Reports and Battery Ops are staff analytics. Badges is the staff
            // catalog. Events reads the internal calendar. Those rows stay
            // hidden rather than offered and refused.
            var rows: [BrowseDestination] = [.scoreboard, .events, .items, .kits, .guides, .blasts, .licenses, .users]
            if isStaffOrAdmin {
                rows.insert(.batteries, at: 4)
                rows.append(.badges)
                rows.append(.reports)
            }
            return rows
        }
        let capabilities = Set(session.currentUser?.capabilities ?? [])
        return [.scoreboard] + [
            Optional.some(BrowseDestination.blasts),
            capabilities.contains("GEAR_CATALOG_VIEW") ? .items : nil,
            capabilities.contains("RESERVATION_CREATE") ? .kits : nil,
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
            .onAppear {
                consumePendingDestination()
            }
            .onChange(of: appState.pendingBrowseDestination) { _, _ in
                consumePendingDestination()
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 2 else { return }
                navigationPath = NavigationPath()
            }
        }
    }

    private func consumePendingDestination() {
        guard let rawValue = appState.pendingBrowseDestination,
              let destination = BrowseDestination(rawValue: rawValue)
        else { return }
        appState.pendingBrowseDestination = nil
        navigationPath = NavigationPath()
        navigationPath.append(destination)
    }

    @ViewBuilder
    private func destinationView(for destination: BrowseDestination) -> some View {
        switch destination {
        case .scoreboard:
            TeamScoreboardView(wrapsInNavigationStack: false)
        case .events:
            EventsView(wrapsInNavigationStack: false)
        case .items:
            ItemsView(wrapsInNavigationStack: false)
        case .kits:
            KitsView(wrapsInNavigationStack: false)
        case .batteries:
            BatteryOpsView(wrapsInNavigationStack: false)
        case .guides:
            GuidesView(wrapsInNavigationStack: false)
        case .licenses:
            LicensesView(wrapsInNavigationStack: false)
        case .users:
            UsersView(wrapsInNavigationStack: false)
        case .badges:
            TeamBadgesView(wrapsInNavigationStack: false)
        case .reports:
            ReportsView()
        case .blasts:
            BlastsView(wrapsInNavigationStack: false)
        }
    }
}

private enum BrowseDestination: String, CaseIterable, Hashable, Identifiable {
    case scoreboard
    case events
    case items
    case kits
    case batteries
    case guides
    case blasts
    case licenses
    case users
    case badges
    case reports

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scoreboard: "Scoreboard"
        case .events: "Events"
        case .items: "Items"
        case .kits: "Kits"
        case .batteries: "Battery Ops"
        case .guides: "Guides"
        case .blasts: "Blasts"
        case .licenses: "Licenses"
        case .users: "Users"
        case .badges: "Badges"
        case .reports: "Reports"
        }
    }

    var subtitle: String {
        switch self {
        case .scoreboard:
            "Team totals, sport breakdowns, and per-person leaderboards."
        case .events:
            "Event details, linked gear, and bookings."
        case .items:
            "Find gear, item families, status, and availability."
        case .kits:
            "See gameday kits and whether the cameras are on the shelf."
        case .batteries:
            "See battery families, who has units out, and what is running low."
        case .guides:
            "Read team reference docs, contacts, venue notes, and workflows."
        case .blasts:
            "Read a broadcast again after you dismiss it."
        case .licenses:
            "Claim, copy, or return a Photo Mechanic license."
        case .users:
            "Find teammates, roles, titles, and work areas."
        case .badges:
            "See the badges staff can award."
        case .reports:
            "See what is going out, what sits idle, and who is overdue."
        }
    }

    var systemImage: String {
        switch self {
        case .scoreboard: "trophy"
        case .events: "calendar"
        case .items: "archivebox"
        case .kits: "square.stack.3d.up"
        case .batteries: "battery.100"
        case .guides: "book.closed"
        case .blasts: "megaphone"
        case .licenses: "key"
        case .users: "person.2"
        case .badges: "medal"
        case .reports: "chart.bar.xaxis"
        }
    }

    var tint: Color {
        switch self {
        case .scoreboard: Color.statusText(.orange)
        case .events: Color.statusText(.blue)
        case .items: Color.statusText(.blue)
        case .kits: Color.statusText(.purple)
        case .batteries: Color.statusText(.orange)
        case .guides: Color.statusText(.purple)
        case .blasts: Color.statusText(.blue)
        case .licenses: Color.statusText(.orange)
        case .users: Color.statusText(.green)
        case .badges: Color.statusText(.purple)
        case .reports: Color.statusText(.red)
        }
    }
}
