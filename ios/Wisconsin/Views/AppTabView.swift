import SwiftUI
import TipKit

struct AppTabView: View {
    private let resumeReservationTip = ResumeReservationTip()
    @Environment(SessionStore.self) private var session
    @Environment(AppState.self) private var appState
    @Environment(ReservationDraftStore.self) private var drafts
    @Environment(NetworkMonitor.self) private var network
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("sidebarTabCustomization") private var tabCustomization: TabViewCustomization
    @State private var draftToast: Toast?
    @State private var showDraftCloseOptions = false

    private var isStaffOrAdmin: Bool {
        let role = session.currentUser?.role ?? ""
        return role == "STAFF" || role == "ADMIN"
    }

    private var gearTabLabel: String {
        isStaffOrAdmin ? "Bookings" : "My Gear"
    }

    private var showsSidebarDestinations: Bool {
        horizontalSizeClass == .regular
    }

    private var isCollaborator: Bool {
        session.currentUser?.role == "COLLABORATOR"
    }

    private func hasCapability(_ capability: String) -> Bool {
        !isCollaborator || (session.currentUser?.capabilities ?? []).contains(capability)
    }

    private var selectedTabIsSidebarOnly: Bool {
        appState.selectedTab >= 5
    }

    var body: some View {
        TabView(selection: Binding(
            get: { appState.selectedTab },
            set: { appState.selectTab($0) }
        )) {
            Tab("Home", systemImage: "house", value: 0) {
                HomeView()
            }

            if hasCapability("PUBLISHED_SCHEDULE_VIEW") {
                Tab("Schedule", systemImage: "calendar", value: 4) {
                    ScheduleView()
                }
                    .badge(appState.myShiftTodayCount)
                    .accessibilityLabel(appState.myShiftTodayCount > 0 ? "Schedule, \(appState.myShiftTodayCount) shifts today" : "Schedule")
            }

            if hasCapability("MY_GEAR_VIEW") {
                Tab(gearTabLabel, systemImage: "calendar.badge.checkmark", value: 1) {
                    BookingsView()
                }
                    .badge(appState.overdueCount)
                    .accessibilityLabel(appState.overdueCount > 0 ? "\(gearTabLabel), \(appState.overdueCount) overdue" : gearTabLabel)
            }

            // Browse always exists because the shared Scoreboard is available
            // to every signed-in role, even when collaborator policy grants no
            // directory or catalog capabilities.
            Tab("Browse", systemImage: "square.grid.2x2", value: 2) {
                BrowseView()
            }

            if hasCapability("GEAR_CATALOG_VIEW") {
                Tab("Search", systemImage: "magnifyingglass", value: 3, role: .search) {
                    GlobalSearchSheet(showsCancelButton: false)
                }
                .tabPlacement(.pinned)
            }

            if showsSidebarDestinations {
                TabSection("Team") {
                    Tab("Scoreboard", systemImage: "trophy", value: 8) {
                        TeamScoreboardView()
                    }
                    .tabPlacement(.sidebarOnly)
                    .customizationID("team.scoreboard")
                }
                .customizationID("team")

                // Scoreboard is the universal exception. Existing Resources
                // stay internal and are not exposed to collaborators by the
                // new regular-width sidebar.
                if !isCollaborator {
                    TabSection("Resources") {
                        Tab("Guides", systemImage: "book.closed", value: 6) {
                            GuidesView()
                        }
                        .tabPlacement(.sidebarOnly)
                        .customizationID("resources.guides")

                        Tab("Licenses", systemImage: "key", value: 7) {
                            LicensesView()
                        }
                        .tabPlacement(.sidebarOnly)
                        .customizationID("resources.licenses")

                        Tab("Users", systemImage: "person.2", value: 5) {
                            UsersView()
                        }
                        .tabPlacement(.sidebarOnly)
                        .customizationID("resources.users")
                    }
                    .customizationID("resources")
                }
            }
        }
        .tabViewCustomization($tabCustomization)
        .onChange(of: showsSidebarDestinations) { _, canShowSidebarDestinations in
            if !canShowSidebarDestinations && selectedTabIsSidebarOnly {
                appState.selectedTab = 0
            }
        }
        .onAppear {
            if !showsSidebarDestinations && selectedTabIsSidebarOnly {
                appState.selectedTab = 0
            }
            consumePendingAppIntentHandoff()
            routePendingAppIntent()
            routePendingEventPush()
            routePendingBookingPush()
            AppSurface.recordView(for: appState.selectedTab)
        }
        .modifier(SurfaceViewTracking(selectedTab: appState.selectedTab))
        .onChange(of: appState.pendingAppIntentDestination) { _, _ in
            routePendingAppIntent()
        }
        .onChange(of: appState.pendingPushEventId) { _, _ in
            routePendingEventPush()
        }
        .onChange(of: appState.pendingPushBookingId) { _, _ in
            routePendingBookingPush()
        }
        .onChange(of: appState.pendingPushBlastId) { _, _ in
            routePendingBlastPush()
        }
        .modifier(ScheduleVisitDonation(selectedTab: appState.selectedTab))
        // The reservation composer lives here, above every tab, so a minimized
        // draft survives tab switches and navigation pops.
        .modifier(ReservationDraftAccessory(isVisible: drafts.showsCard) {
            ReservationDraftCard(
                title: drafts.cardTitle,
                subtitle: drafts.cardSubtitle,
                isBusy: drafts.isBusy,
                onOpen: {
                    resumeReservationTip.invalidate(reason: .actionPerformed)
                    Task { await drafts.openCard() }
                },
                onClose: { showDraftCloseOptions = true }
            )
            .popoverTip(resumeReservationTip, arrowEdge: .bottom)
        })
        .sheet(isPresented: Binding(
            get: { drafts.isExpanded },
            // Swipe-to-dismiss parks the composer instead of ending it. Every
            // real exit goes through the sheet's own Cancel choice.
            set: { if !$0 { drafts.minimize() } }
        )) {
            if let composer = drafts.composer {
                CreateBookingSheet(vm: composer)
            }
        }
        .confirmationDialog(
            "You already have a reservation in progress",
            isPresented: Binding(
                get: { drafts.pendingStart != nil },
                set: { if !$0 { drafts.cancelPendingStart() } }
            ),
            titleVisibility: .visible
        ) {
            Button("Save Draft & Start New") {
                Task { await drafts.resolvePendingStartBySavingCurrent() }
            }
            .disabled(drafts.isBusy)
            Button("Discard & Start New", role: .destructive) {
                Task { await drafts.resolvePendingStartByDiscardingCurrent() }
            }
            .disabled(drafts.isBusy)
            Button("Keep Editing", role: .cancel) { drafts.cancelPendingStart() }
        } message: {
            Text("Saved drafts stay in your bookings until you finish or delete them.")
        }
        .confirmationDialog(
            "Save this reservation as a draft?",
            isPresented: $showDraftCloseOptions,
            titleVisibility: .visible
        ) {
            Button("Save Draft") { Task { await drafts.saveAndClose() } }
                .disabled(drafts.isBusy)
            Button("Discard", role: .destructive) { Task { await drafts.discard() } }
                .disabled(drafts.isBusy)
            Button("Keep It", role: .cancel) {}
        }
        .toast($draftToast)
        .onChange(of: drafts.statusMessage) { _, message in
            guard let message else { return }
            drafts.statusMessage = nil
            draftToast = Toast(message: message, icon: "tray.and.arrow.down.fill", role: .success)
        }
        .onChange(of: drafts.errorMessage) { _, message in
            guard let message else { return }
            drafts.errorMessage = nil
            draftToast = Toast(message: message, icon: "exclamationmark.triangle.fill", role: .error)
        }
        .onChange(of: drafts.createdBookingId) { _, bookingId in
            routeCreatedReservation(bookingId)
        }
        .onChange(of: drafts.showsCard) { _, showsCard in
            guard showsCard else { return }
            Task { await ResumeReservationTip.minimizedReservation.donate() }
        }
        .task(id: session.currentUser?.id) {
            guard hasCapability("RESERVATION_CREATE") else { return }
            await drafts.loadSavedDraft()
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if !network.isConnected {
                BannerView(
                    severity: .warning,
                    message: "No connection — some actions may fail",
                    systemImage: "wifi.slash"
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .modifier(AppTabShellStyle(usesSidebarAdaptableStyle: showsSidebarDestinations))
        .animation(reduceMotion ? nil : .easeInOut, value: network.isConnected)
    }

    /// A reservation can be created long after the screen that started it is
    /// gone, so completion always lands on Bookings rather than trying to push
    /// onto whatever stack happened to open the composer.
    private func routeCreatedReservation(_ bookingId: String?) {
        guard let bookingId else { return }
        drafts.createdBookingId = nil
        guard hasCapability("MY_GEAR_VIEW") else { return }
        appState.pendingBookingDetailId = bookingId
        appState.selectedTab = 1
    }

    private func routePendingEventPush() {
        guard appState.pendingPushEventId != nil else { return }
        guard hasCapability("PUBLISHED_SCHEDULE_VIEW") else {
            appState.pendingPushEventId = nil
            return
        }
        if appState.selectedTab != 4 {
            appState.selectedTab = 4
        }
    }

    /// Blasts always live on Home. No capability gate: everyone who can receive a
    /// blast can see the banner, and HomeView clears the pending id once it refreshes.
    private func routePendingBlastPush() {
        guard appState.pendingPushBlastId != nil else { return }
        if appState.selectedTab != 0 {
            appState.selectedTab = 0
        }
    }

    private func routePendingBookingPush() {
        guard appState.pendingPushBookingId != nil else { return }
        guard hasCapability("MY_GEAR_VIEW") else {
            appState.pendingPushBookingId = nil
            return
        }
        if appState.selectedTab != 0 {
            appState.selectedTab = 0
        }
    }

    private func consumePendingAppIntentHandoff() {
        if let destination = GearTrackerAppIntentHandoff.shared.consumePendingDestination() {
            appState.pendingAppIntentDestination = destination
        }
        if let bookingId = GearTrackerAppIntentHandoff.shared.consumePendingBookingId() {
            appState.pendingPushBookingId = bookingId
        }
    }

    private func routePendingAppIntent() {
        guard let destination = appState.pendingAppIntentDestination else { return }
        switch destination {
        case .scan:
            if hasCapability("GEAR_CATALOG_VIEW"), appState.selectedTab != 3 { appState.selectedTab = 3 }
        case .myGear:
            if hasCapability("MY_GEAR_VIEW"), appState.selectedTab != 1 { appState.selectedTab = 1 }
        case .todaySchedule:
            if hasCapability("PUBLISHED_SCHEDULE_VIEW"), appState.selectedTab != 4 { appState.selectedTab = 4 }
            appState.pendingAppIntentDestination = nil
        case .createReservation:
            if hasCapability("RESERVATION_CREATE"), appState.selectedTab != 1 { appState.selectedTab = 1 }
        }
    }
}

private enum AppSurface {
    static func name(for tab: Int) -> String {
        switch tab {
        case 0: "home"
        case 1: "bookings"
        case 2: "other"
        case 3: "search"
        case 4: "schedule"
        case 5: "users"
        case 6: "resources"
        case 7: "licenses"
        case 8: "scoreboard"
        default: "other"
        }
    }

    @MainActor
    static func recordView(for tab: Int) {
        let surface = name(for: tab)
        Task {
            await APIClient.shared.recordProductEvent(eventName: "surface_viewed", surface: surface)
        }
    }
}

/// Hosts the minimized-reservation card in the tab bar accessory slot.
///
/// The accessory reserves its container for as long as the modifier is
/// attached, so returning an empty content view leaves a blank pill floating
/// above the tab bar. iOS 26.1 added `isEnabled:` for exactly this, which hides
/// the slot without disturbing the view tree. On 26.0 the only way to reclaim
/// the space is to drop the modifier, and that rebuilds the `TabView` — each
/// tab's navigation stack resets — so 26.0 keeps the accessory attached and
/// eats the empty pill rather than throwing away where the user was.
private struct ReservationDraftAccessory<Accessory: View>: ViewModifier {
    let isVisible: Bool
    @ViewBuilder let accessory: () -> Accessory

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: isVisible) { accessory() }
        } else {
            content.tabViewBottomAccessory {
                if isVisible { accessory() }
            }
        }
    }
}

private struct AppTabShellStyle: ViewModifier {
    let usesSidebarAdaptableStyle: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if usesSidebarAdaptableStyle {
            content.tabViewStyle(.sidebarAdaptable)
        } else {
            content.tabViewStyle(.tabBarOnly)
        }
    }
}

private struct ScheduleVisitDonation: ViewModifier {
    let selectedTab: Int

    func body(content: Content) -> some View {
        content.onChange(of: selectedTab) { _, newValue in
            guard newValue == 4 else { return }
            Task { await ShiftCalendarTip.openedSchedule.donate() }
        }
    }
}

private struct SurfaceViewTracking: ViewModifier {
    let selectedTab: Int

    func body(content: Content) -> some View {
        content.onChange(of: selectedTab) { _, newValue in
            AppSurface.recordView(for: newValue)
        }
    }
}
