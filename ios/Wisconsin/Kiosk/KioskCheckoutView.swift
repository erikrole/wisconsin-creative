import SwiftUI
import UIKit

private enum KioskCheckoutFocusedField: Hashable {
    case customPurpose
}

private enum KioskCheckoutDefaults {
    /// Buffer after a linked event ends before gear is due back. Event end is
    /// when the game/session finishes, not when people are done packing up —
    /// 90 minutes gives tear-down and travel back to the gear room without
    /// making the default look identical to the schedule end people ignore.
    static let linkedEventReturnBuffer: TimeInterval = 90 * 60

    static func defaultDueBackDate(now: Date = Date(), calendar: Calendar = .current) -> Date {
        guard let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) else {
            return now.addingTimeInterval(24 * 60 * 60)
        }
        return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow)
            ?? now.addingTimeInterval(24 * 60 * 60)
    }

    static func dueBackDate(afterEventEndsAt eventEnd: Date, now: Date = Date()) -> Date? {
        let proposed = eventEnd.addingTimeInterval(linkedEventReturnBuffer)
        guard proposed > now.addingTimeInterval(60) else { return nil }
        return KioskQuarterHour.roundedUp(proposed)
    }
}

private enum KioskCheckoutSetupLayout {
    /// Keep the setup bounded on the managed M2 iPad Air fleet so the two
    /// setup columns remain a stable task instead of sprawling edge to edge.
    /// The columns themselves split this width evenly -- the old fixed
    /// 376/648 pair cramped the booking-name field beside a return column
    /// sized for a month calendar that no longer exists.
    static let maxWidth: CGFloat = 1048
}

