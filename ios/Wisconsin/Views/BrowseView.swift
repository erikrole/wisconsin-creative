import SwiftUI

struct BrowseView: View {
    @State private var navigationPath = NavigationPath()
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session
    @State private var openDamageCases = 0

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var destinations: [BrowseDestination] {
        guard session.currentUser?.role == "COLLABORATOR" else {
            // Accountability and Brand assets read internal team data.
            // Reports and Battery Ops are staff analytics, and Badges is the staff
            // catalog. UA Gear is the seasonal participant list. Those endpoints
            // refuse anyone else, so the rows are hidden rather than offered and refused.
            var rows: [BrowseDestination] = [.scoreboard, .accountability, .items, .kits, .guides, .brandAssets, .blasts, .whatsNew, .licenses, .sharedLogins, .users, .gearPicks]
            if isStaffOrAdmin {
                rows.insert(.batteries, at: 5)
                rows.append(.badges)
                rows.append(.reports)
                rows.insert(.damage, at: 6)
            }
            return rows
        }
        let capabilities = Set(session.currentUser?.capabilities ?? [])
        return [.scoreboard] + [
            Optional.some(BrowseDestination.blasts),
            capabilities.contains("SOFTWARE_VAULT_VIEW") ? .sharedLogins : nil,
            capabilities.contains("GEAR_CATALOG_VIEW") ? .items : nil,
            capabilities.contains("RESERVATION_CREATE") ? .kits : nil,
            capabilities.contains("PEOPLE_DIRECTORY_VIEW") ? .users : nil,
        ].compactMap { $0 }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                ForEach(BrowseGroup.allCases) { group in
                    let rows = destinations.filter { $0.group == group }
                    if !rows.isEmpty {
                        Section(group.rawValue) {
                            ForEach(rows) { destination in
                                NavigationLink(value: destination) {
                                    SettingsMenuRow(
                                        title: destination.title,
                                        subtitle: destination.subtitle,
                                        systemImage: destination.systemImage,
                                        tint: destination.tint
                                    ) {
                                        if destination == .damage, openDamageCases > 0 {
                                            Text("\(openDamageCases)")
                                                .font(.caption.weight(.semibold).monospacedDigit())
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 2)
                                                .background(Color.statusBackground(.orange), in: Capsule())
                                                .foregroundStyle(Color.statusText(.orange))
                                                .accessibilityLabel("\(openDamageCases) open")
                                        }
                                    }
                                }
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
            .task(id: isStaffOrAdmin) {
                guard isStaffOrAdmin else { return }
                openDamageCases = (try? await APIClient.shared.damageCases(view: .open))?.counts.open ?? 0
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
        guard let rawValue = appState.pendingBrowseDestination else { return }
        appState.pendingBrowseDestination = nil
        if rawValue == "events" {
            appState.selectedTab = 1
            return
        }
        guard let destination = BrowseDestination(rawValue: rawValue) else { return }
        navigationPath = NavigationPath()
        navigationPath.append(destination)
    }

    @ViewBuilder
    private func destinationView(for destination: BrowseDestination) -> some View {
        switch destination {
        case .scoreboard:
            TeamScoreboardView(wrapsInNavigationStack: false)
        case .accountability:
            AccountabilityView(wrapsInNavigationStack: false)
        case .items:
            ItemsView(wrapsInNavigationStack: false)
        case .kits:
            KitsView(wrapsInNavigationStack: false)
        case .batteries:
            BatteryOpsView(wrapsInNavigationStack: false)
        case .guides:
            GuidesView(wrapsInNavigationStack: false)
        case .brandAssets:
            BrandAssetsView(wrapsInNavigationStack: false)
        case .licenses:
            LicensesView(wrapsInNavigationStack: false)
        case .sharedLogins:
            SharedLoginsView(wrapsInNavigationStack: false)
        case .users:
            UsersView(wrapsInNavigationStack: false)
        case .badges:
            TeamBadgesView(wrapsInNavigationStack: false)
        case .reports:
            ReportsView()
        case .damage:
            DamageCasesView(wrapsInNavigationStack: false)
        case .blasts:
            BlastsView(wrapsInNavigationStack: false)
        case .whatsNew:
            WhatsNewView(wrapsInNavigationStack: false)
        case .gearPicks:
            GearPicksView(wrapsInNavigationStack: false)
        }
    }
}

private enum BrowseGroup: String, CaseIterable, Identifiable {
    case work = "Work"
    case equipment = "Equipment"
    case resources = "Resources"
    case team = "Team"
    var id: String { rawValue }
}

private enum BrowseDestination: String, CaseIterable, Hashable, Identifiable {
    case scoreboard
    case accountability
    case items
    case kits
    case batteries
    case guides
    case brandAssets
    case blasts
    case whatsNew
    case licenses
    case sharedLogins
    case users
    case gearPicks
    case badges
    case reports
    case damage

    var id: String { rawValue }

    var group: BrowseGroup {
        switch self {
        case .blasts, .whatsNew: .work
        case .items, .kits, .batteries, .accountability, .reports, .damage: .equipment
        case .guides, .brandAssets, .licenses, .sharedLogins: .resources
        case .scoreboard, .users, .gearPicks, .badges: .team
        }
    }

    var title: String {
        switch self {
        case .scoreboard: "Scoreboard"
        case .accountability: "Accountability"
        case .items: "Items"
        case .kits: "Kits"
        case .batteries: "Battery Ops"
        case .guides: "Guides"
        case .brandAssets: "Brand assets"
        case .blasts: "Blasts"
        case .whatsNew: "What's new"
        case .licenses: "Licenses"
        case .sharedLogins: "Shared logins"
        case .users: "Staff"
        case .gearPicks: "UA Gear"
        case .badges: "Badges"
        case .reports: "Reports"
        case .damage: "Damage and loss"
        }
    }

    var subtitle: String {
        switch self {
        case .scoreboard:
            "Team totals and leaderboards"
        case .accountability:
            "Late returns and overdue gear"
        case .items:
            "Find gear and check availability"
        case .kits:
            "Gameday kits and shelf status"
        case .batteries:
            "Battery stock and checkouts"
        case .guides:
            "Team references and workflows"
        case .brandAssets:
            "Logos, guidelines, and templates"
        case .blasts:
            "Team updates and announcements"
        case .whatsNew:
            "App announcements you have seen"
        case .licenses:
            "Photo Mechanic licenses"
        case .sharedLogins:
            "Copy a department login when you need it."
        case .users:
            "People, roles, and work areas"
        case .gearPicks:
            "Your Under Armour gear picks"
        case .badges:
            "Recognition and staff awards"
        case .reports:
            "Usage, activity, and inventory"
        case .damage:
            "Close out damaged and missing gear"
        }
    }

    var systemImage: String {
        switch self {
        case .scoreboard: "trophy"
        case .accountability: "clock.badge.exclamationmark"
        case .items: "archivebox"
        case .kits: "square.stack.3d.up"
        case .batteries: "battery.100"
        case .guides: "book.closed"
        case .brandAssets: "folder"
        case .blasts: "megaphone"
        case .whatsNew: "sparkles"
        case .licenses: "key"
        case .sharedLogins: "lock.rectangle"
        case .users: "person.2"
        case .gearPicks: "tshirt"
        case .badges: "medal"
        case .reports: "chart.bar.xaxis"
        case .damage: "exclamationmark.triangle"
        }
    }

    var tint: Color {
        switch self {
        case .scoreboard: Color.statusText(.orange)
        case .accountability: Color.statusText(.red)
        case .items: Color.statusText(.blue)
        case .kits: Color.statusText(.purple)
        case .batteries: Color.statusText(.orange)
        case .guides: Color.statusText(.purple)
        case .brandAssets: Color.statusText(.blue)
        case .blasts: Color.statusText(.blue)
        case .whatsNew: Color.statusText(.purple)
        case .licenses: Color.statusText(.orange)
        case .sharedLogins: Color.statusText(.blue)
        case .users: Color.statusText(.green)
        case .gearPicks: Color.statusText(.purple)
        case .badges: Color.statusText(.purple)
        case .reports: Color.statusText(.red)
        case .damage: Color.statusText(.orange)
        }
    }
}
