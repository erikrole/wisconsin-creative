import SwiftUI

struct KioskOperatorHubView: View {
    @Environment(KioskStore.self) private var store
    let user: KioskUser
    @State private var context: KioskStudentContext?
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedCheckout: KioskCheckoutDrawerContext?
    @State private var scanFeedback: ScanRouteFeedback?
    @State private var scanFeedbackDismissTask: Task<Void, Never>?
    @State private var scanRouteTask: Task<Void, Never>?
    @State private var scanRouteRequests = LatestRequestGeneration()
    @State private var contextLoadTask: Task<Void, Never>?
    @State private var contextLoadRequests = LatestRequestGeneration()
    @State private var shifts: [KioskCheckoutEvent] = []
    @State private var isLoadingShifts = true
    @State private var shiftsFailed = false

    private enum ScanRouteFeedback: Equatable {
        case warning(String)
        case error(String)

        var message: String {
            switch self {
            case .warning(let s), .error(let s): return s
            }
        }

        var tone: KioskBannerTone {
            switch self {
            case .warning: .warning
            case .error: .error
            }
        }
    }

    /// This screen shows one person's own bookings, and those change almost
    /// exclusively through actions taken on this same kiosk — which already
    /// reload on completion. A 30-second poll meant a student standing at the
    /// hub for five minutes issued ten authenticated round trips, each one a
    /// read plus (previously) a write, for data that had not moved. Three
    /// minutes is a safety net against a sister kiosk returning their gear
    /// mid-session, not a live feed.
    private let refreshInterval: TimeInterval = 180

