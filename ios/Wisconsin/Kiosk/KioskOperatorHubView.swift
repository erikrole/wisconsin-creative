import SwiftUI

struct KioskOperatorHubView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let user: KioskUser
    @State private var context: KioskStudentContext?
    @State private var isLoading = true
    @State private var error: String?
    @State private var selectedCheckout: KioskCheckoutDrawerContext?
    @State private var scanFeedback: ScanRouteFeedback?
    @State private var scanFeedbackDismissTask: Task<Void, Never>?
    @State private var scanRouteTask: Task<Void, Never>?
    /// Follow-up scans that arrive while the first is being routed ride along
    /// into the flow it opens, instead of each one cancelling the last.
    @State private var trailingScans: [String] = []
    @State private var isRoutingScan = false
    @State private var scanRouteRequests = LatestRequestGeneration()
    @State private var contextLoadTask: Task<Void, Never>?
    @State private var contextLoadRequests = LatestRequestGeneration()
    @State private var shifts: [KioskCheckoutEvent] = []
    @State private var isLoadingShifts = true
    @State private var shiftsFailed = false
    @State private var hasUnfinishedCheckout = false
    @State private var showDiscardUnfinished = false
    /// Changes (row H), each a screen over the hub.
    @State private var extendTarget: KioskCheckoutDrawerContext?
    @State private var transferTarget: KioskCheckoutDrawerContext?
    @State private var reservationTarget: KioskIntentBooking?
    @State private var staffFlowTarget: KioskCheckoutDrawerContext?
    @State private var changeNotice: String?

    private var isPresentingChange: Bool {
        selectedCheckout != nil || extendTarget != nil || transferTarget != nil
            || reservationTarget != nil || staffFlowTarget != nil
    }

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
            KioskTaskHeader(
                title: user.name,
                subtitle: hubSubtitle,
                avatarURL: user.avatarUrl,
                avatarInitials: user.initials,
                backAccessibilityLabel: "Back to home",
                onBack: {
                    cancelContextLoad()
                    store.deferSleepMode()
                    store.screen = .idle
                }
            )

            if let changeNotice {
                KioskFeedbackBanner(tone: .success, message: changeNotice)
                    .padding(.horizontal, KioskSpacing.lg)
                    .padding(.top, KioskSpacing.sm)
            }

            if let scanFeedback {
                KioskFeedbackBanner(tone: scanFeedback.tone, message: scanFeedback.message)
                    .padding(.horizontal, KioskSpacing.lg)
                    .padding(.top, KioskSpacing.sm)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }

            if isLoading && context == nil {
                loadingSkeleton
            } else if let error, context == nil {
                Spacer()
                errorState(message: error)
                Spacer()
            } else {
                hubContent
                    .padding(.top, 16)
            }
        }
        .overlay(alignment: .bottom) {
            if !isPresentingChange {
                HIDScannerField(onScan: { store.scanner.receive($0) }).frame(width: 1, height: 1).opacity(0)
            }
        }
        .task {
            hasUnfinishedCheckout = KioskAPI.shared.hasPendingCheckout(actorId: user.id)
            store.scanner.claim(.operatorHub) { routeScan($0) }
            async let shiftLoad: Void = loadShifts()
            await loadContext()
            await shiftLoad
            #if DEBUG
            // Capture hook: opens the custody drawer without a tap, so the
            // before/after pair for this sheet is scripted rather than
            // hand-driven. No effect outside a fixture scenario.
            if KioskFixtureScenario.active == .checkoutSheet || KioskFixtureScenario.active == .changesSwap,
               let first = context?.checkouts.first {
                selectedCheckout = drawerContext(for: first)
            }
            if KioskFixtureScenario.active == .changesExtend, let first = context?.checkouts.first {
                extendTarget = drawerContext(for: first)
            }
            if KioskFixtureScenario.active == .changesTransfer, let first = context?.checkouts.first {
                transferTarget = drawerContext(for: first)
            }
            if KioskFixtureScenario.active == .changesReservation, let first = context?.pendingPickups.first(where: \.canChangeReservedItems) {
                reservationTarget = KioskIntentBooking(id: first.id, title: first.title, startsAt: first.startsAt, endsAt: nil)
            }
            if KioskFixtureScenario.active == .changesStaff, let overdue = context?.checkouts.last {
                // Production reaches this from a booking's sheet on home.
                staffFlowTarget = KioskCheckoutDrawerContext(
                    checkoutId: overdue.id, title: overdue.title, requesterId: "u-3",
                    requesterName: "Dashiell Okonkwo", requesterAvatarUrl: nil,
                    custodyScope: "PERSON", endsAt: overdue.endsAt, isOverdue: overdue.isOverdue
                )
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
        .overlay {
            if showDiscardUnfinished {
                KioskConfirmationCard(
                    title: "Discard the unfinished checkout?",
                    message: "Only if the gear is back on the shelf. Anything that did go through is already on your hub.",
                    cancelTitle: "Keep it",
                    confirmTitle: "Discard",
                    confirmRole: .destructive,
                    onCancel: { showDiscardUnfinished = false },
                    onConfirm: {
                        KioskAPI.shared.discardPendingCheckout(actorId: user.id)
                        store.clearCart(for: user.id)
                        store.clearCheckoutDraft(for: user.id)
                        hasUnfinishedCheckout = false
                        showDiscardUnfinished = false
                    }
                )
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
        .fullScreenCover(item: $extendTarget) { checkout in
            KioskExtendScreen(
                checkoutId: checkout.checkoutId,
                title: checkout.title,
                detailLine: extendDetailLine(checkout),
                actorId: user.id,
                onCancel: { extendTarget = nil },
                onExtended: { finishChange("Extended. \(checkout.title) has more time.") { extendTarget = nil } }
            )
        }
        .fullScreenCover(item: $transferTarget) { checkout in
            KioskTransferScreen(
                checkoutId: checkout.checkoutId,
                title: checkout.title,
                holderId: user.id,
                holderName: user.name,
                actor: user,
                onCancel: { transferTarget = nil },
                onTransferred: { result, target in
                    finishChange("\(result.itemCount) item\(result.itemCount == 1 ? "" : "s") moved to \(target.shortName). They're on \(target.shortName)'s record now.") {
                        transferTarget = nil
                    }
                }
            )
        }
        .fullScreenCover(item: $reservationTarget) { booking in
            KioskReservationEditView(reservationId: booking.id, title: booking.title, user: user) { saved in
                reservationTarget = nil
                if saved { finishChange("Reservation saved.") {} }
            }
        }
        .fullScreenCover(item: $staffFlowTarget) { checkout in
            KioskStaffActionsFlow(context: checkout) { _ in
                staffFlowTarget = nil
                Task { await loadContext() }
            }
        }
    }

    private func finishChange(_ message: String, dismiss: () -> Void) {
        dismiss()
        changeNotice = message
        Task {
            await loadContext()
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if changeNotice == message { changeNotice = nil }
        }
    }

    private func extendDetailLine(_ checkout: KioskCheckoutDrawerContext) -> String {
        let match = context?.checkouts.first { $0.id == checkout.checkoutId }
        let count = match?.items.count ?? 0
        return [match?.refNumber, count > 0 ? "\(count) item\(count == 1 ? "" : "s")" : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: - Hub (redesign C1–C4)

    private var hubSubtitle: String {
        let role = user.role.capitalized
        guard let location = store.info?.locationName else { return role }
        return "\(role) · \(location)"
    }

    /// Bookings on the left, the person's shifts in a 440pt rail on the right.
    private var hubContent: some View {
        HStack(spacing: 0) {
            bookingsColumn
                .padding(.leading, KioskSpacing.xl)
                .padding(.trailing, KioskSpacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Rectangle().fill(KioskStroke.divider).frame(width: 1)
            shiftsColumn
                .padding(.leading, KioskSpacing.lg)
                .padding(.trailing, KioskSpacing.xl)
                .frame(width: hasAnyGear ? 400 : 440)
                .frame(maxHeight: .infinity, alignment: .top)
        }
        .padding(.bottom, KioskSpacing.screenBottom)
    }

    private var bookingsColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if hasUnfinishedCheckout {
                    unfinishedCheckoutCard
                }
                if let blocked = checkoutBlockedMessage {
                    blockedHero(blocked)
                } else {
                    checkoutHero
                }

                KioskSectionHeader(title: "Out with you")
                if let checkouts = context?.checkouts, !checkouts.isEmpty {
                    ForEach(checkouts) { checkout in
                        HubBookingCard(
                            title: checkout.title,
                            detail: itemsLine(checkout),
                            status: dueStatus(checkout),
                            statusColor: checkout.isOverdue ? KioskStatus.problem
                                : (Calendar.current.isDateInToday(checkout.endsAt) ? KioskStatus.attention : KioskText.secondary),
                            items: checkout.items
                        ) {
                            Button("Return") { startReturn(drawerContext(for: checkout)) }
                                .kioskButtonRole(.primary)
                            // Return leads; the rest sit in one menu (Erik, 2026-10-01).
                            Menu {
                                Button("Extend", systemImage: "clock") { extendTarget = drawerContext(for: checkout) }
                                Button("Add items", systemImage: "plus") { selectedCheckout = drawerContext(for: checkout) }
                                // Decision 2: the holder hands it over directly,
                                // no accept step. Hub checkouts are personal.
                                Button("Transfer", systemImage: "arrow.left.arrow.right") { transferTarget = drawerContext(for: checkout) }
                            } label: {
                                Text("More")
                            }
                            .kioskButtonRole(.secondary)
                        }
                    }
                } else {
                    emptyCard("Nothing out right now.")
                }

                KioskSectionHeader(title: "Ready to pick up")
                let pickups = context?.pendingPickups ?? []
                let reservations = context?.reservations ?? []
                if pickups.isEmpty && reservations.isEmpty {
                    emptyCard("No reservations waiting.")
                } else {
                    ForEach(pickups) { pickup in
                        HubBookingCard(
                            title: pickup.title,
                            detail: "\(pickup.itemCount) item\(pickup.itemCount == 1 ? "" : "s") reserved · \(readyLine(pickup.startsAt))",
                            status: "",
                            statusColor: KioskStatus.scheduled
                        ) {
                            Button("Pick up") { startPickup(id: pickup.id, title: pickup.title, startsAt: pickup.startsAt) }
                                .kioskButtonRole(.primary)
                            if pickup.canChangeReservedItems {
                                Button("Change items") {
                                    reservationTarget = KioskIntentBooking(id: pickup.id, title: pickup.title, startsAt: pickup.startsAt, endsAt: nil)
                                }
                                .kioskButtonRole(.secondary)
                            }
                        }
                    }
                    ForEach(reservations) { reservation in
                        HubBookingCard(
                            title: reservation.title,
                            detail: readyLine(reservation.startsAt),
                            status: "",
                            statusColor: KioskStatus.scheduled
                        ) {
                            Button("Pick up") { startPickup(id: reservation.id, title: reservation.title, startsAt: reservation.startsAt) }
                                .kioskButtonRole(.primary)
                                .accessibilityHint("Start pickup now")
                            Button("Change items") {
                                reservationTarget = KioskIntentBooking(id: reservation.id, title: reservation.title, startsAt: reservation.startsAt, endsAt: nil)
                            }
                            .kioskButtonRole(.secondary)
                        }
                    }
                }

                if !hasAnyGear {
                    Text("Returns and pickups show here when you have them, each with its own button.")
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.muted)
                        .padding(.horizontal, 2)
                }
            }
            .padding(.top, 4)
        }
        .scrollIndicators(.hidden)
    }

    /// C3: the checkout limit or an unfinished leftover pickup, said up front.
    private var checkoutBlockedMessage: String? {
        if hasUnfinishedCheckout { return "Finish the one above first." }
        guard let allowance = context?.checkoutAllowance, !allowance.canCheckout else { return nil }
        if allowance.blockedReason == "leftover_pickup" {
            return "Finish picking up \(allowance.leftoverPickupTitle ?? "your reservation") first."
        }
        let count = allowance.openCheckoutCount
        return "You have \(count) checkout\(count == 1 ? "" : "s") open, which is the most at once. Return one to start another."
    }

    private func blockedHero(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(KioskText.tertiary)
                    .frame(width: 48, height: 48)
                    .background(KioskStroke.pending.opacity(0.6), in: Circle())
                Text("Check out gear")
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(KioskText.tertiary)
            }
            Text(message)
                .font(KioskType.body)
                .foregroundStyle(KioskText.primary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .kioskCard(KioskSurface.card, radius: KioskRadius.hero, stroke: KioskStroke.standard)
        .accessibilityElement(children: .combine)
    }

    /// C4: a checkout saved on this iPad that never confirmed.
    private var unfinishedCheckoutCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("UNFINISHED CHECKOUT")
                .font(KioskType.overline)
                .tracking(KioskType.overlineTracking)
                .foregroundStyle(KioskSection.comingBack.text)
            Text("A checkout never confirmed")
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(KioskText.primary)
            Text("Check it now to finish it. If the gear is already back on the shelf, discard it.")
                .font(KioskType.body)
                .foregroundStyle(KioskText.secondary)
            HStack(spacing: 8) {
                Button("Check it now") {
                    store.setIntent(KioskFlowIntent(action: .checkout, source: .person, identifiedUser: user, expectedRequester: nil, selectedEvent: nil, targetBooking: nil, pendingScanValues: [], createdAt: Date(), ambiguity: .none))
                    store.screen = .checkout(user: user)
                }
                .kioskButtonRole(.primary)
                Button("Discard") { showDiscardUnfinished = true }
                    .kioskButtonRole(.secondary)
            }
        }
        .padding(20)
        .kioskCard(KioskSection.comingBack.stageFill, radius: 18, stroke: KioskSection.comingBack.stageStroke)
    }

    private func emptyCard(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 15))
            .foregroundStyle(KioskText.tertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .kioskCard()
    }

    private func itemsLine(_ checkout: KioskStudentCheckout) -> String {
        let parts = checkout.items.prefix(3).map { $0.tagName == $0.name ? $0.name : "\($0.tagName) \($0.name)" }
        let extra = checkout.items.count - parts.count
        let head = parts.joined(separator: ", ")
        return extra > 0 ? "\(head) +\(extra) more" : head
    }

    private func dueStatus(_ checkout: KioskStudentCheckout) -> String {
        let time = checkout.endsAt.formatted(.dateTime.hour().minute())
        if checkout.isOverdue { return "Overdue" }
        if Calendar.current.isDateInToday(checkout.endsAt) { return "Due today \(time)" }
        return "Due \(checkout.endsAt.formatted(.dateTime.weekday(.abbreviated))) \(time)"
    }

    private func readyLine(_ startsAt: Date) -> String {
        if startsAt <= Date() { return "ready now" }
        if Calendar.current.isDateInToday(startsAt) {
            return "ready from \(startsAt.formatted(.dateTime.hour().minute()))"
        }
        return "from \(startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }

    private var shiftsColumn: some View {
        VStack(alignment: .leading, spacing: 10) {
            KioskSectionHeader(title: "Your shifts")
            if isLoadingShifts && shifts.isEmpty {
                ForEach(0..<2, id: \.self) { _ in
                    KioskSkeletonBox(cornerRadius: KioskRadius.xl).frame(height: 144)
                }
                .accessibilityLabel("Loading your shifts")
            } else if shifts.isEmpty {
                emptyCard(shiftsFailed ? "Couldn't load shifts. Check out gear still works." : "No shifts coming up.")
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        // One card per matchup: a series (Thu and Fri vs the same
                        // opponent) lists its dates instead of repeating the card.
                        ForEach(hubShiftSeries(shifts), id: \.title) { series in
                            HubShiftSeriesCard(title: series.title, events: series.events, existing: { existingBooking(for: $0) }) { startCheckout(for: $0) }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
    }

    /// The green hero. Smaller once the person has gear to deal with.
    private var checkoutHero: some View {
        let compact = hasAnyGear
        return Button {
            store.setIntent(KioskFlowIntent(action: .checkout, source: .person, identifiedUser: user, expectedRequester: nil, selectedEvent: nil, targetBooking: nil, pendingScanValues: [], createdAt: Date(), ambiguity: .none))
            store.screen = .checkout(user: user)
        } label: {
            HStack(spacing: 18) {
                Image(systemName: "plus")
                    .font(.system(size: compact ? 24 : 28, weight: .bold))
                    .foregroundStyle(KioskText.onPrimary)
                    .frame(width: compact ? 48 : 60, height: compact ? 48 : 60)
                    .background(KioskSection.takingOut.accent, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Check out gear")
                        .font(.system(size: compact ? 22 : 26, weight: .heavy))
                        .foregroundStyle(KioskText.primary)
                    if !compact || store.cart(for: user.id).count > 0 {
                        Text(checkoutActionSubtitle)
                            .font(.system(size: 15))
                            .foregroundStyle(KioskText.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(KioskText.muted)
            }
            .padding(.horizontal, compact ? 22 : 24)
            .frame(height: compact ? 88 : 112)
            .kioskCard(Color(red: 0x16 / 255, green: 0x1E / 255, blue: 0x19 / 255), radius: KioskRadius.hero,
                       stroke: Color(red: 0x2F / 255, green: 0x5A / 255, blue: 0x40 / 255))
        }
        .buttonStyle(KioskPressStyle())
        .accessibilityLabel("Check out gear")
    }

    /// Starts checkout with the event already linked. `applyRetainedIntent` in
    /// `KioskCheckoutView` reads `selectedEvent` off the intent, ticks the
    /// event row, and prefills due-back to 90 minutes after the event end —
    /// so this lands on the details step with both required answers already filled.
    /// A shift that already has gear booked points at that booking instead of
    /// offering a second checkout. Matched by cleaned title (bookings don't
    /// carry an event id here).
    private func existingBooking(for event: KioskCheckoutEvent) -> (label: String, action: (() -> Void)?)? {
        let key = kioskEventDisplayTitle(event.title, sportCode: event.sportCode).lowercased()
        func same(_ title: String) -> Bool {
            kioskEventDisplayTitle(title, sportCode: event.sportCode).lowercased() == key
        }
        if let pickup = context?.pendingPickups.first(where: { same($0.title) }) {
            return ("Pick up", { startPickup(id: pickup.id, title: pickup.title, startsAt: pickup.startsAt) })
        }
        if let reservation = context?.reservations.first(where: { same($0.title) }) {
            return ("Pick up", { startPickup(id: reservation.id, title: reservation.title, startsAt: reservation.startsAt) })
        }
        if context?.checkouts.contains(where: { same($0.title) }) == true {
            return ("Gear out", nil)
        }
        return nil
    }

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
            ? "Pick up where you left off · \(count) scanned"
            : "Say what it's for, then scan it"
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
            custodyScope: "PERSON",
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
        store.resetInactivity()
        if isRoutingScan {
            if scan != trailingScans.last { trailingScans.append(scan) }
            return
        }
        trailingScans = []
        isRoutingScan = true
        let requestToken = scanRouteRequests.begin()
        scanRouteTask = Task { @MainActor in
            defer { if scanRouteRequests.owns(requestToken) { isRoutingScan = false } }
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
                    pendingScanValues: KioskFlowIntent.orderedScans(scan, then: trailingScans),
                    createdAt: Date(),
                    ambiguity: .none,
                    custodyOwner: result.custodyOwner
                )
                trailingScans = []
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
        // Audible on every rejection: the fleet iPads have no Taptic Engine.
        KioskScanFeedbackSound.playFailure()
        scanFeedbackDismissTask?.cancel()
        if reduceMotion {
            scanFeedback = feedback
        } else {
            withAnimation { scanFeedback = feedback }
        }
        scanFeedbackDismissTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            if reduceMotion {
                scanFeedback = nil
            } else {
                withAnimation { scanFeedback = nil }
            }
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
                return "The kiosk couldn't read that result. Refresh and try again."
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

// MARK: - Hub cards

private struct HubBookingCard<Actions: View>: View {
    let title: String
    let detail: String
    let status: String
    let statusColor: Color
    /// When set, the gear shows as photo + asset tag chips instead of `detail`.
    var items: [KioskStudentCheckout.StudentItem]? = nil
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    if let items, !items.isEmpty {
                        HubItemChips(items: items)
                    } else {
                        Text(detail)
                            .font(KioskType.meta)
                            .foregroundStyle(KioskText.tertiary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Text(status)
                    .font(KioskType.chipStrong)
                    .foregroundStyle(statusColor)
            }
            HStack(spacing: 8) { actions() }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .kioskCard(radius: 18)
    }
}

/// Groups shifts by their cleaned matchup title, keeping first-seen order.
private func hubShiftSeries(_ shifts: [KioskCheckoutEvent]) -> [(title: String, events: [KioskCheckoutEvent])] {
    var order: [String] = []
    var byTitle: [String: [KioskCheckoutEvent]] = [:]
    for shift in shifts {
        let title = kioskEventDisplayTitle(shift.title, sportCode: shift.sportCode)
        if byTitle[title] == nil { order.append(title) }
        byTitle[title, default: []].append(shift)
    }
    return order.map { ($0, byTitle[$0] ?? []) }
}

private struct HubShiftSeriesCard: View {
    let title: String
    let events: [KioskCheckoutEvent]
    var existing: (KioskCheckoutEvent) -> (label: String, action: (() -> Void)?)? = { _ in nil }
    let action: (KioskCheckoutEvent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                if let location = events.first?.locationName?.components(separatedBy: " - ").first, !location.isEmpty {
                    Text(location)
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.tertiary)
                        .lineLimit(1)
                }
            }
            ForEach(events) { event in
                HStack(spacing: 12) {
                    Text(event.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(KioskText.primary)
                    Text(event.allDay ? "All day" : event.startsAt.formatted(.dateTime.hour().minute()))
                        .font(KioskType.meta)
                        .foregroundStyle(KioskText.secondary)
                    Spacer(minLength: 8)
                    if let booked = existing(event) {
                        if let go = booked.action {
                            Button(action: go) {
                                Text(booked.label).font(.system(size: 15, weight: .semibold)).lineLimit(1).fixedSize().padding(.horizontal, 14).frame(minHeight: 44)
                            }
                            .kioskButtonRole(.primary)
                        } else {
                            Text(booked.label)
                                .font(KioskType.chipStrong)
                                .foregroundStyle(KioskText.tertiary)
                        }
                    } else {
                        Button { action(event) } label: {
                            Text("Check out").font(.system(size: 15, weight: .semibold)).lineLimit(1).fixedSize().padding(.horizontal, 14).frame(minHeight: 44)
                        }
                        .kioskButtonRole(.secondary)
                    }
                }
            }
        }
        .padding(16)
        .kioskCard()
        .accessibilityElement(children: .contain)
    }
}

/// Up to four photo + asset-tag chips, then "+N".
private struct HubItemChips: View {
    let items: [KioskStudentCheckout.StudentItem]
    private let shown = 4

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(items.prefix(shown).enumerated()), id: \.offset) { _, item in
                HStack(spacing: 6) {
                    KioskItemThumbnail(imageUrl: item.imageUrl, size: 26)
                    Text(label(item))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                }
                .padding(.leading, 3)
                .padding(.trailing, 9)
                .padding(.vertical, 3)
                .background(KioskSurface.cardRaised, in: Capsule())
            }
            if items.count > shown {
                Text("+\(items.count - shown)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(KioskText.tertiary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(items.map(\.name).joined(separator: ", "))
    }

    /// Asset tag; counted stock ("x2") reads as its name instead.
    private func label(_ item: KioskStudentCheckout.StudentItem) -> String {
        item.tagName.hasPrefix("x") && Int(item.tagName.dropFirst()) != nil ? item.name : item.tagName
    }
}
