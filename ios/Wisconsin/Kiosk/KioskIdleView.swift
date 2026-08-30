import SwiftUI

struct KioskIdleView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var dashboard: KioskDashboard?
    @State private var users: [KioskUser] = []
    @State private var isLoading = false
    @State private var lastLoadedAt: Date?
    @State private var loadFailedAt: Date?
    @State private var selectedSummary: KioskSummarySelection = .checkouts
    @State private var selectedEvent: KioskEvent?
    @State private var selectedCheckout: KioskCheckoutDrawerContext?
    @State private var identityScanFeedback: IdentityScanFeedback?
    @State private var isIdentifyingScan = false

    /// The idle screen is a monitoring surface, not a live custody mutation
    /// flow. Five minutes lets Neon scale down between unattended checks while
    /// the view still loads immediately whenever the kiosk returns to idle.
    private let refreshInterval: TimeInterval = 5 * 60
    private let sleepWakeDuration: TimeInterval = 10 * 60

    var body: some View {
        GeometryReader { proxy in
            let compact = proxy.size.width < KioskLayout.compactBreakpoint || dynamicTypeSize.isAccessibilitySize
            let rosterWidth = KioskLayout.rosterWidth(for: proxy.size.width)

            ZStack {
                Group {
                    if compact {
                        ScrollView {
                            VStack(spacing: 24) {
                                leftPanel
                                // The page itself scrolls in the compact
                                // fallback, so there is no "one screen" for the
                                // roster to fit into and no box to measure.
                                rosterPanel(fitsToScreen: false)
                            }
                            .padding(28)
                        }
                        .scrollIndicators(.hidden)
                    } else {
                        HStack(spacing: 0) {
                            leftPanel
                                .frame(maxWidth: .infinity)
                                .padding(32)

                            Divider()
                                .background(KioskSurface.placeholder)

                            rosterPanel(fitsToScreen: true)
                                .frame(width: rosterWidth)
                                .padding(32)
                        }
                    }
                }

                if shouldShowSleepMode {
                    KioskSleepModeView(
                        deviceName: store.info?.name ?? "Gear Room",
                        onWake: dismissSleepMode
                    )
                    .transition(.opacity)
                }

                // Only capture card scans when the roster is actually the
                // active surface. While a detail sheet is open or the kiosk is
                // asleep, unmount the hidden HID field so it can't swallow input
                // or fight a presented view for first responder. The roster no
                // longer advertises card scanning, but this path is unchanged.
                if !isScannerPaused {
                    HIDScannerField { value in
                        store.scanner.receive(value)
                    }
                    .frame(width: 1, height: 1)
                    .opacity(0)
                }
            }
        }
        .task { await loadAll() }
        // The event sheet binds to a loaded dashboard event, so the capture
        // scenario can only open it once that data exists. Kept out of the
        // `.task` above so the single-load polling contract stays literal.
        .onChange(of: dashboard == nil) { _, isEmpty in
            guard !isEmpty, KioskCaptureSeed.eventDetail, selectedEvent == nil else { return }
            selectedEvent = dashboard?.events.first
        }
        .onAppear { store.scanner.claim(.home) { handleIdentityScan($0) } }
        .onChange(of: shouldShowSleepMode, initial: true) { _, isStandby in
            store.isStandbyVisible = isStandby
        }
        .onDisappear {
            store.scanner.release(.home)
            store.isStandbyVisible = false
        }
        .task(id: "refresh") {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(refreshInterval * 1_000_000_000))
                guard !store.isDeviceIdle else { continue }
                await loadAll()
            }
        }
        .onChange(of: store.isDeviceIdle) { wasIdle, isIdle in
            // Woke from device idle — refetch right away instead of waiting
            // out the rest of the 5-minute cadence.
            if wasIdle, !isIdle {
                Task { await loadAll() }
            }
        }
        .sheet(item: $selectedEvent) { event in
            KioskEventDetailSheet(
                event: event,
                capabilities: dashboard?.capabilities ?? KioskDashboard.Capabilities(),
                onStartCheckout: { startCheckout(for: event) },
                onScan: { store.scanner.receive($0) }
            )
                .presentationDetents([.height(440), .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $selectedCheckout) { context in
            KioskCheckoutDetailSheet(context: context, allowsEditing: false, onReturn: {
                startReturn(for: context)
            }, onScan: { store.scanner.receive($0) }) {
                Task { await loadAll() }
            }
                .presentationSizing(.page)
                .presentationDragIndicator(.visible)
        }
    }

    private var shouldShowSleepMode: Bool {
        guard dashboard?.standby?.sleepMode == true else { return false }
        guard sleepModeReason != "active_window" else { return false }
        if let sleepDismissedUntil = store.sleepDismissedUntil, sleepDismissedUntil > Date() {
            return false
        }
        return true
    }

    private var sleepModeReason: String {
        guard let dashboard, let standby = dashboard.standby else { return "idle_window" }
        if standby.reason == "night_hours", !Self.isLocalNightHours(Date()) {
            return isLocallyIdleWindow(dashboard, standby: standby) ? "idle_window" : "active_window"
        }
        return standby.reason
    }

    private func isLocallyIdleWindow(_ dashboard: KioskDashboard, standby: KioskDashboard.Standby) -> Bool {
        dashboard.stats.checkouts == 0 &&
        dashboard.stats.itemsOut == 0 &&
        standby.nearbyEventCount == 0 &&
        standby.nearbyBookingWindowCount == 0
    }

    private static func isLocalNightHours(_ date: Date) -> Bool {
        let hour = Calendar.current.component(.hour, from: date)
        return hour >= 22 || hour < 6
    }

    /// Pause card capture while a detail sheet is open or the kiosk is
    /// asleep — those surfaces own the screen and the hidden field should not
    /// be grabbing keystrokes or first responder underneath them.
    private var isScannerPaused: Bool {
        selectedEvent != nil || selectedCheckout != nil || shouldShowSleepMode
    }

    /// The last refresh hit a failure (and we have no fresh data to mask it).
    private var hasConnectionIssue: Bool {
        loadFailedAt != nil
    }

    /// Connection health for the quiet status dot: green when a refresh landed
    /// recently, orange when the data is going stale, red when refreshes fail.
    private var connectionTone: Color {
        if hasConnectionIssue { return Color.statusText(.red) }
        if isStale { return Color.statusText(.orange) }
        return Color.statusText(.green)
    }

    private func dismissSleepMode() {
        store.deferSleepMode(for: sleepWakeDuration)
    }

    // MARK: - Left Panel

    private var leftPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Quiet overline band: device identity reads as a label, not a
            // title, so the clock below owns the hierarchy.
            HStack(spacing: 8) {
                Text((store.info?.name ?? "Gear Room").uppercased())
                    .font(.caption.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(KioskText.secondary)
                if let location = store.info?.locationName {
                    Text("•")
                        .foregroundStyle(KioskText.muted)
                    Text(location.uppercased())
                        .font(.caption.weight(.bold))
                        .tracking(1.2)
                        .foregroundStyle(KioskText.tertiary)
                }
                Spacer(minLength: 8)
                Button {
                    store.resetInactivity()
                    Task { await loadAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(KioskText.secondary)
                        .frame(width: 44, height: 44)
                        .background(KioskSurface.cardRaised, in: Circle())
                        .overlay(Circle().stroke(KioskStroke.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(isLoading)
                .accessibilityLabel("Refresh kiosk data")
                kioskHealthDot
            }

            if hasConnectionIssue {
                connectionBanner
            }

            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: 4) {
                    KioskClockView(date: context.date)
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Color.kioskRed)
                            .frame(width: 3, height: 26)
                            .accessibilityHidden(true)
                        Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                            .font(.gothamBold(size: 32))
                            .foregroundStyle(KioskText.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                    locationAndFreshness
                }
                .accessibilityElement(children: .combine)
            }

            // Stats row
            if let stats = dashboard?.stats {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                            .font(.callout.weight(.semibold))
                        Text("Tap a count to filter the list")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KioskText.tertiary)
                    .accessibilityHidden(true)

                    HStack(spacing: 16) {
                        StatTile(
                            value: stats.checkouts,
                            label: "Checkouts",
                            accent: .white,
                            isSelected: selectedSummary == .checkouts,
                            selectedAccessibilityHint: "Showing all active checkouts",
                            reduceMotion: reduceMotion
                        ) { toggleSummary(.checkouts) }
                        StatTile(
                            value: stats.itemsOut,
                            label: "Items Out",
                            accent: .white,
                            isSelected: selectedSummary == .itemsOut,
                            reduceMotion: reduceMotion
                        ) { toggleSummary(.itemsOut) }
                        StatTile(
                            value: stats.overdue,
                            label: "Overdue",
                            accent: stats.overdue > 0 ? Color.statusText(.red) : .white,
                            isSelected: selectedSummary == .overdue,
                            reduceMotion: reduceMotion
                        ) { toggleSummary(.overdue) }
                    }
                }
            } else {
                HStack(spacing: 16) {
                    StatTilePlaceholder(label: "Checkouts")
                    StatTilePlaceholder(label: "Items Out")
                    StatTilePlaceholder(label: "Overdue")
                }
            }

            // Events used to sit here and were empty most of the time. The
            // idle screen now leads with live custody instead; event context
            // lives in checkout setup, where it is actually used.
            //
            // It takes the rest of the panel. The trailing `Spacer()` below
            // used to win that space and push the list into a 210pt box.
            dashboardDetailPanel
                .frame(maxHeight: .infinity, alignment: .top)

            // Quiet-day state: without it the left panel is a black void
            // below the stat tiles whenever nothing is out and no events run.
            if let dashboard, dashboard.checkouts.isEmpty, selectedSummary == .checkouts {
                Spacer()
                VStack(spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(Color.statusText(.green).opacity(0.12))
                            .frame(width: 88, height: 88)
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(Color.statusText(.green))
                    }
                    .accessibilityHidden(true)
                    Text("All gear is home")
                        .font(.title3.bold())
                        .foregroundStyle(KioskText.primary)
                    Text("Nothing is checked out right now")
                        .font(.subheadline)
                        .foregroundStyle(KioskText.tertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .kioskCard(KioskSurface.low, radius: KioskRadius.lg, stroke: KioskStroke.hairline)
                .accessibilityElement(children: .combine)
            }

            Spacer()
        }
    }

    /// Discreet "Updated Xm ago" stamp. Switches to
    /// orange when the last successful load is >5 min old so staff has a
    /// visual signal that the dashboard might be lying.
    @ViewBuilder
    private var locationAndFreshness: some View {
        HStack(spacing: 6) {
            if let last = lastLoadedAt {
                Text("Updated \(last.kioskFreshnessLabel(now: Date()))")
                    .font(.caption)
                    .foregroundStyle(isStale ? Color.statusText(.orange) : KioskText.tertiary)
                    .monospacedDigit()
            }
        }
    }

    private var isStale: Bool {
        guard let last = lastLoadedAt else { return false }
        return Date().timeIntervalSince(last) > 300
    }

    /// Quiet at-a-glance signal for staff that the kiosk is up and talking to
    /// the server — green/online, orange/stale, red/offline.
    ///
    /// Wrapped in its own `TimelineView` on purpose. `isStale` is a function of
    /// elapsed time since `lastLoadedAt`, but this dot lives in the header row
    /// outside the clock's timeline, so nothing ever invalidated it as time
    /// passed — it re-rendered only when a load actually completed, which is
    /// exactly when the data is *not* stale. The result was a permanently green
    /// ACTIVE dot sitting beside an orange "Updated 1h ago" stamp: the one
    /// element whose entire job is telling staff whether to trust the screen
    /// was the element that could not tell the truth. 30s granularity is plenty
    /// for a 5-minute threshold and costs one view update per half minute.
    private var kioskHealthDot: some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            let isOffline = hasConnectionIssue
            let stale = isStale
            HStack(spacing: 6) {
                Circle()
                    .fill(connectionTone)
                    .frame(width: 8, height: 8)
                Text(isOffline ? "Offline" : (stale ? "Stale" : "Active"))
                    .font(.caption2.weight(.bold))
                    .tracking(0.6)
                    .foregroundStyle(KioskText.tertiary)
                    .textCase(.uppercase)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Kiosk \(isOffline ? "offline" : (stale ? "data stale" : "active and online"))")
        }
    }

    private var connectionBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
                .foregroundStyle(Color.statusText(.orange))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("Can't connect right now")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KioskText.primary)
                if let last = lastLoadedAt {
                    Text("Showing data from \(last.kioskFreshnessLabel(now: Date()))")
                        .font(.caption2)
                        .foregroundStyle(KioskText.muted)
                } else {
                    Text("No data loaded yet")
                        .font(.caption2)
                        .foregroundStyle(KioskText.muted)
                }
            }
            Spacer()
            Button {
                Task { await loadAll() }
            } label: {
                Text(isLoading ? "Retrying…" : "Retry")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KioskText.primary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.kioskRed.opacity(0.85), in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
            .accessibilityLabel("Retry loading kiosk data")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.statusText(.orange).opacity(0.12), in: RoundedRectangle(cornerRadius: KioskRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.md)
                .stroke(Color.statusText(.orange).opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Can't connect right now. \(lastLoadedAt != nil ? "Showing cached data." : "No data yet.") Retry available.")
    }

    // MARK: - Roster Panel

    private func rosterPanel(fitsToScreen: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // The panel says what to do and nothing else. It used to be headed
            // by a 56pt viewfinder glyph and "Scan Wiscard", with tapping a
            // name demoted to a grey subtitle underneath — a card-reader
            // instruction owning the top of the one panel whose entire content
            // is tappable people. Card scanning still works exactly as before
            // (the hidden HID field below is untouched); it simply no longer
            // introduces the roster.
            Text("Tap your name")
                .font(.title2.bold())
                .foregroundStyle(KioskText.primary)
                // No trailing count chip: the shell mounts the scanner status
                // pill at this corner, and a roster that is entirely on screen
                // already states its own size.
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.trailing, 150)

            if let feedback = identityScanFeedback {
                KioskFeedbackBanner(tone: feedback.tone, message: feedback.message)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            if fitsToScreen {
                GeometryReader { proxy in
                    if users.isEmpty && isLoading {
                        rosterSkeleton(in: proxy.size)
                    } else {
                        rosterList(in: proxy.size)
                    }
                }
            } else {
                // Unbounded height: lay out at the comfortable tile size and
                // let the enclosing page scroll.
                let flowing = CGSize(width: 0, height: 0)
                if users.isEmpty && isLoading {
                    rosterSkeleton(in: flowing)
                } else {
                    rosterList(in: flowing)
                }
            }
        }
    }

    /// One flat alphabetical grid, sized so the whole roster is on screen.
    ///
    /// This started as a grid of 112pt photo tiles behind an A-Z chip rail,
    /// then grew pinned letter headers. Both were structure standing between
    /// someone and their own name. The roster is already sorted; finding a name
    /// in a sorted list is a scan, not a lookup, and every separator was a row
    /// of vertical space that pushed real names off screen.
    ///
    /// The scroll view was the last thing doing that. Tiles were a fixed size,
    /// so the roster's length decided how much of it you could see, and the
    /// people below the fold were only reachable if you already knew the panel
    /// scrolled. `KioskRosterMetrics` inverts that: the count and the box are
    /// the inputs, and the tile size is what gives. It scrolls only when the
    /// roster is genuinely too large to show at a tappable size.
    private func rosterList(in size: CGSize) -> some View {
        let labels = disambiguatedLabels(for: users)
        let metrics = rosterMetrics(for: users.count, in: size)
        let grid = LazyVGrid(columns: metrics.gridColumns, spacing: KioskRosterMetrics.gap) {
            ForEach(users) { user in
                UserRow(
                    user: user,
                    displayName: labels[user.id] ?? user.name,
                    metrics: metrics
                ) {
                    store.deferSleepMode(for: sleepWakeDuration)
                    store.screen = .operatorHub(user)
                }
            }
        }

        return Group {
            if metrics.fitsOnOneScreen {
                grid.frame(maxHeight: .infinity, alignment: .top)
            } else {
                ScrollView {
                    grid
                }
                .scrollIndicators(.visible)
            }
        }
    }

    private func rosterSkeleton(in size: CGSize) -> some View {
        let metrics = rosterMetrics(for: 18, in: size)
        return LazyVGrid(columns: metrics.gridColumns, spacing: KioskRosterMetrics.gap) {
            ForEach(0..<18, id: \.self) { _ in
                KioskSkeletonBox(cornerRadius: KioskRadius.md)
                    .frame(height: metrics.tileHeight)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .accessibilityLabel("Loading roster")
    }

    /// At accessibility text sizes the tile can no longer be shrunk to fit —
    /// the type is the point — so the roster returns to a single scrolling
    /// column at a comfortable height.
    private func rosterMetrics(for count: Int, in size: CGSize) -> KioskRosterMetrics {
        guard !dynamicTypeSize.isAccessibilitySize else {
            return KioskRosterMetrics(
                columns: 1,
                tileHeight: KioskRosterMetrics.comfortableHeight,
                avatarSize: 40,
                showsAvatar: true,
                fitsOnOneScreen: false
            )
        }
        return KioskRosterMetrics.resolve(count: count, in: size)
    }

    private func toggleSummary(_ summary: KioskSummarySelection) {
        if summary == .checkouts {
            selectedSummary = .checkouts
        } else {
            selectedSummary = selectedSummary == summary ? .checkouts : summary
        }
        store.resetInactivity()
    }

    /// Custody urgency must not depend on response or fixture ordering. Keep
    /// every overdue checkout ahead of on-time work, then walk forward through
    /// return times. Title is only a stable tie-breaker for equal timestamps.
    private func orderedCheckouts(_ checkouts: [KioskActiveCheckout]) -> [KioskActiveCheckout] {
        checkouts.sorted { lhs, rhs in
            if lhs.isOverdue != rhs.isOverdue { return lhs.isOverdue }
            if lhs.endsAt != rhs.endsAt { return lhs.endsAt < rhs.endsAt }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    @ViewBuilder
    private var dashboardDetailPanel: some View {
        if let dashboard {
            switch selectedSummary {
            case .itemsOut:
                let itemGroups = ActiveItemGroup.groups(from: dashboard.activeItems)
                KioskDashboardList(title: "Items Out", emptyMessage: "No items are out.", isEmpty: dashboard.activeItems.isEmpty, onClose: { toggleSummary(.itemsOut) }) {
                    ForEach(itemGroups) { group in
                        ActiveItemRow(group: group) { openCheckout(id: group.first.checkoutId, title: group.first.checkoutTitle, requesterId: group.first.requesterId, requesterName: group.first.requesterName, requesterAvatarUrl: group.first.requesterAvatarUrl, endsAt: group.first.endsAt, isOverdue: group.first.isOverdue) }
                    }
                }
            case .checkouts:
                let checkouts = orderedCheckouts(dashboard.checkouts)
                KioskDashboardList(title: "Active Checkouts", emptyMessage: "No active checkouts.", isEmpty: checkouts.isEmpty, onClose: nil) {
                    ForEach(checkouts) { checkout in
                        CheckoutRow(
                            checkout: checkout,
                            onTap: { openCheckout(checkout) },
                            onReturn: { startReturn(row: checkout) }
                        )
                    }
                }
            case .overdue:
                let overdueCheckouts = orderedCheckouts(dashboard.checkouts.filter(\.isOverdue))
                KioskDashboardList(title: "Overdue", emptyMessage: "No overdue checkouts.", isEmpty: overdueCheckouts.isEmpty, onClose: { toggleSummary(.overdue) }) {
                    ForEach(overdueCheckouts) { checkout in
                        CheckoutRow(
                            checkout: checkout,
                            onTap: { openCheckout(checkout) },
                            onReturn: { startReturn(row: checkout) }
                        )
                    }
                }
            }
        }
    }

    /// Staff can start a return without the holder identifying first. The
    /// booking already names its requester, and handing gear back is the one
    /// custody action where identity is carried by the record rather than by
    /// the person at the counter. Checkout still requires identity.
    private func startReturn(_ checkout: KioskActiveCheckout) {
        guard let requesterId = checkout.requesterId else { return }
        store.deferSleepMode()
        store.resetInactivity()
        store.screen = .return(bookingId: checkout.id, userId: requesterId)
    }

    /// Return straight from a dashboard row. Builds the same drawer context the
    /// manage sheet would have built, then hands off to the identical
    /// `startReturn(for:)` transition — so a one-tap return and a return
    /// started from inside the sheet are the same flow, identity gate included.
    private func startReturn(row checkout: KioskActiveCheckout) {
        startReturn(for: KioskCheckoutDrawerContext(
            checkoutId: checkout.id,
            title: checkout.title,
            requesterId: checkout.requesterId,
            requesterName: checkout.requesterName,
            requesterAvatarUrl: checkout.requesterAvatarUrl,
            endsAt: checkout.endsAt,
            isOverdue: checkout.isOverdue
        ))
    }

    private func openCheckout(_ checkout: KioskActiveCheckout) {
        openCheckout(
            id: checkout.id,
            title: checkout.title,
            requesterId: checkout.requesterId,
            requesterName: checkout.requesterName,
            requesterAvatarUrl: checkout.requesterAvatarUrl,
            endsAt: checkout.endsAt,
            isOverdue: checkout.isOverdue
        )
    }

    private func openCheckout(id: String, title: String, requesterId: String?, requesterName: String, requesterAvatarUrl: String?, endsAt: Date, isOverdue: Bool) {
        selectedCheckout = KioskCheckoutDrawerContext(
            checkoutId: id,
            title: title,
            requesterId: requesterId,
            requesterName: requesterName,
            requesterAvatarUrl: requesterAvatarUrl,
            endsAt: endsAt,
            isOverdue: isOverdue
        )
        store.resetInactivity()
    }

    @ViewBuilder
    private var eventSections: some View {
        if let dashboard {
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: Date())
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) ?? today
            let todayEvents = dashboard.events.filter { $0.kioskOccurs(on: today, calendar: calendar) }
            let tomorrowEvents = dashboard.events.filter { $0.kioskOccurs(on: tomorrow, calendar: calendar) }
            VStack(alignment: .leading, spacing: 12) {
                KioskEventSection(
                    title: "Today",
                    events: todayEvents,
                    hasWorkerDetails: dashboard.capabilities.eventWorkerDetails
                ) { event in
                    selectedEvent = event
                }
                KioskEventSection(
                    title: "Tomorrow",
                    events: tomorrowEvents,
                    hasWorkerDetails: dashboard.capabilities.eventWorkerDetails
                ) { event in
                    selectedEvent = event
                }
            }
        }
    }

    private func loadAll() async {
        isLoading = true
        async let dashboardResult = fetchDashboard()
        async let usersResult = fetchUsers()

        let dashboardOutcome = await dashboardResult
        let usersOutcome = await usersResult
        var loadedAnyData = false
        var hitFailure = false
        var sawCancellation = false

        switch dashboardOutcome {
        case .success(let value):
            dashboard = value
            #if DEBUG
            print("[KioskIdleView] dashboard capabilities: workerDetails=\(value.capabilities.eventWorkerDetails), callTimes=\(value.capabilities.eventCallTimes)")
            #endif
            loadedAnyData = true
        case .failure(let error) where isUnauthorized(error):
            store.deactivate()
            isLoading = false
            return
        case .failure(let error) where isCancellation(error):
            sawCancellation = true
        case .failure(let error):
            print("[KioskIdleView] dashboard load failed: \(error.localizedDescription)")
            hitFailure = true
        }

        switch usersOutcome {
        case .success(let value):
            users = value
            loadedAnyData = true
        case .failure(let error) where isUnauthorized(error):
            store.deactivate()
            isLoading = false
            return
        case .failure(let error) where isCancellation(error):
            sawCancellation = true
        case .failure(let error):
            print("[KioskIdleView] users load failed: \(error.localizedDescription)")
            hitFailure = true
        }

        if loadedAnyData {
            lastLoadedAt = Date()
        }
        if hitFailure {
            loadFailedAt = Date()
        } else if loadedAnyData || !sawCancellation {
            loadFailedAt = nil
        }
        isLoading = false
    }

    private func fetchDashboard() async -> Result<KioskDashboard, Error> {
        do {
            return .success(try await KioskAPI.shared.kioskDashboard())
        } catch {
            return .failure(error)
        }
    }

    private func fetchUsers() async -> Result<[KioskUser], Error> {
        do {
            return .success(try await KioskAPI.shared.kioskUsers())
        } catch {
            return .failure(error)
        }
    }

    private func isUnauthorized(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        if case .unauthorized = apiError {
            return true
        }
        return false
    }

    private func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }
        if let apiError = error as? APIError,
           case .networkError(let underlying) = apiError {
            return isCancellation(underlying)
        }
        if let urlError = error as? URLError {
            return urlError.code == .cancelled
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private func handleIdentityScan(_ value: String) {
        guard !isIdentifyingScan else { return }
        store.resetInactivity()
        isIdentifyingScan = true
        identityScanFeedback = .working("Resolving scan...")
        Task {
            do {
                let result = try await KioskAPI.shared.kioskResolveScan(scanValue: value)
                if result.kind == "identity", let user = result.user {
                    Haptics.success()
                    identityScanFeedback = .success(user.name)
                    store.screen = .operatorHub(user)
                } else if result.kind == "pending_identity" || result.kind == "action" {
                    let action = KioskFlowAction(rawValue: result.action?.rawValue ?? inferredAction(from: result.disposition)) ?? .checkout
                    let intent = KioskFlowIntent(
                        action: action,
                        source: .scan,
                        identifiedUser: nil,
                        expectedRequester: result.expectedRequester,
                        selectedEvent: nil,
                        targetBooking: result.booking.map { KioskIntentBooking(id: $0.id, title: $0.title, startsAt: $0.startsAt, endsAt: $0.endsAt) },
                        pendingScanValues: [value],
                        createdAt: Date(),
                        ambiguity: .none
                    )
                    store.setIntent(intent)
                    store.screen = .identity
                } else {
                    Haptics.warning()
                    identityScanFeedback = .error(result.message ?? "That scan cannot start a kiosk flow.")
                }
            } catch {
                if isUnauthorized(error) {
                    store.deactivate()
                } else {
                    Haptics.error()
                    identityScanFeedback = .error((error as? APIError)?.errorDescription ?? "Could not read that scan")
                }
            }
            isIdentifyingScan = false
        }
    }

    private func inferredAction(from disposition: String?) -> String {
        switch disposition {
        case "booked_reservation": return "pickup"
        case "active_custody": return "return"
        default: return "checkout"
        }
    }

    private func startCheckout(for event: KioskEvent) {
        store.setIntent(KioskFlowIntent(
            action: .checkout,
            source: .event,
            identifiedUser: nil,
            expectedRequester: nil,
            selectedEvent: KioskIntentEvent(id: event.id, title: event.title, endsAt: event.endsAt),
            targetBooking: nil,
            pendingScanValues: [],
            createdAt: Date(),
            ambiguity: .none
        ))
        store.screen = .identity
    }

    private func startReturn(for context: KioskCheckoutDrawerContext) {
        guard let requesterId = context.requesterId else {
            identityScanFeedback = .error("This checkout is missing its requester.")
            return
        }
        let requester = KioskUser(id: requesterId, name: context.requesterName, avatarUrl: context.requesterAvatarUrl, role: "STUDENT", affiliation: nil, affiliationBadge: nil)
        store.setIntent(KioskFlowIntent(
            action: .return,
            source: .activeCheckout,
            identifiedUser: nil,
            expectedRequester: requester,
            selectedEvent: nil,
            targetBooking: KioskIntentBooking(id: context.checkoutId, title: context.title, startsAt: nil, endsAt: context.endsAt),
            pendingScanValues: [],
            createdAt: Date(),
            ambiguity: .none
        ))
        store.screen = .identity
    }
}

// MARK: - Sub-views

private enum IdentityScanFeedback: Equatable {
    case working(String)
    case success(String)
    case error(String)

    var message: String {
        switch self {
        case .working(let message), .success(let message), .error(let message):
            return message
        }
    }

    var tone: KioskBannerTone {
        switch self {
        case .working: .warning
        case .success: .success
        case .error: .error
        }
    }
}

/// Which slice of live custody the idle list is showing. `checkouts` is the
/// resting state; the other stat tiles temporarily narrow that complete list.
private enum KioskSummarySelection {
    case itemsOut
    case checkouts
    case overdue
}

private struct KioskClockView: View {
    let date: Date

    private var parts: (time: String, seconds: String, meridiem: String) {
        date.kioskClockParts()
    }

    var body: some View {
        Text("\(parts.time)\(parts.seconds) \(parts.meridiem)")
            .font(.system(size: 118, weight: .black, design: .monospaced))
            .foregroundStyle(KioskText.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
        .accessibilityLabel(date.formatted(date: .omitted, time: .standard))
    }
}

private struct StatTile: View {
    let value: Int
    let label: String
    let accent: Color
    let isSelected: Bool
    var selectedAccessibilityHint = "Selected. Tap to show all active checkouts"
    let reduceMotion: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Text("\(value)")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .foregroundStyle(accent)
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.4), value: value)
                    .monospacedDigit()
                Text(label.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(KioskText.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22)
            // These tiles filter the list below, and nothing said so — they
            // read as read-only KPI cards, which is what they look like on
            // every other dashboard anyone has used.
            .overlay(alignment: .topTrailing) {
                Image(systemName: isSelected ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .font(.caption)
                    .foregroundStyle(isSelected ? KioskText.primary : KioskText.muted)
                    .padding(10)
                    .accessibilityHidden(true)
            }
            // Selection uses neutral contrast. Red remains reserved for
            // overdue counts, actions, and other genuinely urgent states.
            .kioskCard(
                isSelected ? KioskSurface.cardSelected : KioskSurface.cardRaised,
                radius: KioskRadius.xl,
                stroke: isSelected ? KioskStroke.selected : KioskStroke.standard,
                lineWidth: isSelected ? 2 : 1
            )
            .overlay(alignment: .bottom) {
                if isSelected {
                    Capsule()
                        .fill(KioskText.primary)
                        .frame(width: 34, height: 3)
                        .padding(.bottom, 8)
                }
            }
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label.lowercased())")
        .accessibilityHint(isSelected ? selectedAccessibilityHint : "Tap to filter the list below")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

private struct StatTilePlaceholder: View {
    let label: String

    var body: some View {
        VStack(spacing: 6) {
            Text("–")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(KioskText.muted)
            Text(label.uppercased())
                .font(.caption.weight(.semibold))
                .tracking(0.8)
                .foregroundStyle(KioskText.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(KioskSurface.low, in: RoundedRectangle(cornerRadius: KioskRadius.xl))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.xl)
                .stroke(KioskStroke.divider, lineWidth: 1)
        )
        .accessibilityHidden(true)
    }
}

private struct KioskDashboardList<Content: View>: View {
    let title: String
    let emptyMessage: String
    let isEmpty: Bool
    var onClose: (() -> Void)?
    let content: Content

    init(title: String, emptyMessage: String, isEmpty: Bool, onClose: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.emptyMessage = emptyMessage
        self.isEmpty = isEmpty
        self.onClose = onClose
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.callout.weight(.bold))
                    .foregroundStyle(KioskText.secondary)
                Spacer()
                if let onClose {
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.body)
                            .foregroundStyle(KioskText.muted)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close \(title)")
                }
            }

            ScrollView {
                LazyVStack(spacing: 8) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // No fixed cap. This was pinned at 210pt while roughly 350pt of
            // black sat directly underneath it, so three checkouts already
            // scrolled inside a small box on a panel with room to show ten.
            .frame(maxHeight: .infinity)
            .overlay {
                if isEmpty {
                    Text(emptyMessage)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(KioskText.secondary)
                        .frame(maxWidth: .infinity, minHeight: 62)
                }
            }
        }
        .padding(12)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(KioskSurface.low, in: RoundedRectangle(cornerRadius: KioskRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.lg)
                .stroke(KioskStroke.divider, lineWidth: 1)
        )
    }
}