struct KioskCheckoutView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let user: KioskUser

    @State private var lastResult: ScanFeedback?
    @State private var feedbackDismissTask: Task<Void, Never>?
    @State private var isCompleting = false
    @State private var showBackConfirm = false
    @State private var showCamera = false
    @State private var eventOptions: [KioskCheckoutEvent] = []
    @State private var isLoadingEvents = false
    @State private var eventLoadError: String?
    @State private var isLinkedToEvent = false
    @State private var selectedEventId: String?
    @State private var customPurpose = ""
    /// A new checkout starts on its details step. Checkout is a two-step flow —
    /// say what this is for and when it comes back, then scan — and the details
    /// were previously a sheet floating over a scan screen you could not
    /// actually use yet, which is why that screen greeted you with a "Details
    /// needed" banner. A restored draft or a scan-initiated checkout resumes
    /// straight into scanning; only a genuinely new checkout starts at step 1.
    @State private var checkoutContextReady = false
    @State private var scannerCaptureEnabled = true
    @State private var scannerHasFocus = false
    // Seeded open for the `scanner-help` capture scenario, which has no other
    // way in: the sheet is local state opened by a tap, and taps are exactly
    // what is unreliable on a kiosk simulator. Always false in release.
    @State private var showScannerHelp = KioskCaptureSeed.scannerHelp
    @State private var showEditContextConfirm = false
    @State private var lastScanAt: Date?
    @State private var pendingScanIdentities: Set<String> = []
    /// The item the last successful scan added, held while its confirmation is
    /// on the stage. Cleared on the same timer as the feedback banner.
    @State private var lastAccepted: KioskAcceptedScan?
    @State private var dueBackAt = KioskCheckoutDefaults.defaultDueBackDate()
    @State private var availabilityResult = KioskCheckoutAvailabilityResult()
    @State private var isCheckingAvailability = false
    @State private var availabilityError: String?
    @State private var hasVerifiedAvailability = false
    @State private var availabilityRequests = LatestRequestGeneration()
    // Plain @State on purpose — NOT @FocusState. The booking-name field is a
    // UIKit-backed KioskNativeTextField, invisible to SwiftUI's focus system,
    // so no view ever claims a @FocusState value for it. SwiftUI then resets
    // the value to nil on its next focus pass, and the stale binding makes
    // KioskNativeTextField force-resign the field the instant it is tapped —
    // the keyboard dies before a single character can be typed. Plain @State
    // is the source of truth the UIKit delegate writes into (same pattern as
    // KioskCheckoutDetailSheet's titleFocused/scanFocused).
    @State private var focusedCheckoutField: KioskCheckoutFocusedField? = nil
    @State private var earnedBadges: [EarnedBadgeReward] = []

    enum ScanFeedback: Equatable {
        case success(String)
        case error(String)
        case duplicate(String)
        case warning(String)

        var message: String {
            switch self {
            case .success(let s), .error(let s), .duplicate(let s), .warning(let s): return s }
        }

        var tone: KioskBannerTone {
            switch self {
            case .success:   .success
            case .error:     .error
            case .duplicate, .warning: .warning
            }
        }
    }

    /// Cart lives in KioskStore so a brief inactivity reset doesn't discard it.
    private var userId: String { user.id }
    private var scannedItems: [KioskCartItem] { store.cart(for: userId) }
    private var groupedScannedItems: [KioskCartDisplayGroup] {
        KioskCartDisplayGroup.groups(from: scannedItems)
    }
    private var shouldListenForHIDScans: Bool {
        scannerCaptureEnabled && focusedCheckoutField == nil && !showCamera && !showScannerHelp && !showEditContextConfirm
    }

    var body: some View {
        checkoutLayout
        .overlay(alignment: .bottom) {
            if scannerCaptureEnabled {
                // Hidden HID scanner field stays mounted in scan mode, but yields
                // first responder whenever visible checkout inputs need the keyboard.
                HIDScannerField(
                    isEnabled: shouldListenForHIDScans,
                    onScan: { store.scanner.receive($0) },
                    onFocusChange: { scannerHasFocus = $0 }
                )
                .frame(width: 1, height: 1)
                .opacity(0)
            }
        }
        .confirmationDialog(
            "Discard \(scannedItems.count) scanned item\(scannedItems.count == 1 ? "" : "s")?",
            isPresented: $showBackConfirm,
            titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) {
                store.clearCart(for: userId)
                store.clearCheckoutDraft(for: userId)
                Haptics.warning()
                store.screen = .operatorHub(user)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Going back will clear your scans.")
        }
        .confirmationDialog(
            "Edit checkout details?",
            isPresented: $showEditContextConfirm,
            titleVisibility: .visible
        ) {
            Button("Edit Details") {
                checkoutContextReady = false
                DispatchQueue.main.async {
                    focusedCheckoutField = .customPurpose
                }
                Haptics.warning()
            }
            Button("Keep Scanning", role: .cancel) {}
        } message: {
            Text("Your scanned items will stay in the cart.")
        }
        .sheet(isPresented: $showCamera) {
            KioskBarcodeCameraView(
                feedbackMessage: lastResult?.message,
                feedbackTone: lastResult?.tone,
                onScan: { value in
                    handleScan(value)
                },
                onCancel: { showCamera = false }
            )
        }
        .sheet(isPresented: $showScannerHelp) {
            KioskScannerTroubleshootingSheet(
                lastScanAt: lastScanAt,
                locationName: store.info?.locationName,
                onCamera: {
                    showScannerHelp = false
                    showCamera = true
                }
            )
        }
        .task {
            restoreDraftIfNeeded()
            applyRetainedIntent()
            store.scanner.claim(.checkout) { handleScan($0) }
            await loadCheckoutEvents()
            applySelectedEventDueTime()
            #if DEBUG
            // Capture hook: the scan stage is only reachable after the details
            // step is satisfied, which no fixture can express through the API.
            if KioskFixtureScenario.active == .scanning { checkoutContextReady = true }
            if KioskFixtureScenario.active == .scanAccepted {
                checkoutContextReady = true
                // The confirmation only exists in the seconds after a real
                // scan, which no fixture payload can produce.
                lastAccepted = KioskAcceptedScan(
                    title: "BAT-004",
                    subtitle: "V-Mount Battery #4",
                    progress: "\(scannedItems.count) items scanned"
                )
            }
            #endif
        }
        .onChange(of: selectedEventId) { _, _ in
            applySelectedEventDueTime()
            persistDraft()
        }
        .onChange(of: isLinkedToEvent) { _, linked in
            if linked {
                customPurpose = ""
                applySelectedEventDueTime()
            } else {
                selectedEventId = nil
                DispatchQueue.main.async {
                    focusedCheckoutField = .customPurpose
                }
            }
            persistDraft()
        }
        .onChange(of: customPurpose) { _, _ in persistDraft() }
        .onChange(of: dueBackAt) { _, _ in
            persistDraft()
            guard checkoutContextReady, !scannedItems.isEmpty else { return }
            Task { await refreshAvailability(for: scannedItems) }
        }
        .onChange(of: focusedCheckoutField) { _, field in
            store.scanner.setEditing(field != nil)
        }
        .onChange(of: checkoutContextReady) { _, isReady in
            if !isReady {
                scannerCaptureEnabled = false
            }
            persistDraft()
        }
        .onDisappear {
            availabilityRequests.invalidate()
            isCheckingAvailability = false
            scannerCaptureEnabled = false
            store.scanner.setEditing(false)
            store.scanner.release(.checkout)
        }
    }

    // MARK: - Scan Zone

    @ViewBuilder
    private var checkoutLayout: some View {
        if checkoutContextReady {
            KioskAdaptiveSplit { _ in
                activeScanZone
            } secondary: { isCompact in
                itemsList(isCompact: isCompact)
            }
        } else {
            checkoutContextSetupZone
        }
    }

    /// Setup stays focused before scan mode: a pinned flow header, one centered
    /// details panel, and a pinned Start Scanning CTA.
    private var checkoutContextSetupZone: some View {
        VStack(spacing: 0) {
            KioskFlowHeader(
                title: "Checkout Details",
                backAccessibilityLabel: "Back to roster",
                onBack: {
                    if scannedItems.isEmpty {
                        store.screen = .operatorHub(user)
                    } else {
                        showBackConfirm = true
                    }
                },
                onCamera: nil
            )

            Group {
                if focusedCheckoutField == nil {
                    ViewThatFits(in: .vertical) {
                        checkoutSetupPanel

                        ScrollView {
                            checkoutSetupPanel
                        }
                        .scrollBounceBehavior(.basedOnSize)
                    }
                } else {
                    ScrollView {
                        checkoutSetupPanel
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    .scrollDismissesKeyboard(.interactively)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)

            VStack(spacing: KioskSpacing.xs) {
                if let blockingRequirement {
                    Label(blockingRequirement, systemImage: "exclamationmark.circle.fill")
                        .font(KioskType.chip)
                        .foregroundStyle(KioskStatus.attention)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityHidden(true)
                }

                KioskCompletionButton(
                    title: "Continue to Scan",
                    isEnabled: hasCheckoutContext && hasValidReturnTime,
                    isBusy: false,
                    accessibilityLabel: startScanningAccessibilityLabel,
                    action: startScanning
                )
            }
            .frame(maxWidth: KioskCheckoutSetupLayout.maxWidth)
            .frame(maxWidth: .infinity)
            .padding(.top, KioskSpacing.md)
        }
        .kioskScreenPadding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var checkoutSetupPanel: some View {
        KioskCheckoutSetupPanel(
            user: user,
            locationName: store.info?.locationName,
            events: eventOptions,
            isLoadingEvents: isLoadingEvents,
            eventLoadError: eventLoadError,
            isLinkedToEvent: $isLinkedToEvent,
            selectedEventId: $selectedEventId,
            customPurpose: $customPurpose,
            dueBackAt: $dueBackAt,
            selectedEvent: selectedEvent,
            focusedField: $focusedCheckoutField,
            onScannerBurstRejected: {
                store.scanner.rejectEditingBurst()
                showFeedback(.warning("Finish editing before scanning"))
            }
        )
        .frame(maxWidth: KioskCheckoutSetupLayout.maxWidth)
        .frame(maxWidth: .infinity)
        .padding(.vertical, KioskSpacing.lg)
    }

    private var activeScanZone: some View {
        KioskScanZoneColumn {
            KioskFlowHeader(
                title: "Scan Items",
                backAccessibilityLabel: scannedItems.isEmpty
                    ? "Back to roster"
                    : "Back to roster, will prompt to discard \(scannedItems.count) items",
                onBack: {
                    if scannedItems.isEmpty {
                        store.screen = .operatorHub(user)
                    } else {
                        showBackConfirm = true
                    }
                },
                onCamera: { showCamera = true }
            )

            KioskCheckoutContextSummary(
                title: hasCheckoutContext ? checkoutContextTitle : "Details needed",
                detail: hasCheckoutContext ? checkoutContextDetail : "Keep scanning, then review before checkout.",
                dueBackAt: dueBackAt,
                onEdit: { requestEditContext() }
            )

            KioskCheckoutAvailabilityBanner(
                result: availabilityResult,
                isChecking: isCheckingAvailability,
                errorMessage: availabilityError
            )

            Spacer()

            KioskScanStage(
                isHardwareConnected: store.scanner.hardwareConnected,
                isReady: scannerHasFocus,
                lastScanAt: lastScanAt,
                feedbackTint: lastResult.map { _ in scannerBorderColor },
                accepted: lastAccepted,
                onCamera: { showCamera = true },
                onHelp: { showScannerHelp = true }
            )

            // Feedback banner
            if let result = lastResult {
                KioskFeedbackBanner(tone: result.tone, message: result.message)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(reduceMotion ? nil : .spring(response: 0.3), value: lastResult)
            }

            Spacer()

            KioskCompletionButton(
                title: completeButtonTitle,
                isEnabled: !scannedItems.isEmpty && pendingScanIdentities.isEmpty && (!hasCheckoutContext || !hasValidReturnTime || (hasVerifiedAvailability && !isCheckingAvailability && availabilityError == nil && !availabilityResult.hasBlockingIssue)),
                isBusy: isCompleting,
                accessibilityLabel: completeAccessibilityLabel,
                action: {
                    if hasCheckoutContext && hasValidReturnTime { completeCheckout() }
                    else { requestEditContext() }
                }
            )
        }
    }

    private var completeAccessibilityLabel: String {
        if isCompleting { return "Processing checkout" }
        if !pendingScanIdentities.isEmpty {
            return "Complete Checkout unavailable, waiting for \(pendingScanIdentities.count) scan\(pendingScanIdentities.count == 1 ? "" : "s")"
        }
        let count = scannedItems.count
        if !hasCheckoutContext {
            return "Complete Checkout unavailable, choose an event or enter what this checkout is for"
        }
        if availabilityResult.hasBlockingIssue {
            return "Complete Checkout unavailable, resolve item conflicts first"
        }
        if isCheckingAvailability {
            return "Complete Checkout unavailable, checking item availability"
        }
        if availabilityError != nil || !hasVerifiedAvailability {
            return "Complete Checkout unavailable, retry the availability check"
        }
        return "Checkout \(count) item\(count == 1 ? "" : "s")"
    }

    private var completeButtonTitle: String {
        let count = scannedItems.count
        guard count > 0 else { return "Complete Checkout" }
        return "Checkout \(count) Item\(count == 1 ? "" : "s")"
    }

    // MARK: - Items List

    private func itemsList(isCompact: Bool) -> some View {
        KioskSideRail(isCompact: isCompact) {
            KioskCheckoutSideSummary(
                user: user,
                locationName: store.info?.locationName,
                contextTitle: hasCheckoutContext ? checkoutContextTitle : nil,
                contextDetail: checkoutContextDetail
            )

            Divider().background(KioskStroke.divider)

            HStack {
                Text("Scanned Items")
                    .font(.headline)
                    .foregroundStyle(KioskText.primary)
                Spacer()
                Text("\(scannedItems.count)")
                    .font(.title3.bold())
                    // A count is not an action and not a problem. Brand red
                    // here made a running tally look like a warning.
                    .foregroundStyle(scannedItems.isEmpty ? .secondary : KioskText.primary)
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: scannedItems.count)
                    .monospacedDigit()
            }
            .padding(20)

            Divider().background(KioskStroke.divider)

            if scannedItems.isEmpty {
                Spacer()
                VStack(spacing: 10) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.title3)
                        .foregroundStyle(KioskText.muted)
                        .accessibilityHidden(true)
                    Text("No items scanned yet")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(KioskText.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(groupedScannedItems.enumerated()), id: \.element.id) { index, group in
                                KioskCartGroupRow(
                                    group: group,
                                    availabilityIssue: availabilityIssue(for: group),
                                    onRemove: { removeGroup(group) }
                                )
                                .id(group.id)
                                .background(group.contains(scannedItems.last) ? KioskSurface.sunken : Color.clear)
                                Divider().background(KioskStroke.hairline)
                            }
                        }
                    }
                    .onChange(of: scannedItems.last?.id) { _, newId in
                        guard let newId else { return }
                        if reduceMotion {
                            proxy.scrollTo(newId, anchor: .bottom)
                        } else {
                            withAnimation(.easeOut(duration: 0.25)) {
                                proxy.scrollTo(newId, anchor: .bottom)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Logic

    private var scannerBorderColor: Color {
        switch lastResult {
        case .success: return Color.statusText(.green)
        case .error: return Color.statusText(.red)
        case .duplicate, .warning: return Color.statusText(.orange)
        // Readiness is already explicit in the badge below the target. Keep
        // the target neutral during the brief first-responder handoff so the
        // scan screen does not enter with a false orange warning flash.
        case nil: return Color.white.opacity(0.3)
        }
    }

    private var trimmedCustomPurpose: String {
        customPurpose.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasCheckoutContext: Bool {
        isLinkedToEvent ? selectedEvent != nil : !trimmedCustomPurpose.isEmpty
    }

    private var hasValidReturnTime: Bool {
        dueBackAt > Date().addingTimeInterval(60)
    }

    /// What is stopping this step from continuing, in the words the screen
    /// uses. `nil` means nothing is.
    ///
    /// Both the visible hint and the VoiceOver label read from this, so they
    /// cannot drift apart — and the button no longer just greys out and leaves
    /// the reason to be guessed. The spoken label also said "Start Scanning"
    /// while the button read "Continue to Scan".
    private var blockingRequirement: String? {
        if isLinkedToEvent, selectedEvent == nil {
            return "Choose an event to link, or unlink to name this checkout yourself."
        }
        if !isLinkedToEvent, trimmedCustomPurpose.isEmpty {
            return "Enter a booking name, or link an event."
        }
        if !hasValidReturnTime {
            return "Choose a return date and time later than now."
        }
        return nil
    }

    private var startScanningAccessibilityLabel: String {
        guard let blockingRequirement else { return "Continue to scan items" }
        return "Continue to Scan unavailable. \(blockingRequirement)"
    }

    private var selectedEvent: KioskCheckoutEvent? {
        guard let selectedEventId else { return nil }
        return eventOptions.first { $0.id == selectedEventId }
    }

    private var checkoutContextTitle: String {
        isLinkedToEvent ? (selectedEvent?.title ?? "") : trimmedCustomPurpose
    }

    private var checkoutContextDetail: String? {
        if isLinkedToEvent, let selectedEvent {
            return KioskCheckoutEventFormat.subtitle(selectedEvent)
        }
        return nil
    }

    private var successMessage: String {
        let count = scannedItems.count
        let itemWord = count == 1 ? "item" : "items"
        let location = store.info?.locationName ?? "this kiosk"
        return "Checked out \(count) \(itemWord) for \(checkoutContextTitle) from \(location)."
    }

    @MainActor
    private func loadCheckoutEvents() async {
        guard eventOptions.isEmpty, !isLoadingEvents else { return }
        isLoadingEvents = true
        eventLoadError = nil
        do {
            eventOptions = try await KioskAPI.shared.kioskCheckoutEvents(requesterId: user.id)
        } catch {
            eventLoadError = (error as? APIError)?.errorDescription ?? "Events unavailable"
        }
        isLoadingEvents = false
    }

    private func handleScan(_ value: String) {
        // Ignore scans during the complete-API window — a late scan would
        // land in the cart but miss the assetIds payload, then get wiped on
        // success. Phantom checkouts are worse than a "hold on" feedback.
        guard !isCompleting else {
            showFeedback(.error("Hold on — finishing checkout"))
            return
        }

        store.resetInactivity()
        lastScanAt = Date()

        let normalizedScan = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalizedScan.isEmpty else {
            showFeedback(.error("Could not read barcode"))
            return
        }

        let cart = store.cart(for: userId)

        // Treat a scan as owned from intake through response so a rapid repeat
        // cannot start a second request before the first item reaches the cart.
        if pendingScanIdentities.contains(normalizedScan)
            || cart.contains(where: { $0.tagName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedScan }) {
            showFeedback(.duplicate("Already scanned"))
            return
        }
        pendingScanIdentities.insert(normalizedScan)

        Task {
            defer { pendingScanIdentities.remove(normalizedScan) }
            do {
                let result = try await KioskAPI.shared.kioskCheckoutScan(actorId: userId, scanValue: value)
                earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
                if result.success, let item = result.item {
                    // Merge into current MainActor state, not the cart snapshot
                    // captured before this request. Parallel scans may complete
                    // in either order and must never overwrite one another.
                    var updated = store.cart(for: userId)
                    if !updated.contains(where: { $0.id == item.id }) {
                        let cartItem = KioskCartItem(
                            id: item.id,
                            name: item.name,
                            tagName: item.tagName,
                            type: item.type,
                            imageUrl: item.imageUrl,
                            bulkSkuId: item.bulkSkuId,
                            unitNumber: item.unitNumber
                        )
                        updated.append(cartItem)
                        store.setCart(updated, for: userId)
                        let preflight = await refreshAvailability(for: updated)
                        lastAccepted = KioskAcceptedScan(
                            title: cartItem.itemListPrimaryTitle,
                            subtitle: cartItem.itemListSecondaryTitle,
                            progress: "\(updated.count) item\(updated.count == 1 ? "" : "s") scanned"
                        )
                        if let scanIssue = preflight.flatMap({ scanAvailabilityFeedback(for: cartItem, result: $0) }) {
                            showFeedback(scanIssue)
                        } else if result.locationMismatch == true {
                            showFeedback(.warning(result.locationMessage ?? "\(item.name) added, location checked"))
                        } else if preflight == nil {
                            showFeedback(.warning("\(cartItem.itemListPrimaryTitle) added, but availability could not be verified. Check before checkout."))
                        } else {
                            showFeedback(.success(result.locationMessage ?? item.name))
                        }
                    } else {
                        showFeedback(.duplicate("Already scanned"))
                    }
                } else {
                    showFeedback(.error(result.error ?? "Could not add item"))
                }
            } catch {
                let message = (error as? APIError)?.errorDescription ?? "Scan failed"
                showFeedback(.error(message))
            }
        }
    }

    private func removeItem(_ item: KioskCartItem) {
        var cart = store.cart(for: userId)
        cart.removeAll { $0.id == item.id }
        store.setCart(cart, for: userId)
        Task { await refreshAvailability(for: cart) }
        Haptics.warning()
        store.resetInactivity()
        UIAccessibility.post(notification: .announcement, argument: "Removed \(item.itemListPrimaryTitle)")
    }

    private func removeGroup(_ group: KioskCartDisplayGroup) {
        var cart = store.cart(for: userId)
        let groupIds = Set(group.items.map(\.id))
        cart.removeAll { groupIds.contains($0.id) }
        store.setCart(cart, for: userId)
        Task { await refreshAvailability(for: cart) }
        Haptics.warning()
        store.resetInactivity()
        UIAccessibility.post(notification: .announcement, argument: "Removed \(group.primaryTitle)")
    }

    private func showFeedback(_ feedback: ScanFeedback) {
        withAnimation { lastResult = feedback }
        // Tactile + spoken signal so the staffer doesn't need to read the
        // banner — ankle-deep in a noisy floor environment.
        switch feedback {
        case .success: Haptics.success()
        case .duplicate, .warning: Haptics.warning()
        case .error: Haptics.error()
        }
        UIAccessibility.post(notification: .announcement, argument: feedback.message)
        // Cancel any prior dismiss timer — otherwise two scans within 3s race:
        // the first scan's timer fires after the second message is already
        // showing and wipes it early.
        feedbackDismissTask?.cancel()
        feedbackDismissTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            lastAccepted = nil
            withAnimation { lastResult = nil }
        }
    }

    private func startScanning() {
        guard hasCheckoutContext, hasValidReturnTime else { return }
        focusedCheckoutField = nil
        scannerCaptureEnabled = false
        HIDScannerFocusGate.allowScannerFocusNow()
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        checkoutContextReady = true
        store.resetInactivity()
        Haptics.success()
        DispatchQueue.main.async {
            HIDScannerFocusGate.allowScannerFocusNow()
            scannerCaptureEnabled = true
        }
    }

    private func requestEditContext() {
        scannerCaptureEnabled = false
        if scannedItems.isEmpty {
            checkoutContextReady = false
            DispatchQueue.main.async {
                focusedCheckoutField = .customPurpose
            }
        } else {
            showEditContextConfirm = true
        }
    }

    /// The scan flow already confirms each item as it's added, so checkout
    /// completes directly here — no redundant review modal. A final
    /// availability check still guards against conflicts that appeared while
    /// the cart was open.
    private func completeCheckout() {
        let cart = store.cart(for: userId)
        guard !cart.isEmpty, hasCheckoutContext, hasValidReturnTime, let locationId = store.info?.locationId else { return }
        guard !isCompleting, pendingScanIdentities.isEmpty else { return }
        let message = successMessage
        let endsAt = dueBackAt
        let eventId = isLinkedToEvent ? selectedEvent?.id : nil
        let purpose = !isLinkedToEvent && !trimmedCustomPurpose.isEmpty ? trimmedCustomPurpose : nil
        isCompleting = true
        Task {
            guard let preflight = await refreshAvailability(for: cart, endsAt: endsAt) else {
                isCompleting = false
                showFeedback(.error(availabilityError ?? "Verify item availability before checkout"))
                return
            }
            guard !preflight.hasBlockingIssue else {
                isCompleting = false
                showFeedback(.error("Resolve item conflicts before checkout"))
                return
            }
            do {
                let completionBadges = try await KioskAPI.shared.kioskCheckoutComplete(
                    actorId: userId,
                    locationId: locationId,
                    items: cart,
                    eventId: eventId,
                    customPurpose: purpose,
                    endsAt: endsAt
                )
                earnedBadges.appendUnique(contentsOf: completionBadges)
                Haptics.success()
                store.clearCart(for: userId)
                store.clearCheckoutDraft(for: userId)
                store.clearIntent(reason: .success)
                scannerCaptureEnabled = false
                store.screen = .success(KioskSuccessInfo(
                    kind: .checkout,
                    message: message,
                    earnedBadges: earnedBadges
                ))
            } catch {
                let message = (error as? APIError)?.errorDescription
                    ?? "Checkout failed. Please try again."
                showFeedback(.error(message))
            }
            isCompleting = false
        }
    }

    private func applySelectedEventDueTime() {
        guard isLinkedToEvent else { return }
        guard let selectedEvent, let eventEnd = selectedEvent.endsAt else { return }
        if let dueBack = KioskCheckoutDefaults.dueBackDate(afterEventEndsAt: eventEnd) {
            dueBackAt = dueBack
        }
    }

    private func restoreDraftIfNeeded() {
        guard let draft = store.checkoutDraft(for: userId) else { return }
        isLinkedToEvent = draft.isLinkedToEvent
        selectedEventId = draft.selectedEventId
        customPurpose = draft.customPurpose
        let minimum = KioskQuarterHour.roundedUp(Date().addingTimeInterval(5 * 60))
        dueBackAt = draft.dueBackAt >= minimum ? draft.dueBackAt : minimum
        // Resume where the draft actually left off. Forcing `true` here sent a
        // half-filled draft straight to the scan step.
        checkoutContextReady = draft.contextReady
        guard checkoutContextReady else { return }
        armScannerCaptureAfterRestore()
    }

    private func applyRetainedIntent() {
        guard var intent = store.pendingIntent, intent.identifiedUser?.id == user.id else { return }
        if let event = intent.selectedEvent {
            isLinkedToEvent = true
            selectedEventId = event.id
            if let end = event.endsAt,
               let dueBack = KioskCheckoutDefaults.dueBackDate(afterEventEndsAt: end) {
                dueBackAt = dueBack
            }
        }
        let consumed = KioskFlowIntentReducer.consumePendingScans(in: intent)
        intent = consumed.intent
        store.setIntent(intent)
        // A scan-initiated checkout means gear is already in hand at the home
        // screen. Dropping that person on the details step would strand the
        // scan they just made, so they resume in scanning and fill details from
        // the scan screen's Edit action instead.
        if !consumed.scans.isEmpty {
            checkoutContextReady = true
            armScannerCaptureAfterRestore()
        }
        for scan in consumed.scans { handleScan(scan) }
    }

    private func persistDraft() {
        store.setCheckoutDraft(
            KioskCheckoutDraft(
                isLinkedToEvent: isLinkedToEvent,
                selectedEventId: selectedEventId,
                customPurpose: customPurpose,
                dueBackAt: dueBackAt,
                contextReady: checkoutContextReady
            ),
            for: userId
        )
    }

    private func armScannerCaptureAfterRestore() {
        DispatchQueue.main.async {
            HIDScannerFocusGate.allowScannerFocusNow()
            scannerCaptureEnabled = true
        }
    }

    @MainActor
    @discardableResult
    private func refreshAvailability(
        for cart: [KioskCartItem],
        endsAt requestedEndsAt: Date? = nil
    ) async -> KioskCheckoutAvailabilityResult? {
        let requestToken = availabilityRequests.begin()
        guard let locationId = store.info?.locationId, !cart.isEmpty else {
            availabilityResult = KioskCheckoutAvailabilityResult()
            availabilityError = nil
            hasVerifiedAvailability = false
            isCheckingAvailability = false
            return nil
        }
        let endsAt = requestedEndsAt ?? dueBackAt
        guard endsAt > Date().addingTimeInterval(60) else {
            availabilityResult = KioskCheckoutAvailabilityResult()
            availabilityError = "Choose a return time later than pickup"
            hasVerifiedAvailability = false
            isCheckingAvailability = false
            return nil
        }

        isCheckingAvailability = true
        hasVerifiedAvailability = false
        availabilityError = nil
        defer {
            if availabilityRequests.owns(requestToken) { isCheckingAvailability = false }
        }
        do {
            let result = try await KioskAPI.shared.kioskCheckoutAvailability(
                locationId: locationId,
                items: cart,
                startsAt: Date(),
                endsAt: endsAt
            )
            guard availabilityRequests.owns(requestToken) else { return nil }
            availabilityResult = result
            hasVerifiedAvailability = true
            return result
        } catch {
            guard availabilityRequests.owns(requestToken) else { return nil }
            availabilityError = (error as? APIError)?.errorDescription ?? "Conflict check unavailable"
            hasVerifiedAvailability = false
            return nil
        }
    }

    private func availabilityIssue(for group: KioskCartDisplayGroup) -> KioskCartAvailabilityIssue? {
        let ids = Set(group.items.map(\.id))
        let bulkSkuIds = Set(group.items.compactMap(\.bulkSkuId))

        if availabilityResult.unavailableAssets.contains(where: { ids.contains($0.assetId) }) {
            return KioskCartAvailabilityIssue(tone: .error, message: "Unavailable")
        }
        if availabilityResult.conflicts.contains(where: { ids.contains($0.assetId) }) {
            return KioskCartAvailabilityIssue(tone: .error, message: "Conflict")
        }
        if availabilityResult.shortages.contains(where: { bulkSkuIds.contains($0.bulkSkuId) }) {
            return KioskCartAvailabilityIssue(tone: .error, message: "Short")
        }
        let serializedRisks = availabilityResult.turnaroundRisks.filter { ids.contains($0.assetId) }
        let bulkRisks = availabilityResult.bulkTurnaroundRisks.filter { bulkSkuIds.contains($0.bulkSkuId) }
        if serializedRisks.contains(where: { $0.code == "RECENT_CHECKIN_REPORT" && $0.reportType == "LOST" }) {
            return KioskCartAvailabilityIssue(tone: .warning, message: "Lost report")
        }
        if serializedRisks.contains(where: { $0.code == "RECENT_CHECKIN_REPORT" }) {
            return KioskCartAvailabilityIssue(tone: .warning, message: "Condition")
        }
        if serializedRisks.contains(where: { $0.code == "LOCATION_TRANSFER" }) {
            return KioskCartAvailabilityIssue(tone: .warning, message: "Transfer")
        }
        if !serializedRisks.isEmpty || !bulkRisks.isEmpty {
            let hasCritical = serializedRisks.contains { $0.severity.caseInsensitiveCompare("critical") == .orderedSame }
                || bulkRisks.contains { $0.severity.caseInsensitiveCompare("critical") == .orderedSame }
            return KioskCartAvailabilityIssue(tone: .warning, message: hasCritical ? "Very tight timing" : "Tight timing")
        }
        return nil
    }

    private func scanAvailabilityFeedback(
        for item: KioskCartItem,
        result: KioskCheckoutAvailabilityResult
    ) -> ScanFeedback? {
        let title = item.itemListPrimaryTitle

        if let unavailable = result.unavailableAssets.first(where: { $0.assetId == item.id }) {
            let status = unavailable.status.replacingOccurrences(of: "_", with: " ").lowercased()
            return .error("\(title) is \(status). Remove it before checkout.")
        }

        if let conflict = result.conflicts.first(where: { $0.assetId == item.id }) {
            let booking = conflict.conflictingBookingTitle ?? "another booking"
            let startsAt = conflict.startsAt.formatted(date: .abbreviated, time: .shortened)
            let endsAt = conflict.endsAt.formatted(date: .abbreviated, time: .shortened)
            return .error("\(title) conflicts with \(booking) (\(startsAt)–\(endsAt)). Remove it or change the return time before checkout.")
        }

        if let bulkSkuId = item.bulkSkuId,
           let shortage = result.shortages.first(where: { $0.bulkSkuId == bulkSkuId }) {
            return .error("\(title) needs \(shortage.requested), but only \(shortage.available) are available. Remove it before checkout.")
        }

        if let risk = result.turnaroundRisks.first(where: { $0.assetId == item.id }) {
            switch risk.code {
            case "RECENT_CHECKIN_REPORT" where risk.reportType == "LOST":
                return .warning("\(title): Recent lost report — verify item status before checkout.")
            case "RECENT_CHECKIN_REPORT":
                return .warning("\(title): Recent damage report — inspect it before checkout.")
            case "LOCATION_TRANSFER":
                return .warning("\(title): \(KioskAvailabilityCopy.riskMessage(risk))")
            default:
                return .warning("\(title): \(KioskAvailabilityCopy.riskMessage(risk)). Confirm the return time.")
            }
        }

        if let bulkSkuId = item.bulkSkuId,
           let risk = result.bulkTurnaroundRisks.first(where: { $0.bulkSkuId == bulkSkuId }) {
            return .warning("\(title): \(KioskAvailabilityCopy.bulkRiskMessage(risk)). Confirm the return time.")
        }

        return nil
    }
}

private enum KioskAvailabilityCopy {
    private static let serializedTurnaroundBuffer: TimeInterval = 60 * 60

    static func riskMessage(_ risk: KioskCheckoutAvailabilityResult.TurnaroundRisk) -> String {
        switch risk.code {
        case "SHORT_TURNAROUND":
            guard let startsAt = risk.startsAt else { return risk.message }
            let returnBy = startsAt.addingTimeInterval(-serializedTurnaroundBuffer)
            let gap = risk.gapMinutes.map { " (\(durationLabel($0)) gap)" } ?? ""
            return "Needed next at \(startsAt.formatted(date: .abbreviated, time: .shortened)) · return by \(returnBy.formatted(date: .abbreviated, time: .shortened))\(gap)"
        case "LOCATION_TRANSFER":
            guard let startsAt = risk.startsAt else { return risk.message }
            return "\(risk.message) (next use \(startsAt.formatted(date: .abbreviated, time: .shortened)))"
        case "RECENT_CHECKIN_REPORT" where risk.reportType == "LOST":
            return "Recent lost report — verify item status before checkout"
        case "RECENT_CHECKIN_REPORT":
            return "Recent damage report — inspect it before checkout"
        default:
            return risk.message
        }
    }

    static func bulkRiskMessage(_ risk: KioskCheckoutAvailabilityResult.BulkTurnaroundRisk) -> String {
        let quantity = risk.plannedQuantity.map(String.init) ?? "the requested quantity"
        let returnBy = risk.startsAt.addingTimeInterval(-serializedTurnaroundBuffer)
        let gap = risk.gapMinutes.map { " (\(durationLabel($0)) gap)" } ?? ""
        return "Next booking needs \(quantity) at \(risk.startsAt.formatted(date: .abbreviated, time: .shortened)) · return by \(returnBy.formatted(date: .abbreviated, time: .shortened))\(gap)"
    }

    private static func durationLabel(_ minutes: Int) -> String {
        guard minutes > 0 else { return "now" }
        let hours = minutes / 60
        let remainingMinutes = minutes % 60
        if hours == 0 { return "\(remainingMinutes)m" }
        if remainingMinutes == 0 { return "\(hours)h" }
        return "\(hours)h \(remainingMinutes)m"
    }
}

// MARK: - Sub-views

private struct KioskCartDisplayGroup: Identifiable, Equatable {
    let id: String
    var items: [KioskCartItem]

    var first: KioskCartItem { items[0] }
    var isBulkGroup: Bool { first.isNumberedBulk }
    var count: Int { items.count }
    var primaryTitle: String {
        guard isBulkGroup else { return first.itemListPrimaryTitle }
        let tags = unitNumbers.map { "#\($0)" }.joined(separator: " ")
        return tags.nonBlankText ?? first.itemListPrimaryTitle
    }
    var subtitle: String {
        if isBulkGroup {
            let name = first.name.replacingOccurrences(of: #" #\d+$"#, with: "", options: .regularExpression)
            return "\(name) · \(count) unit\(count == 1 ? "" : "s")"
        }
        return [first.itemListSecondaryTitle, first.type].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }.joined(separator: " · ")
    }
    var unitNumbers: [Int] {
        items.compactMap(\.unitNumber).sorted()
    }

    func contains(_ item: KioskCartItem?) -> Bool {
        guard let item else { return false }
        return items.contains { $0.id == item.id }
    }

    static func groups(from items: [KioskCartItem]) -> [KioskCartDisplayGroup] {
        var groups: [KioskCartDisplayGroup] = []
        var bulkIndex: [String: Int] = [:]

        for item in items {
            if let bulkSkuId = item.bulkSkuId {
                if let index = bulkIndex[bulkSkuId] {
                    groups[index].items.append(item)
                } else {
                    bulkIndex[bulkSkuId] = groups.count
                    groups.append(KioskCartDisplayGroup(id: "bulk-\(bulkSkuId)", items: [item]))
                }
            } else {
                groups.append(KioskCartDisplayGroup(id: item.id, items: [item]))
            }
        }

        return groups
    }
}

private struct KioskCartAvailabilityIssue: Equatable {
    enum Tone {
        case warning
        case error
    }

    let tone: Tone
    let message: String

    var color: Color {
        switch tone {
        case .warning: Color.statusText(.orange)
        case .error: Color.statusText(.red)
        }
    }
}

private struct KioskCheckoutSetupPanel: View {
    let user: KioskUser
    let locationName: String?
    let events: [KioskCheckoutEvent]
    let isLoadingEvents: Bool
    let eventLoadError: String?
    @Binding var isLinkedToEvent: Bool
    @Binding var selectedEventId: String?
    @Binding var customPurpose: String
    @Binding var dueBackAt: Date
    let selectedEvent: KioskCheckoutEvent?
    let focusedField: Binding<KioskCheckoutFocusedField?>
    let onScannerBurstRejected: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: KioskSpacing.lg) {
            KioskCheckoutSetupHero(user: user, locationName: locationName)

            // Details left, event linking right. Everything the checkout record
            // needs -- name and due-back -- stays on one side and is never
            // pushed below the fold by a long event list.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: KioskSpacing.lg) {
                    detailsColumn.frame(maxWidth: .infinity, alignment: .top)
                    eventColumn.frame(maxWidth: .infinity, alignment: .top)
                }

                VStack(alignment: .leading, spacing: KioskSpacing.lg) {
                    detailsColumn
                    eventColumn
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var detailsColumn: some View {
        VStack(alignment: .leading, spacing: KioskSpacing.lg) {
            contextWindow
            returnWindow
        }
    }

    private var eventColumn: some View {
        KioskCheckoutEventPicker(
            events: events,
            isLoading: isLoadingEvents,
            errorMessage: eventLoadError,
            selectedEventId: $selectedEventId,
            isLinkedToEvent: $isLinkedToEvent
        )
    }

    private var contextWindow: some View {
        KioskCheckoutContextWindow(
            events: events,
            isLoading: isLoadingEvents,
            errorMessage: eventLoadError,
            isLinkedToEvent: $isLinkedToEvent,
            selectedEventId: $selectedEventId,
            selectedEvent: selectedEvent,
            customPurpose: $customPurpose,
            focusedField: focusedField,
            onScannerBurstRejected: onScannerBurstRejected
        )
    }

    private var returnWindow: some View {
        KioskCheckoutReturnWindow(dueBackAt: $dueBackAt, eventEnd: selectedEvent?.endsAt)
    }
}

/// Right column of checkout setup: the requester's own published shifts first,
/// then everything else on the calendar. Tapping a row links the booking to
/// that event; tapping the linked row again unlinks it.
///
/// This replaces a "Link to event" toggle that hid the entire event list behind
/// a switch, plus an overflow menu that buried the rest of the calendar in
/// a popover. Linking is the common case for crewed work, so the events are
/// simply on screen.
private struct KioskCheckoutEventPicker: View {
    let events: [KioskCheckoutEvent]
    let isLoading: Bool
    let errorMessage: String?
    @Binding var selectedEventId: String?
    @Binding var isLinkedToEvent: Bool

    private var myShifts: [KioskCheckoutEvent] { events.filter(\.isMyShift) }
    private var otherEvents: [KioskCheckoutEvent] { events.filter { !$0.isMyShift } }

    var body: some View {
        KioskCheckoutWindow(title: "Link an event") {
            if isLoading {
                KioskCheckoutEventLoadingRow()
            } else if events.isEmpty {
                KioskCheckoutEmptyEventRow()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: KioskSpacing.md) {
                        if !myShifts.isEmpty {
                            group("Your shifts", events: myShifts)
                        }
                        if !otherEvents.isEmpty {
                            group("All events", events: otherEvents)
                        }
                    }
                }
                .frame(maxHeight: 320)
                .scrollIndicators(.visible)
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(KioskType.chip)
                    .foregroundStyle(KioskStatus.attention)
            }
        }
    }

    private func group(_ title: String, events: [KioskCheckoutEvent]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(KioskType.overline)
                .tracking(1.2)
                .foregroundStyle(KioskText.muted)

            VStack(spacing: 0) {
                ForEach(events) { event in
                    KioskCheckoutEventRow(
                        event: event,
                        isSelected: selectedEventId == event.id,
                        subtitle: KioskCheckoutEventFormat.subtitle(event)
                    ) {
                        toggle(event)
                    }

                    if event.id != events.last?.id {
                        Divider().background(KioskStroke.divider)
                    }
                }
            }
            .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.md)
                    .stroke(KioskStroke.hairline, lineWidth: 1)
            )
        }
    }

    /// Tapping the already-linked event unlinks it, so a mis-tap does not
    /// strand the booking against the wrong event with no way back.
    private func toggle(_ event: KioskCheckoutEvent) {
        if selectedEventId == event.id {
            selectedEventId = nil
            isLinkedToEvent = false
        } else {
            selectedEventId = event.id
            isLinkedToEvent = true
        }
        Haptics.selection()
    }
}

