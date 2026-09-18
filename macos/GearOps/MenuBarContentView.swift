import AppKit
import SwiftUI

enum GearOpsLayout {
    /// One popover width for every state so switching between restoring,
    /// signed-out, and operations does not resize the window under the cursor.
    static let popoverWidth: CGFloat = 380
    static let glanceOpenBookings = 4
    static let glancePickups = 3
    static let glanceKiosks = 4
}

private enum ExtraRoute: Equatable {
    case open(id: String)
    case pickup(id: String)
}

struct MenuBarContentView: View {
    let model: GearOpsModel

    @Environment(\.openWindow) private var openWindow
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var measuredContentHeight: CGFloat = 320
    @State private var isHoveringRefresh = false
    @State private var showsAllPickups = false
    @State private var showsAllOpenBookings = false
    @State private var showsAllKiosks = false
    @State private var selectedRoute: ExtraRoute?

    private let minimumContentHeight: CGFloat = 180
    private let maximumContentHeight: CGFloat = 500

    private var resolvedContentHeight: CGFloat {
        min(max(measuredContentHeight, minimumContentHeight), maximumContentHeight)
    }

    var body: some View {
        Group {
            if model.isRestoring, model.user == nil {
                restoringView
            } else if model.user == nil {
                GearOpsLoginView(model: model)
            } else {
                operationsView
            }
        }
        .onAppear {
            guard model.shouldRetryCredentialRestore else { return }
            Task { await model.restoreSession() }
        }
        .onChange(of: model.shouldRetryCredentialRestore) { _, shouldRetry in
            guard shouldRetry else { return }
            Task { await model.restoreSession() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .gearOpsOpenSettings)) { _ in
            NSApplication.shared.activate()
            openWindow(id: GearOpsWindow.settings)
        }
        .onChange(of: model.user?.id) { _, _ in
            showsAllPickups = false
            showsAllOpenBookings = false
            showsAllKiosks = false
            selectedRoute = nil
        }
    }

