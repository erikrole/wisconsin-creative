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
    @SceneStorage("WisconsinSceneRestoreIdentity") private var sceneRestoreIdentity = ""
    @SceneStorage("WisconsinSceneRestoreTab") private var sceneRestoreTab = 0
    @State private var draftToast: Toast?
    @State private var showDraftCloseOptions = false
    @State private var collapsedSidebarTab: Int?

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

    private var isReadOnlyPreview: Bool {
        session.currentUser?.isReadOnlyRolePreview == true
    }

    private func hasCapability(_ capability: String) -> Bool {
        !isCollaborator || (session.currentUser?.capabilities ?? []).contains(capability)
    }

    private var selectedTabIsSidebarOnly: Bool {
        appState.selectedTab >= 5
    }

    private func browseDestination(for tab: Int) -> String? {
        switch tab {
        case 5: return "users"
        case 6: return "guides"
        case 7: return "licenses"
        case 8: return "scoreboard"
        default: return nil
        }
    }

    private func collapseSidebarDestinationIfNeeded() {
        guard !showsSidebarDestinations,
              selectedTabIsSidebarOnly,
              let destination = browseDestination(for: appState.selectedTab)
        else { return }
        collapsedSidebarTab = appState.selectedTab
        appState.pendingBrowseDestination = destination
        appState.selectedTab = 2
    }

    private func restoreSidebarDestinationIfNeeded() {
        guard showsSidebarDestinations, let collapsedSidebarTab else { return }
        self.collapsedSidebarTab = nil
        guard appState.selectedTab == 2 else { return }
        appState.selectedTab = collapsedSidebarTab
    }

    private func restoreSceneSelectionIfNeeded() {
        guard let identity = session.currentUser?.shellIdentity else { return }
        guard sceneRestoreIdentity == identity, isRestorableTab(sceneRestoreTab) else {
            sceneRestoreIdentity = identity
            sceneRestoreTab = appState.selectedTab
            return
        }
        appState.selectedTab = sceneRestoreTab
    }

    private func persistSceneSelection(_ tab: Int) {
        guard let identity = session.currentUser?.shellIdentity else { return }
        sceneRestoreIdentity = identity
        sceneRestoreTab = tab
    }

    private func isRestorableTab(_ tab: Int) -> Bool {
        switch tab {
        case 0, 2:
            return true
        case 1:
            return hasCapability("MY_GEAR_VIEW")
        case 3:
            return hasCapability("GEAR_CATALOG_VIEW")
        case 4:
            return hasCapability("PUBLISHED_SCHEDULE_VIEW")
        case 5, 6, 7:
            return showsSidebarDestinations && !isCollaborator
        case 8:
            return showsSidebarDestinations
        default:
            return false
        }
    }

    private func routePendingSettings() {
        guard appState.pendingSettingsRoute else { return }
        guard session.currentUser != nil else {
            appState.pendingSettingsRoute = false
            return
        }
        if appState.selectedTab != 0 {
            appState.selectedTab = 0
        }
    }

    private func recordCurrentSurface() {
        let tab = appState.selectedTab
        let isPreview = isReadOnlyPreview
        AppSurface.recordView(for: tab, isReadOnlyPreview: isPreview)
    }

    private func handleAppear() {
        restoreSceneSelectionIfNeeded()
        collapseSidebarDestinationIfNeeded()
        routePendingSettings()
        consumePendingAppIntentHandoff()
        routePendingAppIntent()
        routePendingEventPush()
        routePendingBookingPush()
        recordCurrentSurface()
    }

    private var draftExpansionBinding: Binding<Bool> {
        Binding(
            get: { drafts.isExpanded },
            set: { isExpanded in
                if !isExpanded { drafts.minimize() }
            }
        )
    }

    private var pendingStartBinding: Binding<Bool> {
        Binding(
            get: { drafts.pendingStart != nil },
            set: { isPresented in
                if !isPresented { drafts.cancelPendingStart() }
            }
        )
    }

    private var selectedTabBinding: Binding<Int> {
        Binding(
            get: { appState.selectedTab },
            set: { appState.selectTab($0) }
        )
    }

    @TabContentBuilder<Int>
    private var tabItems: some TabContent<Int> {
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

    private var tabContainer: some View {
        TabView(selection: selectedTabBinding) {
            tabItems
        }
        .tabViewCustomization($tabCustomization)
    }

    private var routedTabContainer: some View {
        tabContainer
            .onChange(of: showsSidebarDestinations) { _, canShowSidebarDestinations in
                if canShowSidebarDestinations {
                    restoreSidebarDestinationIfNeeded()
                } else {
                    collapseSidebarDestinationIfNeeded()
                }
            }
            .onAppear(perform: handleAppear)
            .modifier(SurfaceViewTracking(selectedTab: appState.selectedTab))
            .onChange(of: appState.pendingAppIntentDestination) { _, _ in
                routePendingAppIntent()
            }
            .onChange(of: appState.pendingSettingsRoute) { _, _ in
                routePendingSettings()
            }
            .onChange(of: appState.selectedTab) { _, newTab in
                persistSceneSelection(newTab)
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
    }

    private var draftAwareTabContainer: some View {
        routedTabContainer
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
            .sheet(isPresented: draftExpansionBinding) {
                if let composer = drafts.composer {
                    CreateBookingSheet(vm: composer)
                }
            }
            .confirmationDialog(
                "Reservation in Progress?",
                isPresented: pendingStartBinding,
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
    }

    var body: some View {
        draftAwareTabContainer
            .task(id: session.currentUser?.shellIdentity) {
                await loadDraftIfAllowed()
            }
            .modifier(AppTabShellStyle(usesSidebarAdaptableStyle: showsSidebarDestinations))
            .modifier(AppTabStatusOverlays(isReadOnlyPreview: isReadOnlyPreview))
            .animation(reduceMotion ? nil : .easeInOut, value: network.isConnected)
    }

    private func loadDraftIfAllowed() async {
        guard !isReadOnlyPreview else { return }
        guard hasCapability("RESERVATION_CREATE") else { return }
        await drafts.loadSavedDraft()
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
        guard session.currentUser != nil else {
            rejectPendingAppIntent(message: "Sign in to use that shortcut.")
            return
        }
        switch destination {
        case .scan:
            guard hasCapability("GEAR_CATALOG_VIEW") else {
                rejectPendingAppIntent(message: "Scan isn't available for this account.")
                return
            }
            if appState.selectedTab != 3 { appState.selectedTab = 3 }
        case .myGear:
            guard hasCapability("MY_GEAR_VIEW") else {
                rejectPendingAppIntent(message: "My Gear isn't available for this account.")
                return
            }
            if appState.selectedTab != 1 { appState.selectedTab = 1 }
        case .todaySchedule:
            guard hasCapability("PUBLISHED_SCHEDULE_VIEW") else {
                rejectPendingAppIntent(message: "Schedule isn't available for this account.")
                return
            }
            if appState.selectedTab != 4 { appState.selectedTab = 4 }
            appState.pendingAppIntentDestination = nil
        case .createReservation:
            guard hasCapability("RESERVATION_CREATE") else {
                rejectPendingAppIntent(message: "Reservations aren't available for this account.")
                return
            }
            // Most roles have the Bookings tab as the reservation home. A
            // narrowly scoped collaborator may be allowed to reserve without
            // browsing existing bookings, so start the composer here instead
            // of parking the handoff on a tab that is not present.
            if hasCapability("MY_GEAR_VIEW") {
                if appState.selectedTab != 1 { appState.selectedTab = 1 }
            } else {
                appState.pendingAppIntentDestination = nil
                drafts.start()
            }
        }
    }

    private func rejectPendingAppIntent(message: String) {
        appState.pendingAppIntentDestination = nil
        draftToast = Toast(message: message, icon: "info.circle", role: .info)
        UIAccessibility.post(notification: .announcement, argument: message)
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
    static func recordView(for tab: Int, isReadOnlyPreview: Bool = false) {
        guard !isReadOnlyPreview else { return }
        let surface = name(for: tab)
        Task {
            await APIClient.shared.recordProductEvent(eventName: "surface_viewed", surface: surface)
        }
    }
}

/// Hosts the minimized-reservation card in the tab bar accessory slot. The
/// slot is disabled on iOS 26.1 and omitted entirely on iOS 26.0 when no draft
/// exists, so an inactive composer never leaves an empty pill in the shell.
private struct ReservationDraftAccessory<Accessory: View>: ViewModifier {
    let isVisible: Bool
    @ViewBuilder let accessory: () -> Accessory

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: isVisible) { accessory() }
        } else if isVisible {
            content.tabViewBottomAccessory {
                accessory()
            }
        } else {
            content
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

private struct AppTabStatusOverlays: ViewModifier {
    @Environment(NetworkMonitor.self) private var network
    let isReadOnlyPreview: Bool

    func body(content: Content) -> some View {
        content
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
            .overlay {
                if isReadOnlyPreview {
                    Rectangle()
                        .strokeBorder(Color.statusText(.orange).opacity(0.65), lineWidth: 1)
                        .padding(1)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
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
    @Environment(SessionStore.self) private var session
    let selectedTab: Int

    func body(content: Content) -> some View {
        content.onChange(of: selectedTab) { _, newValue in
            AppSurface.recordView(
                for: newValue,
                isReadOnlyPreview: session.currentUser?.isReadOnlyRolePreview == true
            )
        }
    }
}