private struct KioskCheckoutSetupHero: View {
    let user: KioskUser
    let locationName: String?

    var body: some View {
        HStack(spacing: 18) {
            KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 54)

            VStack(alignment: .leading, spacing: 4) {
                Text("STEP 1 OF 2 · CHECKOUT DETAILS")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(KioskText.muted)
                Text(user.name)
                    .font(.kioskScreenTitle(size: 28))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(locationName ?? "Kiosk location")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .kioskCard(KioskSurface.card, radius: KioskRadius.lg, stroke: KioskStroke.standard)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(user.name), \(locationName ?? "kiosk location")")
    }
}

private struct KioskCheckoutWindow<Content: View, Trailing: View>: View {
    let title: String
    let badgeTitle: String?
    let badgeColor: Color
    private let trailing: Trailing
    private let content: Content

    init(
        title: String,
        badgeTitle: String? = nil,
        badgeColor: Color = KioskText.muted,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.badgeTitle = badgeTitle
        self.badgeColor = badgeColor
        self.trailing = trailing()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 10) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(KioskText.primary)

                if let badgeTitle {
                    KioskCheckoutModeBadge(title: badgeTitle, color: badgeColor)
                }

                Spacer(minLength: 12)
                trailing
            }

            content
        }
        .padding(20)
        .kioskCard(KioskSurface.card, radius: KioskRadius.lg, stroke: KioskStroke.standard)
        .accessibilityElement(children: .contain)
    }
}