    private var restoringView: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Checking Wisconsin Creative…")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(width: GearOpsLayout.popoverWidth, height: minimumContentHeight)
    }

    private var operationsView: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            VStack(spacing: 0) {
                header(at: context.date)
                Divider()
                ScrollView {
                    Group {
                        if let selectedRoute {
                            bookingDetail(selectedRoute, at: context.date)
                        } else {
                            VStack(alignment: .leading, spacing: 16) {
                                pendingPickupsList(at: context.date)
                                openBookingsList(at: context.date)
                                systemHealth(at: context.date)
                            }
                        }
                    }
                    .padding(16)
                    .onGeometryChange(for: CGFloat.self, of: { proxy in
                        ceil(proxy.size.height)
                    }) { newHeight in
                        measuredContentHeight = newHeight
                    }
                }
                .frame(height: resolvedContentHeight)
                .animation(reduceMotion ? nil : .smooth(duration: 0.22), value: resolvedContentHeight)
                Divider()
                footer
            }
        }
        .frame(width: GearOpsLayout.popoverWidth)
    }

    private func header(at now: Date) -> some View {
        HStack(spacing: 10) {
            WisconsinCreativeIcon(size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text("Wisconsin Creative")
                    .font(.headline)
                Text(headerSubtitle(at: now))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: model.custodyCount)
            }
            Spacer()
            Button {
                Task { await model.refresh() }
            } label: {
                if model.isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 16, height: 16)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .buttonStyle(.borderless)
            .keyboardShortcut("r", modifiers: .command)
            .disabled(model.isRefreshing)
            .padding(5)
            .background(
                isHoveringRefresh ? Color.primary.opacity(0.08) : .clear,
                in: .rect(cornerRadius: 6)
            )
            .onHover { isHoveringRefresh = $0 }
            .help("Refresh Wisconsin Creative status (⌘R)")
            .accessibilityLabel("Refresh Wisconsin Creative status")
        }
        .padding(16)
    }

    /// Custody, overdue, and freshness stay in the header so a glance does not
    /// require scrolling past rows.
    private func headerSubtitle(at now: Date) -> String {
        guard let count = model.custodyCount else { return model.healthLabel }
        var parts = ["\(count) open"]
        let overdue = model.overdueBookingCount(at: now)
        if overdue > 0 { parts.append("\(overdue) overdue") }
        if let snapshot = model.snapshot {
            parts.append(snapshot.freshnessLabel(at: now))
        }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func bookingDetail(_ route: ExtraRoute, at now: Date) -> some View {
        switch route {
        case .open(let id):
            if let booking = model.openBookings.first(where: { $0.id == id }) {
                ExtraBookingDetail(
                    title: booking.title,
                    timing: "Due \(booking.endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))",
                    tone: booking.isOverdue(at: now) ? .red : .blue,
                    isOverdue: booking.isOverdue(at: now),
                    requester: booking.requester,
                    locationName: booking.location.name,
                    refNumber: booking.refNumber,
                    items: booking.items,
                    backLabel: "All bookings",
                    onBack: { selectedRoute = nil },
                    onOpenWeb: { model.openBooking(booking) }
                )
            } else {
                missingBookingDetail
            }
        case .pickup(let id):
            if let booking = model.pendingPickupBookings(at: now).first(where: { $0.id == id })
                ?? model.activeBookingActivity.first(where: { $0.id == id }) {
                ExtraBookingDetail(
                    title: booking.title,
                    timing: pickupTiming(booking, at: now),
                    tone: .orange,
                    isOverdue: false,
                    requester: booking.requester,
                    locationName: booking.location.name,
                    refNumber: nil,
                    items: booking.items,
                    backLabel: "All bookings",
                    onBack: { selectedRoute = nil },
                    onOpenWeb: { model.openBooking(booking) }
                )
            } else {
                missingBookingDetail
            }
        }
    }

    private var missingBookingDetail: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                selectedRoute = nil
            } label: {
                Label("All bookings", systemImage: "chevron.left")
            }
            .buttonStyle(.link)
            .font(.callout.weight(.semibold))
            Text("This booking is no longer in the current snapshot.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func pickupTiming(_ booking: BookingActivitySnapshot, at now: Date) -> String {
        let when = booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
        if booking.kind == .reservation, booking.status == .booked, booking.startsAt < now {
            return "Pickup was due \(when)"
        }
        return "Pickup \(when)"
    }

    private func openBookingsList(at now: Date) -> some View {
        let bookings = model.glanceOpenBookings(at: now)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                sectionTitle("Open bookings")
                overdueBadge(at: now)
                Spacer()
                if !model.openBookings.isEmpty {
                    Button("View all") { model.openCheckouts() }
                        .buttonStyle(.link)
                        .font(.caption)
                        .accessibilityLabel("View all open bookings")
                }
            }

            if model.openBookings.isEmpty {
                Text(model.openBookingTotal == nil
                    ? "Refresh to load current checkouts."
                    : "All gear is accounted for.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 2)
            } else {
                let visible = visibleItems(bookings, cap: GearOpsLayout.glanceOpenBookings, expanded: showsAllOpenBookings)
                if #available(macOS 26.0, *) {
                    GlassEffectContainer(spacing: 8) {
                        LazyVStack(spacing: 8) {
                            bookingRows(visible, at: now)
                        }
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        bookingRows(visible, at: now)
                    }
                }

                moreRowsButton(
                    remaining: bookings.count - GearOpsLayout.glanceOpenBookings,
                    expanded: $showsAllOpenBookings,
                    accessibilityNoun: "open bookings"
                )
            }
        }
    }

    /// Overdue is the one custody state that needs action, so it is promoted to
    /// the section header instead of only being inferable from row colours.
    @ViewBuilder
    private func overdueBadge(at now: Date) -> some View {
        let overdue = model.overdueBookingCount(at: now)
        if overdue > 0 {
            Text("\(overdue) overdue")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.red, in: .capsule)
                .contentTransition(.numericText())
                .transition(.scale.combined(with: .opacity))
                .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: overdue)
                .accessibilityLabel("\(overdue) overdue booking\(overdue == 1 ? "" : "s")")
        }
    }

    private func bookingRows<S: Sequence>(_ bookings: S, at now: Date) -> some View where S.Element == OpenBooking {
        ForEach(Array(bookings)) { booking in
            OpenBookingRow(booking: booking, now: now) {
                selectedRoute = .open(id: booking.id)
            }
        }
    }

    @ViewBuilder
    private func pendingPickupsList(at now: Date) -> some View {
        let bookings = model.pendingPickupBookings(at: now)
        if !bookings.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    sectionTitle("Waiting for pickup")
                    Spacer()
                    Button("View all") { model.openPendingPickups() }
                        .buttonStyle(.link)
                        .font(.caption)
                        .accessibilityLabel("View all bookings waiting for pickup")
                }

                LazyVStack(spacing: 8) {
                    ForEach(visibleItems(bookings, cap: GearOpsLayout.glancePickups, expanded: showsAllPickups)) { booking in
                        PickupBookingRow(booking: booking, now: now) {
                            selectedRoute = .pickup(id: booking.id)
                        }
                    }
                }

                moreRowsButton(
                    remaining: bookings.count - GearOpsLayout.glancePickups,
                    expanded: $showsAllPickups,
                    accessibilityNoun: "bookings waiting for pickup"
                )
            }
        }
    }

    private func systemHealth(at now: Date) -> some View {
        let kiosks = model.glanceKioskDevices(at: now)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionTitle("System health")
                Spacer()
                Label(model.healthLabel, systemImage: model.healthSeverity.symbol)
                    .font(.caption.weight(.semibold))
                    .symbolRenderingMode(.hierarchical)
                     .foregroundStyle(healthColor)
                     .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: model.healthSeverity)
            }
            // Health is one grouped surface so the popover reads as two kinds
            // of content: actionable booking cards, then a status panel.
            VStack(alignment: .leading, spacing: 0) {
                HealthRow(
                    title: "Companion data",
                    detail: apiHealthDetail(at: now),
                    severity: model.companionHealthSeverity,
                    // `refresh()` coalesces re-entry itself, so the row keeps its
                    // affordance instead of dropping the chevron mid-refresh.
                    action: { Task { await model.refresh() } }
                )
                rowSeparator
                HealthRow(
                    title: model.kioskAccess == .available ? "Kiosks" : "Kiosk access",
                    detail: model.kioskStatusSummary(at: now),
                    severity: model.kioskHealthSeverity,
                    action: model.kioskAccess == .available ? { model.openKioskDevices() } : nil
                )

                if model.kioskAccess == .available, !kiosks.isEmpty {
                    let visible = visibleItems(kiosks, cap: GearOpsLayout.glanceKiosks, expanded: showsAllKiosks)
                    rowSeparator
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, device in
                        if index > 0 { rowSeparator }
                        KioskRow(device: device, now: now) { model.openKioskDevices() }
                    }
                }
            }
            .background(Color.primary.opacity(0.045), in: .rect(cornerRadius: 10))

            if let message = model.statusMessage {
                Label(message, systemImage: "info.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if model.kioskAccess == .available {
                moreRowsButton(
                    remaining: kiosks.count - GearOpsLayout.glanceKiosks,
                    expanded: $showsAllKiosks,
                    accessibilityNoun: "kiosks",
                    visibleSuffix: " kiosks"
                )
            }
        }
    }

    private var rowSeparator: some View {
        Divider().padding(.leading, 10)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Button {
                model.openDashboard()
            } label: {
                Label("Open Dashboard", systemImage: "arrow.up.forward.app")
                    .font(.callout)
            }
            .buttonStyle(.link)
            .keyboardShortcut("d", modifiers: .command)
            .help("Open the Wisconsin Creative dashboard in your browser (⌘D)")
            Spacer()
            Menu {
                if let user = model.user {
                    Text("Signed in as \(user.name)")
                }
                Button("Settings…") { openSettings() }
                    .keyboardShortcut(",", modifiers: .command)
                Divider()
                Button("Sign Out", role: .destructive) {
                    Task { await model.signOut() }
                }
                Divider()
                Button("Quit Wisconsin Creative") { model.quit() }
                    .keyboardShortcut("q", modifiers: .command)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Account and app options")
            .accessibilityLabel("Wisconsin Creative menu")
        }
        .padding(12)
    }

    /// Activation has to happen before the window is ordered in, otherwise an
    /// accessory app places it behind whatever the user is currently looking at.
    private func openSettings() {
        NSApplication.shared.activate()
        openWindow(id: GearOpsWindow.settings)
    }

    private func visibleItems<T>(_ items: [T], cap: Int, expanded: Bool) -> [T] {
        expanded ? items : Array(items.prefix(cap))
    }

    @ViewBuilder
    private func moreRowsButton(
        remaining: Int,
        expanded: Binding<Bool>,
        accessibilityNoun: String,
        visibleSuffix: String = ""
    ) -> some View {
        if remaining > 0 {
            Button(expanded.wrappedValue ? "Show less" : "View \(remaining) more\(visibleSuffix)") {
                if reduceMotion {
                    expanded.wrappedValue.toggle()
                } else {
                    withAnimation(.smooth(duration: 0.22)) {
                        expanded.wrappedValue.toggle()
                    }
                }
            }
            .buttonStyle(.link)
            .font(.caption)
            .accessibilityLabel(
                expanded.wrappedValue
                    ? "Show fewer \(accessibilityNoun)"
                    : "View \(remaining) more \(accessibilityNoun)"
            )
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .kerning(0.4)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .accessibilityHeading(.h2)
    }

    private var healthColor: Color {
        switch model.healthSeverity {
        case .healthy: .green
        case .attention: .orange
        case .critical: .red
        }
    }

    private func apiHealthDetail(at now: Date) -> String {
        if model.countDataIsPartial { return "Fresh totals not confirmed" }
        if model.snapshot == nil { return "Unavailable" }
        return model.snapshot.map { "Last synced " + $0.freshnessLabel(at: now).replacingOccurrences(of: "Updated ", with: "") }
            ?? "Unavailable"
    }
}

