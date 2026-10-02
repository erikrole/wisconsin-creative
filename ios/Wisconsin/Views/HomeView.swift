import SwiftUI
import UIKit
import os

private let homePerformanceLog = Logger(subsystem: "com.erikrole.Wisconsin", category: "Launch")

private struct ProfileRoute: Hashable {
    let initialDestination: ProfileDestination?

    init(initialDestination: ProfileDestination? = nil) {
        self.initialDestination = initialDestination
    }
}

private func elapsedMilliseconds(since start: Date) -> Int {
    Int(Date().timeIntervalSince(start) * 1_000)
}

@MainActor
@Observable
final class HomeViewModel {
    var dashboard: DashboardData?
    var isLoading = false
    var error: String?
    var lastLoadedAt: Date?
    var blasts: [ActiveBlast] = []

    /// Blast ids already reported as read, so a scroll bounce can't spam the endpoint.
    private var reportedRead: Set<String> = []
    /// Acks whose network call failed. Retried on the next `loadBlasts()`, which is
    /// why the ack endpoint is idempotent.
    private var pendingAcks: Set<String> = []

    /// Refresh if data is older than this. `.task` fires on every appearance,
    /// so without a freshness check we'd hammer the endpoint on every tab switch.
    private static let freshnessWindow: TimeInterval = 60
    private var loadRequests = LatestRequestGeneration()

    /// Deliberately outside the freshness window and outside `load()`: a blast has
    /// to be current, and a dashboard failure must never be able to hide one.
    func loadBlasts() async {
        await retryPendingAcks()
        if let latest = try? await APIClient.shared.activeBlasts() {
            blasts = latest.filter { !pendingAcks.contains($0.id) }
        }
    }

    /// The banner actually rendered. Fire-and-forget -- a lost read is not worth a
    /// retry, and the ack that matters stamps read on its own.
    func reportRead(_ id: String) {
        guard reportedRead.insert(id).inserted else { return }
        Task { try? await APIClient.shared.markBlastRead(id: id) }
    }

    /// "Got it." Optimistic, because the banner must feel instant on a phone at a
    /// venue with bad signal; a failed call is queued and replayed.
    func acknowledge(_ id: String) async {
        blasts.removeAll { $0.id == id }
        do {
            try await APIClient.shared.acknowledgeBlast(id: id)
            pendingAcks.remove(id)
        } catch {
            pendingAcks.insert(id)
        }
    }

    private func retryPendingAcks() async {
        for id in pendingAcks {
            if (try? await APIClient.shared.acknowledgeBlast(id: id)) != nil {
                pendingAcks.remove(id)
            }
        }
    }

