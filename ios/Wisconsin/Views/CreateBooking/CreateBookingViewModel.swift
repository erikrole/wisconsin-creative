import SwiftUI

enum BookingEventLimits {
    static let maxLinkedEvents = 5
}

/// Returns the next clean hour boundary after `now`, plus `addingHours`.
/// `addingHours: 0` → the upcoming `:00`; `addingHours: 1` → one hour after that.
private func nextCleanHour(addingHours: Int = 0) -> Date {
    let cal = Calendar.current
    let nextHour = cal.nextDate(
        after: .now,
        matching: DateComponents(minute: 0, second: 0),
        matchingPolicy: .nextTime
    ) ?? .now
    return cal.date(byAdding: .hour, value: addingHours, to: nextHour) ?? nextHour
}

struct AssetCategoryGroup: Identifiable {
    let id: String
    let title: String
    let assets: [Asset]
}

struct BatteryRecommendation: Identifiable {
    let sku: FormBulkSku
    let missingQuantity: Int
    let reason: String

    var id: String { sku.id }
    var reminderKey: String { sku.id }
}

enum ReservationPickerResult: Identifiable {
    case asset(Asset)
    case bulk(FormBulkSku)

    var id: String {
        switch self {
        case .asset(let asset): asset.id
        case .bulk(let sku): "bulk-\(sku.id)"
        }
    }

    var displayName: String {
        switch self {
        case .asset(let asset): asset.itemListPrimaryTitle
        case .bulk(let sku): sku.name
        }
    }
}

enum ReservationSubmissionPreservation: Equatable {
    case savedDraft(id: String, hasNewerUnsavedInput: Bool)
    case inMemoryOnly(errorMessage: String)

    var userMessage: String {
        switch self {
        case .savedDraft(_, let hasNewerUnsavedInput):
            if hasNewerUnsavedInput {
                return "Your original reservation was created. A snapshot of your later changes was saved as a new draft, and newer edits are still open on this device. Save again before leaving."
            }
            return "Your original reservation was created. The changes you made afterward were saved as a new draft and are still open. Review them before creating another reservation."
        case .inMemoryOnly(let errorMessage):
            return "Your original reservation was created, but the changes you made afterward could not be saved as a new draft. They are still open on this device. Save them before leaving. \(errorMessage)"
        }
    }
}

enum ReservationSubmissionOutcome: Equatable {
    case created(bookingId: String)
    case committedOriginal(
        bookingId: String,
        preservation: ReservationSubmissionPreservation
    )

    var bookingId: String {
        switch self {
        case .created(let bookingId), .committedOriginal(let bookingId, _):
            return bookingId
        }
    }
}

@MainActor
@Observable
final class CreateBookingViewModel {
    private let assetPickerLimit = 300
    private let eventPickupLeadTime: TimeInterval = 60 * 60
    private let eventReturnBuffer: TimeInterval = 2 * 60 * 60
    private let draftPersistence: any ReservationDraftPersistence
    private let performsRemoteAssetSearch: Bool

    init(
        draftPersistence: any ReservationDraftPersistence = APIClient.shared,
        performsRemoteAssetSearch: Bool = true
    ) {
        self.draftPersistence = draftPersistence
        self.performsRemoteAssetSearch = performsRemoteAssetSearch
    }

    var title = ""
    var selectedUserId: String = ""
    var selectedLocationId: String = ""
    var startsAt = nextCleanHour(addingHours: 0)
    var endsAt = nextCleanHour(addingHours: 1)
    var notes = ""
    /// Whether Details is set to link events or to enter a manual window.
    /// Lives on the composer, not the sheet, so minimizing and reopening does
    /// not silently drop the user back to Manual.
    var usesEventLinkedSetup = true
    var userEditedTitle = false
    var userEditedLocation = false
    var userEditedWindow = false

    var prefillEventId: String?
    var prefillShiftAssignmentId: String?

    /// Id of the `/api/drafts` row this composer is bound to, once it has been
    /// saved at least once. Subsequent saves update in place.
    var serverDraftId: String?

    var options: FormOptions?
    var events: [ScheduleEvent] = []
    var selectedEventIds: [String] = []
    var isLoadingOptions = false
    var isLoadingEvents = false
    var isSubmitting = false
    var error: String?
    var eventError: String?
    var onReservationSubmitted: ((String) -> Void)?

    // Equipment selection
    var selectedAssetIds: Set<String> = []
    var selectedBulkQuantities: [String: Int] = [:]
    var availableAssets: [Asset] = []
    var popularItemOrder: [String] = []
    var selectedAssetSnapshots: [String: Asset] = [:]
    var isLoadingAssets = false
    var assetSearch = ""
    var assetTotal = 0
    var assetOffset = 0
    /// Category chip filter, applied only while browsing (empty search).
    var browseCategoryFilter: String?
    var hasMoreAssets: Bool { availableAssets.count < assetTotal }
    private var searchTask: Task<Void, Never>?
    private var selectedAssetOrder: [String] = []

    // Conflict checking — non-blocking pre-flight hint against the date window.
    var conflictedAssetIds: Set<String> = []
    var submissionConflict: String?
    private var conflictCheckTask: Task<Void, Never>?
    private var conflictRequests = LatestRequestGeneration()