private extension KioskCheckoutWindow where Trailing == EmptyView {
    init(
        title: String,
        badgeTitle: String? = nil,
        badgeColor: Color = KioskText.muted,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title: title,
            badgeTitle: badgeTitle,
            badgeColor: badgeColor,
            trailing: { EmptyView() },
            content: content
        )
    }
}

private struct KioskCheckoutModeBadge: View {
    let title: String
    let color: Color

    var body: some View {
        Text(title)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.16), in: Capsule())
    }
}

private struct KioskCheckoutContextWindow: View {
    let events: [KioskCheckoutEvent]
    let isLoading: Bool
    let errorMessage: String?
    @Binding var isLinkedToEvent: Bool
    @Binding var selectedEventId: String?
    let selectedEvent: KioskCheckoutEvent?
    @Binding var customPurpose: String
    let focusedField: Binding<KioskCheckoutFocusedField?>
    let onScannerBurstRejected: () -> Void

    private var isFieldFocused: Bool { focusedField.wrappedValue == .customPurpose }

    private var trimmedPurpose: String {
        customPurpose.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        KioskCheckoutWindow(title: "What's this for?") {
            VStack(alignment: .leading, spacing: 12) {
                // Linking an event *answers* this question, so the linked event
                // replaces the field rather than sitting under it. While an
                // event is linked the booking title comes from the event and
                // `completeCheckout` sends `customPurpose: nil` — so the field
                // shown here previously accepted typing that was discarded on
                // completion, and `onChange(of: isLinkedToEvent)` wiped it
                // anyway. An input that cannot affect the record it appears to
                // edit is worse than no input.
                if isLinkedToEvent, let selectedEvent {
                    linkedEventAnswer(selectedEvent)
                } else {
                    bookingNameControl
                }
            }
        }
    }