    var body: some View {
        VStack(spacing: 0) {
            KioskFlowHeader(
                title: store.info?.locationName ?? "Gear Room",
                subtitle: store.info?.name,
                backAccessibilityLabel: "Back to roster",
                onBack: {
                    cancelContextLoad()
                    store.deferSleepMode()
                    store.screen = .idle
                }
            )

            if let scanFeedback {
                KioskFeedbackBanner(tone: scanFeedback.tone, message: scanFeedback.message)
                    .padding(.horizontal, KioskSpacing.lg)
                    .padding(.top, KioskSpacing.sm)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }

            if isLoading && context == nil {
                loadingSkeleton
            } else if let error, context == nil {
                Spacer()
                errorState(message: error)
                Spacer()
            } else {
                hubContent
                    .padding(.top, KioskSpacing.lg)
            }
        }
        .kioskScreenPadding()
        .overlay(alignment: .bottom) {
            if selectedCheckout == nil {
                HIDScannerField(onScan: { store.scanner.receive($0) }).frame(width: 1, height: 1).opacity(0)
            }
        }
        .task {
            store.scanner.claim(.operatorHub) { routeScan($0) }
            async let shiftLoad: Void = loadShifts()
            await loadContext()
            await shiftLoad
            #if DEBUG
            // Capture hook: opens the custody drawer without a tap, so the
            // before/after pair for this sheet is scripted rather than
            // hand-driven. No effect outside a fixture scenario.
            if KioskFixtureScenario.active == .checkoutSheet, let first = context?.checkouts.first {
                selectedCheckout = drawerContext(for: first)
            }
            #endif
        }
        .onDisappear {
            cancelContextLoad()
            scanRouteTask?.cancel()
            scanRouteTask = nil
            scanRouteRequests.invalidate()
            scanFeedbackDismissTask?.cancel()
            scanFeedbackDismissTask = nil
            store.scanner.release(.operatorHub)
        }
        .task(id: "refresh") {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(refreshInterval * 1_000_000_000))
                } catch {
                    break
                }
                guard !Task.isCancelled else { break }
                // An identified student can leave the hub unattended without
                // navigating away. Honor the kiosk-wide idle state so this
                // safety-net refresh does not keep Neon awake overnight.
                guard !store.isDeviceIdle else { continue }
                await loadContext()
            }
        }
        .sheet(item: $selectedCheckout) { checkout in
            KioskCheckoutDetailSheet(
                context: checkout,
                allowsEditing: true,
                onReturn: {
                    startReturn(checkout)
                }
            ) {
                Task { await loadContext() }
            }
            // A custody manifest has to show the custody. The fixed 620pt
            // detent left a six-item checkout showing one and a half rows on a
            // 1180x820 iPad; `.page` gives the sheet the iPad's real estate.
            .presentationSizing(.page)
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Action Panel

    /// One full-width column instead of a 60/40 split.
    ///
    /// The split gave "Coming Up" -- usually an empty state -- half the iPad
    /// while the actual actions were squeezed left and item names truncated
    /// mid-word, and it left both columns dead below the fold. Everything here
    /// is now one prioritized flow: who you are and what you hold, the one
    /// primary action, then your gear grouped by what it needs from you.
    private var hubContent: some View {
        VStack(alignment: .leading, spacing: KioskSpacing.lg) {
            identityBand

            GeometryReader { proxy in
                if proxy.size.width < KioskLayout.compactBreakpoint {
                    ScrollView {
                        VStack(alignment: .leading, spacing: KioskSpacing.lg) {
                            bookingsColumn
                            shiftsColumn
                        }
                    }
                    .scrollIndicators(.visible)
                } else {
                    HStack(alignment: .top, spacing: KioskSpacing.lg) {
                        bookingsColumn
                            .frame(maxWidth: .infinity, alignment: .topLeading)

                        Divider()
                            .background(KioskStroke.divider)

                        shiftsColumn
                            .frame(width: KioskLayout.shiftsRailWidth(for: proxy.size.width))
                    }
                }
            }
        }
    }

    /// Left column: what this person already has a claim on. Unchanged in
    /// content — it is still the reason most people open this screen.
    private var bookingsColumn: some View {
        ScrollView {
                VStack(alignment: .leading, spacing: KioskSpacing.lg) {
                    checkoutHero

                    if let pickups = context?.pendingPickups, !pickups.isEmpty {
                        section("Ready to pick up") {
                            ForEach(pickups) { pickup in
                                ActionButton(
                                    title: pickup.title,
                                    subtitle: pickupSubtitle(pickup),
                                    icon: "tray.and.arrow.down.fill",
                                    color: KioskStatus.attention
                                ) {
                                    startPickup(id: pickup.id, title: pickup.title, startsAt: pickup.startsAt)
                                }
                            }
                        }
                    }

                    if let checkouts = context?.checkouts, !checkouts.isEmpty {
                        section("Out with you") {
                            ForEach(checkouts) { checkout in
                                // The row is the booking, not a verb. Returning
                                // gear is the common case and now has its own
                                // button instead of hiding one level down behind
                                // a "Manage:" label.
                                ActiveCheckoutRow(
                                    title: checkout.title,
                                    subtitle: checkoutSubtitle(checkout),
                                    dueText: dueChipText(checkout),
                                    isOverdue: checkout.isOverdue,
                                    dueAt: checkout.endsAt,
                                    onAddItems: {
                                        selectedCheckout = drawerContext(for: checkout)
                                    },
                                    onReturn: {
                                        startReturn(drawerContext(for: checkout))
                                    }
                                )
                            }
                        }
                    }

                    if let reservations = context?.reservations, !reservations.isEmpty {
                        section("Coming up") {
                            ForEach(reservations) { res in
                                ReservationCard(title: res.title, startsAt: res.startsAt) {
                                    startPickup(id: res.id, title: res.title, startsAt: res.startsAt)
                                }
                            }
                        }
                    }

                    if !hasAnyGear {
                        Text("Nothing out and nothing reserved. Checkout Gear to grab something.")
                            .font(KioskType.body)
                            .foregroundStyle(KioskText.tertiary)
                            .padding(.top, KioskSpacing.xs)
                    }
                }
                .padding(.bottom, KioskSpacing.md)
                .padding(.trailing, 2)
        }
        .scrollIndicators(.visible)
    }

    /// Right column: the shifts this person is actually working, each able to
    /// start a checkout already linked to its event.
    ///
    /// Checkout setup has listed "Your shifts" since the 2026-07-27 rework, but
    /// only *after* someone had already decided to check gear out and walked
    /// through the details step — so the answer to "what am I here for?" lived
    /// one screen past the question. Putting it on the hub means the common
    /// path for crewed work is one tap, with the event and its end time already
    /// filled in, instead of a booking name typed by hand.
    private var shiftsColumn: some View {
        VStack(alignment: .leading, spacing: KioskSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: KioskSpacing.xs) {
                Text("YOUR SHIFTS")
                    .font(KioskType.overline)
                    .tracking(1.2)
                    .foregroundStyle(KioskText.muted)
                Spacer(minLength: 4)
                if !shifts.isEmpty {
                    Text("\(shifts.count)")
                        .font(KioskType.micro.monospacedDigit())
                        .foregroundStyle(KioskText.muted)
                }
            }

            if isLoadingShifts && shifts.isEmpty {
                VStack(spacing: KioskSpacing.xs) {
                    ForEach(0..<3, id: \.self) { _ in
                        KioskSkeletonBox(cornerRadius: KioskRadius.md).frame(height: 84)
                    }
                }
                .accessibilityLabel("Loading your shifts")
            } else if shifts.isEmpty {
                // Quiet, not alarming. Plenty of gear goes out for work that is
                // not a scheduled shift, so an empty rail is a normal Tuesday.
                VStack(alignment: .leading, spacing: 6) {
                    Image(systemName: shiftsFailed ? "wifi.exclamationmark" : "calendar")
                        .font(.title3)
                        .foregroundStyle(KioskText.muted)
                        .accessibilityHidden(true)
                    Text(shiftsFailed ? "Couldn't load shifts" : "No shifts scheduled")
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.secondary)
                    Text(shiftsFailed
                         ? "Checkout Gear still works."
                         : "Use Checkout Gear for anything not on the schedule.")
                        .font(KioskType.chip)
                        .foregroundStyle(KioskText.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KioskSpacing.md)
                .kioskCard(KioskSurface.low, radius: KioskRadius.lg, stroke: KioskStroke.hairline)
                .accessibilityElement(children: .combine)
            } else {
                ScrollView {
                    VStack(spacing: KioskSpacing.xs) {
                        ForEach(shifts) { shift in
                            ShiftCard(event: shift) { startCheckout(for: shift) }
                        }
                    }
                    .padding(.trailing, 2)
                }
                .scrollIndicators(.visible)
            }

            Spacer(minLength: 0)
        }
    }

    /// Starts checkout with the event already linked. `applyRetainedIntent` in
    /// `KioskCheckoutView` reads `selectedEvent` off the intent, ticks the
    /// event row, and prefills due-back to 90 minutes after the event end —
    /// so this lands on the details step with both required answers already filled.
    private func startCheckout(for event: KioskCheckoutEvent) {
        store.deferSleepMode()
        store.resetInactivity()
        store.setIntent(KioskFlowIntent(
            action: .checkout,
            source: .event,
            identifiedUser: user,
            expectedRequester: nil,
            selectedEvent: KioskIntentEvent(id: event.id, title: event.title, endsAt: event.endsAt),
            targetBooking: nil,
            pendingScanValues: [],
            createdAt: Date(),
            ambiguity: .none
        ))
        store.screen = .checkout(user: user)
    }

    /// Shifts are supplementary: a failure here greys one rail, it does not
    /// take down the screen someone came to return gear on.
    private func loadShifts() async {
        isLoadingShifts = true
        defer { isLoadingShifts = false }
        do {
            let events = try await KioskAPI.shared.kioskCheckoutEvents(requesterId: user.id)
            guard !Task.isCancelled else { return }
            shifts = events.filter(\.isMyShift)
            shiftsFailed = false
        } catch APIError.unauthorized {
            store.deactivate()
        } catch {
            guard !isCancellation(error) else { return }
            shiftsFailed = true
        }
    }

    private var hasAnyGear: Bool {
        !(context?.pendingPickups.isEmpty ?? true)
            || !(context?.checkouts.isEmpty ?? true)
            || !(context?.reservations.isEmpty ?? true)
    }

    @ViewBuilder
    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: KioskSpacing.sm) {
            Text(title.uppercased())
                .font(KioskType.overline)
                .tracking(1.2)
                .foregroundStyle(KioskText.muted)
            content()
        }
    }

    /// The one thing this screen is for.
    private var checkoutHero: some View {
        ActionButton(
            title: "Checkout Gear",
            subtitle: checkoutActionSubtitle,
            icon: "arrow.up.circle.fill",
            color: Color.kioskRed,
            isHero: true
        ) {
            store.setIntent(KioskFlowIntent(action: .checkout, source: .person, identifiedUser: user, expectedRequester: nil, selectedEvent: nil, targetBooking: nil, pendingScanValues: [], createdAt: Date(), ambiguity: .none))
            store.screen = .checkout(user: user)
        }
    }

    /// Identity on the left, what you currently hold on the right. Replaces the
    /// separate "YOUR SESSION" card, which restated the same counts and due
    /// time already shown on the booking rows directly beneath it.
    private var identityBand: some View {
        HStack(alignment: .center, spacing: KioskSpacing.md) {
            identityHero
            Spacer(minLength: KioskSpacing.lg)
            if let checkouts = context?.checkouts, !checkouts.isEmpty {
                let itemsOut = checkouts.reduce(0) { $0 + $1.items.count }
                let soonest = checkouts.map(\.endsAt).min()
                let hasOverdue = checkouts.contains(where: \.isOverdue)
                HStack(spacing: KioskSpacing.lg) {
                    holdingStat(value: "\(itemsOut)", label: "Items out", tone: KioskText.primary)
                    if hasOverdue {
                        holdingStat(value: "Overdue", label: "Return now", tone: KioskStatus.problem)
                    } else if let soonest {
                        holdingStat(
                            value: soonest.formatted(.dateTime.weekday(.abbreviated).hour().minute()),
                            label: "Next due",
                            tone: KioskText.primary
                        )
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func holdingStat(value: String, label: String, tone: Color) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(value)
                .font(.gothamBold(size: 22))
                .foregroundStyle(tone)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label.uppercased())
                .font(KioskType.overline)
                .tracking(1.2)
                .foregroundStyle(KioskText.muted)
        }
    }

    /// The identity moment: big avatar, time-aware greeting, Gotham name.
    /// The hub previously showed identity only in a small top-bar cluster,
    /// leaving the 13" canvas anonymous and barren.
    private var identityHero: some View {
        HStack(spacing: 16) {
            KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 72)
            VStack(alignment: .leading, spacing: 3) {
                Text(greetingOverline)
                    .font(.caption.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(KioskText.muted)
                Text(user.name)
                    .font(.gothamBold(size: 34))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(user.role.capitalized)
                    .font(.subheadline)
                    .foregroundStyle(KioskText.tertiary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(user.name), \(user.role.capitalized)")
    }

    private var greetingOverline: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "GOOD MORNING"
        case 12..<17: return "GOOD AFTERNOON"
        default: return "GOOD EVENING"
        }
    }

    /// Mirrors the real layout: identity band, then a full-width stack of
    /// action and booking rows. A skeleton that promises a different shape than
    /// the content makes the load feel like a jump.
    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: KioskSpacing.lg) {
            HStack(spacing: 16) {
                KioskSkeletonBox(cornerRadius: 36).frame(width: 72, height: 72)
                KioskSkeletonBox(cornerRadius: 8).frame(width: 220, height: 34)
                Spacer()
                KioskSkeletonBox(cornerRadius: 8).frame(width: 150, height: 34)
            }
            KioskSkeletonBox(cornerRadius: KioskRadius.lg).frame(height: 100)
            ForEach(0..<2, id: \.self) { _ in
                KioskSkeletonBox(cornerRadius: KioskRadius.lg).frame(height: 88)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.top, KioskSpacing.lg)
        .accessibilityLabel("Loading your gear")
    }

    private func pickupSubtitle(_ pickup: KioskPendingPickup) -> String {
        let names = pickup.serializedItems.prefix(2).map(\.name)
        let head = names.joined(separator: ", ")
        let extra = pickup.itemCount - names.count
        if head.isEmpty {
            return "\(pickup.itemCount) items"
        }
        return extra > 0 ? "\(head) · +\(extra) more" : head
    }

    private var checkoutActionSubtitle: String {
        let count = store.cart(for: user.id).count
        return count > 0
            ? "Resume checkout · \(count) scanned item\(count == 1 ? "" : "s")"
            : "Scan items to check out"
    }

    private func checkoutSubtitle(_ checkout: KioskStudentCheckout) -> String {
        let names = checkout.items.prefix(2).map(\.name)
        let head = names.joined(separator: ", ")
        let extra = checkout.items.count - names.count
        if head.isEmpty {
            return "\(checkout.items.count) items"
        }
        return extra > 0 ? "\(head) · +\(extra) more" : head
    }

    private func drawerContext(for checkout: KioskStudentCheckout) -> KioskCheckoutDrawerContext {
        KioskCheckoutDrawerContext(
            checkoutId: checkout.id,
            title: checkout.title,
            requesterId: user.id,
            requesterName: user.name,
            requesterAvatarUrl: user.avatarUrl,
            endsAt: checkout.endsAt,
            isOverdue: checkout.isOverdue
        )
    }

    private func dueChipText(_ checkout: KioskStudentCheckout) -> String {
        let stamp = checkout.endsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        return checkout.isOverdue ? "Overdue · was due \(stamp)" : "Due \(stamp)"
    }

    // MARK: - Error state

    private func errorState(message: String) -> some View {
        KioskErrorState(
            title: "Couldn't load your information",
            message: message
        ) {
            Task { await loadContext() }
        }
    }

    private func loadContext() async {
        contextLoadTask?.cancel()
        let requestToken = contextLoadRequests.begin()
        let task = Task { @MainActor in
            await performContextLoad(requestToken: requestToken)
        }
        contextLoadTask = task
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
    }

    private func cancelContextLoad() {
        contextLoadTask?.cancel()
        contextLoadTask = nil
        contextLoadRequests.invalidate()
        isLoading = false
    }

    private func performContextLoad(requestToken: UUID) async {
        guard ownsContextLoad(requestToken) else { return }
        if context == nil { isLoading = true }
        defer {
            if contextLoadRequests.owns(requestToken) {
                isLoading = false
                contextLoadTask = nil
            }
        }
        do {
            let loadedContext = try await KioskAPI.shared.kioskStudentContext(userId: user.id)
            guard ownsContextLoad(requestToken) else { return }
            context = loadedContext
            error = nil
        } catch APIError.unauthorized {
            guard ownsContextLoad(requestToken) else { return }
            store.deactivate()
        } catch where isCancellation(error) {
            // A newer refresh or navigation transition owns publication now.
        } catch {
            guard ownsContextLoad(requestToken) else { return }
            // Keep last-good context; if we never had one, surface the error
            // page. Otherwise the next refresh will retry silently.
            if context == nil {
                self.error = studentContextErrorMessage(for: error)
            }
        }
    }

    /// Context belongs to this exact hub lifetime, not only the newest network
    /// request. A scan or action can move the kiosk before SwiftUI tears this
    /// view down, so navigation and scanner ownership are checked after every
    /// suspension as well as on explicit cancellation.
    private func ownsContextLoad(_ requestToken: UUID) -> Bool {
        guard contextLoadRequests.owns(requestToken),
              !Task.isCancelled,
              store.scanner.owner == .operatorHub,
              case .operatorHub(let activeUser) = store.screen
        else { return false }
        return activeUser.id == user.id
    }

    private func routeScan(_ scan: String) {
        scanRouteTask?.cancel()
        let requestToken = scanRouteRequests.begin()
        scanRouteTask = Task { @MainActor in
            do {
                guard ownsScanRoute(requestToken) else { return }
                let result = try await KioskAPI.shared.kioskResolveScan(scanValue: scan, userId: user.id)
                try Task.checkCancellation()
                guard ownsScanRoute(requestToken) else { return }
                guard result.kind == "action", let action = result.action else {
                    showScanFeedback(.warning(result.message ?? "That item cannot start a flow for \(user.name)."))
                    return
                }
                let intent = KioskFlowIntent(
                    action: action,
                    source: .scan,
                    identifiedUser: user,
                    expectedRequester: result.expectedRequester,
                    selectedEvent: nil,
                    targetBooking: result.booking.map { KioskIntentBooking(id: $0.id, title: $0.title, startsAt: $0.startsAt, endsAt: $0.endsAt) },
                    pendingScanValues: [scan],
                    createdAt: Date(),
                    ambiguity: .none
                )
                store.setIntent(intent)
                switch action {
                case .checkout: store.screen = .checkout(user: user)
                case .pickup:
                    if let id = result.booking?.id { store.screen = .pickup(bookingId: id, userId: user.id) }
                case .return:
                    if let id = result.booking?.id { store.screen = .return(bookingId: id, userId: user.id) }
                case .manage: break
                }
            } catch is CancellationError {
                // A newer scan or navigation away owns the screen now.
            } catch {
                guard ownsScanRoute(requestToken), !isCancellation(error) else { return }
                showScanFeedback(.error((error as? APIError)?.errorDescription ?? "Could not route that scan."))
            }
        }
    }

    /// A scanner response can mutate this flow only while it is still the
    /// newest request and this exact student's hub owns both navigation and
    /// scanner input. Cancellation is advisory, so every post-await publish
    /// also checks the generation and live ownership.
    private func ownsScanRoute(_ requestToken: UUID) -> Bool {
        guard scanRouteRequests.owns(requestToken),
              !Task.isCancelled,
              store.scanner.owner == .operatorHub,
              case .operatorHub(let activeUser) = store.screen
        else { return false }
        return activeUser.id == user.id
    }

    /// Cancels any prior dismiss timer before starting a new one — without
    /// this, two scans within 3 seconds race: the first scan's timer fires
    /// after the second message is already showing and wipes it early.
    private func showScanFeedback(_ feedback: ScanRouteFeedback) {
        switch feedback {
        case .warning: Haptics.warning()
        case .error: Haptics.error()
        }
        scanFeedbackDismissTask?.cancel()
        withAnimation { scanFeedback = feedback }
        scanFeedbackDismissTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { scanFeedback = nil }
        }
    }

    private func startPickup(id: String, title: String, startsAt: Date?) {
        store.setIntent(KioskFlowIntent(
            action: .pickup, source: .reservation, identifiedUser: user, expectedRequester: user,
            selectedEvent: nil, targetBooking: KioskIntentBooking(id: id, title: title, startsAt: startsAt, endsAt: nil),
            pendingScanValues: [], createdAt: Date(), ambiguity: .none
        ))
        store.screen = .pickup(bookingId: id, userId: user.id)
    }

    private func startReturn(_ checkout: KioskCheckoutDrawerContext) {
        store.setIntent(KioskFlowIntent(
            action: .return, source: .activeCheckout, identifiedUser: user, expectedRequester: user,
            selectedEvent: nil,
            targetBooking: KioskIntentBooking(id: checkout.checkoutId, title: checkout.title, startsAt: nil, endsAt: checkout.endsAt),
            pendingScanValues: [], createdAt: Date(), ambiguity: .none
        ))
        store.screen = .return(bookingId: checkout.checkoutId, userId: user.id)
    }

    private func studentContextErrorMessage(for error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .networkError:
                return apiError.errorDescription ?? "Check the kiosk network and try again."
            case .decodingError:
                return "The server response changed. Try again after the kiosk refreshes."
            case .notFound:
                return "This profile is no longer available at this kiosk."
            default:
                return apiError.errorDescription ?? "Try again in a moment."
            }
        }
        return "Try again in a moment."
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
}

