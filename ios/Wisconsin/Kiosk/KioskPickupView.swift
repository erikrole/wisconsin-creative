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
    @State private var earnedBadges: [EarnedBadgeReward] = []
    @State private var scanQueue = KioskScanQueue()
    @State private var pendingAdd: PendingOffPlanAdd?
    @State private var pendingBlock: PendingBlockedAdd?
    @State private var pendingRemove: PendingRemove?

    private struct PendingOffPlanAdd: Identifiable {
        let scanValue: String
        let item: KioskScanResult.ScannedItem
        var id: String { item.id }
    }

    private struct PendingBlockedAdd: Identifiable {
        let message: String
        var id: String { message }
    }

    private struct PendingRemove: Identifiable {
        let item: KioskCheckoutDetail.ReturnItem
        let keepQuantity: Int?
        let label: String

        var id: String { item.id }
    }

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

    private static let blockedAddErrorCodes: Set<String> = [
        "conflict",
        "unavailable",
        "already_checked_out",
    ]

    private var totalItems: Int { detail?.items.count ?? 0 }
    private var confirmedCount: Int { confirmedIds.count }
    private var allConfirmed: Bool { confirmedCount >= totalItems && totalItems > 0 }
    /// BOOKED is the reservation pickup state. A legacy PENDING_PICKUP
    /// checkout remains all-or-nothing; reservation custody can be opened for
    /// the scanned subset while the source reservation stays available.
    private var canConfirmPartial: Bool {
        detail?.status == "BOOKED" && confirmedCount > 0 && !allConfirmed
    }
    private var canConfirm: Bool { scanQueue.isEmpty && (allConfirmed || canConfirmPartial) }
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
        .onDisappear { scanQueue.reset(); store.scanner.release(.pickup) }
        .confirmationDialog(
            "Add this item?",
            isPresented: Binding(
                get: { pendingAdd != nil },
                set: {
                    if !$0 {
                        pendingAdd = nil
                        if !isConfirming { processNextScanIfNeeded() }
                    }
                }
            ),
            titleVisibility: .visible,
            presenting: pendingAdd
        ) { pending in
            Button("Add \(pending.item.itemListPrimaryTitle)") {
                Task { await addScannedItem(pending) }
            }
            Button("Discard", role: .cancel) {
                pendingAdd = nil
                processNextScanIfNeeded()
            }
        } message: { pending in
            Text("\(pending.item.itemListPrimaryTitle) is not on this reservation. Add it to this pickup, or discard this scan?")
        }
        .confirmationDialog(
            "Can't add this item",
            isPresented: Binding(
                get: { pendingBlock != nil },
                set: {
                    if !$0 {
                        pendingBlock = nil
                        if !isConfirming { processNextScanIfNeeded() }
                    }
                }
            ),
            titleVisibility: .visible,
            presenting: pendingBlock
        ) { _ in
            Button("OK", role: .cancel) {
                pendingBlock = nil
                processNextScanIfNeeded()
            }
        } message: { blocked in
            Text(blocked.message)
        }
        .confirmationDialog(
            "Leave this off the reservation?",
            isPresented: Binding(
                get: { pendingRemove != nil },
                set: { if !$0 { pendingRemove = nil; processNextScanIfNeeded() } }
            ),
            titleVisibility: .visible,
            presenting: pendingRemove
        ) { pending in
            Button("Remove remaining \(pending.label)", role: .destructive) {
                Task { await removeRemainingItem(pending) }
            }
            Button("Cancel", role: .cancel) { pendingRemove = nil; processNextScanIfNeeded() }
        } message: { pending in
            Text("\(pending.label) stays on the shelf. It will not go out with this pickup.")
        }
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

                    if !scanQueue.isEmpty {
                        Label("Saving \(scanQueue.count) scan\(scanQueue.count == 1 ? "" : "s")…", systemImage: "arrow.triangle.2.circlepath")
                            .font(KioskType.chip)
                            .foregroundStyle(KioskStatus.active)
                    }

                    if hasBatteryScanStep {
                        KioskBatteryScanStatus(
                            title: "Battery quantity",
                            count: confirmedBatteryCount,
                            total: batteryTotal,
                            // The one place the any-unit rule is stated. The rail
                            // header and each battery row used to repeat it.
                            pendingCopy: "Scan any \(batteryTotal == 1 ? "available battery" : "\(batteryTotal) available batteries") — printed numbers don't need to match the list.",
                            completeCopy: batteryTotal == 1 ? "Battery scanned" : "All \(batteryTotal) batteries scanned",
                            progressCopy: "\(confirmedBatteryCount) of \(batteryTotal) \(batteryTotal == 1 ? "battery" : "batteries") scanned",
                            unitsHeader: "Scanned units",
                            scannedUnits: scannedBatteryUnits.map { KioskScannedUnit(id: $0.id, tag: $0.tagName) },
                            // Staged reservation units hold nothing until
                            // confirm, so one someone else took (or the wrong
                            // one) must be clearable. Handed-over units are not.
                            onReplace: detail?.status == "BOOKED" && !isConfirming
                                ? { unit in replaceStagedUnit(unit.id) }
                                : nil
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

            if detail?.items != nil {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(checklistEntries) { entry in
                                checklistEntryView(entry)
                                Divider().background(KioskStroke.hairline)
                            }
                        }
                    }
                    .onChange(of: lastConfirmedId) { _, newId in
                        guard let newId else { return }
                        let targetId = checklistScrollTarget(for: newId)
                        if reduceMotion {
                            proxy.scrollTo(targetId, anchor: .center)
                        } else {
                            withAnimation(.easeOut(duration: 0.25)) {
                                proxy.scrollTo(targetId, anchor: .center)
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

    /// Pickup detail payloads use one placeholder row per requested
    /// numbered unit. Those placeholders are slot IDs for the scan/confirm
    /// contract, not a list of required physical unit numbers, so the pickup
    /// rail presents them as one quantity group.
    private var checklistEntries: [KioskPickupChecklistEntry] {
        guard let items = detail?.items else { return [] }

        var entries: [KioskPickupChecklistEntry] = []
        var batteryEntryIndex: [String: Int] = [:]

        for item in items {
            guard item.isNumberedBulk else {
                entries.append(.item(item))
                continue
            }

            let familyName = batteryFamilyName(for: item)
            let familyKey = item.bulkSkuId ?? "name:\(familyName)"
            if let index = batteryEntryIndex[familyKey], case .battery(let group) = entries[index] {
                var updatedGroup = group
                updatedGroup.items.append(item)
                entries[index] = .battery(updatedGroup)
            } else {
                batteryEntryIndex[familyKey] = entries.count
                entries.append(.battery(KioskPickupBatteryChecklistGroup(
                    id: "battery:\(familyKey)",
                    name: familyName,
                    items: [item]
                )))
            }
        }

        return entries
    }

    private func batteryFamilyName(for item: KioskCheckoutDetail.ReturnItem) -> String {
        if let name = item.bulkSkuName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        return item.name
    }

    private func checklistScrollTarget(for itemId: String) -> String {
        for entry in checklistEntries {
            switch entry {
            case .item(let item) where item.id == itemId:
                return entry.id
            case .battery(let group) where group.items.contains(where: { $0.id == itemId }):
                return entry.id
            default:
                continue
            }
        }
        return itemId
    }

    @ViewBuilder
    private func checklistEntryView(_ entry: KioskPickupChecklistEntry) -> some View {
        switch entry {
        case .item(let item):
            HStack(spacing: 0) {
                KioskChecklistRow(
                    name: confirmedItemOverrides[item.id]?.itemListSecondaryTitle
                        ?? item.itemListSecondaryTitle
                        ?? item.name,
                    tag: confirmedItemOverrides[item.id]?.itemListPrimaryTitle
                        ?? item.itemListPrimaryTitle,
                    isDone: confirmedIds.contains(item.id)
                )
                if canRemoveRemaining(item) {
                    Button {
                        pendingRemove = PendingRemove(
                            item: item,
                            keepQuantity: nil,
                            label: item.itemListPrimaryTitle
                        )
                    } label: {
                        Image(systemName: "trash.fill")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Color.statusText(.red))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(item.itemListPrimaryTitle)")
                    .padding(.trailing, 12)
                }
            }
                .id(entry.id)
        case .battery(let group):
            HStack(spacing: 0) {
                KioskPickupBatteryChecklistRow(
                    name: group.name,
                    total: group.items.count,
                    confirmedCount: group.items.filter { confirmedIds.contains($0.id) }.count,
                    scannedTags: group.items.compactMap { confirmedItemOverrides[$0.id]?.itemListPrimaryTitle }
                )
                if let pending = remainingBatteryRemove(group) {
                    Button {
                        pendingRemove = pending
                    } label: {
                        Image(systemName: "trash.fill")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Color.statusText(.red))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove remaining \(group.name)")
                    .padding(.trailing, 12)
                }
            }
                .id(entry.id)
        }
    }

    // MARK: - Logic

    private func handleScan(_ value: String) {
        // Scans that land while a dialog is open are queued, not dropped: the
        // queue already waits for the dialog, and dropping them was silent
        // while the scanner beeped as if each had taken.
        guard !isConfirming else {
            showFeedback(.error("Hold on — confirming pickup"))
            return
        }

        store.resetInactivity()
        lastScanAt = Date()
        guard scanQueue.enqueue(value) else {
            showFeedback(.alreadyConfirmed("Already waiting for that scan"))
            return
        }
        processNextScanIfNeeded()
    }

    private func processNextScanIfNeeded() {
        guard pendingAdd == nil, pendingBlock == nil, pendingRemove == nil else { return }
        guard let items = detail?.items, let entry = scanQueue.next() else { return }
        let flow = store.flowGeneration
        Task {
            defer {
                scanQueue.finish(entry)
                if store.ownsFlow(flow) { processNextScanIfNeeded() }
            }
            do {
                let result = try await KioskAPI.shared.kioskPickupScan(bookingId: bookingId, actorId: userId, scanValue: entry.value)
                guard store.ownsFlow(flow) else { return }
                earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
                if result.success, let item = result.item {
                    if result.addedToPlan == true {
                        await loadDetail(showLoading: false)
                        lastConfirmedId = item.id
                        lastAccepted = KioskAcceptedScan(
                            title: item.itemListPrimaryTitle,
                            subtitle: item.itemListSecondaryTitle,
                            progress: "\(confirmedIds.count) of \(totalItems) confirmed"
                        )
                        showFeedback(.success("Added \(item.tagName) to this pickup"))
                    } else if confirmedIds.contains(item.id) {
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
                } else if result.errorCode == "add_available", let item = result.item {
                    presentAddOrDiscard(scanValue: entry.value, item: item)
                } else if let substitution = result.substitution {
                    presentAddOrDiscard(
                        scanValue: entry.value,
                        item: KioskScanResult.ScannedItem(
                            id: substitution.scanned.id,
                            name: substitution.scanned.name,
                            tagName: substitution.scanned.tagName,
                            type: nil,
                            imageUrl: nil,
                            bulkSkuId: nil,
                            unitNumber: nil
                        )
                    )
                } else if Self.blockedAddErrorCodes.contains(result.errorCode ?? "") {
                    presentBlockedAdd(result.error ?? "This item cannot be added to this pickup.")
                } else {
                    let isInBooking = items.contains { $0.tagName.lowercased() == entry.value.lowercased() || $0.id == entry.value }
                    showFeedback(.error(result.error ?? (isInBooking ? "Already confirmed" : "Not in this pickup")))
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
        case .success:          Haptics.success()
        case .alreadyConfirmed:
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

    private func confirmPickup() {
        guard canConfirm, !isConfirming else { return }
        let isPartial = canConfirmPartial
        guard let flow = store.beginHandoff() else { return }
        isConfirming = true
        Task {
            defer { store.endHandoff(flow); isConfirming = false }
            do {
                let confirmation = try await KioskAPI.shared.kioskPickupConfirm(
                    bookingId: bookingId,
                    actorId: userId,
                    partial: isPartial
                )
                guard store.ownsFlow(flow) else { return }
                earnedBadges.appendUnique(contentsOf: confirmation.earnedBadges ?? [])
                Haptics.success()
                let count = confirmation.itemCount
                let summary = count.map { "\($0) item\($0 == 1 ? "" : "s") checked out." } ?? "Your pickup is recorded."
                store.screen = .success(KioskSuccessInfo(
                    kind: .pickup,
                    message: (confirmation.partial ?? isPartial)
                        ? "\(summary) The remaining items are reserved for a later pickup."
                        : summary,
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

    private func presentAddOrDiscard(scanValue: String, item: KioskScanResult.ScannedItem) {
        lastAccepted = nil
        lastResult = nil
        pendingAdd = PendingOffPlanAdd(scanValue: scanValue, item: item)
        Haptics.warning()
        KioskScanFeedbackSound.playFailure()
        UIAccessibility.post(
            notification: .announcement,
            argument: "\(item.itemListPrimaryTitle) is not on this reservation. Add it, or discard?"
        )
    }

    private func presentBlockedAdd(_ message: String) {
        lastAccepted = nil
        lastResult = nil
        pendingBlock = PendingBlockedAdd(message: message)
        Haptics.error()
        KioskScanFeedbackSound.playFailure()
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func addScannedItem(_ pending: PendingOffPlanAdd) async {
        guard !isConfirming else { return }
        let flow = store.flowGeneration
        isConfirming = true
        defer {
            isConfirming = false
            pendingAdd = nil
            processNextScanIfNeeded()
        }
        do {
            let result = try await KioskAPI.shared.kioskPickupScan(
                bookingId: bookingId,
                actorId: userId,
                scanValue: pending.scanValue,
                intent: "add"
            )
            guard store.ownsFlow(flow) else { return }
            earnedBadges.appendUnique(contentsOf: result.earnedBadges ?? [])
            if result.success, let item = result.item {
                await loadDetail(showLoading: false)
                lastConfirmedId = item.id
                lastAccepted = KioskAcceptedScan(
                    title: item.itemListPrimaryTitle,
                    subtitle: item.itemListSecondaryTitle,
                    progress: "\(confirmedIds.count) of \(totalItems) confirmed"
                )
                showFeedback(.success("Added \(item.tagName) to this pickup"))
            } else {
                presentBlockedAdd(result.error ?? "This item cannot be added to this pickup.")
            }
        } catch {
            let message = (error as? APIError)?.errorDescription ?? "Could not add that item. Please try again."
            presentBlockedAdd(message)
        }
    }

    private func replaceStagedUnit(_ slotId: String) {
        guard let unit = confirmedItemOverrides[slotId],
              let bulkSkuId = unit.bulkSkuId,
              let unitNumber = unit.unitNumber else {
            showFeedback(.error("Refresh this pickup before replacing a unit."))
            return
        }
        store.resetInactivity()
        let flow = store.flowGeneration
        isConfirming = true
        Task {
            defer { if store.ownsFlow(flow) { isConfirming = false } }
            do {
                let result = try await KioskAPI.shared.kioskPickupUnstage(
                    bookingId: bookingId,
                    actorId: userId,
                    bulkSkuId: bulkSkuId,
                    unitNumber: unitNumber
                )
                guard store.ownsFlow(flow) else { return }
                await loadDetail(showLoading: false)
                showFeedback(.success(result.message ?? "\(unit.tagName) cleared. Scan the replacement."))
            } catch {
                guard store.ownsFlow(flow) else { return }
                showFeedback(.error((error as? APIError)?.errorDescription ?? "Could not clear that unit."))
            }
        }
    }

    private func canRemoveRemaining(_ item: KioskCheckoutDetail.ReturnItem) -> Bool {
        guard item.reservationItemId != nil else { return false }
        if item.isBulkQuantity { return true }
        return !confirmedIds.contains(item.id)
    }

    private func remainingBatteryRemove(_ group: KioskPickupBatteryChecklistGroup) -> PendingRemove? {
        guard let item = group.items.first(where: { $0.reservationItemId != nil }) else { return nil }
        let confirmedCount = group.items.filter { confirmedIds.contains($0.id) }.count
        guard confirmedCount < group.items.count else { return nil }
        return PendingRemove(
            item: item,
            keepQuantity: confirmedCount == 0 ? nil : confirmedCount,
            label: group.name
        )
    }

    private func removeRemainingItem(_ pending: PendingRemove) async {
        guard let reservationItemId = pending.item.reservationItemId else {
            pendingRemove = nil
            showFeedback(.error("Refresh this pickup before removing an item."))
            return
        }
        guard let expectedUpdatedAt = detail?.updatedAt else {
            pendingRemove = nil
            showFeedback(.error("Refresh this pickup before removing an item."))
            return
        }
        let flow = store.flowGeneration
        isConfirming = true
        defer {
            isConfirming = false
            pendingRemove = nil
        }
        do {
            _ = try await KioskAPI.shared.kioskUpdateReservationItem(
                id: bookingId,
                actorId: userId,
                expectedUpdatedAt: expectedUpdatedAt,
                action: pending.keepQuantity == nil ? "remove" : "quantity",
                itemId: reservationItemId,
                quantity: pending.keepQuantity
            )
            guard store.ownsFlow(flow) else { return }
            await loadDetail(showLoading: false)
            showFeedback(.success("Removed remaining \(pending.label)"))
        } catch {
            let message = (error as? APIError)?.errorDescription ?? "Could not remove that item. Please try again."
            showFeedback(.error(message))
        }
    }

    private func loadDetail(showLoading: Bool = true) async {
        if showLoading { isLoading = true }
        error = nil
        do {
            let loaded = try await KioskAPI.shared.kioskCheckoutDetail(id: bookingId)
            guard !Task.isCancelled else { return }
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
            processNextScanIfNeeded()
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

private struct KioskPickupBatteryChecklistGroup {
    let id: String
    let name: String
    var items: [KioskCheckoutDetail.ReturnItem]
}

private enum KioskPickupChecklistEntry: Identifiable {
    case item(KioskCheckoutDetail.ReturnItem)
    case battery(KioskPickupBatteryChecklistGroup)

    var id: String {
        switch self {
        case .item(let item): return item.id
        case .battery(let group): return group.id
        }
    }
}

private struct KioskPickupBatteryChecklistRow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let name: String
    let total: Int
    let confirmedCount: Int
    let scannedTags: [String]

    private var isComplete: Bool { total > 0 && confirmedCount >= total }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: isComplete ? "checkmark.circle.fill" : "battery.100percent")
                .foregroundStyle(isComplete ? Color.statusText(.green) : Color.statusText(.orange))
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(total) × \(name)")
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(isComplete ? KioskText.tertiary : KioskText.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Text("ANY UNITS")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.statusText(.orange))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.statusText(.orange).opacity(0.12), in: Capsule())
                }

                Text(isComplete
                    ? (total == 1 ? "Scanned" : "All \(total) scanned")
                    : "\(confirmedCount) of \(total) scanned")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(KioskText.secondary)



                if !scannedTags.isEmpty {
                    Text("Scanned: \(scannedTags.joined(separator: " · "))")
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(Color.statusText(.green))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 1), value: confirmedCount)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        let progress = isComplete
            ? "all \(total) battery units scanned"
            : "\(confirmedCount) of \(total) battery units scanned"
        let scanned = scannedTags.isEmpty ? "" : ", scanned \(scannedTags.joined(separator: ", "))"
        return "\(total) \(name), \(progress). Scan any available units; printed numbers do not need to match this list\(scanned)."
    }
}
