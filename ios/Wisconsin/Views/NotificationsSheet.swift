import SwiftUI

@MainActor
protocol NotificationInboxAPI {
    func notifications(unreadOnly: Bool, limit: Int, offset: Int) async throws -> NotificationsResponse
    func markNotificationRead(id: String) async throws
    func markAllNotificationsRead() async throws -> [String]
    func markNotificationsUnread(ids: [String]) async throws
}

extension APIClient: NotificationInboxAPI {}

@MainActor
@Observable
final class NotificationsViewModel {
    var notifications: [AppNotification] = []
    var unreadCount = 0
    var total = 0
    var isLoading = false
    var error: String?
    var pageError: String?
    var actionError: String?
    var isMutating = false
    private var nextOffset = 0
    private let sessionBoundary = authSessionBoundary.capture()
    private let api: any NotificationInboxAPI
    private let refreshUnread: () async -> Void
    private let pageSize = 20
    private var lastMarkedUnreadIDs: [String] = []
    private var undoTask: Task<Void, Never>?
    private var loadRequests = LatestRequestGeneration()

    init(api: any NotificationInboxAPI = APIClient.shared,
         refreshUnread: @escaping () async -> Void = { await sharedAppState?.refreshUnread() }) {
        self.api = api
        self.refreshUnread = refreshUnread
    }

    var canUndoMarkAll: Bool { !lastMarkedUnreadIDs.isEmpty }

    func load(forceRefresh: Bool = false) async {
        guard !isMutating, authSessionBoundary.owns(sessionBoundary) else { return }
        if !forceRefresh, isLoading { return }
        let requestToken = loadRequests.begin()
        isLoading = true
        error = nil
        pageError = nil
        actionError = nil
        defer {
            if loadRequests.owns(requestToken) {
                isLoading = false
            }
        }
        do {
            let resp = try await api.notifications(unreadOnly: false, limit: pageSize, offset: 0)
            guard loadRequests.owns(requestToken), authSessionBoundary.owns(sessionBoundary), !Task.isCancelled else { return }
            notifications = resp.data
            total = resp.total
            nextOffset = resp.data.count
            unreadCount = resp.unreadCount
        } catch {
            guard loadRequests.owns(requestToken), authSessionBoundary.owns(sessionBoundary), !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    func loadMore() async {
        guard !isLoading, !isMutating, authSessionBoundary.owns(sessionBoundary), nextOffset < total else { return }
        let requestToken = loadRequests.begin()
        let offset = nextOffset
        isLoading = true
        pageError = nil
        defer {
            if loadRequests.owns(requestToken) {
                isLoading = false
            }
        }
        do {
            let resp = try await api.notifications(unreadOnly: false, limit: pageSize, offset: offset)
            guard loadRequests.owns(requestToken), authSessionBoundary.owns(sessionBoundary), !Task.isCancelled else { return }
            let existingIDs = Set(notifications.map(\.id))
            notifications.append(contentsOf: resp.data.filter { !existingIDs.contains($0.id) })
            nextOffset = offset + resp.data.count
            total = resp.data.isEmpty ? nextOffset : resp.total
            unreadCount = resp.unreadCount
        } catch {
            guard loadRequests.owns(requestToken), authSessionBoundary.owns(sessionBoundary), !Task.isCancelled else { return }
            // Surface page errors so a Retry affordance can render in the
            // sentinel row — silent `try?` left users staring at an
            // unchanging list with no signal.
            pageError = error.localizedDescription
        }
    }

    var hasMore: Bool { nextOffset < total }
    var paginationOffset: Int { nextOffset }

    func markRead(id: String) async {
        guard !isMutating, !isLoading, authSessionBoundary.owns(sessionBoundary),
              notifications.contains(where: { $0.id == id && $0.isUnread }) else { return }
        isMutating = true
        actionError = nil
        defer { isMutating = false }
        do {
            try await api.markNotificationRead(id: id)
            guard authSessionBoundary.owns(sessionBoundary) else { return }
            notifications = notifications.map { $0.id == id ? $0.asRead : $0 }
            unreadCount = max(0, unreadCount - 1)
            await refreshUnread()
        } catch {
            await reconcileReadFailure()
        }
    }

    func markAllRead() async {
        guard !isMutating, !isLoading, authSessionBoundary.owns(sessionBoundary), unreadCount > 0 else { return }
        isMutating = true
        actionError = nil
        defer { isMutating = false }
        do {
            let ids = try await api.markAllNotificationsRead()
            guard authSessionBoundary.owns(sessionBoundary) else { return }
            lastMarkedUnreadIDs = ids
            notifications = notifications.map { $0.asRead }
            unreadCount = 0
            scheduleUndoExpiry()
            await refreshUnread()
        } catch {
            await reconcileReadFailure()
        }
    }

    func undoLastMarkAll() async {
        guard !isMutating, !isLoading, authSessionBoundary.owns(sessionBoundary) else { return }
        let ids = lastMarkedUnreadIDs
        guard !ids.isEmpty else { return }
        isMutating = true
        lastMarkedUnreadIDs = []
        undoTask?.cancel()
        defer { isMutating = false }
        do {
            // The API bounds each request to 500 IDs; large inboxes need batches.
            for offset in stride(from: 0, to: ids.count, by: 500) {
                guard authSessionBoundary.owns(sessionBoundary) else { return }
                try await api.markNotificationsUnread(ids: Array(ids[offset..<min(offset + 500, ids.count)]))
            }
            isMutating = false
            await load(forceRefresh: true)
            await refreshUnread()
        } catch {
            await reconcileReadFailure()
        }
    }

    private func reconcileReadFailure() async {
        guard authSessionBoundary.owns(sessionBoundary) else { return }
        // A failed response may follow a committed write. Re-read before making
        // any claim about which notifications are read; never restore old counts.
        isMutating = false
        await load(forceRefresh: true)
        await refreshUnread()
        actionError = error == nil
            ? "Couldn't confirm the action. Your inbox now shows its latest status."
            : "Couldn't confirm the action or refresh your inbox. Pull to refresh before trying again."
    }

    private func scheduleUndoExpiry() {
        undoTask?.cancel()
        undoTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            self?.lastMarkedUnreadIDs = []
        }
    }
}

private extension AppNotification {
    var asRead: AppNotification {
        AppNotification(id: id, type: type, title: title, body: body,
                        readAt: readAt ?? Date(), createdAt: createdAt, payload: payload)
    }
}

struct NotificationsSheet: View {
    var onRoute: ((GearTrackerRoute) -> Void)?