// MARK: - Sub-views

private struct ActionButton: View {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    var isHero: Bool = false
    var dueText: String?
    var dueIsOverdue: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                KioskSectionIcon(systemImage: icon, tint: color, size: isHero ? 56 : 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(isHero ? .title3.bold() : .headline)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(subtitle)
                        .font(isHero ? .subheadline : .caption)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                    if let dueText {
                        Text(dueText)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(dueIsOverdue ? Color.statusText(.red) : KioskText.tertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                (dueIsOverdue ? Color.statusText(.red) : KioskText.tertiary).opacity(0.14),
                                in: Capsule()
                            )
                            .padding(.top, 2)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(KioskText.secondary)
                    .accessibilityHidden(true)
            }
            .padding(isHero ? 20 : 16)
            .kioskCard(KioskSurface.card, radius: KioskRadius.lg, stroke: color.opacity(0.3))
            .overlay(alignment: .leading) {
                // Glanceable action-color marker on the leading edge.
                RoundedRectangle(cornerRadius: 2)
                    .fill(color)
                    .frame(width: 3)
                    .padding(.vertical, 12)
            }
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(subtitle)\(dueText.map { ", \($0)" } ?? "")")
    }
}

/// A booking the student currently holds, with its two real actions named
/// outright: Add Items opens the custody drawer ready to scan more gear onto
/// this checkout, Return starts the scan-back flow.
///
/// The second button used to read "Edit". Everything a student actually does
/// to a live checkout at the counter is adding another lens or another
/// battery, and "Edit" named the mechanism (a drawer with fields in it)
/// instead of the errand — so the one path to adding gear to an existing
/// checkout was labelled after the least common thing it does. Retitling and
/// renaming the closure keeps the drawer, which still owns title and due-back
/// edits, but stops hiding the common case behind the rare one.
private struct ActiveCheckoutRow: View {
    let title: String
    let subtitle: String
    let dueText: String
    let isOverdue: Bool
    let dueAt: Date
    let onAddItems: () -> Void
    let onReturn: () -> Void

