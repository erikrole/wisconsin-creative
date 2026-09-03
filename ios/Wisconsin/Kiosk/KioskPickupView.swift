import SwiftUI
import UIKit

struct KioskPickupView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let bookingId: String
    let userId: String

    @State private var detail: KioskCheckoutDetail?
    @State private var confirmedIds: Set<String> = []
    @State private var lastResult: ScanFeedback?
    /// The item the last successful scan confirmed, held while its receipt is
    /// on screen. Cleared on the same timer as the feedback banner.
    @State private var lastAccepted: KioskAcceptedScan?
    @State private var feedbackDismissTask: Task<Void, Never>?
    @State private var isLoading = true
    @State private var isConfirming = false
    @State private var error: String?
    @State private var showCamera = false
    @State private var lastConfirmedId: String?
    @State private var scannerHasFocus = false
    @State private var lastScanAt: Date?
    @State private var confirmedItemOverrides: [String: KioskScanResult.ScannedItem] = [:]
    @State private var queuedScanValues: [String] = []
    @State private var earnedBadges: [EarnedBadgeReward] = []

    enum ScanFeedback: Equatable {
        case success(String)
        case error(String)
        case alreadyConfirmed(String)

        var message: String {
            switch self {
            case .success(let s), .error(let s), .alreadyConfirmed(let s): return s
            }
        }

        var tone: KioskBannerTone {
            switch self {
            case .success:          .success
            case .error:            .error
            case .alreadyConfirmed: .warning
            }
        }
    }

    private var totalItems: Int { detail?.items.count ?? 0 }
    private var confirmedCount: Int { confirmedIds.count }
    private var allConfirmed: Bool { confirmedCount >= totalItems && totalItems > 0 }
    /// BOOKED is the reservation pickup state. A legacy PENDING_PICKUP
    /// checkout remains all-or-nothing; reservation custody can be opened for
    /// the scanned subset while the source reservation stays available.
    private var canConfirmPartial: Bool {
        detail?.status == "BOOKED" && confirmedCount > 0 && !allConfirmed
    }
    private var canConfirm: Bool { allConfirmed || canConfirmPartial }
    private var batteryTotal: Int { detail?.scanSummary?.numberedBulkTotal ?? detail?.numberedBulkItems.count ?? 0 }
    private var confirmedBatteryCount: Int {
        detail?.numberedBulkItems.filter { confirmedIds.contains($0.id) }.count ?? 0
    }
    private var hasBatteryScanStep: Bool { batteryTotal > 0 }
    private var remainingBatteryCount: Int { max(0, batteryTotal - confirmedBatteryCount) }
    private var scannedBatteryUnits: [KioskScanResult.ScannedItem] {
        detail?.numberedBulkItems.compactMap { confirmedItemOverrides[$0.id] } ?? []
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
            store.scanner.claim(.pickup) { handleScan($0) }
            await loadDetail()
            replayPendingIntentScan()
        }
        .onDisappear { store.scanner.release(.pickup) }
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
                title: "Pickup",
                subtitle: detail?.title,
                onBack: { backToPerson() },
                onCamera: { showCamera = true }
            )

            Spacer()

            if isLoading {
                ProgressView().tint(KioskText.primary)
            } else {
                VStack(spacing: 24) {
                    if let lastAccepted {
                        KioskScanAcceptedView(accepted: lastAccepted, reduceMotion: reduceMotion)
                            .frame(minHeight: 288)
                    } else {
                        KioskProgressRing(
                            count: confirmedCount,
                            total: totalItems,
                            isComplete: allConfirmed,
                            reduceMotion: reduceMotion,
                            accessibilityText: "\(confirmedCount) of \(totalItems) items confirmed"
                        )
                        VStack(spacing: 6) {
                            Text(allConfirmed
                                ? "All items confirmed"
                                : canConfirmPartial
                                    ? "Ready to pick up selected items"
                                    : "Scan each item to confirm pickup")
                                .font(KioskType.actionTitle)
                                .foregroundStyle(allConfirmed ? KioskStatus.ok : KioskText.primary)
                                .multilineTextAlignment(.center)
                            if !allConfirmed {
                                Text(canConfirmPartial
                                    ? "Keep scanning to add more, or pick up the confirmed items now."
                                    : "Use the hand scanner, or tap Camera to scan with the iPad.")
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
                            count: confirmedBatteryCount,
                            total: batteryTotal,
                            pendingCopy: "Scan each battery unit QR before confirming pickup.",
                            completeCopy: "All \(batteryTotal) units scanned",
                            progressCopy: "\(confirmedBatteryCount) of \(batteryTotal) units scanned",
                            unitsHeader: "Scanned units",
                            scannedUnits: scannedBatteryUnits.map { KioskScannedUnit(id: $0.id, tag: $0.tagName) }
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

            confirmButton
        }
    }

    private var confirmButton: some View {
        KioskCompletionButton(
            title: confirmButtonTitle,
            icon: allConfirmed || canConfirmPartial ? "checkmark.circle.fill" : "barcode.viewfinder",
            isEnabled: canConfirm,
            isBusy: isConfirming,
            busyTitle: "Confirming...",
            accessibilityLabel: confirmAccessibilityLabel,
            action: confirmPickup
        )
    }

    private var confirmAccessibilityLabel: String {
        if isConfirming { return "Confirming pickup" }
        if allConfirmed { return "Confirm Pickup, \(totalItems) item\(totalItems == 1 ? "" : "s")" }
        if canConfirmPartial {
            return "Pick up \(confirmedCount) confirmed item\(confirmedCount == 1 ? "" : "s") now, or continue scanning"
        }
        if remainingBatteryCount > 0 {
            return "Scan \(remainingBatteryCount) more battery unit\(remainingBatteryCount == 1 ? "" : "s") before confirming"
        }
        let remaining = totalItems - confirmedCount
        return "Scan \(remaining) more item\(remaining == 1 ? "" : "s") before confirming"
    }

    /// Every outstanding item, not just the battery units.
    ///
    /// This used to return early on `remainingBatteryCount`, so a booking of
    /// three cameras and one battery with nothing scanned read "Scan 1 Battery
    /// Unit" — the button named a fraction of the work and silently omitted the
    /// three serialized assets also still needed. The battery card above
    /// already reports the unit sub-total; the CTA's job is the whole number.
    private var confirmButtonTitle: String {
        if allConfirmed { return "Confirm Pickup" }
        if canConfirmPartial {
            return "Pick Up \(confirmedCount) Item\(confirmedCount == 1 ? "" : "s")"
        }
        let remaining = max(0, totalItems - confirmedCount)
        return "Scan \(remaining) More Item\(remaining == 1 ? "" : "s")"
    }

    // MARK: - Checklist Panel

    private func checklistPanel(isCompact: Bool) -> some View {
        KioskSideRail(isCompact: isCompact) {
            VStack(alignment: .leading, spacing: 8) {
                Text(detail?.title ?? "Pickup")
                    .font(KioskType.sectionTitle)
                    .foregroundStyle(KioskText.primary)
                if let ref = detail?.refNumber {
                    Text(ref)
                        .font(.caption.monospaced())
                        .foregroundStyle(KioskText.secondary)
                }
                if totalItems > 0 {
                    ChecklistProgressSummary(
                        done: confirmedCount,
                        total: totalItems,
                        verb: "confirmed",
                        complete: allConfirmed
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
                                    name: confirmedItemOverrides[item.id]?.itemListSecondaryTitle
                                        ?? item.itemListSecondaryTitle
                                        ?? item.name,
                                    tag: confirmedItemOverrides[item.id]?.itemListPrimaryTitle
                                        ?? item.itemListPrimaryTitle,
                                    isDone: confirmedIds.contains(item.id),
                                    isBattery: item.isNumberedBulk
                                )
                                    .id(item.id)
                                Divider().background(KioskStroke.hairline)
                            }
                        }
                    }
                    .onChange(of: lastConfirmedId) { _, newId in
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
            } else if let error {
                // Detail-load error (not confirm error — confirm errors flow
                // through showFeedback so they appear next to the progress ring).
                KioskErrorState(title: error) { Task { await loadDetail() } }
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: - Logic

    private func handleScan(_ value: String) {
        guard !isConfirming else {
            showFeedback(.error("Hold on — confirming pickup"))
            return
        }

        store.resetInactivity()
        lastScanAt = Date()
        guard let items = detail?.items else {
            queuedScanValues.append(value)
            return
        }

        Task {
            do {
                let result = try await KioskAPI.shared.kioskPickupScan(bookingId: bookingId, actorId: userId, scanValue: value)
                earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
                if result.success, let item = result.item {
                    if confirmedIds.contains(item.id) {
                        showFeedback(.alreadyConfirmed("\(item.tagName) already confirmed"))
                    } else {
                        confirmedIds.insert(item.id)
                        confirmedItemOverrides[item.id] = item
                        lastConfirmedId = item.id
                        lastAccepted = KioskAcceptedScan(
                            title: item.itemListPrimaryTitle,
                            subtitle: item.itemListSecondaryTitle,
                            progress: "\(confirmedIds.count) of \(totalItems) confirmed"
                        )
                        showFeedback(.success(result.locationMessage ?? item.name))
                    }
                } else {
                    let isInBooking = items.contains { $0.tagName.lowercased() == value.lowercased() || $0.id == value }
                    showFeedback(.error(result.error ?? (isInBooking ? "Already confirmed" : "Not in this pickup")))
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
        case .success:          Haptics.success()
        case .alreadyConfirmed: Haptics.warning()
        case .error:            Haptics.error()
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

    private func confirmPickup() {
        guard canConfirm, !isConfirming else { return }
        let isPartial = canConfirmPartial
        isConfirming = true
        Task {
            do {
                let confirmation = try await KioskAPI.shared.kioskPickupConfirm(
                    bookingId: bookingId,
                    actorId: userId,
                    partial: isPartial
                )
                earnedBadges.appendUnique(contentsOf: confirmation.earnedBadges ?? [])
                Haptics.success()
                let itemWord = confirmedCount == 1 ? "item" : "items"
                store.screen = .success(KioskSuccessInfo(
                    kind: .pickup,
                    message: isPartial
                        ? "Partial pickup confirmed! \(confirmedCount) \(itemWord) checked out. The rest is ready for a later pickup."
                        : "Pickup confirmed! \(confirmedCount) \(itemWord) checked out.",
                    earnedBadges: earnedBadges
                ))
                store.clearIntent(reason: .success)
            } catch {
                let message = (error as? APIError)?.errorDescription
                    ?? "Could not confirm pickup. Please try again."
                showFeedback(.error(message))
            }
            isConfirming = false
        }
    }

    private func loadDetail() async {
        isLoading = true
        error = nil
        do {
            let loaded = try await KioskAPI.shared.kioskCheckoutDetail(id: bookingId)
            confirmedIds = []
            confirmedItemOverrides = [:]
            for item in loaded.items where item.returned {
                confirmedIds.insert(item.id)
                confirmedItemOverrides[item.id] = KioskScanResult.ScannedItem(
                    id: item.id,
                    name: item.name,
                    tagName: item.tagName,
                    type: item.type,
                    imageUrl: item.imageUrl,
                    bulkSkuId: item.bulkSkuId,
                    unitNumber: item.unitNumber
                )
            }
            detail = loaded
            let queued = queuedScanValues
            queuedScanValues.removeAll()
            for scan in queued { handleScan(scan) }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load pickup details."
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