    @State var vm = NotificationsViewModel()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.notifications.isEmpty {
                    ProgressView("Loading notifications")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = vm.error, vm.notifications.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn't load notifications", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await vm.load() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if vm.notifications.isEmpty {
                    ContentUnavailableView(
                        "All caught up",
                        systemImage: "bell",
                        description: Text("No notifications to show.")
                    )
                } else {
                    notificationList
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 8) {
                    if vm.error != nil, !vm.notifications.isEmpty {
                        BannerView(severity: .warning, message: "Couldn't refresh notifications. Showing the last loaded inbox.", systemImage: "wifi.exclamationmark", messageLineLimit: nil, actionLabel: "Retry") {
                            Task { await vm.load(forceRefresh: true) }
                        }
                    }
                    if let actionError = vm.actionError {
                        BannerView(
                            severity: .error,
                            message: actionError,
                            systemImage: "wifi.exclamationmark",
                            messageLineLimit: nil,
                            actionLabel: "Refresh"
                        ) {
                            Task { await vm.load() }
                        }
                    }
                    if vm.canUndoMarkAll {
                        BannerView(
                            severity: .info,
                            message: "Notifications marked read.",
                            systemImage: "checkmark.circle",
                            messageLineLimit: nil,
                            actionLabel: "Undo"
                        ) {
                            Task { await vm.undoLastMarkAll() }
                        }
                    }
                }
                .padding(.top, 8)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if vm.unreadCount > 0 {
                        Button {
                            Task { await vm.markAllRead() }
                        } label: {
                            Label("Mark All Read", systemImage: "checkmark.circle")
                        }
                        .labelStyle(.iconOnly)
                        .accessibilityLabel("Mark all notifications read")
                        .disabled(vm.isMutating || vm.isLoading)
                    }
                }
            }
        }
        // Neutral chrome, applied outside the NavigationStack so the bar's own
        // items inherit it. Both buttons were brand red, which put the urgent
        // colour on "Done" and on a routine bulk action, directly above rows
        // where red means somebody is late with our gear.
        .tint(Color.primary)
        .onChange(of: vm.actionError) { _, actionError in
            if let actionError {
                AccessibilityNotification.Announcement(actionError).post()
            }
        }
        .onChange(of: vm.pageError) { _, pageError in
            if let pageError {
                AccessibilityNotification.Announcement("Couldn't load more notifications. \(pageError)").post()
            }
        }
        .task { await vm.load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await vm.load(forceRefresh: true) } }
        }
    }

    private var notificationList: some View {
        List {
            ForEach(groupedSections, id: \.0) { section, items in
                Section(section) {
                    ForEach(items) { notif in
                        Button {
                            handleTap(notif)
                        } label: {
                            NotificationRow(notification: notif)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .leading) {
                            if notif.isUnread && !vm.isMutating && !vm.isLoading {
                                Button {
                                    Task { await vm.markRead(id: notif.id) }
                                } label: {
                                    Label("Mark Read", systemImage: "checkmark")
                                }
                                .tint(Color.statusText(.blue))
                                .accessibilityLabel("Mark as read")
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            if notif.isUnread && !vm.isMutating && !vm.isLoading {
                                Button {
                                    Task { await vm.markRead(id: notif.id) }
                                } label: {
                                    Label("Mark Read", systemImage: "checkmark")
                                }
                                .tint(Color.statusText(.blue))
                                .accessibilityLabel("Mark as read")
                            }
                        }
                        // Long press agrees with the swipe. A row that offers
                        // an action one way and not the other trains people to
                        // distrust both.
                        .contextMenu {
                            if notif.isUnread && !vm.isMutating && !vm.isLoading {
                                 Button {
                                     Task { await vm.markRead(id: notif.id) }
                                 } label: {
                                    Label("Mark Read", systemImage: "checkmark")
                                }
                            }
                        }
                    }
                }
            }
            // Infinite-scroll sentinel row — fires `loadMore` on appear,
            // surfaces a Retry button on `pageError`. Matches items + bookings
            // list pagination pattern.
            if vm.hasMore || vm.pageError != nil {
                Section {
                    paginationSentinel
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await vm.load(forceRefresh: true) }
    }

    @ViewBuilder
    private var paginationSentinel: some View {
        if let pageError = vm.pageError {
            HStack {
                Text(pageError)
                    .font(.footnote)
                    .foregroundStyle(Color.statusText(.red))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("Retry") {
                    Task { await vm.loadMore() }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.vertical, 4)
        } else {
            HStack {
                Spacer()
                ProgressView()
                Spacer()
            }
            .padding(.vertical, 8)
            .task(id: vm.paginationOffset) {
                // Auto-load the next page when this row appears AND we
                // haven't already loaded it. The id-keyed task re-fires on
                // every page boundary so subsequent pages chain.
                if vm.hasMore && vm.pageError == nil {
                    await vm.loadMore()
                }
            }
        }
    }

    private func handleTap(_ notif: AppNotification) {
        Task { await vm.markRead(id: notif.id) }

        let route = GearTrackerRouteParser.parseNotification(payload: notif.payload, type: notif.type)
        if route == .inbox {
            return
        }
        onRoute?(route)
        dismiss()
    }

    private var groupedSections: [(String, [AppNotification])] {
        let cal = Calendar.current
        let now = Date()
        var today: [AppNotification] = []
        var yesterday: [AppNotification] = []
        var thisWeek: [AppNotification] = []
        var older: [AppNotification] = []

        for n in vm.notifications {
            if cal.isDateInToday(n.createdAt) {
                today.append(n)
            } else if cal.isDateInYesterday(n.createdAt) {
                yesterday.append(n)
            } else if let daysAgo = cal.dateComponents([.day], from: n.createdAt, to: now).day, daysAgo < 7 {
                thisWeek.append(n)
            } else {
                older.append(n)
            }
        }

        return [
            ("Today", today),
            ("Yesterday", yesterday),
            ("Previous 7 Days", thisWeek),
            ("Older", older),
        ].filter { !$0.1.isEmpty }
    }
}

private struct NotificationRow: View {
    let notification: AppNotification

    var body: some View {
        let tone = notification.type.notifTone
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                // Web parity: icon circle is tinted by notification *type*
                // (orange for overdue, green for gear-up, blue for trade
                // claimed/approved, red for trade declined/expired). Read
                // state is signaled by the unread dot on the right, not by
                // graying the icon.
                Circle()
                    .fill(tone.map { Color.statusBackground($0) } ?? Color(.systemGray6))
                    .frame(width: 36, height: 36)
                Image(systemName: notification.type.notifIcon)
                    .font(.system(size: 15))
                    .foregroundStyle(tone.map { Color.statusText($0) } ?? Color.secondary)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(notification.title)
                    .font(.subheadline.weight(notification.isUnread ? .semibold : .regular))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let body = notification.body {
                    Text(body)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(notification.createdAt.relativeLabel)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if notification.isUnread {
                Spacer()
                // Blue, not the accent. `Color.accentColor` resolves to brand
                // red here, so every unread row grew a red dot -- the same mark
                // an overdue row earns -- and a week of unread shift assignments
                // read as a column of alarms.
                Circle()
                    .fill(Color.statusText(.blue))
                    .frame(width: 8, height: 8)
                    .padding(.top, 6)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [notification.title]
        if let body = notification.body { parts.append(body) }
        parts.append(notification.createdAt.relativeLabel)
        if notification.isUnread { parts.append("Unread") }
        return parts.joined(separator: ", ")
    }
}

private extension String {
    var notifIcon: String {
        if hasPrefix("checkout_due") || hasPrefix("checkout_overdue") { return "clock.badge.exclamationmark" }
        if hasPrefix("checkin_item_damaged") { return "exclamationmark.triangle" }
        if hasPrefix("checkin_item_lost") { return "questionmark.circle" }
        if hasPrefix("trade_") { return "arrow.triangle.2.circlepath" }
        if hasPrefix("shift_gear_up") { return "bag.badge.plus" }
        if hasPrefix("shift_") { return "calendar.badge.clock" }
        if hasPrefix("badge_awarded") { return "trophy.fill" }
        if hasPrefix("low_stock") { return "cube.box" }
        if hasPrefix("reservation_booked") { return "calendar.badge.plus" }
        if hasPrefix("reservation_pickup_ready") { return "bag.badge.questionmark" }
        if hasPrefix("reservation_cancelled") { return "calendar.badge.minus" }
        return "bell"
    }

    /// Type → status tone, mirroring `notifIconBg` in `src/app/(app)/notifications/page.tsx`.
    /// `nil` falls back to the muted gray pairing.
    var notifTone: StatusTone? {
        // Overdue is red everywhere else in the app -- COLOR_SYSTEM.md states it
        // outright ("OVERDUE = red, never orange"). These two shared one orange
        // branch, so the single notification that means "somebody is late with
        // our gear" arrived wearing the colour of "due soon".
        if hasPrefix("checkout_overdue") { return .red }
        if hasPrefix("checkout_due") { return .orange }
        if hasPrefix("checkin_item_damaged") || hasPrefix("checkin_item_lost") { return .red }
        if self == "trade_claimed" || self == "trade_approved" { return .blue }
        if self == "trade_declined" || self == "trade_expired" { return .red }
        if hasPrefix("shift_gear_up") { return .green }
        if hasPrefix("shift_") { return .blue }
        if hasPrefix("badge_awarded") { return .purple }
        if hasPrefix("low_stock") { return .orange }
        if hasPrefix("reservation_booked") || hasPrefix("reservation_pickup_ready") { return .purple }
        if hasPrefix("reservation_cancelled") { return .red }
        return nil
    }
}

private extension Date {
    var relativeLabel: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}
