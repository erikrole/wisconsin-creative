import SwiftUI

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
    private let pageSize = 20

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        pageError = nil
        actionError = nil
        defer { isLoading = false }
        do {
            let resp = try await APIClient.shared.notifications(limit: pageSize, offset: 0)
            notifications = resp.data
            total = resp.total
            unreadCount = resp.unreadCount
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadMore() async {
        guard !isLoading, notifications.count < total else { return }
        isLoading = true
        pageError = nil
        defer { isLoading = false }
        do {
            let resp = try await APIClient.shared.notifications(limit: pageSize, offset: notifications.count)
            notifications.append(contentsOf: resp.data)
        } catch {
            // Surface page errors so a Retry affordance can render in the
            // sentinel row — silent `try?` left users staring at an
            // unchanging list with no signal.
            pageError = error.localizedDescription
        }
    }

    func markRead(id: String) async {
        guard let idx = notifications.firstIndex(where: { $0.id == id }),
              notifications[idx].isUnread else { return }
        let previous = notifications[idx]
        let previousUnreadCount = unreadCount
        notifications[idx] = notifications[idx].asRead
        actionError = nil
        if unreadCount > 0 { unreadCount -= 1 }
        do {
            try await APIClient.shared.markNotificationRead(id: id)
        } catch {
            if let restoreIdx = notifications.firstIndex(where: { $0.id == id }) {
                notifications[restoreIdx] = previous
            }
            unreadCount = previousUnreadCount
            actionError = "Couldn't mark that notification read. Your inbox was restored."
        }
    }

    func markAllRead() async {
        let previousNotifications = notifications
        let previousUnreadCount = unreadCount
        notifications = notifications.map { $0.asRead }
        unreadCount = 0
        actionError = nil
        do {
            try await APIClient.shared.markAllNotificationsRead()
        } catch {
            notifications = previousNotifications
            unreadCount = previousUnreadCount
            actionError = "Couldn't mark all notifications read. Your inbox was restored."
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
    var onSelectBooking: ((String) -> Void)?
    var onSelectTrades: (() -> Void)?
    var onSelectAsset: ((String) -> Void)?
    var onSelectUser: ((String) -> Void)?
    var onSelectEvent: ((String) -> Void)?

    @State private var vm = NotificationsViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var markAllHaptic = false
    @State private var swipeMarkHaptic = false
    @State private var actionErrorHaptic = false

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading && vm.notifications.isEmpty {
                    ProgressView()
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
            .overlay(alignment: .top) {
                if let actionError = vm.actionError {
                    BannerView(
                        severity: .error,
                        message: actionError,
                        systemImage: "wifi.exclamationmark",
                        actionLabel: "Refresh"
                    ) {
                        Task { await vm.load() }
                    }
                    .padding(.top, 8)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if vm.unreadCount > 0 {
                        Button("Mark All Read") {
                            markAllHaptic.toggle()
                            Task { await vm.markAllRead() }
                        }
                        .font(.subheadline)
                        .sensoryFeedback(.success, trigger: markAllHaptic)
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
                actionErrorHaptic.toggle()
                AccessibilityNotification.Announcement(actionError).post()
            }
        }
        .onChange(of: vm.pageError) { _, pageError in
            if let pageError {
                AccessibilityNotification.Announcement("Couldn't load more notifications. \(pageError)").post()
            }
        }
        .sensoryFeedback(.error, trigger: actionErrorHaptic)
        .task { await vm.load() }
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
                            if notif.isUnread {
                                Button {
                                    swipeMarkHaptic.toggle()
                                    Task { await vm.markRead(id: notif.id) }
                                } label: {
                                    Label("Mark Read", systemImage: "checkmark")
                                }
                                .tint(.accentColor)
                                .accessibilityLabel("Mark as read")
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            if notif.isUnread {
                                Button {
                                    swipeMarkHaptic.toggle()
                                    Task { await vm.markRead(id: notif.id) }
                                } label: {
                                    Label("Mark Read", systemImage: "checkmark")
                                }
                                .tint(.accentColor)
                                .accessibilityLabel("Mark as read")
                            }
                        }
                        // Long press agrees with the swipe. A row that offers
                        // an action one way and not the other trains people to
                        // distrust both.
                        .contextMenu {
                            if notif.isUnread {
                                Button {
                                    swipeMarkHaptic.toggle()
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
            if vm.notifications.count < vm.total || vm.pageError != nil {
                Section {
                    paginationSentinel
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await vm.load() }
        .sensoryFeedback(.selection, trigger: swipeMarkHaptic)
    }

    @ViewBuilder
    private var paginationSentinel: some View {
        if let pageError = vm.pageError {
            HStack {
                Text(pageError)
                    .font(.footnote)
                    .foregroundStyle(Color.statusText(.red))
                    .lineLimit(2)
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
            .task(id: vm.notifications.count) {
                // Auto-load the next page when this row appears AND we
                // haven't already loaded it. The id-keyed task re-fires on
                // every page boundary so subsequent pages chain.
                if vm.notifications.count < vm.total && vm.pageError == nil {
                    await vm.loadMore()
                }
            }
        }
    }

    private func handleTap(_ notif: AppNotification) {
        Task { await vm.markRead(id: notif.id) }

        // Booking-related types → booking detail (covers checkout_due/overdue,
        // reservation_*, trade_* with bookingId in payload).
        if let bookingId = notif.payload?.effectiveBookingId {
            onSelectBooking?(bookingId)
            dismiss()
            return
        }

        // Trade types without an effectiveBookingId → trade board.
        if notif.type.hasPrefix("trade_") {
            onSelectTrades?()
            dismiss()
            return
        }

        if isShiftTargetedType(notif.type), let eventId = notif.payload?.eventId {
            onSelectEvent?(eventId)
            dismiss()
            return
        }

        // Asset-related types → asset detail. Damage / lost / low-stock all
        // carry assetId; routing there puts the staffer one tap from action.
        if let assetId = notif.payload?.assetId, isAssetTargetedType(notif.type) {
            onSelectAsset?(assetId)
            dismiss()
            return
        }

        if notif.type == "badge_awarded", let userId = notif.payload?.userId {
            onSelectUser?(userId)
            dismiss()
            return
        }

        // Shift rows without event routing and other no-target types: mark-read only (handled
        // above), no navigation.
    }

    private func isAssetTargetedType(_ type: String) -> Bool {
        type.hasPrefix("checkin_item_damaged")
            || type.hasPrefix("checkin_item_lost")
            || type.hasPrefix("low_stock")
    }

    private func isShiftTargetedType(_ type: String) -> Bool {
        type.hasPrefix("shift_")
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
            ("This Week", thisWeek),
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
                    .lineLimit(2)
                if let body = notification.body {
                    Text(body)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
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