    private func linkedEventAnswer(_ event: KioskCheckoutEvent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Booking name", requirement: .suppliedByEvent)

            HStack(spacing: 12) {
                Image(systemName: "calendar.badge.checkmark")
                    .font(.title3)
                    .foregroundStyle(KioskStatus.scheduled)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.title)
                        .font(.gothamBold(size: 20))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                    Text(KioskCheckoutEventFormat.subtitle(event))
                        .font(KioskType.chip)
                        .foregroundStyle(KioskText.tertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Button("Unlink") {
                    selectedEventId = nil
                    isLinkedToEvent = false
                }
                .font(KioskType.chip)
                .buttonStyle(.glass)
                .controlSize(.regular)
                .accessibilityLabel("Unlink \(event.title) and name this checkout instead")
            }
            .padding(14)
            .frame(minHeight: 72)
            .background(KioskStatus.scheduled.opacity(0.12), in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.md)
                    .stroke(KioskStatus.scheduled.opacity(0.45), lineWidth: 1)
            )
            .accessibilityElement(children: .contain)

            statusLine(
                icon: "checkmark.circle.fill",
                text: "This checkout will be titled after the event.",
                tone: KioskStatus.scheduled
            )
        }
    }

    private var bookingNameControl: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Booking name", requirement: .required)

            KioskNativeTextField(
                placeholder: "Event, practice, shoot, or purpose",
                text: $customPurpose,
                isFocused: Binding(
                    get: { focusedField.wrappedValue == .customPurpose },
                    set: { focusedField.wrappedValue = $0 ? .customPurpose : nil }
                ),
                // The booking name is read back across a counter, not held at
                // reading distance. 15pt was the UIKit default this bridge
                // shipped with; it made the one thing a student types the
                // smallest text in the window.
                fontSize: 20,
                fontWeight: .semibold,
                onScannerBurstRejected: onScannerBurstRejected
            )
            .padding(.horizontal, 16)
            .frame(height: 72)
            .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.md)
                    .stroke(fieldStroke, lineWidth: isFieldFocused || !trimmedPurpose.isEmpty ? 2 : 1)
            )

            // The field used to state its requirement once, as a red asterisk,
            // and then say nothing ever again — so "why is Continue still
            // grey?" had no answer on screen.
            if trimmedPurpose.isEmpty {
                statusLine(
                    icon: "info.circle.fill",
                    text: "Name it so staff can find this checkout later — or link an event.",
                    tone: KioskText.tertiary
                )
            } else {
                statusLine(icon: "checkmark.circle.fill", text: "Looks good.", tone: KioskStatus.ok)
            }
        }
    }

    /// Focused is brand red (you are editing it), filled is the OK tone (this
    /// requirement is met), empty is a plain hairline. The field previously
    /// went red as soon as it had *any* content, spending the brand accent on
    /// a resting state.
    private var fieldStroke: Color {
        if isFieldFocused { return Color.kioskRed }
        if !trimmedPurpose.isEmpty { return KioskStatus.ok.opacity(0.6) }
        return KioskStroke.standard
    }

    private enum FieldRequirement {
        case required
        case suppliedByEvent
    }

    @ViewBuilder
    private func fieldLabel(_ text: String, requirement: FieldRequirement) -> some View {
        HStack(spacing: 6) {
            Text(text.uppercased())
                .font(KioskType.overline)
                .tracking(1.2)
                .foregroundStyle(KioskText.muted)
            switch requirement {
            case .required:
                Text("REQUIRED")
                    .font(KioskType.micro)
                    .foregroundStyle(Color.kioskRedGlyph)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.kioskRedGlyph.opacity(0.16), in: Capsule())
            case .suppliedByEvent:
                Text("FROM EVENT")
                    .font(KioskType.micro)
                    .foregroundStyle(KioskStatus.scheduled)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(KioskStatus.scheduled.opacity(0.16), in: Capsule())
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func statusLine(icon: String, text: String, tone: Color) -> some View {
        Label {
            Text(text)
                .font(KioskType.chip)
                .foregroundStyle(tone)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(tone)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct KioskCheckoutEventRow: View {
    let event: KioskCheckoutEvent
    let isSelected: Bool
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 5)
                        .stroke(isSelected ? Color.kioskRed : KioskStroke.standard, lineWidth: isSelected ? 2 : 1)
                        .frame(width: 20, height: 20)
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Color.kioskRed)
                            .accessibilityHidden(true)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(event.title)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                    Text(subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KioskText.muted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(isSelected ? Color.kioskRed.opacity(0.12) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(event.title), \(subtitle)\(isSelected ? ", selected" : "")")
    }
}

private struct KioskCheckoutEventLoadingRow: View {
    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
                .tint(Color.kioskRed)
            Text("Loading upcoming events")
                .font(.caption.weight(.semibold))
                .foregroundStyle(KioskText.secondary)
            Spacer()
        }
        .padding(.horizontal, 14)
        .frame(height: 56)
        .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
    }
}

private struct KioskCheckoutEmptyEventRow: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "calendar")
                .foregroundStyle(KioskText.muted)
                .accessibilityHidden(true)
            Text("No events in the next 7 days")
                .font(.caption.weight(.semibold))
                .foregroundStyle(KioskText.secondary)
            Spacer()
        }
        .padding(.horizontal, 14)
        .frame(height: 56)
        .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
    }
}

