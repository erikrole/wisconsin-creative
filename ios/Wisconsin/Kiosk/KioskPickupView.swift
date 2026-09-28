import SwiftUI
import UIKit

/// Pickup (redesign row F): scan what's reserved, with the picking-up list on
/// the right. Blue for a personal pickup (F1–F3), violet for a shared case
/// picked up for the team (F4). The receipt (F5) names what stays reserved.
struct KioskPickupView: View {
    @Environment(KioskStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let bookingId: String
    let userId: String

    @State private var detail: KioskCheckoutDetail?
    @State private var confirmedIds: Set<String> = []
    @State private var lastResult: ScanFeedback?
    /// The item the last successful scan confirmed, held while its
    /// confirmation is on screen. Cleared on the same timer as the feedback.
    @State private var lastAccepted: KioskAcceptedScan?
    /// What Undo on the current confirmation clears. Nil when the scan can't
    /// be undone here (an item just added to the plan, or a handed-over unit).
    @State private var lastUndo: PickupUndoTarget?
    @State private var feedbackDismissTask: Task<Void, Never>?
    @State private var isLoading = true
    @State private var isConfirming = false
    @State private var isUndoing = false
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
    @State private var showFinishConfirm = false

    struct PendingOffPlanAdd: Identifiable, Equatable {
        let scanValue: String
        let item: KioskScanResult.ScannedItem
        /// Set when the scan can take a remaining reserved item's place (F3).
        var replaces: KioskPickupSubstitution.NamedItem?
        var id: String { item.id }

        static func == (lhs: Self, rhs: Self) -> Bool {
            lhs.scanValue == rhs.scanValue && lhs.item.id == rhs.item.id && lhs.replaces?.id == rhs.replaces?.id
        }
    }

    private struct PendingBlockedAdd: Identifiable, Equatable {
        let message: String
        var id: String { message }
    }

    private struct PendingRemove: Identifiable {
        let item: KioskCheckoutDetail.ReturnItem
        let keepQuantity: Int?
        let label: String

        var id: String { item.id }
    }

    struct PickupUndoTarget: Equatable {
        let slotId: String
        let assetId: String?
        let bulkSkuId: String?
        let unitNumber: Int?
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
    private var isReservation: Bool { detail?.status == "BOOKED" }
    /// BOOKED is the reservation pickup state. A legacy PENDING_PICKUP
    /// checkout remains all-or-nothing; reservation custody can be opened for
    /// the scanned subset while the source reservation stays available.
    private var canConfirmPartial: Bool {
        isReservation && confirmedCount > 0 && !allConfirmed
    }
    private var hasOpenCard: Bool { pendingAdd != nil || pendingBlock != nil }
    private var canConfirm: Bool { scanQueue.isEmpty && !hasOpenCard && (allConfirmed || canConfirmPartial) }

    private var isShared: Bool { detail?.custodyScope == "SHARED" }
    private var section: KioskSection { isShared ? .shared : .pickingUp }
    private var picker: KioskUser? { store.pendingIntent?.identifiedUser }

    private var headerSubtitle: String {
        let name = picker.map { homeShortNames(for: [$0])[$0.id] ?? $0.name }
        return [name, detail?.title, isShared ? "for the team" : nil].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        KioskTaskScaffold(header: KioskTaskHeader(
            title: "Pickup",
            subtitle: headerSubtitle,
            avatarURL: picker?.avatarUrl,
            avatarInitials: picker?.initials,
            onBack: { backToPerson() }
        )) {
            scanMain
        } panel: {
            pickingUpPanel
        }
        .overlay {
            if showFinishConfirm {
                let leftovers = leftoverLabels
                KioskConfirmationCard(
                    title: "\(KioskPickupCopy.list(leftovers)) \(leftovers.count == 1 && !leftovers[0].contains("×") ? "isn't" : "aren't") scanned",
                    message: "\(leftovers.count == 1 ? "It stays" : "They stay") reserved for a later pickup. Pick up the other \(confirmedCount)?",
                    cancelTitle: "Keep scanning",
                    confirmTitle: "Pick up \(confirmedCount)",
                    onCancel: { showFinishConfirm = false },
                    onConfirm: {
                        showFinishConfirm = false
                        confirmPickup()
                    }
                )
            } else if let pending = pendingRemove {
                KioskConfirmationCard(
                    title: "Leave \(pending.label) off the reservation?",
                    message: "\(pending.label) stays on the shelf. It will not go out with this pickup.",
                    cancelTitle: "Cancel",
                    confirmTitle: "Remove remaining \(pending.label)",
                    confirmRole: .destructive,
                    onCancel: { pendingRemove = nil; processNextScanIfNeeded() },
                    onConfirm: { Task { await removeRemainingItem(pending) } }
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
            store.scanner.claim(.pickup) { handleScan($0) }
            await loadDetail()
            replayPendingIntentScan()
            #if DEBUG
            applyFixtureMoment()
            #endif
        }
        .onDisappear { scanQueue.reset(); store.scanner.release(.pickup) }
        .sheet(isPresented: $showCamera) {
            KioskBarcodeCameraView(
                feedbackMessage: lastResult?.message,
                feedbackTone: lastResult?.tone,
                onScan: { value in handleScan(value) },
                onCancel: { showCamera = false }
            )
        }
    }

    // MARK: - Scan area (F1–F4)

    @ViewBuilder
    private var scanMain: some View {
        if isLoading && detail == nil {
            ProgressView().tint(KioskText.primary).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, detail == nil {
            KioskErrorState(title: error) { Task { await loadDetail() } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            if let detail {
                KioskContextCard(title: detail.title, detail: contextLine(detail))
            }
            stage
                .animation(KioskMotion.confirm(reduceMotion), value: lastAccepted)
            bottomAction
        }
    }

    private func contextLine(_ detail: KioskCheckoutDetail) -> String {
        if isShared { return "Shared: no personal due time. It comes back with the team." }
        let due = KioskDueCopy.due(detail.endsAt)
        return isReservation ? "\(due) · from your reservation" : due
    }

    @ViewBuilder
    private var stage: some View {
        if let pending = pendingAdd {
            offPlanCard(pending)
        } else if let blocked = pendingBlock {
            KioskNoticeStage(
                section: .problem,
                overline: "Can't add this item",
                title: blocked.message,
                message: "Put it back on the shelf and scan the next item.",
                showsAlertGlyph: true
            )
        } else if let lastAccepted {
            KioskConfirmationStage(
                section: section,
                title: isShared ? "\(lastAccepted.title) picked up for the team" : "\(lastAccepted.title) picked up",
                detail: lastAccepted.subtitle,
                hint: isShared ? "It isn't on your record; the log shows you handed it over." : "Scan the next item.",
                onUndo: isUndoing || lastUndo == nil ? nil : { undoLastScan() }
            )
        } else if let lastResult, lastResult.tone != .success {
            KioskNoticeStage(
                section: lastResult.tone == .error ? .problem : section,
                overline: lastResult.tone == .error ? "Not picked up" : "Already scanned",
                title: lastResult.message,
                message: "Scan the next item.",
                showsAlertGlyph: lastResult.tone == .error
            )
        } else {
            KioskScanPrompt(
                title: allConfirmed ? "Everything is scanned" : "Scan what you're picking up",
                detail: allConfirmed ? "Pick it up below." : "Each item checks off in the list as you scan.",
                status: scannerStatusLine,
                section: section,
                onCamera: { showCamera = true }
            )
        }
    }

    /// F2 (not on the reservation) and F3 (a like-for-like replacement for a
    /// remaining reserved item), inline instead of a dialog.
    @ViewBuilder
    private func offPlanCard(_ pending: PendingOffPlanAdd) -> some View {
        let tag = pending.item.itemListPrimaryTitle
        if let reserved = pending.replaces {
            KioskNoticeStage(
                section: section,
                overline: "Swap in a replacement",
                title: "\(tag) can take \(reserved.tagName)'s place",
                message: "Both are \(reserved.name). \(tag) goes out instead, and \(reserved.tagName) comes off your reservation."
            ) {
                Spacer(minLength: 0)
                Button("Add \(tag) as an extra instead") {
                    Task { await addScannedItem(pending) }
                }
                .kioskButtonRole(.quiet)
                .disabled(isConfirming)
            }
        } else {
            KioskNoticeStage(
                section: section,
                overline: "Not on your reservation",
                title: "\(tag) isn't on this reservation",
                message: "It's free, so it can go out with the rest. Or put it back."
            )
        }
    }

    @ViewBuilder
    private var bottomAction: some View {
        if let pending = pendingAdd {
            KioskPillPair(
                secondaryTitle: "Put it back",
                primaryTitle: pending.replaces.map { "Swap for \($0.tagName)" } ?? "Add \(pending.item.itemListPrimaryTitle)",
                onSecondary: { discardOffPlan() },
                onPrimary: {
                    if pending.replaces != nil { Task { await substituteScannedItem(pending) } }
                    else { Task { await addScannedItem(pending) } }
                }
            )
            .disabled(isConfirming)
        } else if pendingBlock != nil {
            KioskPrimaryPill(title: "Put it back") {
                pendingBlock = nil
                processNextScanIfNeeded()
            }
        } else {
            KioskPrimaryPill(
                title: isShared ? "Pick up for the team" : "Pick up",
                detail: confirmedCount > 0 ? "\(confirmedCount) of \(totalItems)" : nil,
                isEnabled: canConfirm,
                isBusy: isConfirming
            ) {
                if allConfirmed { confirmPickup() } else if canConfirmPartial { showFinishConfirm = true }
            }
            .accessibilityLabel(confirmAccessibilityLabel)
        }
    }

    private var scannerStatusLine: String? {
        if !store.scanner.hardwareConnected { return "Scanner is asleep. Press its trigger to wake it." }
        if !scannerHasFocus { return "Getting the scanner ready…" }
        return nil
    }

    private var confirmAccessibilityLabel: String {
        if isConfirming { return "Confirming pickup" }
        if allConfirmed { return "Pick up \(totalItems) item\(totalItems == 1 ? "" : "s")" }
        if canConfirmPartial {
            return "Pick up \(confirmedCount) scanned item\(confirmedCount == 1 ? "" : "s"), or keep scanning"
        }
        let remaining = max(0, totalItems - confirmedCount)
        return "Scan \(remaining) more item\(remaining == 1 ? "" : "s") before picking up"
    }

    // MARK: - List (picking up)

    private var pickingUpPanel: some View {
        VStack(alignment: .leading, spacing: 6) {
            KioskSectionHeader(
                title: isShared ? "For the team" : "Picking up",
                detail: detail.map { isShared ? "\($0.title) · shared" : $0.title },
                count: "\(confirmedCount) of \(totalItems)",
                section: section
            )
            if detail?.items != nil {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array(checklistEntries.enumerated()), id: \.element.id) { index, entry in
                                if index > 0 { Rectangle().fill(KioskStroke.divider).frame(height: 1) }
                                checklistEntryView(entry)
                                    .id(entry.id)
                            }
                        }
                        .kioskCard(isShared ? section.stageFill : KioskSurface.card, stroke: isShared ? section.stageStroke : KioskStroke.hairline)
                        .clipShape(RoundedRectangle(cornerRadius: KioskRadius.xl))
                    }
                    .scrollIndicators(.hidden)
                    .onChange(of: lastConfirmedId) { _, newId in
                        guard let newId else { return }
                        let targetId = checklistScrollTarget(for: newId)
                        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) {
                            proxy.scrollTo(targetId, anchor: .center)
                        }
                    }
                }
            }
        }
    }

    /// Pickup detail payloads use one placeholder row per requested
    /// numbered unit. Those placeholders are slot IDs for the scan/confirm
    /// contract, not a list of required physical unit numbers, so the list
    /// presents them as one battery row whose numbers fill in as they scan.
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
            KioskItemRow(
                tag: confirmedItemOverrides[item.id]?.itemListPrimaryTitle ?? item.itemListPrimaryTitle,
                name: confirmedItemOverrides[item.id]?.itemListSecondaryTitle ?? item.itemListSecondaryTitle,
                isDone: confirmedIds.contains(item.id),
                section: section
            ) {
                if canRemoveRemaining(item), !isConfirming {
                    KioskRowRemoveButton(accessibilityLabel: "Remove \(item.itemListPrimaryTitle)") {
                        pendingRemove = PendingRemove(item: item, keepQuantity: nil, label: item.itemListPrimaryTitle)
                    }
                }
            }
        case .battery(let group):
            let scanned = group.items.filter { confirmedIds.contains($0.id) }.count
            HStack(alignment: .top, spacing: 0) {
                KioskBatteryRow(
                    title: KioskBatteryCopy.familyTitle(group.name),
                    scanned: scanned,
                    total: group.items.count,
                    units: batteryUnits(group),
                    // Nothing scanned against a reservation yet: there are no
                    // numbers to show, only the count.
                    note: scanned == 0 && isReservation ? "Numbers are saved as you scan them." : nil,
                    section: section
                )
                if let pending = remainingBatteryRemove(group), !isConfirming {
                    KioskRowRemoveButton(accessibilityLabel: "Remove remaining \(group.name)") {
                        pendingRemove = pending
                    }
                    .padding(.top, 8)
                    .padding(.trailing, 14)
                }
            }
        }
    }

    /// Each unit's number, filled once scanned and outlined while still to
    /// scan. A reservation's unscanned slots have no number yet — any unit
    /// works — so they show as empty outlines; a PENDING_PICKUP checkout's
    /// units are already assigned and show theirs.
    private func batteryUnits(_ group: KioskPickupBatteryChecklistGroup) -> [KioskBatteryRow.Unit] {
        let scannedCount = group.items.filter { confirmedIds.contains($0.id) }.count
        if scannedCount == 0 && isReservation { return [] }
        return group.items.map { slot in
            if confirmedIds.contains(slot.id) {
                let unit = confirmedItemOverrides[slot.id]
                return .init(id: slot.id, label: (unit?.unitNumber ?? slot.unitNumber).map { "#\($0)" } ?? unit?.tagName ?? "", isScanned: true)
            }
            let label = isReservation ? "" : slot.unitNumber.map { "#\($0)" } ?? ""
            return .init(id: slot.id, label: label, isScanned: false)
        }
    }

    /// What stays reserved if the pickup finishes now: "MIC-09", "1 × Sony Battery".
    private var leftoverLabels: [String] {
        var labels: [String] = []
        for entry in checklistEntries {
            switch entry {
            case .item(let item) where !confirmedIds.contains(item.id):
                labels.append(item.itemListPrimaryTitle)
            case .battery(let group):
                let left = group.items.filter { !confirmedIds.contains($0.id) }.count
                if left > 0 { labels.append("\(left) × \(group.name)") }
            default:
                continue
            }
        }
        return labels
    }

    // MARK: - Scanning

    private func handleScan(_ value: String) {
        // Scans that land while a card is open are queued, not dropped: the
        // queue already waits for the card, and dropping them was silent
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
                        acceptScan(item, undo: nil)
                        showFeedback(.success("Added \(item.tagName) to this pickup"))
                    } else if confirmedIds.contains(item.id) {
                        showFeedback(.alreadyConfirmed("\(item.tagName) already scanned"))
                    } else {
                        confirmedIds.insert(item.id)
                        confirmedItemOverrides[item.id] = item
                        acceptScan(item, undo: undoTarget(for: item))
                        showFeedback(.success(result.locationMessage ?? item.name))
                    }
                } else if result.errorCode == "add_available", let item = result.item {
                    presentAddOrDiscard(scanValue: entry.value, item: item, replaces: result.substitution?.reserved)
                } else if Self.blockedAddErrorCodes.contains(result.errorCode ?? "") {
                    presentBlockedAdd(result.error ?? "This item cannot be added to this pickup.")
                } else {
                    let isInBooking = items.contains { $0.tagName.lowercased() == entry.value.lowercased() || $0.id == entry.value }
                    showFeedback(.error(result.error ?? (isInBooking ? "Already scanned" : "Not in this pickup")))
                }
            } catch {
                guard store.ownsFlow(flow) else { return }
                let message = (error as? APIError)?.errorDescription ?? "Scan failed"
                showFeedback(.error(message))
            }
        }
    }

    private func acceptScan(_ item: KioskScanResult.ScannedItem, undo: PickupUndoTarget?) {
        lastConfirmedId = item.id
        lastUndo = undo
        lastAccepted = KioskAcceptedScan(
            title: acceptedTitle(item),
            subtitle: acceptedDetail(item),
            progress: "\(confirmedIds.count) of \(totalItems)"
        )
    }

    /// "CAM-022", or for a numbered unit "Sony Battery #12".
    private func acceptedTitle(_ item: KioskScanResult.ScannedItem) -> String {
        guard let number = item.unitNumber else { return item.itemListPrimaryTitle }
        let slot = detail?.items.first { $0.id == item.id }
        let base = (slot?.bulkSkuName ?? item.name)
            .replacingOccurrences(of: #"\s*#\d+$"#, with: "", options: .regularExpression)
        return "\(base) #\(number)"
    }

    private func acceptedDetail(_ item: KioskScanResult.ScannedItem) -> String {
        let progress = "\(confirmedIds.count) of \(totalItems)"
        if item.unitNumber != nil { return "Any battery works; its number is saved as you scan · \(progress)" }
        return [item.itemListSecondaryTitle, progress].compactMap { $0 }.joined(separator: " · ")
    }

    /// Serialized scans can always be undone before confirm. Numbered units
    /// only on a reservation; a PENDING_PICKUP checkout's units are assigned.
    private func undoTarget(for item: KioskScanResult.ScannedItem) -> PickupUndoTarget? {
        if let bulkSkuId = item.bulkSkuId, let unitNumber = item.unitNumber {
            guard isReservation else { return nil }
            return PickupUndoTarget(slotId: item.id, assetId: nil, bulkSkuId: bulkSkuId, unitNumber: unitNumber)
        }
        return PickupUndoTarget(slotId: item.id, assetId: item.id, bulkSkuId: nil, unitNumber: nil)
    }

    private func undoLastScan() {
        guard let target = lastUndo else { return }
        store.resetInactivity()
        isUndoing = true
        let flow = store.flowGeneration
        Task {
            defer { if store.ownsFlow(flow) { isUndoing = false } }
            do {
                let result = try await KioskAPI.shared.kioskPickupUndoScan(
                    bookingId: bookingId,
                    actorId: userId,
                    assetId: target.assetId,
                    bulkSkuId: target.bulkSkuId,
                    unitNumber: target.unitNumber
                )
                guard store.ownsFlow(flow) else { return }
                if result.success {
                    lastUndo = nil
                    withAnimation { lastAccepted = nil }
                    await loadDetail(showLoading: false)
                } else {
                    showFeedback(.error(result.error ?? result.message ?? "That scan can't be undone now."))
                }
            } catch {
                guard store.ownsFlow(flow) else { return }
                showFeedback(.error((error as? APIError)?.errorDescription ?? "That scan can't be undone now."))
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

    // MARK: - Off-plan scans (F2, F3)

    private func presentAddOrDiscard(scanValue: String, item: KioskScanResult.ScannedItem, replaces: KioskPickupSubstitution.NamedItem? = nil) {
        lastAccepted = nil
        lastResult = nil
        pendingAdd = PendingOffPlanAdd(scanValue: scanValue, item: item, replaces: replaces)
        Haptics.warning()
        KioskScanFeedbackSound.playFailure()
        UIAccessibility.post(
            notification: .announcement,
            argument: replaces.map { "\(item.itemListPrimaryTitle) can take \($0.tagName)'s place. Swap, or put it back?" }
                ?? "\(item.itemListPrimaryTitle) is not on this reservation. Add it, or put it back?"
        )
    }

    private func discardOffPlan() {
        pendingAdd = nil
        processNextScanIfNeeded()
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
                // Added items join the plan; Undo would only clear the scan
                // and leave it reserved, so the row's Remove is the way back.
                acceptScan(item, undo: nil)
                showFeedback(.success("Added \(item.tagName) to this pickup"))
            } else {
                presentBlockedAdd(result.error ?? "This item cannot be added to this pickup.")
            }
        } catch {
            let message = (error as? APIError)?.errorDescription ?? "Could not add that item. Please try again."
            presentBlockedAdd(message)
        }
    }

    private func substituteScannedItem(_ pending: PendingOffPlanAdd) async {
        guard !isConfirming, let reserved = pending.replaces else { return }
        let flow = store.flowGeneration
        isConfirming = true
        defer {
            isConfirming = false
            pendingAdd = nil
            processNextScanIfNeeded()
        }
        do {
            let result = try await KioskAPI.shared.kioskPickupSubstitute(
                bookingId: bookingId,
                actorId: userId,
                scanValue: pending.scanValue,
                reservedAssetId: reserved.id
            )
            guard store.ownsFlow(flow) else { return }
            if result.success, let item = result.item {
                await loadDetail(showLoading: false)
                acceptScan(item, undo: nil)
                showFeedback(.success("\(item.tagName) swapped in for \(reserved.tagName)"))
            } else {
                presentBlockedAdd(result.error ?? "That swap can't be made now.")
            }
        } catch {
            let message = (error as? APIError)?.errorDescription ?? "Could not swap that item. Please try again."
            presentBlockedAdd(message)
        }
    }

    // MARK: - Remove what stays on the shelf

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
        guard let reservationItemId = pending.item.reservationItemId,
              let expectedUpdatedAt = detail?.updatedAt else {
            pendingRemove = nil
            showFeedback(.error("Refresh this pickup before removing an item."))
            return
        }
        let flow = store.flowGeneration
        isConfirming = true
        defer {
            isConfirming = false
            pendingRemove = nil
            processNextScanIfNeeded()
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

    // MARK: - Confirm (F5)

    private func confirmPickup() {
        guard canConfirm, !isConfirming else { return }
        let isPartial = canConfirmPartial
        guard let flow = store.beginHandoff() else { return }
        isConfirming = true
        let scannedTags = confirmedScanTags
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
                let count = confirmation.itemCount ?? confirmedCount
                let partial = confirmation.partial ?? isPartial
                let summary = "\(count) item\(count == 1 ? "" : "s") checked out."
                store.screen = .success(KioskSuccessInfo(
                    kind: .pickup,
                    message: partial ? "\(summary) The remaining items are reserved for a later pickup." : summary,
                    earnedBadges: earnedBadges,
                    receipt: picker.flatMap { user in
                        detail.map { detail in
                            KioskPickupCopy.receipt(
                                user: user,
                                title: detail.title,
                                count: count,
                                total: partial ? totalItems : nil,
                                tags: scannedTags,
                                endsAt: isShared ? nil : detail.endsAt,
                                isShared: isShared,
                                remainingItemNames: confirmation.remainingItemNames ?? []
                            )
                        }
                    }
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

    /// "CAM-022, LENS-41, Sony Battery #12", in list order.
    private var confirmedScanTags: [String] {
        (detail?.items ?? []).filter { confirmedIds.contains($0.id) }.map { item in
            if let unit = confirmedItemOverrides[item.id] { return acceptedTitle(unit) }
            return item.itemListPrimaryTitle
        }
    }

    // MARK: - Loading

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

    #if DEBUG
    /// Capture hook: confirmations and off-plan cards only exist in the
    /// seconds after a real scan, which no fixture payload can produce.
    private func applyFixtureMoment() {
        switch KioskFixtureScenario.active {
        case .pickupAccepted, .pickupShared:
            let slot = KioskFixtureScenario.active == .pickupShared
                ? detail?.items.first { $0.tagName == "LENS-50" }
                : detail?.items.first { $0.isNumberedBulk && confirmedIds.contains($0.id) }
            guard let slot, let unit = confirmedItemOverrides[slot.id] else { return }
            lastConfirmedId = slot.id
            acceptScan(unit, undo: undoTarget(for: unit))
        case .pickupOffPlan:
            pendingAdd = PendingOffPlanAdd(
                scanValue: "MIC-12",
                item: KioskScanResult.ScannedItem(id: "mic-12", name: "Rode NTG5", tagName: "MIC-12", type: nil, imageUrl: nil, bulkSkuId: nil, unitNumber: nil)
            )
        case .pickupSubstitute:
            pendingAdd = PendingOffPlanAdd(
                scanValue: "MIC-11",
                item: KioskScanResult.ScannedItem(id: "mic-11", name: "Rode NTG5", tagName: "MIC-11", type: nil, imageUrl: nil, bulkSkuId: nil, unitNumber: nil),
                replaces: KioskPickupSubstitution.NamedItem(id: "mic-09", name: "Rode NTG5", tagName: "MIC-09")
            )
        case .pickupFinishConfirm:
            showFinishConfirm = true
        default:
            break
        }
    }
    #endif
}

/// Copy shared by the pickup screen and its receipt.
enum KioskPickupCopy {
    /// "MIC-09", "MIC-09 and 1 × Sony Battery", "A, B, and C".
    static func list(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        case 2: return "\(items[0]) and \(items[1])"
        default: return items.dropLast().joined(separator: ", ") + ", and " + (items.last ?? "")
        }
    }

    /// F5: "All set, Erik." then what went out, and — on a partial pickup —
    /// the leftover line naming what stays reserved (`remainingItemNames`).
    static func receipt(
        user: KioskUser,
        title: String,
        count: Int,
        total: Int?,
        tags: [String],
        endsAt: Date?,
        isShared: Bool,
        remainingItemNames: [String]
    ) -> KioskReceipt {
        let heading = total.map { "\(count) of \($0) · \(title)" } ?? "\(count) item\(count == 1 ? "" : "s") · \(title)"
        let detail = [tags.isEmpty ? nil : tags.joined(separator: ", "), endsAt.map { "due " + KioskDueCopy.midSentence($0) }]
            .compactMap { $0 }.joined(separator: " · ")
        let leftover = remainingItemNames.isEmpty
            ? nil
            : "\(list(remainingItemNames)) \(remainingItemNames.count == 1 && !remainingItemNames[0].contains("×") ? "stays" : "stay") reserved for a later pickup."
        let nextStep: String
        if isShared {
            nextStep = "It comes back with the team. Anyone can return it."
        } else if leftover != nil {
            nextStep = "You'll get a reminder before it's due. The rest of your reservation is still waiting here."
        } else {
            nextStep = "You'll get a reminder before it's due."
        }
        return KioskReceipt(
            firstName: String(user.name.split(separator: " ").first ?? Substring(user.name)),
            avatarURL: user.avatarUrl,
            initials: user.initials,
            cards: [KioskReceipt.Card(
                overline: isShared ? "Picked up for the team" : "Picked up",
                title: heading,
                detail: detail.isEmpty ? nil : detail,
                footnote: leftover,
                footnoteSection: leftover == nil ? nil : .comingBack
            )],
            nextStep: nextStep
        )
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
