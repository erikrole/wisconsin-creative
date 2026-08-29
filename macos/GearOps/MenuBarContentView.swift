import AppKit
import SwiftUI

enum GearOpsLayout {
    /// One popover width for every state so switching between restoring,
    /// signed-out, and operations does not resize the window under the cursor.
    static let popoverWidth: CGFloat = 380
}

struct MenuBarContentView: View {
    let model: GearOpsModel

    @Environment(\.openWindow) private var openWindow
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var measuredContentHeight: CGFloat = 320
    @State private var isHoveringRefresh = false

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
            Task { await model.restoreSession(confirmMissingCredential: true) }
        }
        .onChange(of: model.shouldRetryCredentialRestore) { _, shouldRetry in
            guard shouldRetry else { return }
            Task { await model.restoreSession(confirmMissingCredential: true) }
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
                    VStack(alignment: .leading, spacing: 16) {
                        openBookingsList(at: context.date)
                        pendingPickupsList(at: context.date)
                        systemHealth(at: context.date)
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

    /// Custody count plus projection freshness, so the two facts that decide
    /// whether the popover is worth trusting are visible without scrolling.
    private func headerSubtitle(at now: Date) -> String {
        guard let count = model.custodyCount else { return model.healthLabel }
        let custody = "\(count) open booking\(count == 1 ? "" : "s")"
        guard let snapshot = model.snapshot else { return custody }
        return "\(custody) · \(snapshot.freshnessLabel(at: now))"
    }

    private func openBookingsList(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                sectionTitle("Open bookings")
                overdueBadge(at: now)
                Spacer()
                Button("View all") { model.openCheckouts() }
                    .buttonStyle(.link)
                    .font(.caption)
                    .accessibilityLabel("View all open bookings")
            }

            if model.openBookings.isEmpty {
                ContentUnavailableView(
                    "No open bookings",
                    systemImage: "checkmark.seal.fill",
                    description: Text(model.openBookingTotal == nil
                        ? "Refresh to load current checkouts."
                        : "All gear is accounted for.")
                )
                .frame(maxWidth: .infinity, minHeight: 96)
            } else {
                if #available(macOS 26.0, *) {
                    GlassEffectContainer(spacing: 8) {
                        LazyVStack(spacing: 8) {
                            bookingRows(at: now)
                        }
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        bookingRows(at: now)
                    }
                }
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

    private func bookingRows(at now: Date) -> some View {
        ForEach(model.openBookings) { booking in
            OpenBookingRow(booking: booking, now: now) {
                model.openBooking(booking)
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
                    ForEach(bookings.prefix(3)) { booking in
                        PickupBookingRow(booking: booking, now: now) {
                            model.openBooking(booking)
                        }
                    }
                }

                if bookings.count > 3 {
                    Button("View \(bookings.count - 3) more") { model.openPendingPickups() }
                        .buttonStyle(.link)
                        .font(.caption)
                        .accessibilityLabel("View \(bookings.count - 3) more bookings waiting for pickup")
                }
            }
        }
    }

    private func systemHealth(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
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
                    detail: model.kioskStatusSummary,
                    severity: model.kioskHealthSeverity,
                    action: model.kioskAccess == .available ? { model.openKioskDevices() } : nil
                )

                if model.kioskAccess == .available, !model.monitoredKioskDevices.isEmpty {
                    rowSeparator
                    ForEach(Array(model.monitoredKioskDevices.prefix(4).enumerated()), id: \.element.id) { index, device in
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

            if model.kioskAccess == .available, model.monitoredKioskDevices.count > 4 {
                Button("View \(model.monitoredKioskDevices.count - 4) more kiosks") {
                    model.openKioskDevices()
                }
                .buttonStyle(.link)
                .font(.caption)
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

    @State private var isHovering = false

    @ViewBuilder
    var body: some View {
        if #available(macOS 26.0, *) {
            pickupButton
                .glassEffect(
                    .regular.tint(Color.orange.opacity(isHovering ? 0.22 : 0.12)).interactive(),
                    in: .rect(cornerRadius: 10)
                )
                .onHover { isHovering = $0 }
        } else {
            pickupButton
                .background(
                    isHovering ? Color.primary.opacity(0.1) : Color.primary.opacity(0.045),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(.secondary.opacity(0.25), lineWidth: 0.5)
                }
                .onHover { isHovering = $0 }
        }
    }

    private var pickupButton: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Capsule()
                    .fill(.orange)
                    .frame(width: 3, height: 42)

                UserAvatarView(
                    name: booking.requester.name,
                    avatarUrl: booking.requester.avatarUrl
                )

                VStack(alignment: .leading, spacing: 3) {
                    Text(booking.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(pickupLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .lineLimit(1)
                    Text("\(booking.requester.name) · \(booking.location.name)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(isHovering ? .secondary : .tertiary)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(booking.title)
        .accessibilityLabel("\(booking.title), \(pickupLabel), \(booking.requester.name), \(booking.location.name)")
        .accessibilityHint("Opens this booking in Wisconsin Creative")
    }

    private var pickupLabel: String {
        let age = max(0, now.timeIntervalSince(booking.startsAt))
        if age < 60 { return "Waiting now" }
        if Calendar.current.isDateInToday(booking.startsAt) {
            return "Waiting since \(booking.startsAt.formatted(date: .omitted, time: .shortened))"
        }
        return "Waiting since \(booking.startsAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
    }
}

private struct OpenBookingRow: View {
    let booking: OpenBooking
    let now: Date
    let action: () -> Void

    @State private var isHovering = false

    @ViewBuilder
    var body: some View {
        if #available(macOS 26.0, *) {
            bookingButton
                .glassEffect(
                    booking.isOverdue(at: now)
                        ? .regular.tint(Color.red.opacity(0.12)).interactive()
                        : .regular.interactive(),
                    in: .rect(cornerRadius: 10)
                )
                .onHover { isHovering = $0 }
        } else {
            bookingButton
                .background(
                    fallbackBackground,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(.secondary.opacity(0.25), lineWidth: 0.5)
                }
                .onHover { isHovering = $0 }
        }
    }

    private var fallbackBackground: Color {
        if booking.isOverdue(at: now) {
            return Color.red.opacity(isHovering ? 0.16 : 0.08)
        }
        return isHovering ? Color.primary.opacity(0.1) : Color.primary.opacity(0.045)
    }

    private var bookingButton: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Capsule()
                    .fill(booking.isOverdue(at: now) ? Color.red : Color.blue)
                    .frame(width: 3, height: 42)
                UserAvatarView(
                    name: booking.requester.name,
                    avatarUrl: booking.requester.avatarUrl
                )
                VStack(alignment: .leading, spacing: 3) {
                    Text(booking.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(dueLabel(at: now))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(booking.isOverdue(at: now) ? .red : .blue)
                        .lineLimit(1)
                    Text(metadata)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(isHovering ? .secondary : .tertiary)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .help(booking.refNumber.map { "\(booking.title) · \($0)" } ?? booking.title)
        .accessibilityLabel(accessibilityLabel(at: now))
        .accessibilityHint("Opens this checkout in Wisconsin Creative")
    }

    private var metadata: String {
        var parts = [booking.requester.name, booking.location.name]
        if booking.itemCount > 0 {
            parts.append("\(booking.itemCount) item\(booking.itemCount == 1 ? "" : "s")")
        }
        return parts.joined(separator: " · ")
    }

    private func dueLabel(at now: Date) -> String {
        let calendar = Calendar.current
        let day: String
        if calendar.isDateInToday(booking.endsAt) {
            day = "today"
        } else if calendar.isDateInTomorrow(booking.endsAt) {
            day = "tomorrow"
        } else if calendar.isDateInYesterday(booking.endsAt) {
            day = "yesterday"
        } else {
            day = booking.endsAt.formatted(.dateTime.month(.abbreviated).day())
        }
        let time = booking.endsAt.formatted(date: .omitted, time: .shortened)
        return "Due \(day), \(time)"
    }

    private func accessibilityLabel(at now: Date) -> String {
        let prefix = booking.isOverdue(at: now) ? "Overdue, " : ""
        return "\(prefix)\(booking.title), \(booking.requester.name), \(booking.location.name), \(dueLabel(at: now))"
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