    func load(appState: AppState? = nil, requesterId: String? = nil, forceRefresh: Bool = false) async {
        let startedAt = Date()
        if !forceRefresh, isLoading {
            homePerformanceLog.debug("launch.home.dashboardLoad result=skipped reason=inFlight durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            return
        }
        if !forceRefresh, let last = lastLoadedAt, Date().timeIntervalSince(last) < Self.freshnessWindow {
            let ageSeconds = Int(Date().timeIntervalSince(last))
            homePerformanceLog.debug("launch.home.dashboardLoad result=skipped reason=fresh ageSeconds=\(ageSeconds, privacy: .public) durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            return
        }
        let signpost = AppPerformanceSignposts.begin("HomeDashboardLoad")
        defer { AppPerformanceSignposts.end("HomeDashboardLoad", signpost) }
        let requestToken = loadRequests.begin()
        isLoading = true
        defer {
            if loadRequests.owns(requestToken) {
                isLoading = false
            }
        }
        do {
            let loadedDashboard = try await APIClient.shared.dashboard()
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            dashboard = loadedDashboard
            // Home is the only surface that loads the whole dashboard, so it
            // is where the Home Screen widgets get their data. Publishing here
            // keeps the widget as fresh as the app itself, with no second
            // fetch and no session in the widget process.
            GearWidgetPublisher.publish(from: loadedDashboard)
            SpotlightIndexer.index(from: loadedDashboard)
            // The Home Screen long-press menu reads the same snapshot, so the
            // icon menu and the widgets can never disagree about the counts.
            GearTrackerQuickAction.refreshSubtitles(
                from: GearWidgetPublisher.snapshot(from: loadedDashboard)
            )
            if let appState {
                appState.overdueCount = loadedDashboard.overdueCount
                appState.myShiftCount = loadedDashboard.myEventWork.count
            }
            error = nil
            lastLoadedAt = Date()
            homePerformanceLog.info("launch.home.dashboardLoad result=success durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public) checkouts=\(loadedDashboard.myCheckouts.items.count, privacy: .public) reservations=\(loadedDashboard.myReservations.count, privacy: .public) pendingPickups=\(loadedDashboard.pendingPickups.items.count, privacy: .public) eventWork=\(loadedDashboard.myEventWork.count, privacy: .public) flagged=\(loadedDashboard.flaggedItems.count, privacy: .public)")
            Task { @MainActor [weak self] in
                guard let self, self.loadRequests.owns(requestToken), !Task.isCancelled else { return }
                await Self.refreshSecondaryLaunchState(
                    appState: appState,
                    requesterId: requesterId,
                    forceRefresh: forceRefresh
                )
            }
        } catch {
            guard loadRequests.owns(requestToken), !Task.isCancelled else { return }
            self.error = error.localizedDescription
            homePerformanceLog.error("launch.home.dashboardLoad result=failure durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        }
    }

    private static func refreshSecondaryLaunchState(
        appState: AppState?,
        requesterId: String?,
        forceRefresh: Bool
    ) async {
        async let liveActivityRefresh: Void = reconcileCheckoutReturnLiveActivity(requesterId: requesterId)
        if let appState {
            await appState.refresh(forceRefresh: forceRefresh)
        }
        await liveActivityRefresh
    }

    private static func reconcileCheckoutReturnLiveActivity(requesterId: String?) async {
        let startedAt = Date()
        let signpost = AppPerformanceSignposts.begin("LiveActivityReconciliation")
        defer { AppPerformanceSignposts.end("LiveActivityReconciliation", signpost) }
        await CheckoutReturnLiveActivityManager.shared.prepareRemoteStartRegistration()
        await CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts(requesterId: requesterId)
        homePerformanceLog.debug("launch.home.liveActivityReconcile durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
    }
}

struct HomeView: View {
    @State private var vm = HomeViewModel()
    @State private var showNotifications = false
    @State private var showTrades = false
    @State private var navigationPath = NavigationPath()
    @State private var pendingInboxRoute: GearTrackerRoute?
    @State private var selectedEventWork: DashboardEventWork?
    /// Shifts the viewer could offer for trade. Home opened the Trade Board
    /// with an empty list, which left Post a Trade with nothing to post while
    /// the same sheet worked from Schedule. The dashboard's own shift rows
    /// cannot stand in: they carry no status or gear, and Post filters on
    /// both, so this loads the real list rather than fabricating one.
    @State private var tradeMyShifts: [MyShift] = []
    @SceneStorage("WisconsinHomeSceneIdentity") private var sceneRestoreIdentity = ""
    @SceneStorage("WisconsinHomeSceneDestination") private var sceneRestoreDestination = ""
    @SceneStorage("WisconsinHomeSceneDestinationID") private var sceneRestoreDestinationID = ""
    @State private var didRestoreScene = false
    @State private var firstUsefulRenderStartedAt = Date()
    @State private var firstUsefulRenderSignpost: OSSignpostIntervalState?
    @State private var didLogFirstUsefulRender = false
    @Environment(AppState.self) private var appState
    @Environment(SessionStore.self) private var session
    @Environment(ReservationDraftStore.self) private var drafts
    @Environment(NetworkMonitor.self) private var network

    private func rememberSceneDestination(_ destination: String, id: String? = nil) {
        guard let identity = session.currentUser?.shellIdentity else { return }
        sceneRestoreIdentity = identity
        sceneRestoreDestination = destination
        sceneRestoreDestinationID = id ?? ""
    }

    private func clearSceneDestination() {
        sceneRestoreIdentity = session.currentUser?.shellIdentity ?? sceneRestoreIdentity
        sceneRestoreDestination = ""
        sceneRestoreDestinationID = ""
    }

    private func restoreHomeSceneIfNeeded() {
        guard !didRestoreScene else { return }
        didRestoreScene = true
        guard let identity = session.currentUser?.shellIdentity else { return }
        guard sceneRestoreIdentity == identity else {
            sceneRestoreIdentity = identity
            clearSceneDestination()
            return
        }

        switch sceneRestoreDestination {
        case "profile":
            navigationPath.append(ProfileRoute())
        case "profileSettings":
            navigationPath.append(ProfileRoute(initialDestination: .settings))
        case "booking" where !sceneRestoreDestinationID.isEmpty:
            navigationPath.append(sceneRestoreDestinationID)
        case "asset" where !sceneRestoreDestinationID.isEmpty:
            navigationPath.append(AssetRouteId(id: sceneRestoreDestinationID))
        case "user" where !sceneRestoreDestinationID.isEmpty:
            navigationPath.append(UserRouteId(id: sceneRestoreDestinationID))
        default:
            break
        }
    }

    private func routePendingSettings() {
        guard appState.pendingSettingsRoute else { return }
        appState.pendingSettingsRoute = false
        let destination = appState.pendingSettingsDestination
        appState.pendingSettingsDestination = .settings
        navigationPath = NavigationPath()
        rememberSceneDestination("profileSettings")
        navigationPath.append(ProfileRoute(initialDestination: destination))
    }

    private func consumePendingHomeRoutes() {
        if let id = appState.pendingPushBookingId {
            rememberSceneDestination("booking", id: id)
            navigationPath.append(id)
            appState.pendingPushBookingId = nil
        }
        if let id = appState.pendingPushAssetId {
            rememberSceneDestination("asset", id: id)
            navigationPath.append(AssetRouteId(id: id))
            appState.pendingPushAssetId = nil
        }
        if let id = appState.pendingPushUserId {
            rememberSceneDestination("user", id: id)
            navigationPath.append(UserRouteId(id: id))
            appState.pendingPushUserId = nil
        }
        if appState.pendingNotificationsInbox {
            appState.pendingNotificationsInbox = false
            showNotifications = true
        }
        if appState.pendingTradeBoard {
            appState.pendingTradeBoard = false
            showTrades = true
        }
    }

    /// Rendered in every state of `mainContent` -- loading, error, and loaded. A
    /// message someone is being asked to acknowledge must not be hidden because the
    /// dashboard behind it is still loading or failed.
    @ViewBuilder private var blastStack: some View {
        if !vm.blasts.isEmpty {
            BlastBannerStack(
                blasts: vm.blasts,
                onAppearBlast: { vm.reportRead($0) },
                onAcknowledge: { id in Task { await vm.acknowledge(id) } }
            )
        }
    }

    @ViewBuilder private var mainContent: some View {
        if vm.dashboard == nil && vm.error == nil {
            ScrollView {
                VStack(alignment: .leading, spacing: Brand.Space.lg) {
                    blastStack
                    VStack(alignment: .leading, spacing: 5) {
                        Skeleton().frame(width: 150, height: 12)
                        Skeleton().frame(width: 260, height: 30)
                    }
                    StatStripSkeleton()
                    VStack(alignment: .leading, spacing: 4) {
                        Skeleton().frame(width: 96, height: 20)
                            .padding(.bottom, 8)
                        ForEach(0..<4, id: \.self) { index in
                            QueueRowSkeleton()
                            if index < 3 { Divider().overlay(Color.flatDivider).padding(.leading, 30) }
                        }
                    }
                    .flatCard()
                }
                .padding(Brand.Space.md)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading dashboard")
            }
            .allowsHitTesting(false)
        } else if let error = vm.error, vm.dashboard == nil {
            ScrollView {
                VStack(alignment: .leading, spacing: Brand.Space.lg) {
                    blastStack
                    ContentUnavailableView {
                        Label("Couldn't load dashboard", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await vm.load(appState: appState, requesterId: session.currentUser?.id, forceRefresh: true) } }
                            .authButton(.primary, adaptive: true)
                            .frame(maxWidth: 240)
                    }
                }
                .padding(Brand.Space.md)
            }
        } else if let dash = vm.dashboard {
            dashboardScrollView(dash)
                .onAppear { logFirstUsefulRender(dash) }
        }
    }

    /// The shifts this person could offer for trade. Failure is deliberately
    /// quiet: the Trade Board's browse and claim paths do not need this list,
    /// and an error banner over a sheet the user just opened would be worse
    /// than a Post step that has nothing to offer.
    private func loadTradeMyShifts() async {
        guard tradeMyShifts.isEmpty, let userId = session.currentUser?.id, !userId.isEmpty else { return }
        tradeMyShifts = (try? await APIClient.shared.myShifts(userId: userId)) ?? []
    }

    private func logFirstUsefulRender(_ dash: DashboardData) {
        guard !didLogFirstUsefulRender else { return }
        didLogFirstUsefulRender = true
        if let firstUsefulRenderSignpost {
            AppPerformanceSignposts.end("FirstUsefulHome", firstUsefulRenderSignpost)
            self.firstUsefulRenderSignpost = nil
        }
        homePerformanceLog.info("launch.home.firstUsefulRender durationMs=\(elapsedMilliseconds(since: firstUsefulRenderStartedAt), privacy: .public) checkouts=\(dash.myCheckouts.items.count, privacy: .public) reservations=\(dash.myReservations.count, privacy: .public) pendingPickups=\(dash.pendingPickups.items.count, privacy: .public) eventWork=\(dash.myEventWork.count, privacy: .public)")
    }

    private func isAllEmpty(_ dash: DashboardData) -> Bool {
        let hasMyPendingPickup: Bool
        if let currentUserId = session.currentUser?.id {
            hasMyPendingPickup = dash.pendingPickups.items.contains { $0.requesterUserId == currentUserId }
        } else {
            hasMyPendingPickup = false
        }
        return dash.myCheckouts.items.isEmpty
            && dash.myReservations.isEmpty
            && !hasMyPendingPickup
            && dash.myEventWork.isEmpty
            && !dash.myCheckouts.items.contains(where: \.isOverdue)
            && dash.flaggedItems.isEmpty
            && dash.lostBulkUnits.isEmpty
    }

    @ViewBuilder private func dashboardScrollView(_ dash: DashboardData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Brand.Space.lg) {
                blastStack
                DashboardHero(
                    name: session.currentUser?.name ?? ""
                )
                if vm.error != nil {
                    RefreshFailurePill(message: vm.error ?? "")
                }
                StatStrip(
                    stats: dash.stats,
                    pendingPickupCount: dash.pendingPickups.total,
                    shiftCount: dash.myEventWork.count,
                    openBookings: { appState.selectedTab = 1 },
                    openAttention: {
                        // Urgency tiles open the complete list; row color carries status.
                        appState.pendingBookingsScope = BookingScope.all.rawValue
                        appState.selectedTab = 1
                    },
                    openSchedule: {
                        // The Shifts count is personal, so the screen it opens
                        // is scoped to match rather than dropping the reader
                        // into every event on the calendar.
                        appState.pendingScheduleMyShifts = true
                        appState.selectedTab = 4
                    },
                    emptyMessage: clearSummary(dash)
                )
                if HomeActionQueue.hasActions(in: dash, currentUserId: session.currentUser?.id) {
                    HomeActionQueue(
                        dash: dash,
                        openBookingSummary: { summary in
                            rememberSceneDestination("booking", id: summary.id)
                            navigationPath.append(summary)
                        },
                        openEventWork: { selectedEventWork = $0 },
                        currentUserId: session.currentUser?.id,
                        openBookings: { appState.selectedTab = 1 },
                        openSchedule: {
                        // The Shifts count is personal, so the screen it opens
                        // is scoped to match rather than dropping the reader
                        // into every event on the calendar.
                        appState.pendingScheduleMyShifts = true
                        appState.selectedTab = 4
                    }
                    )
                // Both halves, not either: "You're all set" sat directly above
                // a populated Drafts card whenever the personal queue happened
                // to be empty, because `isAllEmpty` alone was enough to pass.
                } else if isAllEmpty(dash) && !hasStaffFollowUp(dash) {
                    AllClearEmptyState(openSearch: { appState.presentSearch() })
                }
                let teamEvents = teamScheduleEvents(dash)
                if !teamEvents.isEmpty {
                    TeamScheduleCard(events: teamEvents, openFullSchedule: { appState.selectedTab = 4 })
                }
                if dash.isStaff {
                    staffExceptionSection(dash)
                }
            }
            .padding(Brand.Space.md)
        }
    }

    /// Events on the team calendar that this person is not already working,
    /// since Next Up lists those. A short list fills the space a shift-only
    /// Home would otherwise leave empty.
    private func teamScheduleEvents(_ dash: DashboardData) -> [DashboardUpcomingEvent] {
        let mine = Set(dash.myEventWork.map(\.event.id))
        return Array(
            dash.upcomingEvents
                .filter { !mine.contains($0.id) && $0.endsAt > .now }
                .sorted { $0.startsAt < $1.startsAt }
                .prefix(3)
        )
    }

    /// The line shown when nothing is overdue, due, or waiting. Says when the
    /// next shift is, so a quiet Home still answers "what's next".
    private func clearSummary(_ dash: DashboardData) -> String {
        let next = dash.myEventWork.map(\.shift.startsAt).filter { $0 > .now }.min()
        guard let next else { return "Nothing overdue, due today, or waiting on you" }
        return "Nothing due. Next shift \(queueWhen(next))"
    }

    private func hasStaffFollowUp(_ dash: DashboardData) -> Bool {
        !dash.flaggedItems.isEmpty || !dash.lostBulkUnits.isEmpty || !dash.drafts.isEmpty
    }

    @ViewBuilder
    private func staffExceptionSection(_ dash: DashboardData) -> some View {
        if !dash.flaggedItems.isEmpty || !dash.lostBulkUnits.isEmpty || !dash.drafts.isEmpty {
            VStack(alignment: .leading, spacing: Brand.Space.sm) {
                FlatSectionTitle("Staff Follow-Up")
                if !dash.flaggedItems.isEmpty {
                    FlaggedItemsBanner(items: dash.flaggedItems)
                }
                if dash.isAdmin && !dash.lostBulkUnits.isEmpty {
                    LostBulkUnitsBanner(items: dash.lostBulkUnits)
                }
                if !dash.drafts.isEmpty {
                    DashboardCard(title: "Drafts") {
                        ForEach(dash.drafts) { draft in
                            Button {
                                // A reservation draft is unfinished work, so
                                // resume it in the composer. Checkout drafts
                                // are web-only, and keep the detail route.
                                if draft.isReservation {
                                    Task { await drafts.resume(draftId: draft.id) }
                                } else {
                                    rememberSceneDestination("booking", id: draft.id)
                                    navigationPath.append(draft.id)
                                }
                            } label: {
                                DraftRow(draft: draft)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            mainContent
                .background(Color(.systemGroupedBackground).ignoresSafeArea())
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        rememberSceneDestination("profile")
                        navigationPath.append(ProfileRoute())
                    } label: {
                        AccountAvatar(size: 32)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Profile")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        showNotifications = true
                    } label: {
                        // Neutral when nothing is waiting — an accent-red bell
                        // reads as an alert on an otherwise all-clear screen.
                        if appState.unreadNotifCount > 0 {
                            Image(systemName: "bell.badge.fill")
                                .symbolRenderingMode(.multicolor)
                                .foregroundStyle(Color.brandPrimary)
                        } else {
                            Image(systemName: "bell")
                                .foregroundStyle(.primary)
                        }
                    }
                    .accessibilityLabel(appState.unreadNotifCount > 0 ? "\(appState.unreadNotifCount) unread notifications" : "Notifications")
                }
            }
            .nativeScrollBarMinimization()
            // Walking back into signal should not require noticing the list is
            // stale and pulling it down. Gated on the visible tab so a
            // reconnection does not fan out into a refetch from every tab that
            // happens to still be alive.
            .onChange(of: network.reconnectionToken) { _, _ in
                guard appState.selectedTab == 0 else { return }
                Task { await vm.load(appState: appState, requesterId: session.currentUser?.id, forceRefresh: true) }
            }
            .refreshable {
                // Concurrent, not sequential: the blast banner must not wait on the
                // dashboard query, and must not be suppressed if it fails.
                async let blasts: Void = vm.loadBlasts()
                await vm.load(appState: appState, requesterId: session.currentUser?.id, forceRefresh: true)
                await blasts
            }
            .task {
                if firstUsefulRenderSignpost == nil, !didLogFirstUsefulRender {
                    firstUsefulRenderSignpost = AppPerformanceSignposts.begin("FirstUsefulHome")
                }
                async let blasts: Void = vm.loadBlasts()
                await vm.load(appState: appState, requesterId: session.currentUser?.id)
                await blasts
            }
            .onChange(of: appState.pendingPushBlastId) { _, id in
                if id != nil {
                    appState.pendingPushBlastId = nil
                    Task { await vm.loadBlasts() }
                }
            }
            .onChange(of: appState.pendingPushBookingId) { _, id in
                if let id {
                    rememberSceneDestination("booking", id: id)
                    navigationPath.append(id)
                    appState.pendingPushBookingId = nil
                }
            }
            .onChange(of: appState.pendingPushAssetId) { _, id in
                if let id {
                    rememberSceneDestination("asset", id: id)
                    navigationPath.append(AssetRouteId(id: id))
                    appState.pendingPushAssetId = nil
                }
            }
            .onChange(of: appState.pendingPushUserId) { _, id in
                if let id {
                    rememberSceneDestination("user", id: id)
                    navigationPath.append(UserRouteId(id: id))
                    appState.pendingPushUserId = nil
                }
            }
            .onChange(of: appState.pendingNotificationsInbox) { _, openInbox in
                guard openInbox else { return }
                appState.pendingNotificationsInbox = false
                showNotifications = true
            }
            .onChange(of: appState.pendingTradeBoard) { _, openTrades in
                guard openTrades else { return }
                appState.pendingTradeBoard = false
                showTrades = true
            }
            .onAppear {
                restoreHomeSceneIfNeeded()
                routePendingSettings()
                consumePendingHomeRoutes()
            }
            .onChange(of: appState.pendingSettingsRoute) { _, _ in
                routePendingSettings()
            }
            .onChange(of: navigationPath.count) { _, count in
                if count == 0 {
                    clearSceneDestination()
                }
            }
            .onChange(of: appState.tabResetToken) { _, _ in
                guard appState.resetTab == 0 else { return }
                navigationPath = NavigationPath()
                clearSceneDestination()
                showNotifications = false
                showTrades = false
                selectedEventWork = nil
            }
            .navigationDestination(for: BookingSummary.self) { summary in
                BookingDetailView(bookingId: summary.id)
            }
            .navigationDestination(for: String.self) { id in
                BookingDetailView(bookingId: id)
            }
            .navigationDestination(for: AssetRouteId.self) { route in
                ItemDetailView(assetId: route.id)
            }
            .navigationDestination(for: UserRouteId.self) { route in
                UserDetailView(userId: route.id)
            }
            .navigationDestination(for: ProfileRoute.self) { route in
                ProfileView(
                    wrapsInNavigationStack: false,
                    initialDestination: route.initialDestination
                )
            }
            .navigationDestination(
                isPresented: Binding(
                    get: { selectedEventWork != nil },
                    set: { if !$0 { selectedEventWork = nil } }
                )
            ) {
                if let work = selectedEventWork {
                    EventDetailView(event: work.asScheduleEvent, myShift: nil, eventWork: work)
                }
            }
            .sheet(isPresented: $showNotifications, onDismiss: {
                Task { await appState.refresh(forceRefresh: true) }
                if let route = pendingInboxRoute {
                    pendingInboxRoute = nil
                    appState.apply(route)
                }
            }) {
                NotificationsSheet { route in
                    pendingInboxRoute = route
                }
            }
            .sheet(isPresented: $showTrades) {
                TradeBoardSheet(
                    myShifts: tradeMyShifts,
                    currentUserId: session.currentUser?.id ?? "",
                    currentUserRole: session.currentUser?.role ?? ""
                )
                // Loaded with the sheet rather than on every Home render, so a
                // screen most people never open costs nothing. Browsing and
                // claiming still work if it fails; only Post needs this list.
                .task { await loadTradeMyShifts() }
            }
        }
    }
}

// MARK: - Dashboard Hero

private struct DashboardHero: View {
    let name: String

    private var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? ""
    }

    private var greeting: String {
        let calendar = Calendar.current
        let dayOrdinal = calendar.ordinality(of: .day, in: .era, for: .now) ?? calendar.component(.day, from: .now)
        let variants: [String]

        switch calendar.component(.hour, from: .now) {
        case 5..<12:
            variants = ["Good morning", "Morning", "Good to see you"]
        case 12..<17:
            variants = ["Good afternoon", "Afternoon", "Good to see you"]
        case 17..<22:
            variants = ["Good evening", "Evening", "Welcome back"]
        default:
            variants = ["Hello", "Welcome back", "Good to see you"]
        }

        return variants[dayOrdinal % variants.count]
    }

    private var displayDate: String {
        Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    private var accessibilityGreeting: String {
        firstName.isEmpty ? greeting : "\(greeting), \(firstName)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(displayDate)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(0.6)
            Text(accessibilityGreeting)
                .font(.system(size: 32, weight: .heavy))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, Brand.Space.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(displayDate), \(accessibilityGreeting)")
    }
}

// MARK: - Stat Strip

private struct StatStrip: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let stats: DashboardStats
    let pendingPickupCount: Int
    let shiftCount: Int
    let openBookings: () -> Void
    let openAttention: () -> Void
    let openSchedule: () -> Void
    /// Shown when no tile applies; says what is next instead of only what is not.
    let emptyMessage: String

    private var activeItems: [StatItem] {
        var items: [StatItem] = []
        if stats.overdue > 0 {
            items.append(StatItem(id: "overdue", value: stats.overdue, label: "Overdue", systemImage: "exclamationmark.triangle.fill", tone: .red, action: openAttention))
        }
        if stats.dueToday > 0 {
            items.append(StatItem(id: "due-today", value: stats.dueToday, label: "Due Today", systemImage: "clock.fill", tone: .orange, action: openAttention))
        }
        if pendingPickupCount > 0 {
            // Orange, matching PENDING_PICKUP everywhere else. Green reads as
            // "available, nothing needed", and this is the one state that
            // cancels itself and releases the gear after 48 unattended hours.
            items.append(StatItem(id: "pickups", value: pendingPickupCount, label: pendingPickupCount == 1 ? "Pickup" : "Pickups", systemImage: "shippingbox.fill", tone: .orange, action: openBookings))
        }
        // Next Up lists up to three shifts itself, so a tile that repeats them
        // only earns its place once the list has to overflow.
        if shiftCount > 3 {
            items.append(StatItem(id: "shifts", value: shiftCount, label: shiftCount == 1 ? "Shift" : "Shifts", systemImage: "calendar", tone: .blue, action: openSchedule))
        }
        return items
    }

    /// No freshness stamp here. Pull-to-refresh is the freshness indicator: it
    /// says when the data moved and who asked for it, where a "Synced 2 minutes
    /// ago" line only ever invited a second look at a number that was already
    /// current.
    var body: some View {
        VStack(alignment: .trailing, spacing: Brand.Space.sm) {
            if activeItems.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle")
                        .font(.caption.weight(.semibold))
                        .accessibilityHidden(true)
                    Text(emptyMessage)
                        .font(.caption)
                    Spacer(minLength: 8)
                }
                .foregroundStyle(.secondary)
                .accessibilityElement(children: .combine)
            } else {
                // Tiles pair up two to a row. A tile left without a partner (a
                // lone metric, or the odd one out) spans the row as a compact
                // number-and-label strip rather than leaving a hole beside it.
                let rows = dynamicTypeSize.isAccessibilitySize
                    ? activeItems.map { [$0] }
                    : stride(from: 0, to: activeItems.count, by: 2).map {
                        Array(activeItems[$0..<min($0 + 2, activeItems.count)])
                    }
                VStack(spacing: Brand.Space.sm) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        HStack(spacing: Brand.Space.sm) {
                            ForEach(row) { item in
                                StatRow(item: item, isWide: row.count == 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct StatItem: Identifiable {
    let id: String
    let value: Int
    let label: String
    let systemImage: String
    let tone: StatusTone
    let action: () -> Void
}

private struct StatRow: View {
    let item: StatItem
    var isWide = false

    private var valueText: some View {
        Text("\(item.value)")
            .font(.system(size: 34, weight: .heavy))
            .monospacedDigit()
            .foregroundStyle(Color.statusText(item.tone))
            .contentTransition(.numericText())
    }

    private var labelText: some View {
        Text(item.label)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
    @State private var hapticTrigger = false

    var body: some View {
        Button(action: {
            hapticTrigger.toggle()
            item.action()
        }) {
            // The number is the point of the tile: no icon square, no chevron.
            Group {
                if isWide {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        valueText
                        labelText
                        Spacer(minLength: 0)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        valueText
                        labelText
                    }
                }
            }
            .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.label): \(item.value)")
        .accessibilityHint("Opens related work")
    }
}

private struct StatStripSkeleton: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: dynamicTypeSize.isAccessibilitySize ? 1 : 2), spacing: Brand.Space.sm) {
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    Skeleton().frame(width: 36, height: 30)
                    Skeleton().frame(width: 72, height: 14)
                }
                .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
            }
        }
        .accessibilityHidden(true)  // Don't pollute VO with placeholder shapes during initial load.
    }
}

// MARK: - Action Queue

private struct HomeActionQueue: View {
    let dash: DashboardData
    let openBookingSummary: (BookingSummary) -> Void
    let openEventWork: (DashboardEventWork) -> Void
    let currentUserId: String?
    let openBookings: () -> Void
    let openSchedule: () -> Void

    private func shiftLinked(to summary: BookingSummary) -> DashboardShift? {
        let ids = Set(summary.eventIds + [summary.linkedEventId, summary.eventId].compactMap { $0 })
        guard !ids.isEmpty else { return nil }
        return dash.myShifts
            .filter { ids.contains($0.event.id) }
            .sorted { $0.startsAt < $1.startsAt }
            .first
    }

    private func gearInstruction(for summary: BookingSummary) -> String {
        let time = summary.startsAt.formatted(date: .omitted, time: .shortened)
        if summary.status == .pendingPickup && summary.startsAt < Date() {
            return "Pickup gear now"
        }
        return "Pickup gear at \(time)"
    }

    private func itemCountLabel(for summary: BookingSummary) -> String {
        "\(summary.itemCount) item\(summary.itemCount == 1 ? "" : "s")"
    }

    private func personalContext(for summary: BookingSummary) -> String {
        let parts = [summary.locationName, itemCountLabel(for: summary)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? summary.title : parts.joined(separator: " · ")
    }

    private func eventDetailLines(for summary: BookingSummary) -> [QueueDetailLine] {
        var lines = [QueueDetailLine(text: gearInstruction(for: summary), tone: queueGearTone(for: summary))]
        if let shift = shiftLinked(to: summary), let callTime = queueCallTime(workerType: shift.workerType, callStartsAt: shift.callStartsAt) {
            lines.append(QueueDetailLine(text: callTime, tone: .blue))
        }
        return lines
    }

    /// Everything that isn't overdue, interleaved by the time it actually
    /// happens. Grouping by category instead put a Sunday shift above a
    /// checkout due Thursday, which reads as an ordering bug on a list whose
    /// whole job is "what's next". Overdue stays pinned above this.
    private func makeDisplayedEntries() -> [QueueEntry] {
        let eventLinkedGearIds = Set(dash.myEventWork.flatMap { $0.gearBookings.map(\.id) })
        var overdueBookings: [BookingSummary] = []
        var dueTodayBookings: [BookingSummary] = []
        var upcomingCheckouts: [BookingSummary] = []
        var seenDueToday = Set<String>()

        for summary in dash.myCheckouts.items {
            if summary.isOverdue {
                overdueBookings.append(summary)
            } else if Calendar.current.isDateInToday(summary.endsAt) {
                if seenDueToday.insert(summary.id).inserted {
                    dueTodayBookings.append(summary)
                }
            } else {
                upcomingCheckouts.append(summary)
            }
        }

        let standalonePendingPickups: [BookingSummary]
        if let currentUserId {
            standalonePendingPickups = dash.pendingPickups.items.filter {
                $0.requesterUserId == currentUserId && !eventLinkedGearIds.contains($0.id)
            }
        } else {
            standalonePendingPickups = []
        }
        let standaloneReservations = dash.myReservations.filter {
            !eventLinkedGearIds.contains($0.id)
        }

        var entries: [QueueEntry] = []
        entries += dueTodayBookings.prefix(3).map {
            QueueEntry(id: "due-today-\($0.id)", sortsAt: $0.endsAt, kind: .dueToday($0))
        }
        entries += standalonePendingPickups.prefix(3).map {
            QueueEntry(id: "pickup-\($0.id)", sortsAt: $0.startsAt, kind: .pendingPickup($0))
        }
        entries += standaloneReservations.prefix(3).map {
            QueueEntry(id: "reservation-\($0.id)", sortsAt: $0.startsAt, kind: .reservation($0))
        }
        entries += dash.myEventWork.prefix(3).map {
            QueueEntry(id: "event-\($0.id)", sortsAt: eventWorkSortDate(for: $0), kind: .eventWork($0))
        }
        entries += upcomingCheckouts.prefix(3).map {
            QueueEntry(id: "checkout-\($0.id)", sortsAt: $0.endsAt, kind: .upcomingCheckout($0))
        }
        let chronological = entries.sorted {
            $0.sortsAt == $1.sortsAt ? $0.id < $1.id : $0.sortsAt < $1.sortsAt
        }
        // Overdue is not capped. Every other lane can hide its tail behind a
        // "more" row, but silently dropping the fourth overdue checkout hides
        // the most urgent thing on the screen behind no affordance at all.
        let overdue = overdueBookings.map {
            QueueEntry(id: "overdue-\($0.id)", sortsAt: $0.endsAt, kind: .overdue($0))
        }
        return overdue + chronological
    }

    /// What the per-lane caps above left out, so the queue can say so instead
    /// of ending on an arbitrary third row.
    private func hiddenCounts() -> (gear: Int, shifts: Int) {
        let eventLinkedGearIds = Set(dash.myEventWork.flatMap { $0.gearBookings.map(\.id) })
        var dueToday = 0
        var upcoming = 0
        var seenDueToday = Set<String>()
        for summary in dash.myCheckouts.items where !summary.isOverdue {
            if Calendar.current.isDateInToday(summary.endsAt) {
                if seenDueToday.insert(summary.id).inserted { dueToday += 1 }
            } else {
                upcoming += 1
            }
        }
        let pickups = currentUserId.map { id in
            dash.pendingPickups.items.filter {
                $0.requesterUserId == id && !eventLinkedGearIds.contains($0.id)
            }.count
        } ?? 0
        let reservations = dash.myReservations.filter { !eventLinkedGearIds.contains($0.id) }.count
        let gear = max(0, dueToday - 3) + max(0, pickups - 3)
            + max(0, reservations - 3) + max(0, upcoming - 3)
        let shifts = max(0, dash.myEventWork.count - 3)
        return (gear: gear, shifts: shifts)
    }

    /// Mirrors `EventActionQueueRow.firstTime` so a row sorts on the same
    /// moment it displays.
    private func eventWorkSortDate(for work: DashboardEventWork) -> Date {
        min(work.primaryGear?.startsAt ?? work.shift.startsAt, work.shift.startsAt)
    }

    @ViewBuilder
    private func row(for entry: QueueEntry) -> some View {
        switch entry.kind {
        case .overdue(let summary):
            ActionQueueRow(
                tone: queueGearTone(for: summary),
                systemImage: entry.systemImage,
                title: summary.title,
                subtitle: personalContext(for: summary),
                meta: summary.endsAt.overdueLabel,
                action: { openBookingSummary(summary) }
            )
        case .dueToday(let summary):
            ActionQueueRow(
                tone: queueGearTone(for: summary),
                systemImage: entry.systemImage,
                title: summary.title,
                subtitle: personalContext(for: summary),
                meta: "Due \(queueWhen(summary.endsAt))",
                action: { openBookingSummary(summary) }
            )
        case .pendingPickup(let summary):
            ActionQueueRow(
                tone: queueGearTone(for: summary),
                systemImage: entry.systemImage,
                title: summary.title,
                subtitle: summary.linkedEventId == nil ? personalContext(for: summary) : nil,
                meta: summary.startsAt < Date()
                    ? "Pickup \(summary.startsAt.lateLabel)"
                    : "Pickup \(queueWhen(summary.startsAt))",
                detailLines: summary.linkedEventId == nil ? [] : eventDetailLines(for: summary),
                action: { openBookingSummary(summary) }
            )
        case .reservation(let summary):
            ActionQueueRow(
                tone: queueGearTone(for: summary),
                systemImage: entry.systemImage,
                title: summary.title,
                subtitle: summary.linkedEventId == nil ? personalContext(for: summary) : nil,
                meta: queueWhen(summary.startsAt),
                detailLines: summary.linkedEventId == nil ? [] : eventDetailLines(for: summary),
                action: { openBookingSummary(summary) }
            )
        case .eventWork(let work):
            EventActionQueueRow(
                work: work,
                systemImage: entry.systemImage,
                openEventWork: openEventWork
            )
        case .upcomingCheckout(let summary):
            ActionQueueRow(
                tone: queueGearTone(for: summary),
                systemImage: entry.systemImage,
                title: summary.title,
                subtitle: personalContext(for: summary),
                meta: "Due \(queueWhen(summary.endsAt))",
                action: { openBookingSummary(summary) }
            )
        }
    }

    static func hasActions(in dash: DashboardData, currentUserId: String?) -> Bool {
        let hasMyPendingPickup = currentUserId.map { id in
            dash.pendingPickups.items.contains { $0.requesterUserId == id }
        } ?? false
        return dash.myCheckouts.items.contains(where: \.isOverdue)
            || hasMyPendingPickup
            || !dash.myReservations.isEmpty
            || !dash.myEventWork.isEmpty
            || !dash.myCheckouts.items.isEmpty
    }

    /// Overdue, then what lands before tomorrow, then the rest. Entries are
    /// already ordered overdue-first then chronologically, so each bucket is
    /// one contiguous run and a label only has to mark where it starts.
    private enum Bucket: String {
        case overdue = "Overdue"
        case today = "Today"
        case later = "Later"
    }

    private func bucket(for entry: QueueEntry) -> Bucket {
        if case .overdue = entry.kind { return .overdue }
        let tomorrow = Calendar.current.startOfDay(for: .now).addingTimeInterval(86_400)
        return entry.sortsAt < tomorrow ? .today : .later
    }

    var body: some View {
        let entries = makeDisplayedEntries()
        let buckets = entries.map(bucket(for:))
        let showsLabels = Set(buckets).count > 1
        let hidden = hiddenCounts()
        VStack(alignment: .leading, spacing: 4) {
            header
                .padding(.bottom, 4)

            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    if showsLabels, index == 0 || buckets[index] != buckets[index - 1] {
                        BucketLabel(text: buckets[index].rawValue, isFirst: index == 0)
                    }
                    row(for: entry)
                    let continuesBucket = index < entries.count - 1 && buckets[index + 1] == buckets[index]
                    if continuesBucket || (index == entries.count - 1 && hidden.gear + hidden.shifts > 0) {
                        // Inset to the title, past the glyph column.
                        Divider().overlay(Color.flatDivider).padding(.leading, 30)
                    }
                }
                if hidden.gear + hidden.shifts > 0 {
                    QueueOverflowRow(
                        gear: hidden.gear,
                        shifts: hidden.shifts,
                        openBookings: openBookings,
                        openSchedule: openSchedule
                    )
                }
            }
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }

    private var header: some View {
        FlatSectionTitle("Next Up")
    }
}

/// Quiet time-bucket label inside the Next Up card.
private struct BucketLabel: View {
    let text: String
    let isFirst: Bool

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .tracking(0.6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, isFirst ? 6 : 14)
            .padding(.bottom, 2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Names what the per-lane caps left out. The queue used to end on an arbitrary
/// third row with nothing to say more existed, so a student with five shifts
/// today saw three and no reason to look further.
/// The next few events on the team calendar that this person is not working.
private struct TeamScheduleCard: View {
    let events: [DashboardUpcomingEvent]
    let openFullSchedule: () -> Void
    @State private var hapticTrigger = false

    private func title(_ event: DashboardUpcomingEvent) -> String {
        if let raw = event.opponent, !raw.isEmpty {
            let name = scheduleOpponentParts(raw).name
            let preposition = event.isHome == false ? "at" : "vs"
            let sport = sportLabel(event.sportCode)
            return [sport, "\(preposition) \(name)"].compactMap { $0 }.joined(separator: " ")
        }
        let cleaned = cleanScheduleEventSummary(event.title)
        return cleaned.isEmpty ? "Event" : cleaned
    }

    private func supporting(_ event: DashboardUpcomingEvent) -> String {
        let calendar = Calendar.current
        let day: String
        if calendar.isDateInToday(event.startsAt) {
            day = "Today"
        } else if calendar.isDateInTomorrow(event.startsAt) {
            day = "Tomorrow"
        } else {
            day = event.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        let open = event.totalShiftSlots - event.filledShiftSlots
        let coverage = event.totalShiftSlots > 0
            ? (open > 0 ? "\(open) open" : "Fully staffed")
            : nil
        return [day, coverage].compactMap { $0 }.joined(separator: " · ")
    }

    private func time(_ event: DashboardUpcomingEvent) -> String {
        if event.allDay { return event.sportCode == "FB" ? "TBD" : "All day" }
        return event.startsAt.formatted(date: .omitted, time: .shortened)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FlatSectionTitle("On the Schedule")
                .padding(.bottom, 4)
            ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                Button {
                    hapticTrigger.toggle()
                    openFullSchedule()
                } label: {
                    QueueRowLayout(
                        tone: .gray,
                        systemImage: "calendar",
                        title: title(event),
                        supporting: supporting(event),
                        meta: time(event)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(title(event)), \(supporting(event)), \(time(event))")
                if index < events.count - 1 {
                    Divider().overlay(Color.flatDivider).padding(.leading, 30)
                }
            }
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }
}

/// Placeholder shaped like `QueueRowLayout`: glyph, two text lines, time.
private struct QueueRowSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Skeleton(cornerRadius: 4).frame(width: 18, height: 18)
                .padding(.top, 3)
            VStack(alignment: .leading, spacing: 6) {
                Skeleton().frame(width: 190, height: 16)
                Skeleton().frame(width: 130, height: 12)
            }
            Spacer(minLength: 8)
            Skeleton().frame(width: 64, height: 12)
                .padding(.top, 4)
        }
        .padding(.vertical, 10)
        .frame(minHeight: 44)
    }
}

private struct QueueOverflowRow: View {
    let gear: Int
    let shifts: Int
    let openBookings: () -> Void
    let openSchedule: () -> Void
    @State private var hapticTrigger = false

    /// One kind names itself and routes to the tab that owns it. Mixed sends to
    /// Bookings, which holds the larger share, and says so rather than implying
    /// everything is there.
    private var label: String {
        if shifts == 0 { return "\(gear) more in Bookings" }
        if gear == 0 { return shifts == 1 ? "1 more shift in Schedule" : "\(shifts) more shifts in Schedule" }
        return "\(gear + shifts) more in Bookings and Schedule"
    }

    private var action: () -> Void {
        gear == 0 ? openSchedule : openBookings
    }

    var body: some View {
        Button {
            hapticTrigger.toggle()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "ellipsis.circle")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 18)
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, Brand.Space.sm)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
    }
}

/// When something lands, in the form that reads fastest: minutes or hours out
/// for the next few hours, then a clock time today, "Tomorrow" plus a time, a
/// weekday inside the week, and a date beyond it. Evaluated when the row
/// renders; Home refreshes on foreground, so it is never read stale for long.
private func queueWhen(_ date: Date, now: Date = .now) -> String {
    let time = date.formatted(date: .omitted, time: .shortened)
    let delta = date.timeIntervalSince(now)
    if delta > 0 && delta < 3 * 3_600 {
        let minutes = max(1, Int((delta / 60).rounded()))
        if minutes <= 90 { return "in \(minutes) min" }
        return "in \(Int((Double(minutes) / 60).rounded())) hr"
    }
    let calendar = Calendar.current
    if calendar.isDateInToday(date) { return time }
    if calendar.isDateInTomorrow(date) { return "Tomorrow \(time)" }
    if delta < 6 * 86_400 { return date.formatted(.dateTime.weekday(.abbreviated).hour().minute()) }
    return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
}

private struct QueueDetailLine {
    let text: String
    let tone: StatusTone
}

/// Gear rows still *compute* the booking-status tone from
/// `docs/COLOR_SYSTEM.md`: purple reserved, orange awaiting pickup, blue checked
/// out, red overdue, with the deadline overlay that takes an open checkout orange
/// on the day it is due. `QueueRowLayout` only *renders* the urgent tones (red,
/// orange); purple, blue, and gray resolve to the neutral secondary style so
/// colour on Home means "needs you now", not "which kind of booking".
private func queueGearTone(for summary: BookingSummary) -> StatusTone {
    if summary.isOverdue { return .red }
    switch summary.status {
    case .booked: return .purple
    case .pendingPickup: return .orange
    case .open: return Calendar.current.isDateInToday(summary.endsAt) ? .orange : .blue
    default: return .gray
    }
}

/// Shift rows still compute the scheduling domain's venue tone through the
/// shared `venueTone`, but Home renders it neutral: a green or blue venue tone is
/// not urgent, so only the box-versus-calendar glyph says which kind of row this
/// is. Venue colour lives on the Schedule tab.
private func queueVenueTone(for event: DashboardEventWorkEvent) -> StatusTone {
    venueTone(isHome: event.isHome)
}

/// Students are told when to report. Staff assignments deliberately carry no
/// call-time line because their timing is established outside Schedule.
private func queueCallTime(workerType: String, callStartsAt: Date?) -> String? {
    guard workerType == "ST", let callStartsAt else { return nil }
    return "Call time \(callStartsAt.formatted(date: .omitted, time: .shortened))"
}

/// Next Up titles are the Bookings list's titles: same Gotham face, same size.
/// The two lists name the same work, so a row should not change typeface on the
/// way from Home to Bookings.
private struct QueueRowTitle: View {
    let text: String
    let wraps: Bool

