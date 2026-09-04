import SwiftUI
import UIKit

struct KioskReturnView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let bookingId: String
    let userId: String

    @State private var detail: KioskCheckoutDetail?
    @State private var returnedIds: Set<String> = []
    @State private var lastResult: ScanFeedback?
    /// The item the last successful scan returned, held while its receipt is
    /// on screen. Cleared on the same timer as the feedback banner.
    @State private var lastAccepted: KioskAcceptedScan?
    @State private var feedbackDismissTask: Task<Void, Never>?
    @State private var isLoading = true
    @State private var isCompleting = false
    @State private var loadError: String?
    @State private var showCamera = false
    @State private var lastReturnedId: String?
    @State private var scannerHasFocus = false
    @State private var lastScanAt: Date?
    @State private var earnedBadges: [EarnedBadgeReward] = []

    enum ScanFeedback: Equatable {
        case success(String)
        case error(String)
        case alreadyReturned(String)

        var message: String {
            switch self {
            case .success(let s), .error(let s), .alreadyReturned(let s): return s
            }
        }

        var tone: KioskBannerTone {
            switch self {
            case .success:         .success
            case .error:           .error
            case .alreadyReturned: .warning
            }
        }
    }

    private var totalItems: Int { detail?.items.count ?? 0 }
    private var returnedCount: Int { returnedIds.count }
    private var hasReturned: Bool { returnedCount > 0 }
    private var allReturned: Bool { returnedCount == totalItems && totalItems > 0 }
    private var batteryTotal: Int { detail?.scanSummary?.numberedBulkTotal ?? detail?.numberedBulkItems.count ?? 0 }
    private var returnedBatteryCount: Int {
        detail?.numberedBulkItems.filter { returnedIds.contains($0.id) }.count ?? 0
    }
    private var hasBatteryScanStep: Bool { batteryTotal > 0 }
    private var returnedBatteryUnits: [KioskCheckoutDetail.ReturnItem] {
        detail?.numberedBulkItems.filter { returnedIds.contains($0.id) } ?? []
    }

    var body: some View {
        KioskAdaptiveSplit { _ in
            scanZone
        } secondary: { isCompact in
            checklistPanel(isCompact: isCompact)
        }
        .overlay(alignment: .bottom) {
            HIDScannerField(
                onScan: { store.scanner.receive($0) },
                onFocusChange: { scannerHasFocus = $0 }
            )
                .frame(width: 1, height: 1)
                .opacity(0)
        }
        .task {
            store.scanner.claim(.return) { handleScan($0) }
            await loadDetail()
            replayPendingIntentScan()
            #if DEBUG
            // Capture hook: the confirmation only exists in the seconds after a
            // real scan, which no fixture payload can produce.
            if KioskFixtureScenario.active == .returnAccepted, let first = detail?.items.first {
                returnedIds.insert(first.id)
                lastAccepted = KioskAcceptedScan(
                    title: first.itemListPrimaryTitle,
                    subtitle: first.itemListSecondaryTitle,
                    progress: "\(returnedIds.count) of \(totalItems) returned"
                )
            }
            #endif
        }
        .onDisappear { store.scanner.release(.return) }
        .sheet(isPresented: $showCamera) {
            KioskBarcodeCameraView(
                feedbackMessage: lastResult?.message,
                feedbackTone: lastResult?.tone,
                onScan: { value in handleScan(value) },
                onCancel: { showCamera = false }
            )
        }
    }

    // MARK: - Scan Zone

    private var scanZone: some View {
        KioskScanZoneColumn {
            KioskFlowHeader(
                title: "Return",
                subtitle: detail?.title,
                onBack: { backToPerson() },
                onCamera: { showCamera = true }
            )

            Spacer()

            if isLoading {
                ProgressView().tint(KioskText.primary)
            } else {
                VStack(spacing: 20) {
                    if let lastAccepted {
                        KioskScanAcceptedView(accepted: lastAccepted, reduceMotion: reduceMotion)
                            .frame(minHeight: 300)
                    } else {
                        KioskProgressRing(
                            count: returnedCount,
                            total: totalItems,
                            isComplete: allReturned,
                            reduceMotion: reduceMotion,
                            accessibilityText: "\(returnedCount) of \(totalItems) items returned"
                        )

                        if let detail, detail.isOverdue {
                            Label("Overdue", systemImage: "exclamationmark.triangle.fill")
                                .font(KioskType.chip)
                                .foregroundStyle(KioskStatus.problem)
                                .accessibilityLabel("This checkout is overdue")
                        }

                        VStack(spacing: 6) {
                            Text(allReturned ? "All items returned" : "Scan items to return them")
                                .font(KioskType.actionTitle)
                                .foregroundStyle(allReturned ? KioskStatus.ok : KioskText.primary)
                                .multilineTextAlignment(.center)
                            if !allReturned {
                                Text("Use the hand scanner, or tap Camera to scan with the iPad.")
                                    .font(KioskType.rowDetail)
                                    .foregroundStyle(KioskText.tertiary)
                                    .multilineTextAlignment(.center)
                            }
                        }
                    }

                    KioskScannerReadinessBadge(
                        isReady: scannerHasFocus,
                        lastScanAt: lastScanAt,
                        isHardwareConnected: store.scanner.hardwareConnected
                    )

                    if hasBatteryScanStep {
                        KioskBatteryScanStatus(
                            title: "Battery Units",
                            count: returnedBatteryCount,
                            total: batteryTotal,
                            pendingCopy: "Scan each returned battery unit QR so custody closes on the exact units.",
                            completeCopy: "All \(batteryTotal) units returned",
                            progressCopy: "\(returnedBatteryCount) of \(batteryTotal) units returned",
                            unitsHeader: "Returned units",
                            scannedUnits: returnedBatteryUnits.map { KioskScannedUnit(id: $0.id, tag: $0.tagName) }
                        )
                    }

                    if let result = lastResult {
                        KioskFeedbackBanner(tone: result.tone, message: result.message)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .animation(reduceMotion ? nil : .spring(response: 0.3), value: lastResult)
                    }
                }
            }

            Spacer()

            completeButton
        }
    }

    private var completeButton: some View {
        KioskCompletionButton(
            title: returnLabel,
            icon: hasReturned ? "checkmark.circle.fill" : "barcode.viewfinder",
            isEnabled: hasReturned,
            isBusy: isCompleting,
            accessibilityLabel: completeAccessibilityLabel,
            action: completeReturn
        )
    }

    /// The CTA names what the next tap does, and while nothing is scanned it is
    /// disabled — so it must not read "Return 0 of 6 Items", which describes an
    /// action that returns nothing and looks like the button is broken rather
    /// than waiting.
    ///
    /// It also no longer singles out battery units while empty. Any item on the
    /// booking can be scanned first; "Scan Battery Units to Start" invented an
    /// order that does not exist, and on a booking of three cameras and one
    /// battery it named the smallest part of the work.
    private var returnLabel: String {
        if allReturned { return "Complete Return" }
        if !hasReturned { return "Scan Items to Return" }
        return "Return \(returnedCount) of \(totalItems) Items"
    }

    private var completeAccessibilityLabel: String {
        if isCompleting { return "Processing return" }
        if !hasReturned { return "Scan at least one item before returning" }
        if allReturned { return "Complete Return, all \(totalItems) items" }
        return "Return \(returnedCount) of \(totalItems) items"
    }

    // MARK: - Checklist Panel

    private func checklistPanel(isCompact: Bool) -> some View {
        KioskSideRail(isCompact: isCompact) {
            VStack(alignment: .leading, spacing: 8) {
                Text(detail?.title ?? "Return")
                    .font(KioskType.sectionTitle)
                    .foregroundStyle(KioskText.primary)
                if let ref = detail?.refNumber {
                    Text(ref)
                        .font(.caption.monospaced())
                        .foregroundStyle(KioskText.secondary)
                }
                if totalItems > 0 {
                    ChecklistProgressSummary(
                        done: returnedCount,
                        total: totalItems,
                        verb: "returned",
                        complete: allReturned
                    )
                }
            }
            .padding(20)

            Divider().background(KioskStroke.divider)

            if let items = detail?.items {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(items) { item in
                                KioskChecklistRow(
                                    name: item.itemListSecondaryTitle ?? item.name,
                                    tag: item.itemListPrimaryTitle,
                                    isDone: returnedIds.contains(item.id),
                                    isBattery: item.isNumberedBulk,
                                    strikethroughWhenDone: true
                                )
                                    .id(item.id)
                                Divider().background(KioskStroke.hairline)
                            }
                        }
                    }
                    .onChange(of: lastReturnedId) { _, newId in
                        guard let newId else { return }
                        if reduceMotion {
                            proxy.scrollTo(newId, anchor: .center)
                        } else {
                            withAnimation(.easeOut(duration: 0.25)) {
                                proxy.scrollTo(newId, anchor: .center)
                            }
                        }
                    }
                }
            } else if isLoading {
                Spacer()
                ProgressView().tint(KioskText.primary).frame(maxWidth: .infinity)
                Spacer()
            } else if let loadError {
                // Detail-load error — distinct recovery surface from
                // complete-failure (which now flows through showFeedback to
                // the in-flow banner near the progress ring).
                KioskErrorState(title: loadError) { Task { await loadDetail() } }
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: - Logic

    private func handleScan(_ value: String) {
        guard !isCompleting else {
            showFeedback(.error("Hold on — completing return"))
            return
        }

        store.resetInactivity()
        lastScanAt = Date()

        Task {
            do {
                let result = try await KioskAPI.shared.kioskCheckinScan(bookingId: bookingId, actorId: userId, scanValue: value)
                earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
                if result.success, let item = result.item {
                    if returnedIds.contains(item.id) {
                        showFeedback(.alreadyReturned("\(item.tagName) already returned"))
                    } else {
                        returnedIds.insert(item.id)
                        lastReturnedId = item.id
                        lastAccepted = KioskAcceptedScan(
                            title: item.itemListPrimaryTitle,
                            subtitle: item.itemListSecondaryTitle,
                            progress: "\(returnedIds.count) of \(totalItems) returned"
                        )
                        showFeedback(.success(result.locationMessage ?? item.name))
                    }
                } else {
                    showFeedback(.error(result.error ?? "Item not in this checkout"))
                }
            } catch {
                let message = (error as? APIError)?.errorDescription ?? "Scan failed"
                showFeedback(.error(message))
            }
        }
    }

    private func showFeedback(_ feedback: ScanFeedback) {
        withAnimation { lastResult = feedback }
        if case .success = feedback {} else { lastAccepted = nil }
        switch feedback {
        case .success:        Haptics.success()
        case .alreadyReturned:
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
            withAnimation {
                lastResult = nil
                lastAccepted = nil
            }
        }
    }

    private func completeReturn() {
        guard hasReturned, !isCompleting else { return }
        isCompleting = true
        Task {
            do {
                let result = try await KioskAPI.shared.kioskCheckinComplete(bookingId: bookingId, actorId: userId)
                earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
                Haptics.success()
                store.clearIntent(reason: .success)
                store.screen = .success(KioskSuccessInfo(
                    kind: .returned,
                    message: successMessage(for: result),
                    earnedBadges: earnedBadges
                ))
            } catch {
                let message = (error as? APIError)?.errorDescription
                    ?? "Return failed. Please try again."
                showFeedback(.error(message))
            }
            isCompleting = false
        }
    }

    /// Use the SERVER-authoritative counts in the success message — local
    /// counts can drift if a sister kiosk checked items in mid-session.
    private func successMessage(for result: KioskCheckinCompleteResult) -> String {
        let total = result.totalItems
        if result.completed {
            return "All \(total) item\(total == 1 ? "" : "s") returned. Thanks!"
        }
        return "\(result.returnedItems) of \(total) item\(total == 1 ? "" : "s") returned."
    }

    private func loadDetail() async {
        isLoading = true
        loadError = nil
        do {
            let loaded = try await KioskAPI.shared.kioskCheckoutDetail(id: bookingId)
            detail = loaded
            // Pre-populate already-returned items (mid-session resume).
            for item in loaded.items where item.returned {
                returnedIds.insert(item.id)
            }
        } catch {
            self.loadError = (error as? APIError)?.errorDescription ?? "Could not load return details."
        }
        isLoading = false
    }

    private func replayPendingIntentScan() {
        guard var intent = store.pendingIntent, intent.targetBooking?.id == bookingId else { return }
        let consumed = KioskFlowIntentReducer.consumePendingScans(in: intent)
        intent = consumed.intent
        store.setIntent(intent)
        for scan in consumed.scans { handleScan(scan) }
    }

    private func backToPerson() {
        if let user = store.pendingIntent?.identifiedUser { store.screen = .operatorHub(user) }
        else { store.screen = .idle }
    }
}

// MARK: - Sub-views

private extension KioskCheckoutDetail {
    var isOverdue: Bool { endsAt < Date() }
}