private struct PickupBookingRow: View {
    let booking: BookingActivitySnapshot
    let now: Date
    let action: () -> Void

    private var timingLabel: String {
        let when = booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
        if booking.kind == .reservation, booking.status == .booked, booking.startsAt < now {
            return "Pickup was due \(when)"
        }
        return "Pickup \(when)"
    }

    var body: some View {
        BookingGlanceCard(
            tone: .orange,
            isOverdue: false,
            title: booking.title,
            timing: timingLabel,
            requester: booking.requester.name,
            location: booking.location.name,
            itemCount: nil,
            avatarName: booking.requester.name,
            avatarUrl: booking.requester.avatarUrl,
            help: booking.title,
            accessibilityLabel: "\(booking.title), \(timingLabel), \(booking.requester.name), \(booking.location.name)",
            accessibilityHint: "Shows details and items",
            action: action
        )
    }
}

private struct OpenBookingRow: View {
    let booking: OpenBooking
    let now: Date
    let action: () -> Void

    private var isOverdue: Bool { booking.isOverdue(at: now) }
    private var timingLabel: String {
        "Due \(booking.endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))"
    }

    var body: some View {
        BookingGlanceCard(
            tone: isOverdue ? .red : .blue,
            isOverdue: isOverdue,
            title: booking.title,
            timing: timingLabel,
            requester: booking.requester.name,
            location: booking.location.name,
            itemCount: booking.itemCount,
            avatarName: booking.requester.name,
            avatarUrl: booking.requester.avatarUrl,
            help: booking.refNumber.map { "\(booking.title) · \($0)" } ?? booking.title,
            accessibilityLabel: "\(isOverdue ? "Overdue, " : "")\(booking.title), \(booking.requester.name), \(booking.location.name), \(timingLabel)",
            accessibilityHint: "Shows details and items",
            action: action
        )
    }
}