    /// Status, not brand. An `OPEN` checkout is blue, orange on its due day,
    /// red only once it is actually late — the ramp in `docs/COLOR_SYSTEM.md`.
    /// Brand red stays on the Return button, which is an action, not a state.
    private var accent: Color { KioskStatus.custody(isOverdue: isOverdue, dueAt: dueAt) }

    var body: some View {
        HStack(spacing: 16) {
            KioskSectionIcon(systemImage: "shippingbox.fill", tint: accent, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(KioskType.rowTitle)
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(subtitle)
                    .font(KioskType.chip)
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
                Text(dueText)
                    .font(KioskType.micro)
                    .foregroundStyle(accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(accent.opacity(0.14), in: Capsule())
                    .padding(.top, 2)
            }

            Spacer(minLength: 12)

            Button(action: onAddItems) {
                Label("Add Items", systemImage: "plus.circle.fill")
            }
                .font(KioskType.chip)
                .kioskButtonRole(.secondary)
                .controlSize(.large)
                .accessibilityLabel("Add items to \(title)")

            Button("Return", action: onReturn)
                .font(KioskType.chip)
                .kioskButtonRole(.primary)
                .controlSize(.large)
                .accessibilityLabel("Return gear from \(title)")
        }
        .padding(16)
        .kioskCard(KioskSurface.card, radius: KioskRadius.lg, stroke: accent.opacity(0.3))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(accent)
                .frame(width: 3)
                .padding(.vertical, 12)
        }
    }
}