    func scheduleConflictCheck() {
        conflictCheckTask?.cancel()
        guard !selectedAssetIds.isEmpty, !selectedLocationId.isEmpty, endsAt > startsAt else {
            conflictRequests.invalidate()
            conflictedAssetIds = []
            return
        }
        let requestToken = conflictRequests.begin()
        let ids = Array(selectedAssetIds)
        let location = selectedLocationId
        let start = startsAt, end = endsAt
        conflictCheckTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled, conflictRequests.owns(requestToken) else { return }
            let result = await APIClient.shared.checkAvailability(
                locationId: location, serializedAssetIds: ids, startsAt: start, endsAt: end
            )
            guard !Task.isCancelled, conflictRequests.owns(requestToken) else { return }
            conflictedAssetIds = Set(result.keys)
        }
    }

    var selectedUser: FormUser? { options?.users.first(where: { $0.id == selectedUserId }) }
    var selectedLocation: FormOption? { options?.locations.first(where: { $0.id == selectedLocationId }) }
    var primaryPickupLocations: [FormOption] {
        let preferredNames = ["Camp Randall", "Kohl Center"]
        return preferredNames.compactMap { preferred in
            options?.locations.first { $0.name.localizedCaseInsensitiveContains(preferred) }
        }
    }
    var selectedEvents: [ScheduleEvent] {
        let byId = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        return selectedEventIds
            .compactMap { byId[$0] }
            .sorted { $0.startsAt < $1.startsAt }
    }
    var linkedEventCount: Int {
        if !selectedEventIds.isEmpty { return selectedEventIds.count }
        return prefillEventId == nil ? 0 : 1
    }
    var prefillEvent: ScheduleEvent? {
        guard let prefillEventId else { return nil }
        return events.first { $0.id == prefillEventId }
    }
    var linkedEventsForSetup: [ScheduleEvent] {
        selectedEvents.isEmpty ? (prefillEvent.map { [$0] } ?? []) : selectedEvents
    }
    var linkedEventLabel: String? {
        if selectedEvents.isEmpty {
            return prefillEventId == nil ? nil : "Linked to event"
        }
        if selectedEvents.count == 1 { return selectedEvents[0].shortBookingEventTitle }
        return "\(selectedEvents.count) linked events"
    }
    var selectedAssets: [Asset] {
        selectedAssetIds
            .compactMap { id in selectedAssetSnapshots[id] ?? availableAssets.first(where: { $0.id == id }) }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
    var availableAssetGroups: [AssetCategoryGroup] {
        let grouped = Dictionary(grouping: availableAssets.filter(isReservablePickerAsset)) { asset in
            let categoryName = asset.category?.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return categoryName?.isEmpty == false ? categoryName! : "Uncategorized"
        }
        return grouped
            .map { title, assets in
                AssetCategoryGroup(
                    id: title,
                    title: title,
                    assets: assets.sorted(by: compareAssetsByDisplayName)
                )
            }
            .sorted { lhs, rhs in
                if lhs.title == "Uncategorized" { return false }
                if rhs.title == "Uncategorized" { return true }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
    }
    var availableBulkSkus: [FormBulkSku] {
        let all = options?.bulkSkus ?? []
        let query = assetSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        return all.filter { sku in
                if query.isEmpty { return true }
                return sku.name.localizedCaseInsensitiveContains(query)
                    || (sku.categoryName?.localizedCaseInsensitiveContains(query) ?? false)
                    || (sku.category?.localizedCaseInsensitiveContains(query) ?? false)
            }
    }
    private static let reservationCategories = ["Cameras", "Lenses", "Batteries", "Other"]

    private func bulkCategoryTitle(_ sku: FormBulkSku) -> String {
        let name = sku.categoryName ?? sku.category
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed! : "Uncategorized"
    }

    private func isReservablePickerAsset(_ asset: Asset) -> Bool {
        !isHiddenAttachmentCategory(asset.category?.name)
    }

    private func isHiddenAttachmentCategory(_ title: String?) -> Bool {
        let normalized = title?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard let normalized, !normalized.isEmpty else { return false }
        return normalized == "accessories"
            || normalized == "camera accessories"
            || normalized.hasSuffix("/accessories")
            || normalized.hasSuffix("/camera accessories")
    }

    private var isBrowsing: Bool {
        assetSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var browseCategories: [String] {
        Self.reservationCategories
    }

    /// Asset groups the picker renders. Default browse is one flat
    /// "Most popular" section in server popularity order (same sort as the
    /// items list); a category chip switches to that category; an active
    /// search shows category-grouped matches.
    var displayedAssetGroups: [AssetCategoryGroup] {
        guard isBrowsing else { return availableAssetGroups }
        guard browseCategoryFilter != nil else {
            let rankedAssets = availableAssets.filter(isReservablePickerAsset)
            guard !rankedAssets.isEmpty else { return [] }
            return [AssetCategoryGroup(id: "most-popular", title: "Most popular", assets: rankedAssets)]
        }
        return []
    }

    /// Bulk SKUs stay out of the default browse list (they'd bury the
    /// popular gear); they surface via search or their category chip.
    var displayedBulkSkus: [FormBulkSku] {
        let visibleSkus = availableBulkSkus.filter { !isHiddenAttachmentCategory(bulkCategoryTitle($0)) }
        guard isBrowsing else { return visibleSkus }
        return []
    }

    /// Category tabs use the server's mixed popularity order so item families
    /// do not jump above serialized gear or fall into an alphabetical bucket.
    /// Other is deliberately the complement of the three named gear classes.
    var displayedCategoryResults: [ReservationPickerResult]? {
        guard isBrowsing, let filter = browseCategoryFilter else { return nil }
        let assets = availableAssets
            .filter(isReservablePickerAsset)
            .filter { reservationCategory(for: $0) == filter }
            .map(ReservationPickerResult.asset)
        let skus = availableBulkSkus
            .filter { !isHiddenAttachmentCategory(bulkCategoryTitle($0)) }
            .filter { reservationCategory(for: $0) == filter }
            .map(ReservationPickerResult.bulk)
        let rank = Dictionary(uniqueKeysWithValues: popularItemOrder.enumerated().map { ($0.element, $0.offset) })
        return (assets + skus).sorted { lhs, rhs in
            let lhsRank = rank[lhs.id] ?? Int.max
            let rhsRank = rank[rhs.id] ?? Int.max
            if lhsRank != rhsRank { return lhsRank < rhsRank }
            return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
        }
    }

    var selectedBulkSkus: [FormBulkSku] {
        let all = options?.bulkSkus ?? []
        return all
            .filter { (selectedBulkQuantities[$0.id] ?? 0) > 0 }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
    var selectedBulkTotal: Int {
        selectedBulkQuantities.values.reduce(0, +)
    }
    var selectedEquipmentCount: Int {
        selectedAssetIds.count + selectedBulkTotal
    }
    var selectedLocationMismatchCount: Int {
        let serialized = selectedAssets.filter { !isAtPickupLocation($0) }.count
        let bulk = selectedBulkSkus.reduce(0) { count, sku in
            count + (isAtPickupLocation(sku) ? 0 : quantity(for: sku))
        }
        return serialized + bulk
    }
    var canReviewEquipment: Bool {
        selectedEquipmentCount > 0 && selectedLocationMismatchCount == 0 && !isSubmitting
    }
    var batteryRecommendations: [BatteryRecommendation] {
        powerRecommendations(includeSatisfied: false)
    }
    var batterySuggestions: [BatteryRecommendation] {
        powerRecommendations(includeSatisfied: true)
    }
    var hasSelectedPower: Bool {
        selectedBulkSkus.contains { reservationCategory(for: $0) == "Batteries" }
    }

    private func powerRecommendations(includeSatisfied: Bool) -> [BatteryRecommendation] {
        let selected = selectedAssets
        let cameras = selected.filter(isCameraAsset)
        let sonyStandardCount = cameras.filter {
            $0.brand.localizedCaseInsensitiveContains("Sony")
                && !$0.model.localizedCaseInsensitiveContains("FX6")
        }.count
        let fx6Count = cameras.filter { $0.model.localizedCaseInsensitiveContains("FX6") }.count
        let monitorCount = selected.filter(isMonitorAsset).count

        let orderByAssetId = Dictionary(uniqueKeysWithValues: selectedAssetOrder.enumerated().map { ($0.element, $0.offset) })
        let fallbackOrder = selectedAssetOrder.count + selected.count
        let sonyOrder = cameras
            .filter { $0.brand.localizedCaseInsensitiveContains("Sony") && !$0.model.localizedCaseInsensitiveContains("FX6") }
            .compactMap { orderByAssetId[$0.id] }
            .min() ?? fallbackOrder
        let fx6Order = cameras
            .filter { $0.model.localizedCaseInsensitiveContains("FX6") }
            .compactMap { orderByAssetId[$0.id] }
            .min() ?? fallbackOrder + 1
        let monitorOrder = selected
            .filter(isMonitorAsset)
            .compactMap { orderByAssetId[$0.id] }
            .min() ?? fallbackOrder + 2

        return [
            (sonyOrder, batteryRecommendation(
                requiredQuantity: sonyStandardCount,
                matching: ["sony", "battery"],
                reason: sonyStandardCount == 1 ? "Recommended for the selected Sony camera" : "Recommended for the selected Sony cameras",
                includeSatisfied: includeSatisfied
            )),
            (fx6Order, batteryRecommendation(
                requiredQuantity: fx6Count,
                matching: ["gold", "mount"],
                reason: fx6Count == 1 ? "Recommended for the selected FX6" : "Recommended for the selected FX6 cameras",
                includeSatisfied: includeSatisfied
            )),
            (monitorOrder, batteryRecommendation(
                requiredQuantity: monitorCount,
                matching: ["monitor", "battery"],
                reason: monitorCount == 1 ? "Recommended for the selected monitor" : "Recommended for the selected monitors",
                includeSatisfied: includeSatisfied
            )),
        ]
        .sorted { $0.0 < $1.0 }
        .compactMap { $0.1 }
    }
    var selectedBulkRequests: [BulkReservationRequest] {
        selectedBulkQuantities
            .filter { $0.value > 0 }
            .sorted { $0.key < $1.key }
            .map { BulkReservationRequest(bulkSkuId: $0.key, quantity: $0.value) }
    }

    var isValid: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
            && !selectedUserId.isEmpty
            && !selectedLocationId.isEmpty
            && endsAt > startsAt
    }

    // MARK: - Draft state

    /// The values this composer started with: auto-filled identity and pickup
    /// location, default dates, and anything a Reserve-this-item or prep-gear
    /// entry point seeded. Exit compares against this so a prefill the user
    /// never touched does not masquerade as unsaved work.
    private struct Baseline {
        let title: String
        let notes: String
        let userId: String
        let locationId: String
        let startsAt: Date
        let endsAt: Date
        let eventIds: [String]
        let assetIds: Set<String>
        let bulkQuantities: [String: Int]
    }

    /// One source draft id is an idempotency key for exactly one immutable
    /// reservation payload. Holding that payload after an indeterminate
    /// response prevents a retry from attaching later composer edits to a
    /// reservation the server may already have committed.
    private struct ReservationSubmissionSnapshot: Equatable {
        let title: String
        let requesterUserId: String
        let locationId: String
        let startsAt: Date
        let endsAt: Date
        let notes: String?
        let eventId: String?
        let eventIds: [String]
        let shiftAssignmentId: String?
        let serializedAssetIds: [String]
        let bulkItems: [BulkReservationRequest]
    }

    private struct UncertainReservationSubmission {
        let sourceDraftId: String
        let payload: ReservationSubmissionSnapshot
    }

    /// Immutable request state for one draft write. A slow response must only
    /// baseline the values it actually sent, never newer edits made while the
    /// request was in flight.
    private struct DraftSaveSnapshot {
        let serverDraftId: String?
        let title: String
        let requesterUserId: String?
        let locationId: String?
        let startsAt: Date
        let endsAt: Date
        let notes: String?
        let eventIds: [String]
        let serializedAssetIds: [String]
        let bulkItems: [BulkReservationRequest]
        let baseline: Baseline
    }

    private var baseline: Baseline?
    private var draftSaveOperation: (id: UUID, task: Task<String, Error>)?
    private var draftSaveRequests = LatestRequestGeneration()
    private var uncertainReservationSubmission: UncertainReservationSubmission?

    /// Captures the starting values once, after identity resolves. Callers fire
    /// this from several lifecycle points because the requester arrives from
    /// either a prefill or the session; capturing before it lands would record
    /// an empty user and read the later auto-fill as an edit.
    func captureBaselineIfNeeded() {
        guard baseline == nil, !selectedUserId.isEmpty else { return }
        baseline = currentBaseline()
    }

    private func currentBaseline() -> Baseline {
        Baseline(
            title: title,
            notes: notes,
            userId: selectedUserId,
            locationId: selectedLocationId,
            startsAt: startsAt,
            endsAt: endsAt,
            eventIds: draftEventIds,
            assetIds: selectedAssetIds,
            bulkQuantities: selectedBulkQuantities
        )
    }

    private var draftEventIds: [String] {
        if !selectedEventIds.isEmpty {
            return selectedEventIds
        }
        return prefillEventId.map { [$0] } ?? []
    }

    private func currentDraftSaveSnapshot() -> DraftSaveSnapshot {
        DraftSaveSnapshot(
            serverDraftId: serverDraftId,
            title: title.trimmingCharacters(in: .whitespaces),
            requesterUserId: selectedUserId,
            locationId: selectedLocationId,
            startsAt: startsAt,
            endsAt: endsAt,
            notes: notes.isEmpty ? nil : notes,
            eventIds: draftEventIds,
            serializedAssetIds: selectedAssetIds.sorted(),
            bulkItems: selectedBulkRequests,
            baseline: currentBaseline()
        )
    }

    /// True when the composer holds work the user would miss. Before the
    /// baseline is captured there is nothing to diff against, so any content at
    /// all counts as unsaved.
    var hasUnsavedInput: Bool {
        guard let baseline else {
            if !title.trimmingCharacters(in: .whitespaces).isEmpty { return true }
            if !notes.isEmpty { return true }
            if userEditedLocation || userEditedWindow { return true }
            if !selectedEventIds.isEmpty { return true }
            if !selectedAssetIds.isEmpty { return true }
            if selectedBulkTotal > 0 { return true }
            return false
        }
        if title != baseline.title { return true }
        if notes != baseline.notes { return true }
        if selectedUserId != baseline.userId { return true }
        if selectedLocationId != baseline.locationId { return true }
        if startsAt != baseline.startsAt { return true }
        if endsAt != baseline.endsAt { return true }
        if draftEventIds != baseline.eventIds { return true }
        if selectedAssetIds != baseline.assetIds { return true }
        if selectedBulkQuantities != baseline.bulkQuantities { return true }
        return false
    }

    /// Every server-backed field that differs from the starting state is worth
    /// preserving. A pristine new composer remains row-free, while an existing
    /// server draft remains a real draft even when it has no newer edits.
    var isWorthSavingAsDraft: Bool {
        serverDraftId != nil || hasUnsavedInput
    }

    /// One-line description of the composer for the minimized card.
    var draftSummaryLine: String {
        var parts: [String] = []
        let count = selectedEquipmentCount
        parts.append(count == 0 ? "No gear yet" : "\(count) item\(count == 1 ? "" : "s")")
        parts.append(startsAt.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
        return parts.joined(separator: " · ")
    }

    var draftDisplayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "New Reservation" : trimmed
    }

    /// Saves the composer through the shared `/api/drafts` contract and rebinds
    /// to the returned row so later saves update rather than duplicate. All
    /// callers join the same in-flight write, preventing two nil-id saves from
    /// creating separate rows.
    @discardableResult
    func saveDraft() async throws -> String {
        try await saveDraft(allowDuringSubmission: false)
    }

    @discardableResult
    private func saveDraft(allowDuringSubmission: Bool) async throws -> String {
        if let existing = draftSaveOperation {
            return try await existing.task.value
        }
        guard allowDuringSubmission || !isSubmitting else {
            throw APIError.serverError("This reservation is already being created.")
        }

        let snapshot = currentDraftSaveSnapshot()
        let operationId = UUID()
        let requestToken = draftSaveRequests.begin()
        let persistence = draftPersistence
        let task = Task { @MainActor [self] in
            let id = try await persistence.saveBookingDraft(
                id: snapshot.serverDraftId,
                title: snapshot.title,
                requesterUserId: snapshot.requesterUserId,
                locationId: snapshot.locationId,
                startsAt: snapshot.startsAt,
                endsAt: snapshot.endsAt,
                notes: snapshot.notes,
                eventIds: snapshot.eventIds,
                serializedAssetIds: snapshot.serializedAssetIds,
                bulkItems: snapshot.bulkItems
            )
            try Task.checkCancellation()
            guard draftSaveRequests.owns(requestToken) else {
                throw CancellationError()
            }
            serverDraftId = id
            baseline = snapshot.baseline
            return id
        }
        draftSaveOperation = (operationId, task)

        do {
            let id = try await task.value
            if draftSaveOperation?.id == operationId {
                draftSaveOperation = nil
            }
            if draftSaveRequests.owns(requestToken) {
                draftSaveRequests.invalidate()
            }
            return id
        } catch {
            if draftSaveOperation?.id == operationId {
                draftSaveOperation = nil
            }
            if draftSaveRequests.owns(requestToken) {
                draftSaveRequests.invalidate()
            }
            throw error
        }
    }

    /// A session boundary owns cancellation, but cancellation alone is
    /// advisory. Invalidating the request generation prevents a delayed save
    /// response from rebinding a composer that belonged to the prior account.
    func cancelDraftPersistenceForSessionBoundary() {
        draftSaveOperation?.task.cancel()
        draftSaveOperation = nil
        draftSaveRequests.invalidate()
    }

    /// Existing server ids are permanent replay keys and must not be rewritten:
    /// after a lost create response the source row is already consumed, so a
    /// retry has to POST the same id for the server's audit-backed replay path.
    /// A never-saved composer first creates its source row and cannot POST
    /// without that server-issued id.
    private func sourceDraftIdForSubmission() async throws -> String {
        if let existing = draftSaveOperation {
            return try await existing.task.value
        }
        if let serverDraftId {
            return serverDraftId
        }
        return try await saveDraft(allowDuringSubmission: true)
    }

    /// Rehydrates a saved draft. Event links restore by id and resolve once
    /// `loadEvents()` returns; the user-edited flags are set so that resolution
    /// cannot overwrite the title or window the user already chose.
    func applyDraft(_ draft: BookingDraftDetail) async {
        serverDraftId = draft.id
        title = draft.title == "Untitled draft" ? "" : draft.title
        userEditedTitle = !title.isEmpty
        if let requesterUserId = draft.requesterUserId { selectedUserId = requesterUserId }
        if let locationId = draft.locationId {
            selectedLocationId = locationId
            userEditedLocation = true
        }
        startsAt = draft.startsAt
        endsAt = draft.endsAt
        userEditedWindow = true
        notes = draft.notes
        selectedEventIds = draft.linkedEventIds
        usesEventLinkedSetup = !draft.linkedEventIds.isEmpty
        prefillEventId = nil
        prefillShiftAssignmentId = nil
        selectedAssetIds = Set(draft.serializedAssetIds)
        selectedAssetOrder = draft.serializedAssetIds
        selectedBulkQuantities = Dictionary(
            draft.bulkItems.map { ($0.bulkSkuId, $0.quantity) },
            uniquingKeysWith: { _, later in later }
        )
        await loadSnapshotsForSelectedAssets(ids: draft.serializedAssetIds)
        baseline = currentBaseline()
    }

    /// Restores display rows for saved gear so Review and the cart read
    /// correctly before the picker's paged asset list has loaded.
    private func loadSnapshotsForSelectedAssets(ids: [String]) async {
        let missing = ids.filter { selectedAssetSnapshots[$0] == nil }
        guard !missing.isEmpty else { return }
        await withTaskGroup(of: Asset?.self) { group in
            for id in missing {
                group.addTask {
                    try? await APIClient.shared.asset(id: id).asAsset
                }
            }
            for await asset in group {
                guard let asset else { continue }
                selectedAssetSnapshots[asset.id] = asset
            }
        }
    }

    /// Pickup and return are independent operational decisions. Moving pickup
    /// must not silently drag a return time the user already reviewed.
    func adjustStart(to newStart: Date) {
        submissionConflict = nil
        userEditedWindow = true
        startsAt = newStart
        scheduleConflictCheck()
    }

    func adjustEnd(to newEnd: Date) {
        submissionConflict = nil
        userEditedWindow = true
        endsAt = newEnd
        scheduleConflictCheck()
    }

    /// Currently unreferenced, and kept deliberately.
    ///
    /// Event detail was its only caller until gear moved off that screen. This
    /// is the sole path that stamps `shiftAssignmentId` on a new reservation —
    /// the precise "this booking is for *this person's* shift" link, as opposed
    /// to the event link the composer's own picker still sets. Nothing is broken
    /// without it (my-shifts resolves gear through the event paths, and web's
    /// Missing Gear keys on requester, not assignment), but the web crew row's
    /// per-assignment `linkedBookingId` stays null for iOS-created reservations.
    /// Deleting this would foreclose restoring that link.
    func prefill(title: String, startsAt: Date, endsAt: Date, userId: String, eventId: String?, shiftAssignmentId: String?) {
        self.title = title
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.selectedUserId = userId
        self.prefillEventId = eventId
        self.prefillShiftAssignmentId = shiftAssignmentId
        self.usesEventLinkedSetup = eventId != nil
    }

    func loadEvents() async {
        guard events.isEmpty else { return }
        isLoadingEvents = true
        eventError = nil
        do {
            events = try await APIClient.shared.calendarEvents(includePast: false, limit: 60)
            if selectedEventIds.isEmpty, let prefillEvent, !userEditedWindow {
                applyDefaultEventWindow([prefillEvent])
            }
        } catch {
            eventError = error.localizedDescription
        }
        isLoadingEvents = false
    }

    func toggleEvent(_ event: ScheduleEvent) {
        if selectedEventIds.isEmpty, prefillEventId == event.id {
            prefillEventId = nil
            prefillShiftAssignmentId = nil
        } else if selectedEventIds.contains(event.id) {
            selectedEventIds.removeAll { $0 == event.id }
        } else {
            guard selectedEventIds.count < BookingEventLimits.maxLinkedEvents else {
                Haptics.warning()
                return
            }
            selectedEventIds.append(event.id)
        }
        sortSelectedEventIds()
        applySelectedEventsToDetails()
        Haptics.selection()
    }

    func removeSelectedEvent(_ event: ScheduleEvent) {
        selectedEventIds.removeAll { $0 == event.id }
        applySelectedEventsToDetails()
    }

    func unlinkEvents() {
        selectedEventIds = []
        prefillEventId = nil
        prefillShiftAssignmentId = nil
        submissionConflict = nil
        if !userEditedTitle {
            title = ""
        }
    }

    func setTitleFromUser(_ value: String) {
        userEditedTitle = true
        title = value
    }

    func setLocationFromUser(_ value: String) {
        submissionConflict = nil
        userEditedLocation = true
        selectedLocationId = value
    }

    private func sortSelectedEventIds() {
        let byId = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        selectedEventIds.sort {
            (byId[$0]?.startsAt ?? .distantFuture) < (byId[$1]?.startsAt ?? .distantFuture)
        }
    }

    private func applySelectedEventsToDetails() {
        let picked = selectedEvents
        guard let first = picked.first else {
            if !userEditedTitle {
                title = ""
            }
            return
        }
        if !userEditedTitle || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            title = first.shortBookingEventTitle
            userEditedTitle = false
        }
        if !userEditedWindow {
            applyDefaultEventWindow(picked)
        }
        prefillEventId = nil
        prefillShiftAssignmentId = nil
        submissionConflict = nil
        scheduleConflictCheck()
    }

    private func applyDefaultEventWindow(_ picked: [ScheduleEvent]) {
        guard let first = picked.first, let last = picked.last else { return }
        startsAt = first.startsAt.addingTimeInterval(-eventPickupLeadTime)
        endsAt = last.endsAt.addingTimeInterval(eventReturnBuffer)
    }

    /// Prefills a reservation context started from an item row.
    /// Sets a sensible title, preselects the asset, and seeds the equipment list
    /// so the asset is visible at the top of step 2.
    func prefillReservation(for asset: Asset) {
        // Reserving a specific item is an ad-hoc need, not event prep.
        usesEventLinkedSetup = false
        if title.isEmpty {
            title = "Reservation: \(asset.displayName)"
        }
        selectedAssetIds.insert(asset.id)
        recordAssetSelection(asset.id)
        selectedAssetSnapshots[asset.id] = asset
        if !availableAssets.contains(where: { $0.id == asset.id }) {
            availableAssets.insert(asset, at: 0)
            if assetTotal == 0 { assetTotal = 1 }
        }
        // Pre-seed the location to the asset's home location if nothing is set yet.
        if selectedLocationId.isEmpty {
            selectedLocationId = asset.location.id
        }
    }

    /// Prefills a reservation context started from a bulk-item family (e.g.
    /// a scanned battery unit). Seeds one unit of the SKU; the equipment step
    /// resolves the SKU details once form options load.
    func prefillReservation(forFamily family: AssetFamilySearchResult) {
        usesEventLinkedSetup = false
        if title.isEmpty {
            title = "Reservation: \(family.name)"
        }
        if (selectedBulkQuantities[family.id] ?? 0) == 0 {
            selectedBulkQuantities[family.id] = 1
        }
        if selectedLocationId.isEmpty {
            selectedLocationId = family.locationId
        }
    }

    func loadOptions() async {
        guard options == nil else { return }
        isLoadingOptions = true
        do {
            options = try await APIClient.shared.formOptions()
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingOptions = false
    }

    func loadAvailableAssets(reset: Bool = false) async {
        // Search-driven resets must still pass through while an older request
        // is in flight, then the snapshot guard below drops stale responses.
        if !reset, isLoadingAssets { return }
        let capturedSearch = assetSearch
        if reset {
            availableAssets = []
            popularItemOrder = []
            assetOffset = 0
            assetTotal = 0
            error = nil
        }
        isLoadingAssets = true
        defer { isLoadingAssets = false }
        do {
            let resp = try await APIClient.shared.assets(
                search: capturedSearch.isEmpty ? nil : capturedSearch,
                statuses: [.available],
                locationId: nil,
                // Browse leads with what actually gets reserved; searches
                // stay alphabetical so results scan predictably.
                sort: capturedSearch.isEmpty ? "popular" : "name",
                limit: assetPickerLimit,
                offset: 0
            )
            // Stale-write guard: drop the response if the user has typed more
            // since this request was started. Mirrors the global-search fix.
            guard capturedSearch == assetSearch else { return }
            availableAssets = resp.data
            popularItemOrder = resp.itemOrder
            for asset in resp.data where selectedAssetIds.contains(asset.id) {
                selectedAssetSnapshots[asset.id] = asset
            }
            assetTotal = resp.total
            assetOffset = resp.data.count
        } catch {
            guard capturedSearch == assetSearch else { return }
            self.error = error.localizedDescription
        }
    }

    /// Adds an asset from a picker result (idempotent). Removal goes through
    /// `toggleAsset`/`removeSelectedAsset` so tap-to-add never un-picks.
    func addAsset(_ asset: Asset) {
        guard isAtPickupLocation(asset) else { return }
        submissionConflict = nil
        selectedAssetIds.insert(asset.id)
        recordAssetSelection(asset.id)
        selectedAssetSnapshots[asset.id] = asset
        scheduleConflictCheck()
    }

    func toggleAsset(_ asset: Asset) {
        submissionConflict = nil
        if selectedAssetIds.contains(asset.id) {
            selectedAssetIds.remove(asset.id)
            selectedAssetOrder.removeAll { $0 == asset.id }
            selectedAssetSnapshots.removeValue(forKey: asset.id)
        } else {
            selectedAssetIds.insert(asset.id)
            recordAssetSelection(asset.id)
            selectedAssetSnapshots[asset.id] = asset
        }
        scheduleConflictCheck()
    }

    func removeSelectedAsset(_ asset: Asset) {
        submissionConflict = nil
        selectedAssetIds.remove(asset.id)
        selectedAssetOrder.removeAll { $0 == asset.id }
        selectedAssetSnapshots.removeValue(forKey: asset.id)
        scheduleConflictCheck()
    }

    func quantity(for sku: FormBulkSku) -> Int {
        selectedBulkQuantities[sku.id] ?? 0
    }

    func setBulkQuantity(_ sku: FormBulkSku, quantity: Int) {
        submissionConflict = nil
        let clamped = min(max(quantity, 0), max(sku.availableQuantity, 0))
        if clamped == 0 {
            selectedBulkQuantities.removeValue(forKey: sku.id)
        } else {
            selectedBulkQuantities[sku.id] = clamped
        }
    }

    func incrementBulk(_ sku: FormBulkSku) {
        setBulkQuantity(sku, quantity: quantity(for: sku) + 1)
    }

    func decrementBulk(_ sku: FormBulkSku) {
        setBulkQuantity(sku, quantity: quantity(for: sku) - 1)
    }

    func removeSelectedBulk(_ sku: FormBulkSku) {
        selectedBulkQuantities.removeValue(forKey: sku.id)
    }

    /// Adds a scanned serialized asset and reports the outcome so the scanner
    /// can stay open (continuous scanning) and show an in-scanner banner.
    func addScannedAsset(id: String) async -> (message: String, success: Bool) {
        do {
            let detail = try await APIClient.shared.asset(id: id)
            let asset = detail.asAsset
            guard asset.computedStatus == .available else {
                return ("\(asset.displayName) is \(asset.computedStatus.label.lowercased()).", false)
            }
            guard isAtPickupLocation(asset) else {
                return ("\(asset.displayName) is at \(asset.location.name). Change the pickup location to add it.", false)
            }
            if selectedAssetIds.contains(asset.id) {
                return ("\(asset.displayName) is already in this reservation.", true)
            }
            submissionConflict = nil
            selectedAssetIds.insert(asset.id)
            recordAssetSelection(asset.id)
            selectedAssetSnapshots[asset.id] = asset
            if !availableAssets.contains(where: { $0.id == asset.id }) {
                availableAssets.insert(asset, at: 0)
                assetTotal = max(assetTotal, availableAssets.count)
            }
            scheduleConflictCheck()
            return ("Added \(asset.displayName)", true)
        } catch {
            return (error.localizedDescription, false)
        }
    }

    /// Adds one unit of a scanned bulk family (e.g. a battery bin code).
    func addScannedFamily(_ family: AssetFamilySearchResult) -> (message: String, success: Bool) {
        guard let sku = options?.bulkSkus.first(where: { $0.id == family.id }) else {
            return ("\(family.name) can't be reserved from this location.", false)
        }
        guard isAtPickupLocation(sku) else {
            return ("\(family.name) is at \(locationName(for: sku)). Change the pickup location to add it.", false)
        }
        let current = quantity(for: sku)
        guard current < sku.availableQuantity else {
            return ("All \(sku.availableQuantity) available \(sku.name) are already selected.", false)
        }
        setBulkQuantity(sku, quantity: current + 1)
        return ("Added \(sku.name) (\(current + 1) selected)", true)
    }

    func onSearchChange() {
        searchTask?.cancel()
        guard performsRemoteAssetSearch else { return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await loadAvailableAssets(reset: true)
        }
    }

    func submit() async throws -> ReservationSubmissionOutcome {
        guard !isSubmitting else {
            throw APIError.serverError("This reservation is already being created.")
        }
        isSubmitting = true
        defer { isSubmitting = false }

        if let uncertainReservationSubmission {
            return try await submit(
                uncertainReservationSubmission.payload,
                sourceDraftId: uncertainReservationSubmission.sourceDraftId,
                recordsUncertainFailure: false
            )
        }

        guard !selectedUserId.isEmpty, !selectedLocationId.isEmpty else {
            throw APIError.serverError("Select a requester and location.")
        }
        guard selectedLocationMismatchCount == 0 else {
            throw APIError.serverError("Remove gear from another pickup location before creating this reservation.")
        }

        let payload = currentReservationSubmissionSnapshot()
        let sourceDraftId = try await sourceDraftIdForSubmission()
        return try await submit(
            payload,
            sourceDraftId: sourceDraftId,
            recordsUncertainFailure: true
        )
    }

    private func currentReservationSubmissionSnapshot() -> ReservationSubmissionSnapshot {
        ReservationSubmissionSnapshot(
            title: title.trimmingCharacters(in: .whitespaces),
            requesterUserId: selectedUserId,
            locationId: selectedLocationId,
            startsAt: startsAt,
            endsAt: endsAt,
            notes: notes.isEmpty ? nil : notes,
            eventId: selectedEventIds.isEmpty ? prefillEventId : nil,
            eventIds: selectedEventIds,
            shiftAssignmentId: prefillShiftAssignmentId,
            serializedAssetIds: selectedAssetIds.sorted(),
            bulkItems: selectedBulkRequests
        )
    }

    private func submit(
        _ payload: ReservationSubmissionSnapshot,
        sourceDraftId: String,
        recordsUncertainFailure: Bool
    ) async throws -> ReservationSubmissionOutcome {
        do {
            let id = try await draftPersistence.createReservation(
                title: payload.title,
                requesterUserId: payload.requesterUserId,
                locationId: payload.locationId,
                startsAt: payload.startsAt,
                endsAt: payload.endsAt,
                notes: payload.notes,
                eventId: payload.eventId,
                eventIds: payload.eventIds,
                shiftAssignmentId: payload.shiftAssignmentId,
                sourceDraftId: sourceDraftId,
                serializedAssetIds: payload.serializedAssetIds,
                bulkItems: payload.bulkItems
            )
            return await finishCommittedSubmission(id: id, payload: payload)
        } catch APIError.conflict(let message) {
            submissionConflict = message
            throw APIError.conflict(message)
        } catch {
            if recordsUncertainFailure, responseMayHaveCommitted(error) {
                uncertainReservationSubmission = UncertainReservationSubmission(
                    sourceDraftId: sourceDraftId,
                    payload: payload
                )
            }
            throw error
        }
    }

    private func responseMayHaveCommitted(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else {
            return true
        }
        switch apiError {
        case .networkError, .decodingError, .sessionChanged, .serverError:
            return true
        case .httpError(let statusCode, _):
            return (500...599).contains(statusCode)
        case .unauthorized, .notFound, .conflict:
            return false
        }
    }

    private func finishCommittedSubmission(
        id: String,
        payload: ReservationSubmissionSnapshot
    ) async -> ReservationSubmissionOutcome {
        uncertainReservationSubmission = nil
        submissionConflict = nil

        // The route consumes this draft in the creation transaction. Detach it
        // before preserving any edits made after the submitted snapshot.
        serverDraftId = nil

        guard currentReservationSubmissionSnapshot() != payload else {
            onReservationSubmitted?(id)
            return .created(bookingId: id)
        }

        do {
            let draftId = try await saveDraft(allowDuringSubmission: true)
            return .committedOriginal(
                bookingId: id,
                preservation: .savedDraft(
                    id: draftId,
                    hasNewerUnsavedInput: hasUnsavedInput
                )
            )
        } catch {
            return .committedOriginal(
                bookingId: id,
                preservation: .inMemoryOnly(errorMessage: error.localizedDescription)
            )
        }
    }

    private func compareAssetsByDisplayName(_ lhs: Asset, _ rhs: Asset) -> Bool {
        let nameOrder = lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName)
        if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
        return (lhs.assetTag ?? "").localizedStandardCompare(rhs.assetTag ?? "") == .orderedAscending
    }

    private func recordAssetSelection(_ id: String) {
        if !selectedAssetOrder.contains(id) {
            selectedAssetOrder.append(id)
        }
    }

    func isAtPickupLocation(_ asset: Asset) -> Bool {
        selectedLocationId.isEmpty || asset.location.id == selectedLocationId
    }

    func isAtPickupLocation(_ sku: FormBulkSku) -> Bool {
        selectedLocationId.isEmpty || sku.locationId == nil || sku.locationId == selectedLocationId
    }

    func locationName(for sku: FormBulkSku) -> String {
        guard let locationId = sku.locationId else { return "All locations" }
        return options?.locations.first(where: { $0.id == locationId })?.name ?? "Another location"
    }

    func addRecommendation(_ recommendation: BatteryRecommendation) {
        let current = quantity(for: recommendation.sku)
        setBulkQuantity(
            recommendation.sku,
            quantity: current + recommendation.missingQuantity
        )
    }

    private func reservationCategory(for asset: Asset) -> String {
        reservationCategory(from: [asset.category?.name, asset.brand, asset.model, asset.name])
    }

    private func reservationCategory(for sku: FormBulkSku) -> String {
        reservationCategory(from: [sku.categoryName, sku.category, sku.name])
    }

    private func reservationCategory(from values: [String?]) -> String {
        let text = values.compactMap { $0 }.joined(separator: " ").lowercased()
        if text.contains("camera") || text.contains("camcorder") || text.contains("cinema body") { return "Cameras" }
        if text.contains("lens") { return "Lenses" }
        if text.contains("battery") || text.contains("power") { return "Batteries" }
        return "Other"
    }

    private func isCameraAsset(_ asset: Asset) -> Bool {
        reservationCategory(for: asset) == "Cameras"
    }

    private func isMonitorAsset(_ asset: Asset) -> Bool {
        [asset.category?.name, asset.name, asset.brand, asset.model]
            .compactMap { $0 }
            .joined(separator: " ")
            .localizedCaseInsensitiveContains("monitor")
    }

    private func batteryRecommendation(
        requiredQuantity: Int,
        matching terms: [String],
        reason: String,
        includeSatisfied: Bool
    ) -> BatteryRecommendation? {
        guard requiredQuantity > 0 else { return nil }
        let candidates = (options?.bulkSkus ?? []).filter { sku in
            guard isAtPickupLocation(sku) else { return false }
            let text = [sku.name, sku.categoryName, sku.category]
                .compactMap { $0 }
                .joined(separator: " ")
                .lowercased()
            return terms.allSatisfy { text.contains($0) }
        }
        guard let sku = candidates.max(by: { $0.availableQuantity < $1.availableQuantity }) else { return nil }
        let missing = max(0, requiredQuantity - quantity(for: sku))
        guard sku.availableQuantity > quantity(for: sku) else { return nil }
        guard includeSatisfied || missing > 0 else { return nil }
        return BatteryRecommendation(
            sku: sku,
            missingQuantity: min(max(missing, 0), sku.availableQuantity - quantity(for: sku)),
            reason: reason
        )
    }
}
