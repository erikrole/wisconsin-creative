import Foundation
import os
import UIKit

private let appStatePerformanceLog = Logger(subsystem: "com.erikrole.Wisconsin", category: "Launch")

private func elapsedMilliseconds(since start: Date) -> Int {
    Int(Date().timeIntervalSince(start) * 1_000)
}

// Used by AppDelegate to post push destinations without importing SwiftUI
nonisolated(unsafe) var sharedAppState: AppState?

enum PushRegistrationState: Equatable {
    case unknown
    case registering
    case registered
    case failed
}

@MainActor
@Observable
final class AppState {
    var overdueCount = 0
    var myShiftCount = 0
    var myShiftTodayCount = 0
    var unreadNotifCount = 0
    var openTradeCount = 0
    var pendingPushBookingId: String?
    var pendingPushEventId: String?
    /// Set when a blast push is tapped. Routes to Home and forces a banner refresh;
    /// the blast itself is fetched from /api/me/blasts, never trusted from the payload.
    var pendingPushBlastId: String?
    /// Server-registration truth, kept separate from iOS authorization state.
    /// `.registered` means the APNs token was accepted by `/api/devices`; it
    /// does not claim that a later push reached the device.
    var pushRegistrationState: PushRegistrationState = .unknown
    var pendingAppIntentDestination: GearTrackerAppIntentDestination?
    var selectedTab: Int = 0
    var resetTab: Int?
    var tabResetToken = 0
    /// Dashboard hint for landing Bookings on a specific scope (raw
    /// `BookingScope` value). Set by stat-tile taps (Overdue / Due Today land
    /// on All); consumed and cleared by BookingsView.
    var pendingBookingsScope: String?
    /// Booking to open in the Bookings tab. Set after a reservation is created
    /// from the app-level composer, which may outlive the screen it started on.
    var pendingBookingDetailId: String?
    /// Compact-width fallback for a sidebar destination that cannot be a tab.
    /// Browse consumes this once and opens the equivalent native route.
    var pendingBrowseDestination: String?
    /// Set by the app-wide Command-Comma shortcut. The Home shell consumes
    /// this after the selected tab has been restored so Settings opens through
    /// the same native Profile route as the visible gear button.
    var pendingSettingsRoute = false
    /// Dashboard hint for landing Schedule on the viewer's own shifts. Set by
    /// the Home Shifts tile, whose count is personal, so the screen it opens
    /// should be scoped the same way. Consumed and cleared by ScheduleView.
    var pendingScheduleMyShifts = false
    private var isRefreshing = false
    private var lastRefreshAttemptAt: Date?
    private var refreshRequests = LatestRequestGeneration()
    private var unreadRefreshRequests = LatestRequestGeneration()
    private let minimumRefreshInterval: TimeInterval = 60

    /// Clears every account-owned app-shell value before a signed-out or
    /// different-user shell can render. Invalidating request ownership also
    /// prevents a response started by the previous session from repopulating
    /// counts after this synchronous reset.
    func resetForSessionBoundary() {
        refreshRequests.invalidate()
        unreadRefreshRequests.invalidate()
        isRefreshing = false
        lastRefreshAttemptAt = nil

        overdueCount = 0
        myShiftCount = 0
        myShiftTodayCount = 0
        unreadNotifCount = 0
        openTradeCount = 0

        pendingPushBookingId = nil
        pendingPushEventId = nil
        pendingPushBlastId = nil
        pendingAppIntentDestination = nil
        pendingBookingsScope = nil
        pendingScheduleMyShifts = false
        pendingBookingDetailId = nil
        pendingBrowseDestination = nil
        pendingSettingsRoute = false

        selectedTab = 0
        resetTab = nil
        tabResetToken = 0
        pushRegistrationState = .unknown
    }

    func selectTab(_ tab: Int) {
        if selectedTab == tab {
            resetTab = tab
            tabResetToken += 1
        } else {
            selectedTab = tab
        }
    }

    func presentSearch() {
        selectTab(3)
    }

    func presentScanLookup() {
        presentSearch()
    }

    func requestRemoteNotificationRegistration() {
        PushTokenStorage.registrationAllowed = true
        pushRegistrationState = .registering
        UIApplication.shared.registerForRemoteNotifications()
    }

    func consumeAppIntentDestination(_ destination: GearTrackerAppIntentDestination) -> Bool {
        guard pendingAppIntentDestination == destination else { return false }
        pendingAppIntentDestination = nil
        return true
    }

    func refresh(forceRefresh: Bool = false) async {
        let startedAt = Date()
        guard !isRefreshing else {
            appStatePerformanceLog.debug("launch.appState.refresh result=skipped reason=inFlight durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            return
        }
        if !forceRefresh,
           let lastRefreshAttemptAt,
           Date().timeIntervalSince(lastRefreshAttemptAt) < minimumRefreshInterval {
            let ageSeconds = Int(Date().timeIntervalSince(lastRefreshAttemptAt))
            appStatePerformanceLog.debug("launch.appState.refresh result=skipped reason=fresh ageSeconds=\(ageSeconds, privacy: .public) durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
            return
        }
        let requestToken = refreshRequests.begin()
        isRefreshing = true
        lastRefreshAttemptAt = Date()
        defer {
            if refreshRequests.owns(requestToken) {
                isRefreshing = false
            }
        }
        do {
            // Use the lightweight stats endpoint instead of the full dashboard payload.
            async let statsTask = APIClient.shared.dashboardStats()
            async let countTask = APIClient.shared.notificationUnreadCount()
            async let tradesTask = APIClient.shared.shiftTrades(status: "OPEN", limit: 1)
            let (stats, count, trades) = try await (statsTask, countTask, tradesTask)
            guard refreshRequests.owns(requestToken), !Task.isCancelled else { return }
            overdueCount = stats.overdueCount
            myShiftCount = stats.myShiftsCount
            myShiftTodayCount = stats.myShiftsTodayCount ?? 0
            unreadNotifCount = count
            openTradeCount = min(trades.total, 9)
            appStatePerformanceLog.info("launch.appState.refresh result=success durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public) overdue=\(self.overdueCount, privacy: .public) shifts=\(self.myShiftCount, privacy: .public) shiftsToday=\(self.myShiftTodayCount, privacy: .public) unread=\(self.unreadNotifCount, privacy: .public) openTrades=\(self.openTradeCount, privacy: .public)")
        } catch {
            guard refreshRequests.owns(requestToken), !Task.isCancelled else { return }
            // Non-critical
            appStatePerformanceLog.error("launch.appState.refresh result=failure durationMs=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        }
    }

    func refreshUnread() async {
        let requestToken = unreadRefreshRequests.begin()
        do {
            let count = try await APIClient.shared.notificationUnreadCount()
            guard unreadRefreshRequests.owns(requestToken), !Task.isCancelled else { return }
            unreadNotifCount = count
        } catch {}
    }
}