/// One shift this operator is working, with the checkout it implies.
///
/// The card is not itself the button. Tapping a whole card to start a custody
/// flow is how someone brushing past the counter opens a checkout they did not
/// mean to start; the explicit "Checkout" control keeps the destructive-ish
/// action deliberate while the card stays readable as schedule information.
private struct ShiftCard: View {
    let event: KioskCheckoutEvent
    let onCheckout: () -> Void

    private var isToday: Bool { Calendar.current.isDateInToday(event.startsAt) }

    /// Today's shift is the one you are most likely standing here for.
    private var accent: Color { isToday ? KioskStatus.attention : KioskStatus.scheduled }

    var body: some View {
        VStack(alignment: .leading, spacing: KioskSpacing.sm) {
            HStack(alignment: .top, spacing: KioskSpacing.sm) {
                VStack(spacing: 1) {
                    Text(event.startsAt.formatted(.dateTime.day()))
                        .font(.title3.weight(.heavy).monospacedDigit())
                        .foregroundStyle(KioskText.primary)
                    Text(event.startsAt.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                        .font(.caption2.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(accent)
                }
                .frame(width: 46, height: 50)
                .background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: KioskRadius.sm))
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(event.title)
                        .font(KioskType.rowTitle)
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(KioskType.chip)
                        .foregroundStyle(KioskText.tertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }

                Spacer(minLength: 0)

                if isToday {
                    Text("TODAY")
                        .font(KioskType.micro)
                        .foregroundStyle(accent)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(accent.opacity(0.16), in: Capsule())
                        .accessibilityHidden(true)
                }
            }

            // Secondary, not brand red. `Checkout Gear` and each booking's
            // `Return` already spend red on this screen; giving every shift a
            // full-width red button too put five of them on one canvas, which
            // is how brand red stops meaning "the action this screen is for".
            // The card's own tint and date block already read as actionable.
            Button(action: onCheckout) {
                Label("Start Checkout", systemImage: "arrow.up.circle.fill")
                    .font(KioskType.chip)
                    .frame(maxWidth: .infinity)
            }
            .kioskButtonRole(.secondary)
            .controlSize(.large)
            .accessibilityLabel("Check out gear for \(event.title)")
            .accessibilityHint("Starts checkout with this event already linked")
        }
        .padding(KioskSpacing.sm)
        .kioskCard(KioskSurface.card, radius: KioskRadius.lg, stroke: accent.opacity(0.3))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(isToday ? "Today. " : "")\(event.title), \(subtitle)")
    }