/// iOS `BookingRow` compact card: 4pt rail, 40pt avatar, 16pt title, operational
/// timing, requester · location · items, 16pt continuous card.
private struct BookingGlanceCard: View {
    let tone: StatusTone
    let isOverdue: Bool
    let title: String
    let timing: String
    let requester: String
    let location: String
    let itemCount: Int?
    let avatarName: String
    let avatarUrl: String?
    let help: String
    let accessibilityLabel: String
    let accessibilityHint: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        if #available(macOS 26.0, *) {
            cardButton
                .glassEffect(
                    isOverdue
                        ? .regular.tint(Color.red.opacity(0.12)).interactive()
                        : .regular.interactive(),
                    in: .rect(cornerRadius: Brand.Radius.md)
                )
                .onHover { isHovering = $0 }
        } else {
            cardButton
                .background(
                    fallbackBackground,
                    in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
                        .strokeBorder(Color.hairline, lineWidth: 0.5)
                }
                .shadow(color: Color.black.opacity(0.05), radius: 8, x: 0, y: 3)
                .onHover { isHovering = $0 }
        }
    }

    private var fallbackBackground: Color {
        if isOverdue { return Color.statusBackground(.red) }
        return isHovering ? Color.primary.opacity(0.1) : Color.primary.opacity(0.045)
    }

    private var cardButton: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                StatusRail(tone: tone)
                UserAvatarView(name: avatarName, avatarUrl: avatarUrl, size: 40)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .lineLimit(1)
                    Text(timing)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(tone))
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Text(requester)
                        Text("·")
                        Text(location)
                        if let itemCount, itemCount > 0 {
                            Text("·")
                            Text("\(itemCount) item\(itemCount == 1 ? "" : "s")")
                                .monospacedDigit()
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(accessibilityHint)
    }
}

private struct ExtraBookingDetail: View {
    let title: String
    let timing: String
    let tone: StatusTone
    let isOverdue: Bool
    let requester: OpenBooking.Person
    let locationName: String
    let refNumber: String?
    let items: [OpenBooking.ItemReference]
    let backLabel: String
    let onBack: () -> Void
    let onOpenWeb: () -> Void

