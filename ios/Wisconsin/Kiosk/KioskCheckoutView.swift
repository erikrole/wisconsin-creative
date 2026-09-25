import SwiftUI
import UIKit

enum KioskCheckoutFocusedField: Hashable {
    case customPurpose
}

enum KioskCheckoutDefaults {
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

struct KioskCheckoutView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let user: KioskUser

    @State private var lastResult: ScanFeedback?
    @State private var feedbackDismissTask: Task<Void, Never>?
    @State private var isCompleting = false
    @State private var hasPendingCompletion = false
    @State private var showBackConfirm = false
    @State private var showCamera = false
    @State private var eventOptions: [KioskCheckoutEvent] = []
    @State private var isLoadingEvents = false
    @State private var eventLoadError: String?
    @State private var isLinkedToEvent = false
    @State private var selectedEventId: String?
    @State private var customPurpose = ""
    @State private var kitOptions: [KioskKitOption] = []
    @State private var isLoadingKits = false
    @State private var kitLoadError: String?
    @State private var selectedKitId: String?
    @State private var selectedKitDetail: KioskKitDetail?
    @State private var didApplySuggestedKit = false
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
    @State private var queuedScanValues: [String] = []
    @State private var isProcessingScan = false
    /// The item the last successful scan added, held while its confirmation is
    /// on the stage. Cleared on the same timer as the feedback banner.
    @State private var lastAccepted: KioskAcceptedScan?
    @State private var dueBackAt = KioskCheckoutDefaults.defaultDueBackDate()
    @State private var availabilityResult = KioskCheckoutAvailabilityResult()
    @State private var isCheckingAvailability = false
    @State private var availabilityError: String?
    @State private var hasVerifiedAvailability = false
    @State private var availabilityRequests = LatestRequestGeneration()
    /// Scan preflights run on their own generation. Sharing the cart refresh's
    /// token meant removing an item, or changing the return time, while a scan
    /// was being checked orphaned that preflight and rejected a valid scan as
    /// "could not be verified".
    @State private var preflightRequests = LatestRequestGeneration()
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
    @State private var hasRestoredDraft = false

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
        // Armed only on the scan step. Step 1 has no cart on screen, so a scan
        // there landed items nobody could see, checked against a due time
        // nobody had chosen yet.
        scannerCaptureEnabled && checkoutContextReady && focusedCheckoutField == nil && !showCamera && !showScannerHelp && !showEditContextConfirm
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
            scannedItems.isEmpty
                ? "Discard the unfinished checkout?"
                : "Discard \(scannedItems.count) scanned item\(scannedItems.count == 1 ? "" : "s")?",
            isPresented: $showBackConfirm,
            titleVisibility: .visible
        ) {
            Button("Discard", role: .destructive) {
                store.clearCart(for: userId)
                store.clearCheckoutDraft(for: userId)
                KioskAPI.shared.discardPendingCheckout(actorId: userId)
                hasPendingCompletion = false
                Haptics.warning()
                store.screen = .operatorHub(user)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(hasPendingCompletion
                 ? "A checkout that didn't confirm is saved on this iPad. Discard it only if the gear is back on the shelf — anything that did go through is on your hub."
                 : "Going back will clear your scans.")
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
            Button("Keep Scanning", role: .cancel) { armScannerCaptureAfterRestore() }
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
            hasPendingCompletion = KioskAPI.shared.hasPendingCheckout(actorId: userId)
            restoreDraftIfNeeded()
            applyRetainedIntent()
            store.scanner.claim(.checkout) { handleScan($0) }
            // Events and kits are independent; loading them one after the
            // other doubled the time before step 1 was complete.
            let events = Task { await loadCheckoutEvents() }
            await loadCheckoutKits()
            await events.value
            await loadSelectedKitDetail()
            if !hasRestoredDraft { applySelectedEventDueTime() }
            if !scannedItems.isEmpty { await refreshAvailability(for: scannedItems) }
            hasRestoredDraft = false
            #if DEBUG
            // Capture hook: the scan stage is only reachable after the details
            // step is satisfied, which no fixture can express through the API.
            if KioskFixtureScenario.active == .scanning { checkoutContextReady = true }
            if KioskFixtureScenario.active == .availabilityConflicts {
                isLinkedToEvent = false
                selectedEventId = nil
                customPurpose = "Volleyball vs Minnesota"
                checkoutContextReady = true
                availabilityResult = KioskFixtures.availabilityConflicts
                hasVerifiedAvailability = true
                if let conflict = KioskFixtures.availabilityConflicts.conflicts.first,
                   let item = KioskFixtures.availabilityConflictCart.first(where: { $0.id == conflict.assetId }) {
                    lastResult = .error(KioskAvailabilityCopy.conflictMessage(for: conflict, itemTitle: item.name))
                }
            }
            if KioskFixtureScenario.active == .availabilityRejected {
                isLinkedToEvent = false
                selectedEventId = nil
                customPurpose = "Volleyball vs Minnesota"
                checkoutContextReady = true
                availabilityResult = KioskCheckoutAvailabilityResult()
                availabilityError = nil
                hasVerifiedAvailability = true
                if let conflict = KioskFixtures.availabilityConflicts.conflicts.first,
                   let item = KioskFixtures.availabilityConflictCart.first(where: { $0.id == conflict.assetId }) {
                    lastResult = .error(
                        KioskAvailabilityCopy.rejectedScan(
                            KioskAvailabilityCopy.conflictMessage(for: conflict, itemTitle: item.name)
                        )
                    )
                }
            }
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
            if !hasRestoredDraft { applySelectedEventDueTime() }
            persistDraft()
        }
        .onChange(of: selectedKitId) { _, kitId in
            if kitId == nil { selectedKitDetail = nil }
            persistDraft()
            Task { await loadSelectedKitDetail() }
        }
        .onChange(of: isLinkedToEvent) { _, linked in
            if linked {
                customPurpose = ""
                if !hasRestoredDraft { applySelectedEventDueTime() }
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
        .onChange(of: showEditContextConfirm) { _, visible in
            if !visible && checkoutContextReady { armScannerCaptureAfterRestore() }
        }
        .onChange(of: checkoutContextReady) { _, isReady in
            if !isReady {
                scannerCaptureEnabled = false
            }
            persistDraft()
        }
        .onDisappear {
            availabilityRequests.invalidate()
            preflightRequests.invalidate()
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
            KioskTaskScaffold(header: taskHeader(step: 2)) {
                scanMain
            } panel: {
                takingOutPanel
            }
        } else {
            VStack(spacing: 0) {
                taskHeader(step: 1)
                KioskCheckoutDetailsStep(
                    events: eventOptions,
                    isLoadingEvents: isLoadingEvents,
                    isLinkedToEvent: $isLinkedToEvent,
                    selectedEventId: $selectedEventId,
                    customPurpose: $customPurpose,
                    dueBackAt: $dueBackAt,
                    focusedField: $focusedCheckoutField,
                    canContinue: hasCheckoutContext && hasValidReturnTime,
                    blockingRequirement: blockingRequirement,
                    onContinue: startScanning
                )
            }
        }
    }

    private func taskHeader(step: Int) -> KioskTaskHeader {
        KioskTaskHeader(
            title: "New checkout",
            subtitle: "\(homeShortNames(for: [user])[user.id] ?? user.name) · step \(step) of 2",
            avatarURL: user.avatarUrl,
            avatarInitials: user.initials,
            backAccessibilityLabel: scannedItems.isEmpty ? "Back" : "Back, will ask before discarding \(scannedItems.count) scans",
            onBack: {
                if step == 2 && scannedItems.isEmpty && !hasPendingCompletion {
                    checkoutContextReady = false
                } else if scannedItems.isEmpty && !hasPendingCompletion {
                    store.screen = .operatorHub(user)
                } else {
                    showBackConfirm = true
                }
            }
        )
    }

    // MARK: - Scan step (D4–D6, I3, I5)

    @ViewBuilder
    private var scanMain: some View {
        KioskContextCard(
            title: hasCheckoutContext ? checkoutContextTitle : "Details needed",
            detail: KioskDueCopy.due(dueBackAt) + (selectedKitDetail.map { " · \($0.name) kit" } ?? ""),
            onEdit: { requestEditContext() }
        )

        scanStage
            .animation(KioskMotion.confirm(reduceMotion), value: lastAccepted)

        KioskPrimaryPill(
            title: hasPendingCompletion ? "Try again now" : "Check out",
            detail: scannedItems.isEmpty ? nil : "\(scannedItems.count) item\(scannedItems.count == 1 ? "" : "s")",
            isEnabled: hasPendingCompletion || (!scannedItems.isEmpty && pendingScanIdentities.isEmpty && (!hasCheckoutContext || !hasValidReturnTime || (hasVerifiedAvailability && !isCheckingAvailability && availabilityError == nil && !availabilityResult.hasBlockingIssue))),
            isBusy: isCompleting,
            action: {
                if hasPendingCompletion || (hasCheckoutContext && hasValidReturnTime) { completeCheckout() }
                else { requestEditContext() }
            }
        )
        .accessibilityLabel(completeAccessibilityLabel)
    }

    @ViewBuilder
    private var scanStage: some View {
        if hasPendingCompletion {
            KioskNoticeStage(
                section: .comingBack,
                overline: "Not confirmed yet",
                title: "We couldn't reach the server",
                message: "Your checkout is saved on this iPad and hasn't gone through yet. Keep the gear here and try again. Nothing is checked out twice, however many times you try."
            )
        } else if let lastAccepted {
            KioskConfirmationStage(
                section: .takingOut,
                title: "\(lastAccepted.title) added",
                detail: [lastAccepted.subtitle, "\(scannedItems.count) item\(scannedItems.count == 1 ? "" : "s")"].compactMap { $0 }.joined(separator: " · "),
                hint: "Keep scanning, or check out.",
                onUndo: undoLastScan
            )
        } else if let lastResult, lastResult.tone == .error {
            KioskNoticeStage(
                section: .problem,
                overline: "Not added",
                title: KioskAvailabilityCopy.withoutRejectionSuffix(lastResult.message),
                message: "Put it back on the shelf, or scan something else. Your list didn't change.",
                showsAlertGlyph: true
            )
        } else if availabilityResult.hasBlockingIssue || availabilityError != nil {
            KioskNoticeStage(
                section: .problem,
                overline: "Before you check out",
                title: availabilityError == nil ? KioskAvailabilityCopy.blockingTitle(for: availabilityResult) : "Couldn't check your items",
                message: availabilityError ?? "Remove the item marked in your list, or change when it's back.",
                showsAlertGlyph: true
            ) {
                if availabilityError != nil {
                    Button("Try again") {
                        let cart = store.cart(for: userId)
                        Task { await refreshAvailability(for: cart) }
                    }
                    .kioskButtonRole(.secondary)
                }
            }
        } else {
            KioskScanPrompt(
                title: scannedItems.isEmpty ? "Scan what you're taking" : "Scan the next item",
                detail: "Each item appears in your list as you scan.",
                status: scannerStatusLine,
                onCamera: { showCamera = true }
            )
        }
    }

    /// A sleeping scanner is normal: say how to wake it, never an error.
    private var scannerStatusLine: String? {
        if !store.scanner.hardwareConnected { return "Scanner is asleep. Press its trigger to wake it." }
        // The hidden field's real first-responder state, not merely that it
        // is mounted.
        if !scannerHasFocus { return "Getting the scanner ready…" }
        return nil
    }

    private func undoLastScan() {
        guard let last = scannedItems.last,
              let group = groupedScannedItems.first(where: { $0.contains(last) }) else { return }
        if group.items.count > 1 {
            var cart = store.cart(for: userId)
            cart.removeAll { $0.id == last.id }
            store.setCart(cart, for: userId)
            Task { await refreshAvailability(for: cart) }
        } else {
            removeGroup(group)
        }
        lastAccepted = nil
    }

    private var takingOutPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            KioskSectionHeader(
                title: "Taking out",
                detail: selectedKitDetail.map { "\($0.name) kit" } ?? "new checkout",
                count: "\(scannedItems.count)",
                section: .takingOut
            )
            if scannedItems.isEmpty && remainingKitItems.isEmpty {
                Text("Scanned items show up here.")
                    .font(.system(size: 15))
                    .foregroundStyle(KioskText.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 16)
                    .kioskCard()
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(groupedScannedItems.enumerated()), id: \.element.id) { index, group in
                            if index > 0 { Rectangle().fill(KioskStroke.divider).frame(height: 1) }
                            if let issue = availabilityIssue(for: group) {
                                KioskCartGroupRow(
                                    group: group,
                                    availabilityIssue: issue,
                                    onRemove: { removeGroup(group) },
                                    onChangeReturnTime: issue.canChangeReturnTime ? { editReturnTime() } : nil,
                                    onScanAnother: issue.isBlocking ? { prepareForNextScan(after: group) } : nil
                                )
                            } else if group.isBulkGroup {
                                KioskBatteryRow(
                                    title: group.subtitle.components(separatedBy: " · ").first ?? group.subtitle,
                                    scanned: group.count,
                                    total: group.count,
                                    units: group.unitNumbers.map { .init(id: "\(group.id)-\($0)", label: "#\($0)", isScanned: true) }
                                )
                            } else {
                                KioskItemRow(tag: group.first.itemListPrimaryTitle, name: group.first.itemListSecondaryTitle, isDone: true) {
                                    KioskRowRemoveButton(accessibilityLabel: "Remove \(group.primaryTitle)") { removeGroup(group) }
                                }
                            }
                        }
                        ForEach(remainingKitItems) { item in
                            Rectangle().fill(KioskStroke.divider).frame(height: 1)
                            KioskItemRow(tag: item.title, name: item.subtitle == item.title ? nil : item.subtitle, isDone: false)
                        }
                    }
                    .kioskCard()
                    .clipShape(RoundedRectangle(cornerRadius: KioskRadius.xl))
                }
                .scrollIndicators(.hidden)
            }
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

    @MainActor
    private func loadCheckoutKits() async {
        guard kitOptions.isEmpty, !isLoadingKits else { return }
        isLoadingKits = true
        kitLoadError = nil
        do {
            let response = try await KioskAPI.shared.kioskKits(requesterId: user.id)
            kitOptions = response.kits
            if !didApplySuggestedKit,
               selectedKitId == nil,
               let suggestedKitId = response.suggestedKitId,
               kitOptions.contains(where: { $0.id == suggestedKitId }) {
                didApplySuggestedKit = true
                selectedKitId = suggestedKitId
            }
        } catch {
            kitLoadError = (error as? APIError)?.errorDescription ?? "Kits unavailable"
        }
        isLoadingKits = false
    }

    @MainActor
    private func loadSelectedKitDetail() async {
        guard let selectedKitId else {
            selectedKitDetail = nil
            return
        }
        if selectedKitDetail?.id == selectedKitId { return }
        do {
            let detail = try await KioskAPI.shared.kioskKitDetail(id: selectedKitId)
            guard self.selectedKitId == selectedKitId else { return }
            selectedKitDetail = detail
        } catch {
            guard self.selectedKitId == selectedKitId else { return }
            selectedKitDetail = nil
            showFeedback(.error((error as? APIError)?.errorDescription ?? "Could not load this kit."))
        }
    }

    private var remainingKitItems: [KioskKitRemainingItem] {
        guard let kit = selectedKitDetail else { return [] }
        let scannedAssetIds = Set(scannedItems.filter { $0.bulkSkuId == nil }.map(\.id))
        var rows: [KioskKitRemainingItem] = []
        for member in kit.members where !scannedAssetIds.contains(member.id) {
            rows.append(KioskKitRemainingItem(
                id: member.id,
                title: member.assetTag.nonBlankText ?? member.name,
                subtitle: member.name
            ))
        }
        for bulk in kit.bulkMembers {
            let scanned = scannedItems.filter { $0.bulkSkuId == bulk.bulkSkuId }.count
            let missing = bulk.quantity - scanned
            if missing > 0 {
                rows.append(KioskKitRemainingItem(
                    id: bulk.bulkSkuId,
                    title: bulk.name,
                    subtitle: missing == bulk.quantity ? "Scan \(missing)" : "Scan \(missing) more"
                ))
            }
        }
        return rows
    }

    private func handleScan(_ value: String) {
        // Ignore scans during the complete-API window — a late scan would
        // land in the cart but miss the assetIds payload, then get wiped on
        // success. Phantom checkouts are worse than a "hold on" feedback.
        guard !isCompleting else {
            showFeedback(.error("Hold on — finishing checkout"))
            return
        }
        // A saved handoff resends its own item list, not this cart, and a
        // success then clears the cart. Scanning more now would send gear home
        // with no record, so the saved handoff has to settle first.
        guard !hasPendingCompletion else {
            showFeedback(.error("Finish the previous checkout first — tap Check Previous Handoff"))
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
        queuedScanValues.append(value)
        processNextScanIfNeeded()
    }

    /// Keep rapid scanner input ordered. Availability must be checked against
    /// the current cart before a candidate becomes visible as accepted; doing
    /// that serially prevents two out-of-order responses from bypassing the
    /// candidate preflight or losing a valid scan.
    private func processNextScanIfNeeded() {
        guard !isProcessingScan, let value = queuedScanValues.first else { return }
        isProcessingScan = true
        let normalizedScan = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let flow = store.flowGeneration

        Task {
            defer {
                pendingScanIdentities.remove(normalizedScan)
                if !queuedScanValues.isEmpty { queuedScanValues.removeFirst() }
                isProcessingScan = false
                if store.ownsFlow(flow) { processNextScanIfNeeded() }
            }

            do {
                let result = try await KioskAPI.shared.kioskCheckoutScan(actorId: userId, scanValue: value)
                guard store.ownsFlow(flow) else { return }
                guard result.success, let item = result.item else {
                    showFeedback(.error(KioskAvailabilityCopy.rejectedScan(result.error ?? "Could not add item")))
                    return
                }

                let cartItem = KioskCartItem(
                    id: item.id,
                    name: item.name,
                    tagName: item.tagName,
                    type: item.type,
                    imageUrl: item.imageUrl,
                    bulkSkuId: item.bulkSkuId,
                    unitNumber: item.unitNumber
                )
                var updated = store.cart(for: userId)
                guard !updated.contains(where: { $0.id == cartItem.id }) else {
                    showFeedback(.duplicate("Already scanned"))
                    return
                }

                // Preflight the candidate before putting it in the visible
                // cart. A reservation conflict is a rejected scan, not an
                // accepted item that happens to make completion impossible.
                let candidateCart = updated + [cartItem]
                guard let preflight = await refreshAvailability(for: candidateCart, applyResult: false) else {
                    showFeedback(.error(
                        "Scan rejected; \(cartItem.itemListPrimaryTitle) was not added because availability could not be verified."
                    ))
                    return
                }
                let candidateGroup = KioskCartDisplayGroup(id: cartItem.id, items: [cartItem])
                guard store.ownsFlow(flow) else { return }
                if let candidateIssue = availabilityIssue(for: candidateGroup, result: preflight), candidateIssue.isBlocking {
                    let feedback = scanAvailabilityFeedback(for: cartItem, result: preflight)
                        ?? .error("Scan rejected; \(cartItem.itemListPrimaryTitle) was not added because it is unavailable.")
                    showFeedback(feedback)
                    return
                }

                // The scan queue is serial, but the cart can still be changed
                // by an explicit remove action while the preflight is in flight.
                // Re-read it before admitting the candidate.
                updated = store.cart(for: userId)
                guard !updated.contains(where: { $0.id == cartItem.id }) else {
                    showFeedback(.duplicate("Already scanned"))
                    return
                }
                updated.append(cartItem)
                store.setCart(updated, for: userId)
                applyAvailabilityResult(preflight)
                earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
                lastAccepted = KioskAcceptedScan(
                    title: cartItem.itemListPrimaryTitle,
                    subtitle: cartItem.itemListSecondaryTitle,
                    progress: "\(updated.count) item\(updated.count == 1 ? "" : "s") scanned"
                )
                if let scanIssue = scanAvailabilityFeedback(for: cartItem, result: preflight) {
                    showFeedback(scanIssue)
                } else if result.locationMismatch == true {
                    showFeedback(.warning(result.locationMessage ?? "\(item.name) added, location checked"))
                } else {
                    showFeedback(.success(result.locationMessage ?? item.name))
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
        switch feedback {
        case .error, .duplicate:
            lastAccepted = nil
        case .success, .warning:
            break
        }
        // Tactile + spoken signal so the staffer doesn't need to read the
        // banner — ankle-deep in a noisy floor environment.
        switch feedback {
        case .success: Haptics.success()
        case .warning: Haptics.warning()
        case .duplicate:
            Haptics.warning()
            KioskScanFeedbackSound.playFailure()
        case .error:
            Haptics.error()
            KioskScanFeedbackSound.playFailure()
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
        let cart = store.cart(for: userId)
        if !cart.isEmpty {
            Task { await refreshAvailability(for: cart, endsAt: dueBackAt) }
        }
        DispatchQueue.main.async {
            HIDScannerFocusGate.allowScannerFocusNow()
            scannerCaptureEnabled = true
        }
    }

    /// Open the existing details step without discarding the scan cart. This
    /// is the direct recovery path for a conflict whose reservation window can
    /// be avoided by choosing an earlier return time.
    private func editReturnTime() {
        feedbackDismissTask?.cancel()
        lastAccepted = nil
        withAnimation { lastResult = nil }
        scannerCaptureEnabled = false
        focusedCheckoutField = nil
        checkoutContextReady = false
        store.resetInactivity()
        Haptics.selection()
        UIAccessibility.post(
            notification: .announcement,
            argument: "Edit the return date and time. Scanned items will stay in the cart."
        )
    }

    /// Restore the scan target after an operator has read a blocked-item
    /// message. The item remains visible in the cart so the operator can still
    /// remove it explicitly; this action only makes the next scan immediate.
    private func prepareForNextScan(after group: KioskCartDisplayGroup) {
        feedbackDismissTask?.cancel()
        lastAccepted = nil
        withAnimation { lastResult = nil }
        scannerCaptureEnabled = false
        store.resetInactivity()
        Haptics.selection()
        let itemLabel = group.isBulkGroup ? "another unit" : "another item"
        UIAccessibility.post(notification: .announcement, argument: "Ready to scan \(itemLabel).")
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
        guard hasPendingCompletion || (!cart.isEmpty && hasCheckoutContext && hasValidReturnTime), let locationId = store.info?.locationId else { return }
        guard !isCompleting, pendingScanIdentities.isEmpty else { return }
        guard let flow = store.beginHandoff() else { return }
        let endsAt = dueBackAt
        let eventId = isLinkedToEvent ? selectedEvent?.id : nil
        let purpose = !isLinkedToEvent && !trimmedCustomPurpose.isEmpty ? trimmedCustomPurpose : nil
        isCompleting = true
        Task {
            defer { store.endHandoff(flow) }
            if !hasPendingCompletion {
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
            }
            do {
                let completion = try await KioskAPI.shared.kioskCheckoutComplete(
                    actorId: userId,
                    locationId: locationId,
                    items: cart,
                    eventId: eventId,
                    customPurpose: purpose,
                    endsAt: endsAt,
                    kitId: selectedKitId
                )
                guard store.ownsFlow(flow) else { return }
                earnedBadges.appendUnique(contentsOf: completion.earnedBadges ?? [])
                Haptics.success()
                store.clearCart(for: userId)
                store.clearCheckoutDraft(for: userId)
                store.clearIntent(reason: .success)
                scannerCaptureEnabled = false
                store.screen = .success(KioskSuccessInfo(
                    kind: .checkout,
                    message: completion.itemCount.map { "\($0) item\($0 == 1 ? "" : "s") checked out. Your handoff is recorded." } ?? "Your checkout is recorded.",
                    earnedBadges: earnedBadges
                ))
            } catch {
                hasPendingCompletion = KioskAPI.shared.hasPendingCheckout(actorId: userId)
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
        hasRestoredDraft = true
        isLinkedToEvent = draft.isLinkedToEvent
        selectedEventId = draft.selectedEventId
        customPurpose = draft.customPurpose
        let minimum = KioskQuarterHour.roundedUp(Date().addingTimeInterval(5 * 60))
        dueBackAt = draft.dueBackAt >= minimum ? draft.dueBackAt : minimum
        selectedKitId = draft.selectedKitId
        if draft.selectedKitId != nil { didApplySuggestedKit = true }
        // Resume where the draft actually left off. Forcing `true` here sent a
        // half-filled draft straight to the scan step.
        checkoutContextReady = draft.contextReady
        guard checkoutContextReady else { return }
        armScannerCaptureAfterRestore()
    }

    private func applyRetainedIntent() {
        guard var intent = store.pendingIntent, intent.identifiedUser?.id == user.id else { return }
        if let event = intent.selectedEvent, !hasRestoredDraft || selectedEventId != event.id {
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
                contextReady: checkoutContextReady,
                selectedKitId: selectedKitId
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
        endsAt requestedEndsAt: Date? = nil,
        applyResult: Bool = true
    ) async -> KioskCheckoutAvailabilityResult? {
        let isPreflight = !applyResult
        let requestToken = isPreflight ? preflightRequests.begin() : availabilityRequests.begin()
        func owns() -> Bool {
            isPreflight ? preflightRequests.owns(requestToken) : availabilityRequests.owns(requestToken)
        }
        guard let locationId = store.info?.locationId, !cart.isEmpty else {
            if applyResult {
                availabilityResult = KioskCheckoutAvailabilityResult()
                availabilityError = nil
                hasVerifiedAvailability = false
            }
            isCheckingAvailability = false
            return nil
        }
        let endsAt = requestedEndsAt ?? dueBackAt
        guard endsAt > Date().addingTimeInterval(60) else {
            if applyResult {
                availabilityResult = KioskCheckoutAvailabilityResult()
                availabilityError = "Choose a return time later than pickup"
                hasVerifiedAvailability = false
            }
            isCheckingAvailability = false
            return nil
        }

        isCheckingAvailability = true
        if applyResult {
            hasVerifiedAvailability = false
            availabilityError = nil
        }
        defer {
            if owns() { isCheckingAvailability = false }
        }
        do {
            let result = try await KioskAPI.shared.kioskCheckoutAvailability(
                locationId: locationId,
                items: cart,
                startsAt: Date(),
                endsAt: endsAt
            )
            guard owns() else { return nil }
            if applyResult {
                applyAvailabilityResult(result)
            }
            return result
        } catch {
            guard owns() else { return nil }
            // A failed preflight rejects only its own scan; it must not
            // disable Complete for the cart that was already verified.
            if applyResult {
                availabilityError = (error as? APIError)?.errorDescription ?? "Conflict check unavailable"
                hasVerifiedAvailability = false
            }
            return nil
        }
    }

    private func applyAvailabilityResult(_ result: KioskCheckoutAvailabilityResult) {
        availabilityResult = result
        availabilityError = nil
        hasVerifiedAvailability = true
    }

    private func availabilityIssue(
        for group: KioskCartDisplayGroup,
        result: KioskCheckoutAvailabilityResult? = nil
    ) -> KioskCartAvailabilityIssue? {
        let availability = result ?? availabilityResult
        let ids = Set(group.items.map(\.id))
        let bulkSkuIds = Set(group.items.compactMap(\.bulkSkuId))

        if let unavailable = availability.unavailableAssets.first(where: { ids.contains($0.assetId) }) {
            return KioskCartAvailabilityIssue(
                tone: KioskAvailabilityCopy.unavailableTone(for: unavailable.status),
                message: KioskAvailabilityCopy.unavailableLabel(for: unavailable.status),
                isBlocking: true
            )
        }
        if let conflict = availability.conflicts.first(where: { ids.contains($0.assetId) }) {
            let state = KioskAvailabilityCopy.conflictState(for: conflict)
            return KioskCartAvailabilityIssue(
                tone: state.tone,
                message: state.label,
                isBlocking: true,
                canChangeReturnTime: true
            )
        }
        if availability.shortages.contains(where: { bulkSkuIds.contains($0.bulkSkuId) }) {
            return KioskCartAvailabilityIssue(tone: .error, message: "Short", isBlocking: true)
        }
        let serializedRisks = availability.turnaroundRisks.filter { ids.contains($0.assetId) }
        let bulkRisks = availability.bulkTurnaroundRisks.filter { bulkSkuIds.contains($0.bulkSkuId) }
        if serializedRisks.contains(where: { $0.code == "RECENT_CHECKIN_REPORT" && $0.reportType == "LOST" }) {
            return KioskCartAvailabilityIssue(tone: .warning, message: "Lost report", isBlocking: false)
        }
        if serializedRisks.contains(where: { $0.code == "RECENT_CHECKIN_REPORT" }) {
            return KioskCartAvailabilityIssue(tone: .warning, message: "Condition", isBlocking: false)
        }
        if serializedRisks.contains(where: { $0.code == "LOCATION_TRANSFER" }) {
            return KioskCartAvailabilityIssue(tone: .warning, message: "Transfer", isBlocking: false)
        }
        if !serializedRisks.isEmpty || !bulkRisks.isEmpty {
            let hasCritical = serializedRisks.contains { $0.severity.caseInsensitiveCompare("critical") == .orderedSame }
                || bulkRisks.contains { $0.severity.caseInsensitiveCompare("critical") == .orderedSame }
            return KioskCartAvailabilityIssue(
                tone: .warning,
                message: hasCritical ? "Very tight timing" : "Tight timing",
                isBlocking: false
            )
        }
        return nil
    }

    private func scanAvailabilityFeedback(
        for item: KioskCartItem,
        result: KioskCheckoutAvailabilityResult
    ) -> ScanFeedback? {
        let title = item.itemListPrimaryTitle

        if let unavailable = result.unavailableAssets.first(where: { $0.assetId == item.id }) {
            let status = KioskAvailabilityCopy.unavailableMessageStatus(for: unavailable.status)
            return .error(KioskAvailabilityCopy.rejectedScan("\(title) is \(status)"))
        }

        if let conflict = result.conflicts.first(where: { $0.assetId == item.id }) {
            return .error(KioskAvailabilityCopy.rejectedScan(
                KioskAvailabilityCopy.conflictMessage(for: conflict, itemTitle: title)
            ))
        }

        if let bulkSkuId = item.bulkSkuId,
           let shortage = result.shortages.first(where: { $0.bulkSkuId == bulkSkuId }) {
            return .error(KioskAvailabilityCopy.rejectedScan(
                "\(title) needs \(shortage.requested), but only \(shortage.available) are available"
            ))
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

fileprivate enum KioskAvailabilityTone: Equatable {
    case warning
    case error
    case reserved
    case checkedOut
}

fileprivate enum KioskAvailabilityState: Equatable, Hashable {
    case reserved
    case checkedOut
    case pendingPickup
    case conflict

    var label: String {
        switch self {
        case .reserved: return "Reserved"
        case .checkedOut: return "Checked Out"
        case .pendingPickup: return "Pending Pickup"
        case .conflict: return "Conflict"
        }
    }

    var tone: KioskAvailabilityTone {
        switch self {
        case .reserved: return .reserved
        case .checkedOut: return .checkedOut
        case .pendingPickup: return .warning
        case .conflict: return .error
        }
    }
}

private enum KioskAvailabilityCopy {
    private static let serializedTurnaroundBuffer: TimeInterval = 60 * 60

    static func rejectedScan(_ message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let needsPeriod = !trimmed.hasSuffix(".") && !trimmed.hasSuffix("!") && !trimmed.hasSuffix("?")
        return "\(trimmed)\(needsPeriod ? "." : "") Scan rejected; it was not added."
    }

    /// The scan stage's "NOT ADDED" overline already says it; the headline
    /// keeps only the reason.
    static func withoutRejectionSuffix(_ message: String) -> String {
        message.replacingOccurrences(of: " Scan rejected; it was not added.", with: "")
    }

    static func conflictState(for conflict: KioskCheckoutAvailabilityResult.SerializedConflict) -> KioskAvailabilityState {
        let kind = conflict.conflictingBookingKind?.uppercased()
        let status = conflict.conflictingBookingStatus?.uppercased()

        // An explicit status is stronger than kind during a mixed-version rollout.
        if status == "OPEN" { return .checkedOut }
        if status == "PENDING_PICKUP" { return .pendingPickup }
        if kind == "CHECKOUT" { return .checkedOut }
        if status == "BOOKED" || kind == "RESERVATION" { return .reserved }
        return .conflict
    }

    static func unavailableLabel(for status: String) -> String {
        switch status.uppercased() {
        case "RESERVED", "BOOKED": return "Reserved"
        case "CHECKED_OUT", "OPEN": return "Checked Out"
        case "PENDING_PICKUP": return "Pending Pickup"
        case "MAINTENANCE": return "Maintenance"
        case "RETIRED": return "Retired"
        case "NOT_FOUND": return "Not Found"
        case "NOT_AVAILABLE_FOR_CHECKOUT": return "Checkout Disabled"
        case "NOT_AVAILABLE_FOR_RESERVATION": return "Reservation Disabled"
        default: return "Unavailable"
        }
    }

    static func unavailableTone(for status: String) -> KioskAvailabilityTone {
        switch status.uppercased() {
        case "RESERVED", "BOOKED": return .reserved
        case "CHECKED_OUT", "OPEN": return .checkedOut
        case "PENDING_PICKUP": return .warning
        default: return .error
        }
    }

    static func unavailableMessageStatus(for status: String) -> String {
        switch status.uppercased() {
        case "RESERVED", "BOOKED": return "already reserved"
        case "CHECKED_OUT", "OPEN": return "already checked out"
        case "PENDING_PICKUP": return "pending pickup"
        case "MAINTENANCE": return "in maintenance"
        case "RETIRED": return "retired"
        case "NOT_FOUND": return "not found"
        case "NOT_AVAILABLE_FOR_CHECKOUT": return "not enabled for checkout"
        case "NOT_AVAILABLE_FOR_RESERVATION": return "not enabled for reservations"
        default: return "unavailable"
        }
    }

    static func conflictMessage(
        for conflict: KioskCheckoutAvailabilityResult.SerializedConflict,
        itemTitle: String
    ) -> String {
        let booking = conflict.conflictingBookingTitle ?? "another booking"
        let startsAt = conflict.startsAt.formatted(date: .abbreviated, time: .shortened)
        let endsAt = conflict.endsAt.formatted(date: .abbreviated, time: .shortened)
        let window = "(\(startsAt)–\(endsAt))"

        switch conflictState(for: conflict) {
        case .reserved:
            if let requester = conflict.conflictingBookingRequesterName?.nonBlankText {
                return "\(requester) has reserved the \(itemTitle) until \(conflict.endsAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
            }
            return "\(itemTitle) is already reserved for \(booking) \(window). Remove it or change the return time before checkout."
        case .checkedOut:
            if let requester = conflict.conflictingBookingRequesterName?.nonBlankText {
                return "\(requester) has checked out the \(itemTitle) until \(conflict.endsAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
            }
            return "\(itemTitle) is already checked out for \(booking) \(window). Remove it or change the return time before checkout."
        case .pendingPickup:
            if let requester = conflict.conflictingBookingRequesterName?.nonBlankText {
                return "\(requester) has a pending pickup for the \(itemTitle) until \(conflict.endsAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))"
            }
            return "\(itemTitle) is pending pickup for \(booking) \(window). Remove it or change the return time before checkout."
        case .conflict:
            return "\(itemTitle) conflicts with \(booking) \(window). Remove it or change the return time before checkout."
        }
    }

    static func blockingTitle(for result: KioskCheckoutAvailabilityResult) -> String {
        let states = Set(result.conflicts.map { conflictState(for: $0) })
        if states.contains(.reserved) && states.contains(.checkedOut) { return "Reserved or checked out" }
        if states.contains(.reserved) { return "Reserved item" }
        if states.contains(.checkedOut) { return "Checked out item" }
        if states.contains(.pendingPickup) { return "Pickup pending" }
        return "Conflict found"
    }

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

private struct KioskKitRemainingItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String
}

private struct KioskCartAvailabilityIssue: Equatable {
    let tone: KioskAvailabilityTone
    let message: String
    let isBlocking: Bool
    var canChangeReturnTime: Bool = false

    var color: Color {
        switch tone {
        case .warning: KioskStatus.attention
        case .error: KioskStatus.problem
        case .reserved: KioskStatus.scheduled
        case .checkedOut: KioskStatus.active
        }
    }
}

enum KioskCheckoutEventFormat {
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

private struct KioskCartGroupRow: View {
    let group: KioskCartDisplayGroup
    let availabilityIssue: KioskCartAvailabilityIssue?
    let onRemove: (() -> Void)?
    let onChangeReturnTime: (() -> Void)?
    let onScanAnother: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: availabilityIssue?.isBlocking == true ? 12 : 0) {
            HStack(spacing: 14) {
                KioskCheckoutThumbnail(item: group.first)

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(group.primaryTitle)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(KioskText.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                        if group.count > 1 {
                            Text("x\(group.count)")
                                .font(KioskType.chipStrong)
                                .foregroundStyle(KioskText.primary)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(KioskSurface.control, in: Capsule())
                        }
                        if let availabilityIssue {
                            Text(availabilityIssue.message)
                                .font(KioskType.chipStrong)
                                .foregroundStyle(availabilityIssue.color)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(availabilityIssue.color.opacity(0.16), in: Capsule())
                        }
                    }

                    Text(group.subtitle)
                        .font(KioskType.chip)
                        .foregroundStyle(KioskText.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer()
                if availabilityIssue?.isBlocking != true, let onRemove {
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
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityAction(named: "Remove") { onRemove?() }

            if availabilityIssue?.isBlocking == true {
                recoveryActions
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var recoveryActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What now?")
                .font(KioskType.overline)
                .tracking(1.2)
                .foregroundStyle(KioskText.muted)

            ViewThatFits(in: .horizontal) {
                actionButtons
                VStack(alignment: .leading, spacing: 8) {
                    actionButtons
                }
            }
        }
    }

    private var actionButtons: some View {
        HStack(spacing: 8) {
            if let onRemove {
                recoveryButton(
                    title: group.count == 1 ? "Remove item" : "Remove \(group.count) units",
                    systemImage: "trash",
                    role: .destructive,
                    accessibilityHint: "Removes this staged item group from the cart.",
                    action: onRemove
                )
            }
            if let onChangeReturnTime {
                recoveryButton(
                    title: "Change return time",
                    systemImage: "clock.arrow.circlepath",
                    role: .secondary,
                    accessibilityHint: "Opens checkout details without clearing your scans.",
                    action: onChangeReturnTime
                )
            }
            if let onScanAnother {
                recoveryButton(
                    title: group.isBulkGroup ? "Scan another unit" : "Scan another item",
                    systemImage: "barcode.viewfinder",
                    role: .secondary,
                    accessibilityHint: "Keeps this item staged and re-arms the scanner for another scan.",
                    action: onScanAnother
                )
            }
        }
    }

    private func recoveryButton(
        title: String,
        systemImage: String,
        role: KioskButtonRole,
        accessibilityHint: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(KioskType.micro)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .frame(minHeight: 44)
        }
        .kioskButtonRole(role)
        .controlSize(.small)
        .accessibilityLabel(title)
        .accessibilityHint(accessibilityHint)
    }

    private var accessibilityLabel: String {
        let status = availabilityIssue.map { ", \($0.message)" } ?? ""
        return "\(group.primaryTitle), \(group.subtitle)\(status)"
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
