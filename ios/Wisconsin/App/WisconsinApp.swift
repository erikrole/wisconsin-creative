import CoreSpotlight
import Foundation
import SwiftUI
import SwiftData
import TipKit
import UIKit
import UserNotifications

@main
struct WisconsinApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var session = SessionStore()
    @State private var profileCompletion = ProfileCompletionStore()
    @State private var appState = AppState()
    @State private var drafts = ReservationDraftStore()
    @State private var network = NetworkMonitor()
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("WisconsinThemeChoice") private var themeChoice: ThemeChoice = .system

    init() {
        AppMetricMonitor.shared.start()
        try? Tips.configure([.displayFrequency(.daily)])
#if DEBUG
        // Harness screenshots must be deterministic: a first-run tip popover
        // otherwise lands over whatever surface is being captured.
        if AppRuntimeMode.isPerformanceTesting {
            Tips.hideAllTipsForTesting()
        }
#endif
    }

    var body: some Scene {
        WindowGroup {
            rootContent
                .environment(session)
                .environment(profileCompletion)
                .environment(appState)
                .environment(drafts)
                .environment(network)
                .nativeRemoteImageSession()
                .preferredColorScheme(themeChoice.colorScheme)
                .onAppear {
                    sharedAppState = appState
                }
                .onChange(of: session.currentUser, initial: true) { old, user in
                    handleCurrentUserChange(from: old, to: user)
                }
                .onChange(of: scenePhase) { _, phase in
                    handleScenePhaseChange(phase)
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
                    Task { @MainActor in
                        ThumbnailCache.shared.evictAll()
                        URLCache.shared.removeAllCachedResponses()
                    }
                }
                .onOpenURL { url in
                    // Custom URLs and universal links share one parser. Query
                    // parameters never open a mutation sheet — Extend stays a
                    // deliberate action on booking detail.
                    guard let route = GearTrackerRouteParser.parse(url) else { return }
                    appState.apply(route)
                }
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    // A Spotlight hit carries the booking id, which the push
                    // router already knows how to open — same destination, one
                    // routing path.
                    guard let bookingId = SpotlightIndexer.bookingId(from: activity.userInfo) else { return }
                    appState.pendingPushBookingId = bookingId
                }
                .tint(.brandPrimary)
        }
        .modelContainer(GearStore.shared.container)
    }

    @ViewBuilder
    private var rootContent: some View {
#if DEBUG
        if let scenario = AppRuntimeMode.performanceScenario {
            PerformanceTestRootView(scenario: scenario)
        } else {
            RootView()
        }
#else
        RootView()
#endif
    }

    private func handleCurrentUserChange(from oldUser: CurrentUser?, to user: CurrentUser?) {
        let authenticatedIdentityChanged = oldUser != nil && oldUser?.id != user?.id
        if user == nil || authenticatedIdentityChanged {
            // Keep this synchronous and first: no previous-user counts, routes,
            // or navigation state may survive into a signed-out or replacement
            // account shell.
            appState.resetForSessionBoundary()
            CheckoutReturnLiveActivityManager.shared.cancelObserverWork()
            AppDelegate.clearRemoteNotificationsForSignedOutUser()
            SearchRecentsStorage.clear()
            ScheduleWindowCache.clear()
            ShiftCalendarTokenStore.removeAll()
            // A Home Screen widget renders without unlocking the app, so the
            // previous account's shift and gear cannot outlive their session.
            GearWidgetPublisher.clear()
            SpotlightIndexer.clear()
            ThumbnailCache.shared.clearForSignOut()

            if oldUser != nil {
                GearStore.shared.clearAll()
                profileCompletion.resetSession()
                // A parked reservation belongs to the person who started it.
                drafts.clearForSignOut()
                Task { await CheckoutReturnLiveActivityManager.shared.endAll() }
            }
        }

        // Rebuilt on every identity change, including sign-out (which empties
        // the menu). A shortcut is a claim about what the phone's owner can
        // do, so it must track the role rather than the install.
        GearTrackerQuickAction.refresh(for: user)

        if user == nil {
            return
        }

        let isReadOnlyPreview = user?.isReadOnlyRolePreview == true
        PushTokenStorage.registrationAllowed = !isReadOnlyPreview
        if isReadOnlyPreview {
            CheckoutReturnLiveActivityManager.shared.cancelObserverWork()
        }
        // Push permission is now requested via PushPrePromptView, not as a
        // cold OS alert on login. Home owns the first checkout reconciliation
        // after its useful payload arrives.
        guard user?.forcePasswordChange == false,
              !isReadOnlyPreview else { return }
        let userId = user?.id ?? ""
        let sessionBoundary = authSessionBoundary.capture()
        Task {
            await registerForPushIfAuthorized(
                userId: userId,
                sessionBoundary: sessionBoundary
            )
        }
    }

    private func handleScenePhaseChange(_ phase: ScenePhase) {
        // Leaving the foreground is where an unfinished reservation is most
        // likely to be lost to a task kill, so persist it and keep composing.
        if phase == .background {
            Task { await drafts.autosave() }
            return
        }
        guard phase == .active else { return }
        Task { await AppDelegate.pruneStaleDeliveredNotifications() }

        guard session.currentUser?.forcePasswordChange == false,
              !session.isInitialSessionValidationInFlight else {
            return
        }
        Task { await refreshForegroundState() }
    }

    private func refreshForegroundState() async {
        await session.refreshCurrentUser()
        guard let user = session.currentUser, !user.forcePasswordChange else { return }

        async let badgeRefresh: Void = appState.refresh()
        async let profileRefresh: Void = profileCompletion.load(for: user, force: true)
        if !user.isReadOnlyRolePreview {
            await CheckoutReturnLiveActivityManager.shared.prepareRemoteStartRegistration()
            await CheckoutReturnLiveActivityManager.shared.reconcileCurrentUserCheckouts(requesterId: user.id)
        }
        await badgeRefresh
        await profileRefresh
    }

    /// Registers for remote notifications if the user has already authorized.
    /// New authorization is collected by `PushPrePromptView` after login.
    @MainActor
    private func registerForPushIfAuthorized(
        userId: String,
        sessionBoundary: UUID
    ) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard session.currentUser?.id == userId,
              authSessionBoundary.owns(sessionBoundary),
              session.currentUser?.isReadOnlyRolePreview != true,
              PushTokenStorage.registrationAllowed else {
            return
        }
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            // Re-requesting decided permission never prompts; it adds the iOS
            // Settings link for people who allowed notifications before the
            // app offered one.
            if settings.providesAppNotificationSettings == false {
                _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: PushAuthorization.options)
            }
            appState.requestRemoteNotificationRegistration()
        default:
            appState.pushRegistrationState = .unknown
        }
    }
}

