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
    @State private var scanQueue = KioskScanQueue()
    @State private var returningQuantityId: String?

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

    /// Names the owner when someone else is returning their gear, so the
    /// returner can see whose checkout this scan closes.
    private var returningForOwner: KioskUser? {
        guard let intent = store.pendingIntent, intent.targetBooking?.id == bookingId,
              let owner = intent.custodyOwner, owner.id != userId else { return nil }
        return owner
    }
    private var returnSubtitle: String? {
        guard let owner = returningForOwner else { return detail?.title }
        return [detail?.title, "Returning for \(owner.name)"].compactMap { $0 }.joined(separator: " · ")
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

    @State private var showFinishConfirm = false
    @State private var isUndoing = false

    private var returner: KioskUser? { store.pendingIntent?.identifiedUser }
    private var isShared: Bool { detail?.custodyScope == "SHARED" }
    private var section: KioskSection { isShared ? .shared : .comingBack }

    private var headerSubtitle: String {
        let name = returner.map { homeShortNames(for: [$0])[$0.id] ?? $0.name }
        if let owner = returningForOwner {
            let ownerName = homeShortNames(for: [owner])[owner.id] ?? owner.name
            return "\(name ?? "Someone") returning for \(ownerName)"
        }
        return [name, detail?.title].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        KioskTaskScaffold(header: KioskTaskHeader(
            title: "Return",
            subtitle: headerSubtitle,
            avatarURL: returner?.avatarUrl,
            avatarInitials: returner?.initials,
            onBack: { backToPerson() }
        )) {
            scanMain
        } panel: {
            comingBackPanel
        }
        .overlay {
            if showFinishConfirm {
                let stillOut = (detail?.items ?? []).filter { !returnedIds.contains($0.id) }
                KioskConfirmationCard(
                    title: stillOut.count == 1 ? "\(stillOut[0].itemListPrimaryTitle) is still out" : "\(stillOut.count) items are still out",
                    message: "\(stillOut.count == 1 ? "It stays" : "They stay") on \(returningForOwner.map { "\($0.name.split(separator: " ").first ?? "")'s" } ?? "the") checkout, due \(KioskDueCopy.midSentence(detail?.endsAt ?? Date())). Finish returning the other \(returnedCount)?",
                    cancelTitle: "Keep scanning",
                    confirmTitle: "Finish return",
                    onCancel: { showFinishConfirm = false },
                    onConfirm: {
                        showFinishConfirm = false
                        completeReturn()
                    }
                )
            }
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
                lastReturnedId = first.id
                lastAccepted = KioskAcceptedScan(
                    title: first.itemListPrimaryTitle,
                    subtitle: first.itemListSecondaryTitle,
                    progress: "\(returnedIds.count) of \(totalItems) returned"
                )
            }
            #endif
        }
        .onDisappear { scanQueue.reset(); store.scanner.release(.return) }
        .sheet(isPresented: $showCamera) {
            KioskBarcodeCameraView(
                feedbackMessage: lastResult?.message,
                feedbackTone: lastResult?.tone,
                onScan: { value in handleScan(value) },
                onCancel: { showCamera = false }
            )
        }
    }

    // MARK: - Scan area (G1, G2)

    @ViewBuilder
    private var scanMain: some View {
        if isLoading && detail == nil {
            ProgressView().tint(KioskText.primary).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loadError, detail == nil {
            KioskErrorState(title: loadError) { Task { await loadDetail() } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            stage
                .animation(KioskMotion.confirm(reduceMotion), value: lastAccepted)
            if let owner = returningForOwner {
                Text("It stays \(owner.name.split(separator: " ").first ?? "")'s checkout. The record shows who returned it.")
                    .font(KioskType.meta)
                    .foregroundStyle(KioskText.tertiary)
                    .frame(maxWidth: .infinity)
            }
            KioskPrimaryPill(
                title: "Finish return",
                detail: hasReturned ? progressDetail : nil,
                isEnabled: hasReturned && scanQueue.isEmpty,
                isBusy: isCompleting
            ) {
                if allReturned { completeReturn() } else { showFinishConfirm = true }
            }
            .accessibilityLabel(completeAccessibilityLabel)
        }
    }

    private var progressDetail: String {
        let out = max(0, totalItems - returnedCount)
        return out == 0 ? "all \(returnedCount) back" : "\(returnedCount) back · \(out) still out"
    }

    @ViewBuilder
    private var stage: some View {
        if let lastAccepted {
            KioskConfirmationStage(
                section: section,
                title: "\(lastAccepted.title) returned",
                detail: [lastAccepted.subtitle, "\(returnedCount) of \(totalItems)"].compactMap { $0 }.joined(separator: " · "),
                onUndo: isUndoing || lastReturnedId == nil ? nil : { undoLastReturn() }
            )
        } else if let lastResult, lastResult.tone != .success {
            KioskNoticeStage(
                section: lastResult.tone == .error ? .problem : .comingBack,
                overline: lastResult.tone == .error ? "Not returned" : "Already back",
                title: lastResult.message,
                message: "Scan the next item.",
                showsAlertGlyph: lastResult.tone == .error
            )
        } else {
            KioskScanPrompt(
                title: allReturned ? "Everything is back" : "Scan what's coming back",
                detail: allReturned ? "Finish the return below." : "Each item checks off in the list as you scan.",
                status: scannerStatusLine,
                section: section,
                onCamera: { showCamera = true }
            )
        }
    }

    private var scannerStatusLine: String? {
        if !store.scanner.hardwareConnected { return "Scanner is asleep. Press its trigger to wake it." }
        if !scannerHasFocus { return "Getting the scanner ready…" }
        return nil
    }

    private var completeAccessibilityLabel: String {
        if isCompleting { return "Processing return" }
        if !hasReturned { return "Scan at least one item before finishing the return" }
        if allReturned { return "Finish return, all \(totalItems) items" }
        return "Finish return, \(returnedCount) of \(totalItems) items"
    }

    private func undoLastReturn() {
        guard let id = lastReturnedId, let item = detail?.items.first(where: { $0.id == id }) else { return }
        store.resetInactivity()
        isUndoing = true
        let flow = store.flowGeneration
        Task {
            defer { if store.ownsFlow(flow) { isUndoing = false } }
            do {
                let result = try await KioskAPI.shared.kioskUndoCheckinScan(bookingId: bookingId, actorId: userId, item: item)
                guard store.ownsFlow(flow) else { return }
                if result.success {
                    returnedIds.remove(id)
                    lastReturnedId = nil
                    withAnimation { lastAccepted = nil }
                } else {
                    showFeedback(.error(result.error ?? result.message ?? "That scan can't be undone now."))
                }
            } catch {
                guard store.ownsFlow(flow) else { return }
                showFeedback(.error((error as? APIError)?.errorDescription ?? "That scan can't be undone now."))
            }
        }
    }

    // MARK: - List (coming back)

    private var comingBackPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            KioskSectionHeader(
                title: isShared ? "For the team" : "Coming back",
                detail: [returningForOwner.map { "\($0.name.split(separator: " ").first ?? "")'s checkout" } ?? detail?.title,
                         detail.map { "due \($0.endsAt.formatted(.dateTime.hour().minute()))" }].compactMap { $0 }.joined(separator: " · "),
                count: "\(returnedCount) of \(totalItems)",
                section: section
            )
            if let items = detail?.items {
                let serialized = items.filter { !$0.isNumberedBulk }
                let batteries = Dictionary(grouping: items.filter(\.isNumberedBulk), by: { $0.bulkSkuId ?? $0.name })
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(serialized.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { Rectangle().fill(KioskStroke.divider).frame(height: 1) }
                            KioskItemRow(
                                tag: item.itemListPrimaryTitle,
                                name: item.itemListSecondaryTitle,
                                isDone: returnedIds.contains(item.id),
                                section: section
                            ) {
                                if item.returnsByQuantity == true, !returnedIds.contains(item.id) {
                                    quantityReturnControl(for: item)
                                }
                            }
                        }
                        ForEach(batteries.keys.sorted(), id: \.self) { key in
                            let units = batteries[key] ?? []
                            if !serialized.isEmpty || key != batteries.keys.sorted().first {
                                Rectangle().fill(KioskStroke.divider).frame(height: 1)
                            }
                            KioskBatteryRow(
                                title: KioskBatteryCopy.familyTitle(units.first?.bulkSkuName ?? units.first?.name ?? "Batteries"),
                                scanned: units.filter { returnedIds.contains($0.id) }.count,
                                total: units.count,
                                units: units.map { .init(id: $0.id, label: $0.unitNumber.map { "#\($0)" } ?? $0.tagName, isScanned: returnedIds.contains($0.id)) },
                                section: section
                            )
                        }
                    }
                    .kioskCard()
                    .clipShape(RoundedRectangle(cornerRadius: KioskRadius.xl))
                }
                .scrollIndicators(.hidden)
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

        guard scanQueue.enqueue(value) else {
            showFeedback(.alreadyReturned("Already waiting for that scan"))
            return
        }
        processNextScanIfNeeded()
    }

    private func processNextScanIfNeeded() {
        guard detail != nil, let entry = scanQueue.next() else { return }
        let flow = store.flowGeneration
        Task {
            defer {
                scanQueue.finish(entry)
                if store.ownsFlow(flow) { processNextScanIfNeeded() }
            }
            do {
                let result = try await KioskAPI.shared.kioskCheckinScan(bookingId: bookingId, actorId: userId, scanValue: entry.value)
                guard store.ownsFlow(flow) else { return }
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
                guard store.ownsFlow(flow) else { return }
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
        guard hasReturned, !isCompleting, scanQueue.isEmpty,
              let flow = store.beginHandoff() else { return }
        isCompleting = true
        Task {
            defer { store.endHandoff(flow); isCompleting = false }
            do {
                let result = try await KioskAPI.shared.kioskCheckinComplete(bookingId: bookingId, actorId: userId)
                guard store.ownsFlow(flow) else { return }
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

    /// Counted stock has no QR per piece, so it cannot be scanned back. It
    /// used to sit unreturned forever, keeping the checkout open and overdue.
    /// One tap returns everything outstanding; fewer is in the menu.
    @ViewBuilder
    private func quantityReturnControl(for item: KioskCheckoutDetail.ReturnItem) -> some View {
        let outstanding = item.quantity ?? 0
        if returningQuantityId == item.id {
            ProgressView().tint(KioskText.primary)
        } else if outstanding > 0, let bulkSkuId = item.bulkSkuId {
            Menu {
                if outstanding > 1 {
                    ForEach((1..<min(outstanding, 20)).reversed(), id: \.self) { count in
                        Button("Return \(count) of \(outstanding)") {
                            returnQuantity(item, bulkSkuId: bulkSkuId, quantity: count, outstanding: outstanding)
                        }
                    }
                }
            } label: {
                Text(outstanding == 1 ? "Return" : "Return all \(outstanding)")
                    .font(KioskType.chip)
            } primaryAction: {
                returnQuantity(item, bulkSkuId: bulkSkuId, quantity: outstanding, outstanding: outstanding)
            }
            .kioskButtonRole(.primary)
            .controlSize(.regular)
            .disabled(returningQuantityId != nil || isCompleting)
            .accessibilityLabel("Return \(outstanding) \(item.bulkSkuName ?? item.name)")
        }
    }

    private func returnQuantity(
        _ item: KioskCheckoutDetail.ReturnItem,
        bulkSkuId: String,
        quantity: Int,
        outstanding: Int
    ) {
        store.resetInactivity()
        returningQuantityId = item.id
        let flow = store.flowGeneration
        Task {
            defer { if store.ownsFlow(flow) { returningQuantityId = nil } }
            do {
                let result = try await KioskAPI.shared.kioskReturnQuantity(
                    bookingId: bookingId,
                    actorId: userId,
                    bulkSkuId: bulkSkuId,
                    quantity: quantity,
                    expectedOutstanding: outstanding
                )
                guard store.ownsFlow(flow) else { return }
                showFeedback(.success(result.message ?? "\(quantity) returned"))
                await loadDetail()
            } catch {
                guard store.ownsFlow(flow) else { return }
                showFeedback(.error((error as? APIError)?.errorDescription ?? "Could not return that quantity."))
                await loadDetail()
            }
        }
    }

    private func loadDetail() async {
        isLoading = true
        loadError = nil
        do {
            let loaded = try await KioskAPI.shared.kioskCheckoutDetail(id: bookingId)
            guard !Task.isCancelled else { return }
            detail = loaded
            // Pre-populate already-returned items (mid-session resume).
            returnedIds = Set(loaded.items.filter(\.returned).map(\.id))
            processNextScanIfNeeded()
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