private struct KioskCheckoutReturnWindow: View {
    @Binding var dueBackAt: Date
    var eventEnd: Date?

    var body: some View {
        KioskCheckoutWindow(title: "When's it back?") {
            KioskCheckoutReturnDatePicker(dueBackAt: $dueBackAt, eventEnd: eventEnd)
        }
    }
}

/// Return date and time, stated outright.
///
/// This screen has been through two wrong answers. First a 300pt
/// `UICalendarView` beside a 180pt wheel, both `.clipped()` inside a card too
/// short to hold them -- they visibly overlapped on device. Then one-tap
/// presets ("2 hours", "Tonight"), which were quick but wrong for a custody
/// record: an easy default is the one people press to get past the screen, and
/// a due date nobody chose is a due date nobody honours.
///
/// So both fields are always visible, always native, and always require a
/// deliberate choice. Each opens its own system popover, so neither can
/// overlap the other. Time uses the native compact picker in 15-minute steps:
/// less scrolling and no false minute-level precision in a custody record.
private struct KioskCheckoutReturnDatePicker: View {
    @Binding var dueBackAt: Date
    var eventEnd: Date?

    private var minimumDueBack: Date {
        KioskQuarterHour.roundedUp(Date().addingTimeInterval(5 * 60))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: KioskSpacing.md) {
                field("Return date") {
                    DatePicker(
                        "Return date",
                        selection: clampedDueBack,
                        in: minimumDueBack...,
                        displayedComponents: .date
                    )
                }
                field("Return time") {
                    KioskQuarterHourTimePicker(
                        selection: clampedDueBack,
                        minimumDate: minimumDueBack
                    )
                }
                Spacer(minLength: 0)
            }