    private var subtitle: String {
        var parts = [event.startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())]
        if let location = event.locationName, !location.isEmpty {
            parts.append(location)
        } else if let sport = event.sportCode, !sport.isEmpty {
            parts.append(sport)
        }
        return parts.joined(separator: " · ")
    }
}

/// Calendar-block reservation row: big day-of-month over the weekday in the
/// reservation purple, so upcoming holds read at a glance.
private struct ReservationCard: View {
    let title: String
    let startsAt: Date
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                VStack(spacing: 1) {
                    Text(startsAt.formatted(.dateTime.day()))
                        .font(.title2.weight(.heavy).monospacedDigit())
                        .foregroundStyle(KioskText.primary)
                    Text(startsAt.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                        .font(.caption2.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(Color.statusText(.purple))
                }
                .frame(width: 50, height: 54)
                .background(Color.statusText(.purple).opacity(0.12), in: RoundedRectangle(cornerRadius: KioskRadius.sm))

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Text(startsAt.formatted(date: .omitted, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(KioskText.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(KioskText.secondary)
                    .accessibilityHidden(true)
            }
            .padding(12)
            .kioskCard(KioskSurface.card, radius: KioskRadius.md, stroke: Color.statusText(.purple).opacity(0.3))
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(startsAt.formatted(date: .abbreviated, time: .shortened))")
        .accessibilityHint("Start pickup now")
    }
}
