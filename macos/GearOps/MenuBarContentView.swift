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

enum ExtraRoute: Hashable {
    case open(id: String)
    case pickup(id: String)
}

extension BookingSearchResult {
    var route: ExtraRoute {
        switch booking {
        case .open(let booking): .open(id: booking.id)
        case .reservation(let booking): .pickup(id: booking.id)
        }
    }
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
    @State private var selectedRoute: ExtraRoute? = MenuBarContentView.fixtureRoute
    @State private var searchText = MenuBarContentView.fixtureQuery
    @State private var highlightedRoute: ExtraRoute?
    @FocusState private var searchIsFocused: Bool

    /// `GEAROPS_FIXTURE_ROUTE=open:<id>` opens a booking detail for captures.
    private static var fixtureRoute: ExtraRoute? {
        #if DEBUG
        guard GearOpsFixture.isActive,
              let raw = ProcessInfo.processInfo.environment["GEAROPS_FIXTURE_ROUTE"] else { return nil }
        if raw.hasPrefix("open:") { return .open(id: String(raw.dropFirst(5))) }
        if raw.hasPrefix("pickup:") { return .pickup(id: String(raw.dropFirst(7))) }
        #endif
        return nil
    }

    /// `GEAROPS_FIXTURE_QUERY=<text>` starts the capture with a search applied.
    private static var fixtureQuery: String {
        #if DEBUG
        if GearOpsFixture.isActive {
            return ProcessInfo.processInfo.environment["GEAROPS_FIXTURE_QUERY"] ?? ""
        }
        #endif
        return ""
    }