            // The committed answer, restated in full so it is legible from
            // across the counter and unambiguous about which day it lands on.
            //
            // It now sits in its own band rather than floating as loose text
            // under two system controls. The two `.compact` pickers are small
            // grey chips by construction; with the answer set in the same
            // visual weight as everything around it, the window stated the due
            // date three times and emphasised it zero times.
            VStack(alignment: .leading, spacing: 4) {
                // No "DUE BACK" overline: the card is titled "When's it back?",
                // so the band repeating the label spent vertical space this
                // step does not have — and this is a step that must fit on one
                // screen, because its CTA is pinned to the bottom of it.
                Text(dueBackAt.kioskDueStamp())
                    .font(.gothamBold(size: 22))
                    .foregroundStyle(KioskText.primary)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                if let eventEnd {
                    if let defaultDueBack = KioskCheckoutDefaults.dueBackDate(afterEventEndsAt: eventEnd),
                       abs(defaultDueBack.timeIntervalSince(dueBackAt)) < 60 {
                        Label(
                            "90 minutes after the linked event ends",
                            systemImage: "calendar.badge.checkmark"
                        )
                        .font(KioskType.chip)
                        .foregroundStyle(KioskStatus.scheduled)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(KioskSurface.sunken, in: RoundedRectangle(cornerRadius: KioskRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.md)
                    .stroke(KioskStroke.hairline, lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Due back \(dueBackAt.formatted(date: .complete, time: .shortened))")
        }
    }

    private func field<Picker: View>(
        _ label: String,
        @ViewBuilder picker: () -> Picker
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(label.uppercased())
                    .font(KioskType.overline)
                    .tracking(1.2)
                    .foregroundStyle(KioskText.muted)
                // A bare red asterisk is a convention from dense web forms and
                // means nothing at counter distance. The word does.
                Text("REQUIRED")
                    .font(KioskType.micro)
                    .foregroundStyle(Color.kioskRedGlyph)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.kioskRedGlyph.opacity(0.16), in: Capsule())
            }
            picker()
                .datePickerStyle(.compact)
                .labelsHidden()
                .tint(Color.kioskRed)
                .controlSize(.large)
        }
    }

    private var clampedDueBack: Binding<Date> {
        Binding(
            get: { max(dueBackAt, minimumDueBack) },
            set: { dueBackAt = KioskQuarterHour.clamped($0, minimum: minimumDueBack) }
        )
    }
}

private enum KioskCheckoutEventFormat {
    static func subtitle(_ event: KioskCheckoutEvent) -> String {
        var parts = [eventDateFormatter.string(from: event.startsAt)]
        if let locationName = event.locationName, !locationName.isEmpty {
            parts.append(locationName)
        } else if let sportCode = event.sportCode, !sportCode.isEmpty {
            parts.append(sportCode)
        }
        return parts.joined(separator: " · ")
    }

