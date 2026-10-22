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
    func loadBlasts(userId: String?) async {
        await retryPendingAcks()
        if let latest = try? await APIClient.shared.activeBlasts() {
            if let userId {
                BlastArchive.recordActive(latest, userId: userId)
            }
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
    @State private var selectedScheduleEvent: ScheduleEvent?
    @State private var reviewingFlag: DashboardFlaggedItem?
    @State private var feeds = HomeFeedsModel()
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

    @ViewBuilder private func dashboardScrollView(_ dash: DashboardData) -> some View {
        let role = dash.role
        HomeDashboardList(
            dash: dash,
            feeds: feeds,
            actions: HomeActions(
                openBooking: { id in
                    rememberSceneDestination("booking", id: id)
                    navigationPath.append(id)
                },
                openBookingSummary: { summary in
                    rememberSceneDestination("booking", id: summary.id)
                    navigationPath.append(summary)
                },
                openEventWork: { selectedEventWork = $0 },
                openShift: { shift in
                    // Prefer the richer event-work payload when the shift has
                    // one; otherwise open the event from the shift itself.
                    if let work = dash.myEventWork.first(where: { $0.event.id == shift.event.id }) {
                        selectedEventWork = work
                    } else {
                        selectedScheduleEvent = shift.asScheduleEvent
                    }
                },
                openFlagged: { item in
                    if item.isMaintenanceFlag {
                        navigationPath.append(AssetRouteId(id: item.assetId))
                    } else {
                        reviewingFlag = item
                    }
                },
                openDraft: { draft in
                    // A reservation draft is unfinished work, so resume it in
                    // the composer. Checkout drafts are web-only, and keep the
                    // detail route.
                    if draft.isReservation {
                        Task { await drafts.resume(draftId: draft.id) }
                    } else {
                        rememberSceneDestination("booking", id: draft.id)
                        navigationPath.append(draft.id)
                    }
                },
                openBookings: {
                    appState.pendingBookingsScope = BookingScope.all.rawValue
                    appState.selectedTab = 1
                },
                openSchedule: {
                    // The Up next list is personal, so the screen it opens is
                    // scoped to match rather than dropping the reader into
                    // every event on the calendar.
                    appState.pendingScheduleMyShifts = true
                    appState.selectedTab = 4
                },
                openSearch: { appState.presentSearch() },
                claimTrade: { id in Task { await feeds.claim(id, role: role) } },
                approveTrade: { id in Task { await feeds.approve(id, role: role) } }
            )
        ) {
            VStack(alignment: .leading, spacing: Brand.Space.md) {
                blastStack
                DashboardHero(
                    name: session.currentUser?.name ?? "",
                    summary: HomeModel.daySummary(dash: dash),
                    openProfile: {
                        rememberSceneDestination("profile")
                        navigationPath.append(ProfileRoute())
                    }
                )
                if vm.error != nil {
                    RefreshFailurePill(message: vm.error ?? "")
                }
                if let message = feeds.actionError {
                    RefreshFailurePill(message: message)
                }
            }
            .padding(.vertical, Brand.Space.xs)
        }
        .nativeScrollBarMinimization()
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            mainContent
                .background(Color(.systemGroupedBackground).ignoresSafeArea())
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        showNotifications = true
                    } label: {
                        // Neutral when nothing is waiting — an accent-red bell
                        // reads as an alert on an otherwise all-clear screen.
                        if appState.unreadNotifCount > 0 {
                            // Not red: overdue is the only red on Home.
                            Image(systemName: "bell.badge.fill")
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(.primary)
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
                async let blasts: Void = vm.loadBlasts(userId: session.currentUser?.id)
                await vm.load(appState: appState, requesterId: session.currentUser?.id, forceRefresh: true)
                await feeds.load(role: vm.dashboard?.role ?? "")
                await blasts
            }
            .task {
                if firstUsefulRenderSignpost == nil, !didLogFirstUsefulRender {
                    firstUsefulRenderSignpost = AppPerformanceSignposts.begin("FirstUsefulHome")
                }
                async let blasts: Void = vm.loadBlasts(userId: session.currentUser?.id)
                await vm.load(appState: appState, requesterId: session.currentUser?.id)
                await feeds.load(role: vm.dashboard?.role ?? "")
                await blasts
            }
            .onChange(of: appState.pendingPushBlastId) { _, id in
                if id != nil {
                    appState.pendingPushBlastId = nil
                    Task { await vm.loadBlasts(userId: session.currentUser?.id) }
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
                selectedScheduleEvent = nil
                reviewingFlag = nil
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
            .navigationDestination(
                isPresented: Binding(
                    get: { selectedScheduleEvent != nil },
                    set: { if !$0 { selectedScheduleEvent = nil } }
                )
            ) {
                if let event = selectedScheduleEvent {
                    EventDetailView(event: event, myShift: nil, eventWork: nil)
                }
            }
            .sheet(item: $reviewingFlag) { item in
                FlaggedReportSheet(
                    item: item,
                    onOpenItem: { id in navigationPath.append(AssetRouteId(id: id)) },
                    onChanged: {
                        Task { await vm.load(appState: appState, requesterId: session.currentUser?.id, forceRefresh: true) }
                    }
                )
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
    /// The web Home's one-sentence read of the day, in place of a counts line.
    let summary: String
    let openProfile: () -> Void

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
        HStack(alignment: .top, spacing: Brand.Space.sm) {
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
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(displayDate), \(accessibilityGreeting). \(summary)")
            Spacer(minLength: 0)
            // Your photo (or role-colored initials) lives with your name, not
            // inside a toolbar button that flattens it to a solid disc.
            Button(action: openProfile) {
                AccountAvatar(size: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Profile")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, Brand.Space.xs)
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

// MARK: - Flagged Report Sheet

/// Staff review of one damaged/lost report: the photo, the reporter's notes,
/// and the actions that follow from them. Maintenance is refetched from the
/// server, never guessed, because it changes what others can reserve.
private struct FlaggedReportSheet: View {
    let item: DashboardFlaggedItem
    let onOpenItem: (String) -> Void
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Brand.Space.md) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.assetTag).font(.gothamBold(size: 20))
                        Text([item.assetName, item.bookingTitle, item.reportedBy.map { "Reported by \($0)" }]
                            .compactMap { $0 }
                            .joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let urlString = item.imageUrl, let url = URL(string: urlString) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFit()
                            case .failure:
                                Label("Photo couldn't load", systemImage: "photo.badge.exclamationmark")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            default:
                                ProgressView().frame(maxWidth: .infinity, minHeight: 160)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.md))
                        .accessibilityLabel("Photo of the reported \(item.typeLabel.lowercased()) item")
                    } else {
                        Text("No photo was attached to this report.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let description = item.description, !description.isEmpty {
                        Text(description).font(.body)
                    }
                    if let errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(Color.statusText(.red))
                    }
                    Button {
                        Task { await toggleMaintenance() }
                    } label: {
                        Label(
                            item.isInMaintenance ? "Clear Maintenance" : "Needs Maintenance",
                            systemImage: item.isInMaintenance ? "checkmark.circle" : "wrench.and.screwdriver"
                        )
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isWorking)
                    Button {
                        dismiss()
                        onOpenItem(item.assetId)
                    } label: {
                        Label("Open Item", systemImage: "shippingbox").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(Brand.Space.md)
            }
            .navigationTitle("\(item.typeLabel) Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func toggleMaintenance() async {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            _ = try await APIClient.shared.toggleAssetMaintenance(assetId: item.assetId)
            Haptics.success()
            onChanged()
            dismiss()
        } catch {
            Haptics.error()
            errorMessage = (error as? APIError)?.errorDescription ?? "Couldn't update maintenance"
        }
    }
}

// MARK: - Helpers

// `overdueLabel` / `lateLabel` live in DateFormats.swift with the other Date
// display helpers.