    private var isSearching: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

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
        // Each presentation makes the extra's window key. That is the moment
        // the user is looking, so it retries a locked Keychain and re-reads a
        // snapshot that push may have missed (bounded inside the model).
        .background(ExtraWindowEvents(
            onBecomeKey: {
                Task { await model.refreshOnPresentation() }
                if selectedRoute == nil, model.user != nil { searchIsFocused = true }
            },
            onKey: handleKey
        ))
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
            searchText = ""
            highlightedRoute = nil
        }
        .onChange(of: searchText) { _, _ in
            highlightedRoute = nil
        }
    }

    // MARK: Keyboard

    /// Arrow keys move a highlight through the visible booking rows while
    /// focus stays in the search field, so typing keeps refining. Return opens
    /// the highlighted booking; Escape clears the search. Anything unhandled
    /// falls through to the field and the existing shortcuts.
    private func handleKey(_ key: ExtraKey) -> Bool {
        guard model.user != nil else { return false }
        switch key {
        case .down, .up:
            guard selectedRoute == nil else { return false }
            let routes = navigableRoutes(at: .now)
            guard !routes.isEmpty else { return false }
            let current = highlightedRoute.flatMap { routes.firstIndex(of: $0) }
            let next: Int = switch (key, current) {
            case (.down, nil): 0
            case (.up, nil): routes.count - 1
            case (.down, let index?): min(index + 1, routes.count - 1)
            default: max((current ?? 0) - 1, 0)
            }
            highlightedRoute = routes[next]
            return true
        case .select:
            guard selectedRoute == nil, let highlightedRoute else { return false }
            selectedRoute = highlightedRoute
            return true
        case .cancel:
            guard selectedRoute == nil else { return false }
            if isSearching || highlightedRoute != nil {
                searchText = ""
                highlightedRoute = nil
                return true
            }
            return false
        }
    }

    /// The same order the rows render in, so the highlight never jumps.
    private func navigableRoutes(at now: Date) -> [ExtraRoute] {
        if isSearching {
            return model.searchBookings(searchText, at: now).map(\.route)
        }
        let pickups = visibleItems(model.pendingPickupBookings(at: now), cap: GearOpsLayout.glancePickups, expanded: showsAllPickups)
            .map { ExtraRoute.pickup(id: $0.id) }
        let open = visibleItems(model.glanceOpenBookings(at: now), cap: GearOpsLayout.glanceOpenBookings, expanded: showsAllOpenBookings)
            .map { ExtraRoute.open(id: $0.id) }
        return pickups + open
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
                searchField
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        Group {
                            if let selectedRoute {
                                bookingDetail(selectedRoute, at: context.date)
                            } else if isSearching {
                                searchResults(at: context.date)
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
                    .onChange(of: highlightedRoute) { _, route in
                        guard let route else { return }
                        proxy.scrollTo(route)
                    }
                }
                // A fresh scroll position per route, so opening a booking
                // from the bottom of the list starts at its header.
                .id(selectedRoute)
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

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("Search bookings, people, or gear", text: $searchText)
                .textFieldStyle(.plain)
                .focused($searchIsFocused)
                .accessibilityLabel("Search bookings, people, or gear")
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                    searchIsFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .help("Clear search (Esc)")
                .accessibilityLabel("Clear search")
            }
        }
        .font(.callout)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 8))
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .background {
            // ⌘F returns to the field from a booking detail.
            Button("") {
                selectedRoute = nil
                searchIsFocused = true
            }
            .keyboardShortcut("f", modifiers: .command)
            .hidden()
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func searchResults(at now: Date) -> some View {
        let results = model.searchBookings(searchText, at: now)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                sectionTitle("Results")
                Spacer()
                Text("\(results.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(results.count) result\(results.count == 1 ? "" : "s")")
            }
            if results.isEmpty {
                Text("No open or upcoming bookings match “\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))”.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(results) { result in
                        switch result.booking {
                        case .open(let booking):
                            OpenBookingRow(
                                booking: booking,
                                now: now,
                                matchedItem: result.matchedItem,
                                isHighlighted: highlightedRoute == result.route,
                                onOpenWeb: { model.openBooking(booking) }
                            ) {
                                selectedRoute = result.route
                            }
                            .id(result.route)
                        case .reservation(let booking):
                            PickupBookingRow(
                                booking: booking,
                                now: now,
                                matchedItem: result.matchedItem,
                                isHighlighted: highlightedRoute == result.route,
                                onOpenWeb: { model.openBooking(booking) }
                            ) {
                                selectedRoute = result.route
                            }
                            .id(result.route)
                        }
                    }
                }
            }
        }
    }

    /// Custody, overdue, and freshness stay in the header so a glance does not
    /// require scrolling past rows.
    private func headerSubtitle(at now: Date) -> String {
        guard let count = model.custodyCount else { return model.healthLabel(at: now) }
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
                    timing: booking.dueLabel(at: now),
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
                    timing: booking.pickupLabel(at: now),
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
                Text(model.snapshot == nil
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
            OpenBookingRow(
                booking: booking,
                now: now,
                isHighlighted: highlightedRoute == .open(id: booking.id),
                onOpenWeb: { model.openBooking(booking) }
            ) {
                selectedRoute = .open(id: booking.id)
            }
            .id(ExtraRoute.open(id: booking.id))
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
                        PickupBookingRow(
                            booking: booking,
                            now: now,
                            isHighlighted: highlightedRoute == .pickup(id: booking.id),
                            onOpenWeb: { model.openBooking(booking) }
                        ) {
                            selectedRoute = .pickup(id: booking.id)
                        }
                        .id(ExtraRoute.pickup(id: booking.id))
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
                Label(model.healthLabel(at: now), systemImage: model.healthSeverity(at: now).symbol)
                    .font(.caption.weight(.semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(model.healthSeverity(at: now).color)
                    .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: model.healthSeverity(at: now))
            }
            // Health is one grouped surface so the popover reads as two kinds
            // of content: actionable booking cards, then a status panel.
            VStack(alignment: .leading, spacing: 0) {
                HealthRow(
                    title: "Companion data",
                    detail: apiHealthDetail(at: now),
                    severity: model.companionHealthSeverity(at: now),
                    // `refresh()` coalesces re-entry itself, so the row stays
                    // tappable mid-refresh and shows progress in place of the
                    // refresh glyph. A chevron would promise navigation.
                    accessory: model.isRefreshing ? .progress : .refresh,
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

    private func apiHealthDetail(at now: Date) -> String {
        guard let snapshot = model.snapshot else { return "Unavailable" }
        // Past the stale threshold, say how long the data has gone unconfirmed;
        // otherwise, when the server last changed it.
        if model.snapshotIsStale(at: now), let confirmedAt = model.confirmedAt {
            return "Unconfirmed for " + GearOpsSnapshot.compactElapsed(from: confirmedAt, to: now)
        }
        return "Last synced " + snapshot.freshnessLabel(at: now).replacingOccurrences(of: "Updated ", with: "")
    }
}