    init(_ text: String, wraps: Bool = false) {
        self.text = text
        self.wraps = wraps
    }

    var body: some View {
        Text(text)
            .font(.gothamBold(size: 16))
            .foregroundStyle(.primary)
            .lineLimit(wraps ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A Next Up row plus the moment it sorts on, so rows of different kinds can
/// share one chronological list.
private struct QueueEntry: Identifiable {
    enum Kind {
        case overdue(BookingSummary)
        case dueToday(BookingSummary)
        case pendingPickup(BookingSummary)
        case reservation(BookingSummary)
        case eventWork(DashboardEventWork)
        case upcomingCheckout(BookingSummary)
    }

    let id: String
    let sortsAt: Date
    let kind: Kind

    /// Gear rows and shift rows sit interleaved in one chronological list, so
    /// each carries the glyph its kind uses in the stat strip above: a box for
    /// anything about gear, a calendar for event work.
    var systemImage: String {
        switch kind {
        case .eventWork: "calendar"
        default: "shippingbox.fill"
        }
    }
}

private struct EventActionQueueRow: View {
    let work: DashboardEventWork
    let systemImage: String
    let openEventWork: (DashboardEventWork) -> Void
    @State private var hapticTrigger = false

    /// Venue, not gear readiness. Whether gear is still needed is a fact for the
    /// detail sheet. The tone is computed for parity with Schedule, but the row
    /// renders it neutral (see `QueueRowLayout`).
    private var tone: StatusTone { queueVenueTone(for: work.event) }
    private var scheduleEvent: ScheduleEvent { work.asScheduleEvent }
    private var isAllDayEvent: Bool { scheduleEvent.displayAllDay }

    /// "Football vs Notre Dame", the same construction the Schedule tab uses,
    /// rather than the raw calendar summary this row used to print.
    private var title: String { scheduleEventDisplayTitle(scheduleEvent) }

    /// "Sunday, September 6". The date owns a line of its own now, which is why
    /// the meta column no longer repeats a weekday.
    private var dateLine: String {
        let days = scheduleEvent.spannedDays
        guard scheduleEvent.isMultiDay, let first = days.first, let last = days.last else {
            return (days.first ?? work.event.startsAt)
                .formatted(.dateTime.weekday(.wide).month(.wide).day())
        }
        let start = first.formatted(.dateTime.month(.wide).day())
        // Same month reads as "September 6 - 7", not "September 6 - September 7".
        let sameMonth = Calendar.current.isDate(first, equalTo: last, toGranularity: .month)
        let end = sameMonth
            ? last.formatted(.dateTime.day())
            : last.formatted(.dateTime.month(.wide).day())
        return "\(start) - \(end)"
    }

    /// Student assignments have an explicit report time. Staff do not.
    private var callTimeLine: String? {
        guard !isAllDayEvent else { return nil }
        return queueCallTime(workerType: work.shift.workerType, callStartsAt: work.shift.callStartsAt)
    }

    /// When the event itself starts. The gear a shift needs is stated on its
    /// own Next Up row and in the event detail sheet; restating it here made a
    /// four-line row out of what is fundamentally "where to be, and when".
    private var timeMeta: String {
        isAllDayEvent ? scheduleAllDayLabel(scheduleEvent) : work.event.startsAt.formatted(date: .omitted, time: .shortened)
    }

    private var supportingLine: String {
        [dateLine, scheduleEventPromotion(scheduleEvent), callTimeLine].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        Button {
            hapticTrigger.toggle()
            openEventWork(work)
        } label: {
            QueueRowLayout(
                tone: tone,
                systemImage: systemImage,
                title: title,
                supporting: supportingLine,
                meta: timeMeta
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [title, dateLine]
        if let callTimeLine { parts.append(callTimeLine) }
        parts.append(timeMeta)
        return parts.joined(separator: ", ")
    }
}

/// One Next Up row: kind glyph, Gotham title over a single supporting line, and
/// the time on the trailing edge. Only the problem tones (overdue, due today)
/// colour the time; every other state reads in the neutral secondary tone, so
/// colour means "needs you now" instead of "which kind of booking".
private struct QueueRowLayout: View {
    let tone: StatusTone
    let systemImage: String
    let title: String
    let supporting: String
    let meta: String

    private var metaStyle: Color {
        tone == .red || tone == .orange ? Color.statusText(tone) : .secondary
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            QueueKindGlyph(systemImage: systemImage, tone: tone)
                .padding(.top, 3)

            VStack(alignment: .leading, spacing: 3) {
                QueueRowTitle(title, wraps: true)
                if !supporting.isEmpty {
                    Text(supporting)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(meta)
                .font(.caption.weight(.semibold))
                .foregroundStyle(metaStyle)
                .multilineTextAlignment(.trailing)
                .padding(.top, 3)
        }
        .multilineTextAlignment(.leading)
        .padding(.vertical, 10)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

private struct ActionQueueRow: View {
    let tone: StatusTone
    let systemImage: String
    let title: String
    let subtitle: String?
    let meta: String
    var detailLines: [QueueDetailLine] = []
    let action: () -> Void
    @State private var hapticTrigger = false

    private var supporting: String {
        detailLines.isEmpty ? (subtitle ?? "") : detailLines.map(\.text).joined(separator: " · ")
    }

    var body: some View {
        Button {
            hapticTrigger.toggle()
            action()
        } label: {
            QueueRowLayout(
                tone: tone,
                systemImage: systemImage,
                title: title,
                supporting: supporting,
                meta: meta
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        let detail = detailLines.isEmpty ? (subtitle ?? "") : detailLines.map(\.text).joined(separator: ", ")
        return "\(title), \(detail), \(meta)."
    }
}

/// Kind marker for a Next Up row: a box for gear, a calendar for event work,
/// reusing the stat strip's glyph vocabulary so the two blocks of the home
/// screen name the same things the same way.
private struct QueueKindGlyph: View {
    let systemImage: String
    let tone: StatusTone

    var body: some View {
        Image(systemName: systemImage)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(tone == .red || tone == .orange ? AnyShapeStyle(Color.statusText(tone)) : AnyShapeStyle(.secondary))
            .frame(width: 18)
            .accessibilityHidden(true)
    }
}

// MARK: - Refresh Failure Pill

private struct RefreshFailurePill: View {
    let message: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.statusText(.orange))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("Couldn't refresh")
                    .font(.caption.weight(.semibold))
                Text(message.isEmpty ? "Pull to try again." : message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
        }
        .flatCard(padding: 12, radius: Brand.Radius.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - All Clear Empty State

private struct AllClearEmptyState: View {
    let openSearch: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(spacing: 4) {
                Text("You're all set")
                    .font(.system(size: 20, weight: .heavy))
                Text("Use Search to look up gear or scan a code.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                openSearch()
            } label: {
                Label("Search or Scan", systemImage: "magnifyingglass")
            }
            .authButton(.primary, adaptive: true)
            .frame(maxWidth: 280)
            .padding(.top, 4)
        }
        .flatCard(padding: Brand.Space.xl, radius: Brand.Radius.md, alignment: .center)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Dashboard Card

// "See all" machinery removed: its only consumer (Drafts) routed to the
// Bookings tab, which never lists drafts, and the tap target was sub-44pt.
// Draft rows now navigate directly to booking detail instead.
private struct DashboardCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(0.3)
            content()
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }
}

// MARK: - Flagged Items Banner

private struct FlaggedItemsBanner: View {
    let items: [DashboardFlaggedItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text("\(items.count) Flagged Item\(items.count == 1 ? "" : "s")")
            } icon: {
                Image(systemName: "flag.fill").accessibilityHidden(true)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.statusText(.orange))

            ForEach(items) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.assetTag)
                            .font(.gothamBold(size: 16))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            if let assetName = item.assetName, !assetName.isSameListText(as: item.assetTag) {
                                Text(assetName)
                                Text("·")
                            }
                            Text(item.typeLabel)
                            if let title = item.bookingTitle {
                                Text("·")
                                Text(title)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    }
                    Spacer()
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(flaggedRowLabel(for: item))
                if item.id != items.last?.id { Divider().overlay(Color.flatDivider) }
            }
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }

    private func flaggedRowLabel(for item: DashboardFlaggedItem) -> String {
        var parts: [String] = ["Flagged: \(item.assetTag)"]
        if let assetName = item.assetName, !assetName.isSameListText(as: item.assetTag) {
            parts.append(assetName)
        }
        parts.append(item.typeLabel)
        if let title = item.bookingTitle { parts.append(title) }
        parts.append("tag \(item.assetTag)")
        return parts.joined(separator: ", ")
    }
}

// MARK: - Lost Bulk Units Banner

private struct LostBulkUnitsBanner: View {
    let items: [DashboardLostBulkUnit]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text("Lost Bulk Units")
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").accessibilityHidden(true)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.statusText(.red))

            ForEach(items, id: \.skuName) { item in
                HStack {
                    Text(item.skuName)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Spacer()
                    Text("\(item.count) missing")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.statusText(.red))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(item.skuName), \(item.count) missing")
            }
        }
        .flatCard(padding: Brand.Space.md, radius: Brand.Radius.md)
    }
}

// MARK: - Draft Row

private struct DraftRow: View {
    let draft: DashboardDraft

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: draft.isReservation ? "calendar.badge.clock" : "archivebox")
                .foregroundStyle(.secondary)
                .frame(width: 24)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(draft.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text("\(draft.itemCount) item\(draft.itemCount == 1 ? "" : "s")")
                    Text("·")
                    Text(draft.updatedAt.formatted(.relative(presentation: .named)))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Draft: \(draft.title), \(draft.itemCount) item\(draft.itemCount == 1 ? "" : "s"), updated \(draft.updatedAt.formatted(.relative(presentation: .named)))")
    }
}

// MARK: - Helpers

// `overdueLabel` / `lateLabel` live in DateFormats.swift with the other Date
// display helpers.