// MARK: - Feature Discovery

struct NewReservationTip: Tip {
    var title: Text {
        Text("Reserve gear for upcoming work")
    }

    var message: Text? {
        Text("Choose an event, pickup time, and the gear you need.")
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct MinimizeReservationTip: Tip {
    var title: Text {
        Text("Keep this reservation handy")
    }

    var message: Text? {
        Text("Minimize it to check another tab without losing your progress.")
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct ScheduleOpenWorkTip: Tip {
    var title: Text {
        Text("Open work and trades")
    }

    var message: Text? {
        Text("Open the Trade Board to review available shifts and post or claim a trade.")
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct ShiftCalendarTip: Tip {
    static let openedSchedule = Tips.Event(id: "internal-schedule-opened")

    var title: Text {
        Text("Add shifts to Apple Calendar")
    }

    var message: Text? {
        Text("Shift Calendar keeps your assignments and call times available outside the app.")
    }

    var rules: [Rule] {
        #Rule(Self.openedSchedule) {
            $0.donations.count >= 3
        }
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct MyAvailabilityTip: Tip {
    var title: Text {
        Text("Share when you can't work")
    }

    var message: Text? {
        Text("Add availability so staff can see conflicts while building the schedule.")
    }

    var rules: [Rule] {
        #Rule(ShiftCalendarTip.openedSchedule) {
            $0.donations.count >= 3
        }
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct ScanReservationGearTip: Tip {
    static let openedGearStep = Tips.Event(id: "reservation-gear-step-opened")

    var title: Text {
        Text("Scan gear into this reservation")
    }

    var message: Text? {
        Text("Keep the scanner open while you add several labeled items.")
    }

    var rules: [Rule] {
        #Rule(Self.openedGearStep) {
            $0.donations.count >= 1
        }
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct ResumeReservationTip: Tip {
    static let minimizedReservation = Tips.Event(id: "reservation-minimized")

    var title: Text {
        Text("Your reservation is still here")
    }

    var message: Text? {
        Text("Tap this card to return to the same step with your progress intact.")
    }

    var rules: [Rule] {
        #Rule(Self.minimizedReservation) {
            $0.donations.count >= 1
        }
    }

    var options: [Option] {
        MaxDisplayCount(1)
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ProfileCompletionStore.self) private var profileCompletion
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var earnedBadgeQueue: [EarnedBadgeReward] = []
    @State private var badgeRewardPollInFlight = false

    var body: some View {
        Group {
            if session.isRestoring {
                LaunchView()
            } else if let user = session.currentUser, user.forcePasswordChange {
                PasswordSetupView(email: user.email)
                    .id(user.id)
            } else if let user = session.currentUser {
                if user.isReadOnlyRolePreview {
                    AppTabView()
                        .id(user.shellIdentity)
                } else {
                    switch profileCompletion.route(
                        for: user,
                        optimisticSession: session.usedOptimisticSessionSnapshot
                    ) {
                    case .welcome:
                        ProfileCompletionWelcomeView()
                            .id(user.id)
                    case .app:
                        AppTabView()
                            .id(user.shellIdentity)
                    }
                }
            } else {
                LoginView()
                    .overlay(alignment: .top) {
                        if session.isOffline {
                            BannerView(
                                severity: .warning,
                                message: "No connection — check your network",
                                systemImage: "wifi.slash"
                            )
                            .padding(.top, 12)
                        }
                    }
                    .animation(reduceMotion ? nil : .easeInOut, value: session.isOffline)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: session.isRestoring)
        .task(id: session.currentUser?.shellIdentity) {
            guard let user = session.currentUser,
                  !user.forcePasswordChange,
                  !user.isReadOnlyRolePreview else { return }
            await profileCompletion.load(for: user)
            guard session.currentUser?.shellIdentity == user.shellIdentity else { return }
            await APIClient.shared.recordProductEvent(eventName: "app_opened", surface: "home")
            await NotificationTelemetry.recordPushStatusIfDue(registration: appState.pushRegistrationState)
        }
        .task(id: "badge-rewards-\(session.currentUser?.shellIdentity ?? "signed-out")") {
            earnedBadgeQueue.removeAll()
            guard let user = session.currentUser,
                  !user.forcePasswordChange,
                  !user.isReadOnlyRolePreview,
                  user.role != "COLLABORATOR" else { return }

            // Establish the no-history-replay cursor before the app-open event
            // can mint an easter egg, then fetch once more for its reward.
            await refreshBadgeRewardsForAppOpen(for: user.id)

            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(15))
                } catch {
                    return
                }
                await pollBadgeRewards(for: user.id)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active,
                  let user = session.currentUser,
                  !user.forcePasswordChange,
                  !user.isReadOnlyRolePreview else { return }
            Task {
                await APIClient.shared.recordProductEvent(eventName: "app_opened", surface: "home")
                if user.role != "COLLABORATOR" {
                    await refreshBadgeRewardsForAppOpen(for: user.id)
                }
            }
        }
        .overlay {
            if session.currentUser != nil, let reward = earnedBadgeQueue.first {
                BadgeEarnedCelebrationView(
                    reward: reward,
                    remaining: earnedBadgeQueue.count - 1,
                    onDismiss: { earnedBadgeQueue.removeFirst() }
                )
                .zIndex(100)
            }
        }
        // iPad keyboards and Mac Catalyst users need a stable, app-wide way
        // to reach Settings. The action feeds the same Profile destination
        // used by the visible gear button; it does not create a second
        // settings surface or bypass role routing.
        .background {
            Button("Settings…") {
                appState.pendingSettingsRoute = true
            }
            .keyboardShortcut(",", modifiers: .command)
            .frame(width: 0, height: 0)
            .opacity(0.01)
            .accessibilityHidden(true)
        }
    }

    @MainActor
    private func pollBadgeRewards(for userId: String) async {
        guard session.currentUser?.isReadOnlyRolePreview != true else { return }
        guard !badgeRewardPollInFlight else { return }
        badgeRewardPollInFlight = true
        defer { badgeRewardPollInFlight = false }

        let cursorKey = "WisconsinBadgeRewardCursor.\(userId)"
        let after = UserDefaults.standard.string(forKey: cursorKey)

        do {
            let response = try await APIClient.shared.recentBadgeAwards(after: after)
            guard session.currentUser?.id == userId else { return }
            UserDefaults.standard.set(response.nextCursor, forKey: cursorKey)
            earnedBadgeQueue.appendUnique(contentsOf: response.awards)
        } catch APIError.httpError(let statusCode, _) where statusCode == 400 {
            // A stale or damaged cursor must not strand reward polling forever.
            UserDefaults.standard.removeObject(forKey: cursorKey)
        } catch {
            // Reward chrome is additive. Keep the cursor and try again later.
        }
    }

    @MainActor
    private func refreshBadgeRewardsForAppOpen(for userId: String) async {
        guard session.currentUser?.isReadOnlyRolePreview != true else { return }
        let cursorKey = "WisconsinBadgeRewardCursor.\(userId)"
        await pollBadgeRewards(for: userId)
        if UserDefaults.standard.string(forKey: cursorKey) == nil {
            // A malformed cursor is removed by the first poll. Establish a new
            // no-replay boundary before creating an award on this foreground.
            await pollBadgeRewards(for: userId)
        }
        guard session.currentUser?.id == userId,
              UserDefaults.standard.string(forKey: cursorKey) != nil else { return }
        try? await APIClient.shared.recordBadgeAppOpen()
        await pollBadgeRewards(for: userId)
    }

}