/// Groups the flat active-item list so a holder's numbered battery units
/// collapse into one row with unit chips, mirroring the checkout cart.
/// Units are keyed by SKU *and* checkout so two students holding the same
/// battery type stay on separate rows.
private struct ActiveItemGroup: Identifiable {
    let id: String
    var items: [KioskDashboard.ActiveItem]

    var first: KioskDashboard.ActiveItem { items[0] }
    var isBulkGroup: Bool { first.isNumberedBulk }
    var count: Int { items.count }
    var isOverdue: Bool { first.isOverdue }
    var unitNumbers: [Int] { items.compactMap(\.unitNumber).sorted() }

    var primaryTitle: String {
        guard isBulkGroup else { return first.itemListPrimaryTitle }
        let tags = unitNumbers.map { "#\($0)" }.joined(separator: " ")
        return tags.nonBlankText ?? first.itemListPrimaryTitle
    }

    var subtitle: String {
        guard isBulkGroup else { return [first.itemListSecondaryTitle, first.checkoutTitle].compactMap { $0 }.joined(separator: " · ") }
        let name = first.name.replacingOccurrences(of: #" #\d+$"#, with: "", options: .regularExpression)
        return "\(name) · \(count) unit\(count == 1 ? "" : "s")"
    }

    static func groups(from items: [KioskDashboard.ActiveItem]) -> [ActiveItemGroup] {
        var groups: [ActiveItemGroup] = []
        var bulkIndex: [String: Int] = [:]
        for item in items {
            if item.isNumberedBulk, let bulkSkuId = item.bulkSkuId {
                let key = "bulk-\(bulkSkuId)-\(item.checkoutId)"
                if let index = bulkIndex[key] {
                    groups[index].items.append(item)
                } else {
                    bulkIndex[key] = groups.count
                    groups.append(ActiveItemGroup(id: key, items: [item]))
                }
            } else {
                groups.append(ActiveItemGroup(id: item.id, items: [item]))
            }
        }
        return groups
    }
}

private struct ActiveItemRow: View {
    let group: ActiveItemGroup
    let onTap: () -> Void
    private var item: KioskDashboard.ActiveItem { group.first }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                assetImage
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(group.primaryTitle)
                            .font(.gothamBold(size: 16))
                            .foregroundStyle(KioskText.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                        if group.count > 1 {
                            Text("x\(group.count)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Color.kioskRed)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.kioskRed.opacity(0.16), in: Capsule())
                        }
                    }

                    Text(group.subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 6)
                KioskAvatar(url: item.requesterAvatarUrl, initials: item.requesterInitials, size: 30)
                    .accessibilityHidden(true)
                if group.isOverdue {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.statusText(.red))
                        .font(.caption)
                        .accessibilityLabel("Overdue")
                }
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(KioskText.muted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.sm)
                    .stroke(KioskStroke.standard, lineWidth: 1)
            )
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Opens checkout details")
    }

    private var accessibilityLabel: String {
        let prefix = group.isOverdue ? "Overdue: " : ""
        let what: String
        if group.isBulkGroup {
            what = "\(group.primaryTitle), \(group.subtitle)"
        } else {
            what = "\(group.primaryTitle), \(group.subtitle)"
        }
        return "\(prefix)\(what), held by \(item.requesterName) for \(item.checkoutTitle)"
    }

    @ViewBuilder
    private var assetImage: some View {
        if let urlString = item.imageUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    fallbackAssetImage
                }
            }
            .frame(width: 42, height: 42)
            .clipShape(RoundedRectangle(cornerRadius: KioskRadius.sm))
        } else {
            fallbackAssetImage
        }
    }

    private var fallbackAssetImage: some View {
        RoundedRectangle(cornerRadius: KioskRadius.sm)
            .fill(KioskSurface.placeholder)
            .frame(width: 42, height: 42)
            .overlay {
                Image(systemName: item.isNumberedBulk ? "battery.100percent" : "camera.fill")
                    .font(.caption)
                    .foregroundStyle(KioskText.secondary)
            }
    }
}