    private var namedItems: [OpenBooking.ItemReference] { items.filter(\.hasIdentity) }
    private var itemsAreAnonymous: Bool { !items.isEmpty && namedItems.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: onBack) {
                Label(backLabel, systemImage: "chevron.left")
            }
            .buttonStyle(.link)
            .font(.callout.weight(.semibold))
            .accessibilityLabel(backLabel)

            HStack(alignment: .top, spacing: 12) {
                StatusRail(tone: tone)
                UserAvatarView(name: requester.name, avatarUrl: requester.avatarUrl, size: 40)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(timing)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.statusText(tone))
                    HStack(spacing: 4) {
                        Text(requester.name)
                        Text("·")
                        Text(locationName)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let refNumber, !refNumber.isEmpty {
                        Text(refNumber)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isOverdue ? Color.statusBackground(.red) : Color.primary.opacity(0.045),
                in: RoundedRectangle(cornerRadius: Brand.Radius.md, style: .continuous)
            )

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Items")
                        .font(.caption.weight(.semibold))
                        .kerning(0.4)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                    Spacer()
                    if !items.isEmpty {
                        Text("\(items.count)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }

                if items.isEmpty {
                    Text("No items on this booking.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else if itemsAreAnonymous {
                    Text("Item names are not in this snapshot yet. Sign in again to load them.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { Divider() }
                            ExtraItemRow(item: item)
                        }
                    }
                    if items.count >= 48 {
                        Text("Showing the first 48 items.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Button("Open in Wisconsin Creative", action: onOpenWeb)
                .buttonStyle(.link)
                .font(.callout)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ExtraItemRow: View {
    let item: OpenBooking.ItemReference

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.listPrimaryTitle)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                if let subtitle = item.listSecondaryTitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let quantity = item.quantity, quantity > 1 {
                Text("×\(quantity)")
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [item.listPrimaryTitle]
        if let subtitle = item.listSecondaryTitle { parts.append(subtitle) }
        if let quantity = item.quantity { parts.append("quantity \(quantity)") }
        return parts.joined(separator: ", ")
    }
}

private struct HealthRow: View {
    let title: String
    let detail: String
    let severity: GearOpsHealthSeverity
    var action: (() -> Void)?

    @State private var isHovering = false

    var body: some View {
        if let action {
            Button(action: action) { content }
                .buttonStyle(.plain)
                .background(isHovering ? Color.primary.opacity(0.06) : .clear)
                .onHover { isHovering = $0 }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isButton)
        } else {
            content.accessibilityElement(children: .combine)
        }
    }

    private var content: some View {
        HStack(spacing: 8) {
            Image(systemName: severity.symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(color)
            Text(title)
            Spacer()
            Text(detail)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
            if action != nil {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(isHovering ? .secondary : .tertiary)
            }
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .contentShape(.rect)
    }

    private var color: Color {
        switch severity {
        case .healthy: .green
        case .attention: .orange
        case .critical: .red
        }
    }
}

private struct KioskRow: View {
    let device: KioskDevice
    let now: Date
    let action: () -> Void

    @State private var isHovering = false

    private var state: KioskConnectionState { device.connectionState(at: now) }

    var body: some View {
        Button(action: action) { content }
            .buttonStyle(.plain)
            .background(isHovering ? Color.primary.opacity(0.06) : .clear)
            .onHover { isHovering = $0 }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens kiosk devices in Wisconsin Creative")
            .help(buildHelp)
    }

    private var content: some View {
        HStack(spacing: 10) {
            Image(systemName: "ipad")
                .symbolRenderingMode(.hierarchical)
                .frame(width: 22)
                .foregroundStyle(stateColor)
            VStack(alignment: .leading, spacing: 1) {
                Text(device.name)
                    .lineLimit(1)
                Text(kioskDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Text(state.label)
                .font(.caption.weight(.medium))
                .foregroundStyle(stateColor)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .contentShape(.rect)
    }

    private var kioskDetail: String {
        if state == .online {
            return "\(device.location.name) · \(device.pendingPickupCount) pickup\(device.pendingPickupCount == 1 ? "" : "s") · \(device.openCheckoutCount) open"
        }
        guard let lastSeenAt = device.lastSeenAt else {
            return "\(device.location.name) · Never checked in"
        }
        return "\(device.location.name) · Last seen \(lastSeenAt.formatted(.relative(presentation: .named)))"
    }

    private var buildHelp: String {
        device.buildLabel.map { "Build \($0)" } ?? "Build unknown"
    }

    private var stateColor: Color {
        switch state {
        case .online: .green
        case .stale: .secondary
        case .offline: .red
        case .inactive: .secondary
        }
    }
}