    private static let eventDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE h:mm a"
        return formatter
    }()
}

private struct KioskCheckoutSideSummary: View {
    let user: KioskUser
    let locationName: String?
    let contextTitle: String?
    let contextDetail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                KioskAvatar(url: user.avatarUrl, initials: user.initials, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(user.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                    Text(locationName ?? "Kiosk location")
                        .font(.caption)
                        .foregroundStyle(KioskText.muted)
                        .lineLimit(1)
                }
            }

            if let contextTitle, !contextTitle.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "calendar.badge.clock")
                        .foregroundStyle(Color.kioskRed)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(contextTitle)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(KioskText.primary)
                            .lineLimit(2)
                        if let contextDetail, !contextDetail.isEmpty {
                            Text(contextDetail)
                                .font(.caption2)
                                .foregroundStyle(KioskText.muted)
                                .lineLimit(2)
                        }
                    }
                }
            }
        }
        .padding(20)
    }
}

private struct KioskScannerTroubleshootingSheet: View {
    let lastScanAt: Date?
    let locationName: String?
    let onCamera: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Status") {
                    Label(lastScanText, systemImage: "barcode.viewfinder")
                    if let locationName {
                        Label(locationName, systemImage: "mappin.and.ellipse")
                    }
                }
                Section("Try This") {
                    Label("Make sure the scanner sends Return after each scan.", systemImage: "return")
                    Label("Keep the checkout screen open while scanning item labels.", systemImage: "ipad")
                    Label("If a label is damaged, use the camera fallback.", systemImage: "camera")
                }
                Section {
                    Button {
                        dismiss()
                        onCamera()
                    } label: {
                        Label("Use Camera", systemImage: "camera.fill")
                    }
                }
            }
            .navigationTitle("Scanner Health")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var lastScanText: String {
        guard let lastScanAt else { return "No scanner input received in this checkout yet" }
        return "Last scanner input: \(lastScanAt.formatted(date: .omitted, time: .shortened))"
    }
}

private struct KioskCheckoutContextSummary: View {
    let title: String
    let detail: String?
    let dueBackAt: Date
    var showsEdit: Bool = true
    let onEdit: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "calendar.badge.clock")
                .font(.headline)
                .foregroundStyle(Color.kioskRed)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(KioskText.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(KioskText.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
                Text("Due back \(dueBackAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }

            Spacer()

            if showsEdit {
                Button("Edit", action: onEdit)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(KioskText.secondary)
                    .buttonStyle(.plain)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .kioskCard(KioskSurface.card, radius: KioskRadius.lg, stroke: KioskStroke.standard)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), due back \(dueBackAt.formatted(date: .abbreviated, time: .shortened))")
    }
}

private struct KioskCheckoutAvailabilityBanner: View {
    let result: KioskCheckoutAvailabilityResult
    let isChecking: Bool
    let errorMessage: String?

    var body: some View {
        if isChecking || result.hasBlockingIssue || result.hasWarning || errorMessage != nil {
            HStack(spacing: 10) {
                Image(systemName: iconName)
                    .foregroundStyle(color)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(KioskText.primary)
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(KioskText.muted)
                        .lineLimit(2)
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .kioskCard(KioskSurface.card, radius: KioskRadius.md, stroke: KioskStroke.hairline)
        }
    }

    private var color: Color {
        if errorMessage != nil { return Color.statusText(.orange) }
        if result.hasBlockingIssue { return Color.statusText(.red) }
        if result.hasWarning { return Color.statusText(.orange) }
        return Color.statusText(.blue)
    }

    private var iconName: String {
        if isChecking { return "arrow.triangle.2.circlepath" }
        if errorMessage != nil { return "wifi.exclamationmark" }
        if result.hasBlockingIssue { return "exclamationmark.triangle.fill" }
        if result.hasWarning { return "clock.badge.exclamationmark" }
        return "checkmark.shield.fill"
    }

    private var title: String {
        if isChecking { return "Checking availability" }
        if errorMessage != nil { return "Availability unavailable" }
        if result.hasBlockingIssue { return "Conflict found" }
        if hasLostReport { return "Lost report" }
        if hasConditionReport { return "Condition check" }
        if hasTransferRisk { return "Transfer timing" }
        if result.hasWarning && hasCriticalWarning { return "Very tight turnaround" }
        if result.hasWarning { return "Tight turnaround" }
        return "Conflict check clear"
    }

    private var hasLostReport: Bool {
        result.turnaroundRisks.contains { $0.code == "RECENT_CHECKIN_REPORT" && $0.reportType == "LOST" }
    }

    private var hasConditionReport: Bool {
        result.turnaroundRisks.contains { $0.code == "RECENT_CHECKIN_REPORT" }
    }

    private var hasTransferRisk: Bool {
        result.turnaroundRisks.contains { $0.code == "LOCATION_TRANSFER" }
    }

    private var hasCriticalWarning: Bool {
        result.turnaroundRisks.contains { $0.severity.caseInsensitiveCompare("critical") == .orderedSame }
            || result.bulkTurnaroundRisks.contains { $0.severity.caseInsensitiveCompare("critical") == .orderedSame }
    }

    private var detail: String {
        if let errorMessage { return errorMessage }
        if result.hasBlockingIssue {
            let count = result.conflicts.count + result.shortages.count + result.unavailableAssets.count
            return "\(count) issue\(count == 1 ? "" : "s") must be resolved before checkout."
        }
        if let risk = result.turnaroundRisks.first(where: { $0.code == "RECENT_CHECKIN_REPORT" && $0.reportType == "LOST" }) {
            return KioskAvailabilityCopy.riskMessage(risk)
        }
        if let risk = result.turnaroundRisks.first(where: { $0.code == "RECENT_CHECKIN_REPORT" }) {
            return KioskAvailabilityCopy.riskMessage(risk)
        }
        if let risk = result.turnaroundRisks.first(where: { $0.code == "LOCATION_TRANSFER" }) {
            return KioskAvailabilityCopy.riskMessage(risk)
        }
        if let risk = result.turnaroundRisks.first {
            return KioskAvailabilityCopy.riskMessage(risk)
        }
        if let risk = result.bulkTurnaroundRisks.first {
            return KioskAvailabilityCopy.bulkRiskMessage(risk)
        }
        return "Scanning can continue."
    }
}

private struct KioskCartGroupRow: View {
    let group: KioskCartDisplayGroup
    let availabilityIssue: KioskCartAvailabilityIssue?
    let onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 14) {
            KioskCheckoutThumbnail(item: group.first)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(group.primaryTitle)
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(KioskText.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                    if group.count > 1 {
                        Text("x\(group.count)")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.kioskRed)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Color.kioskRed.opacity(0.16), in: Capsule())
                    }
                    if let availabilityIssue {
                        Text(availabilityIssue.message)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(availabilityIssue.color)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(availabilityIssue.color.opacity(0.16), in: Capsule())
                    }
                }

                Text(group.subtitle)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(KioskText.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer()
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(KioskText.muted)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(group.primaryTitle)")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAction(named: "Remove") { onRemove?() }
    }

    private var accessibilityLabel: String {
        if group.isBulkGroup {
            return "\(group.primaryTitle), \(group.subtitle)"
        }
        return "\(group.primaryTitle), \(group.subtitle)"
    }
}

private struct KioskCheckoutThumbnail: View {
    let item: KioskCartItem

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let urlString = item.imageUrl, let url = URL(string: urlString) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                        default:
                            placeholder
                        }
                    }
                } else {
                    placeholder
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: KioskRadius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: KioskRadius.sm)
                    .stroke(KioskStroke.standard, lineWidth: 1)
            )

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.statusText(.green))
                .background(Color.black.opacity(0.78), in: Circle())
                .offset(x: 4, y: 4)
                .accessibilityHidden(true)
        }
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: KioskRadius.sm)
            .fill(KioskSurface.placeholder)
            .overlay {
                Image(systemName: item.isNumberedBulk ? "battery.100percent" : "camera.fill")
                    .font(.title3)
                    .foregroundStyle(KioskText.secondary)
            }
    }
}