private struct CheckoutRow: View {
    let checkout: KioskActiveCheckout
    let onTap: () -> Void
    let onReturn: () -> Void

    /// Status, not brand: blue while out, orange on the due day, red once late.
    private var tone: Color {
        KioskStatus.custody(isOverdue: checkout.isOverdue, dueAt: checkout.endsAt)
    }

    // Two labelled destinations, not one target and a chevron.
    //
    // This row was previously a single tap that opened the manage sheet, on the
    // reasoning that a Return button beside a chevron gave the row two
    // competing destinations. The competition was real, but the fix removed the
    // wrong half: the idle screen's resting list is naming gear that is still
    // out, and handing that gear back was three steps away behind an unlabelled
    // chevron and a sheet load.
    //
    // The chevron is what goes. What is left is a named body action and a named
    // Return — the same shape the student hub already uses for the same
    // booking, so the two surfaces no longer disagree about how a return
    // starts. Return routes through exactly the path the sheet's own Return
    // button used, so the identity gate is unchanged.
    var body: some View {
        HStack(spacing: KioskSpacing.xs) {
            Button(action: onTap) {
                HStack {
                    // Real avatar when available; falls back to the existing
                    // initials disc on missing/failed loads. Overdue ring stays
                    // as the visual signal regardless of which path renders.
                    ZStack {
                        Circle()
                            .fill(checkout.isOverdue ? tone.opacity(0.3) : KioskSurface.cardRaised)
                            .frame(width: 36, height: 36)
                        avatarInitialsLayer
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(checkout.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(KioskText.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                        Text(holderSummary)
                            .font(.caption)
                            .foregroundStyle(KioskText.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                    Spacer(minLength: 6)
                    Text(checkout.endsAt.kioskDashboardDueStamp(isOverdue: checkout.isOverdue))
                        .font(KioskType.micro)
                        .foregroundStyle(tone)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(tone.opacity(0.14), in: Capsule())
                        .fixedSize()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(KioskPressStyle())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilitySummary)
            .accessibilityHint("Opens checkout details")

            Button("Return", action: onReturn)
                .font(KioskType.chip)
                .kioskButtonRole(.primary)
                .controlSize(.regular)
                .accessibilityLabel("Return gear from \(checkout.title)")
                .padding(.trailing, 10)
        }
        .background(KioskSurface.cardRaised, in: RoundedRectangle(cornerRadius: KioskRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: KioskRadius.sm)
                .stroke(KioskStroke.standard, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var avatarInitialsLayer: some View {
        if let urlString = checkout.requesterAvatarUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    initialsBubble
                }
            }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
        } else {
            initialsBubble
        }
    }

    private var initialsBubble: some View {
        Text(checkout.requesterInitials)
            .font(.caption.bold())
            .foregroundStyle(KioskText.primary)
    }

    private var itemCountSummary: String {
        "\(checkout.itemCount) \(checkout.itemCount == 1 ? "item" : "items")"
    }

    private var holderSummary: String {
        "\(checkout.requesterName) · \(itemCountSummary)"
    }

    private var accessibilitySummary: String {
        let dueSummary = checkout.endsAt.kioskDashboardDueStamp(isOverdue: checkout.isOverdue)
        return "\(checkout.title), held by \(checkout.requesterName), \(itemCountSummary), \(dueSummary)"
    }
}
