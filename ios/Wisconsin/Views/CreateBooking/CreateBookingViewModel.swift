import SwiftUI

enum BookingEventLimits {
    static let maxLinkedEvents = 5
}

private enum ReservationAvailabilityThresholds {
    static let serializedTurnaroundBuffer: TimeInterval = 60 * 60
    static let warningWindow: TimeInterval = 12 * 60 * 60
    static let criticalWindow: TimeInterval = 2 * 60 * 60
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

/// Person-first availability line on Gear and Review.
/// Reservations stay purple; someone who already has the item stays red.
struct ReservationAvailabilityCaption: Equatable {
    enum Kind: Equatable {
        case reserved
        case held
    }

    let text: String
    let kind: Kind

    var tone: StatusTone { kind == .reserved ? .purple : .red }

    static func make(
        requesterName: String?,
        kind: String?,
        status: String?,
        startsAt: Date?,
        endsAt: Date?,
        now: Date = .now
    ) -> ReservationAvailabilityCaption? {
        let person = requesterName.nonBlankText
        if isCheckoutHold(kind: kind, status: status, startsAt: startsAt, endsAt: endsAt, now: now) {
            guard let until = endsAt else { return nil }
            let when = until.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
            let text = person.map { "\($0) has this item until \(when)." }
                ?? "This item is out until \(when)."
            return ReservationAvailabilityCaption(text: text, kind: .held)
        }
        guard let reservedAt = startsAt else { return nil }
        let when = reservedAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false)
        let text = person.map { "\($0) has reserved for \(when)." }
            ?? "Reserved for \(when)."
        return ReservationAvailabilityCaption(text: text, kind: .reserved)
    }

    private static func isCheckoutHold(
        kind: String?,
        status: String?,
        startsAt: Date?,
        endsAt: Date?,
        now: Date
    ) -> Bool {
        let status = status?.uppercased()
        let kind = kind?.uppercased()
        if status == "OPEN" || status == "PENDING_PICKUP" { return true }
        if kind == "CHECKOUT" && status != "BOOKED" {
            return true
        }
        // List rows for an in-progress reservation omit the start. That hold
        // still runs through its return, same as a checkout.
        if kind == "RESERVATION" && status == "BOOKED" && startsAt == nil {
            return true
        }
        if status == nil && kind == nil, let startsAt, let endsAt {
            return startsAt <= now && endsAt > now
        }
        return false
    }
}

/// Gear that is out, staged, or already reserved can still be added when the
/// current hold ends at least 60 minutes before this pickup. Maintenance,
/// retired, and unknown states stay blocked, and a known overlap always wins.
func canReserveSerializedAssetForWindow(
    computedStatus: AssetComputedStatus,
    holderEndsAt: Date?,
    requestedStartsAt: Date,
    hasConflict: Bool
) -> Bool {
    if hasConflict { return false }
    switch computedStatus {
    case .available:
        return true
    case .checkedOut, .pendingPickup, .reserved:
        guard let holderEndsAt else { return false }
        return holderEndsAt.addingTimeInterval(ReservationAvailabilityThresholds.serializedTurnaroundBuffer) <= requestedStartsAt
    case .maintenance, .retired, .unknown:
        return false
    }
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
    case consolidated(bookingId: String)
    case committedOriginal(
        bookingId: String,
        preservation: ReservationSubmissionPreservation
    )

    var bookingId: String {
        switch self {
        case .created(let bookingId), .consolidated(let bookingId), .committedOriginal(let bookingId, _):
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
    var selectedKitId = ""
    var kits: [BookingKitOption] = []
    var kitsLoading = false
    var kitsLoadError: String?
    private var appliedKitId = ""
    private var didApplySuggestedKit = false
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
    var reusedGearSourceTitle: String?
    private var reusedGearSourceEventIds: Set<String> = []
    private var reusedSourceStartsAt: Date?
    private var reusedSourceEndsAt: Date?
    private var reusedSourceEventStartsAt: Date?
    private var reusedSourceEventEndsAt: Date?

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

    // Conflict checking — the picker preview is advisory while loading, but a
    // known buffered conflict blocks review until it is removed or the window
    // changes. The server remains authoritative for races at save time.
    var conflictedAssetIds: Set<String> = []
    var conflictDetailsByAssetId: [String: AssetConflict] = [:]
    var upcomingCommitmentsByAssetId: [String: AvailabilityCommitment] = [:]
    var turnaroundRisksByAssetId: [String: [AvailabilityTurnaroundRisk]] = [:]
    var bulkTurnaroundRisksBySkuId: [String: [AvailabilityBulkTurnaroundRisk]] = [:]
    var isCheckingAvailability = false
    var availabilityCheckError: String?
    var submissionConflict: String?
    private var conflictCheckTask: Task<Void, Never>?
    private var conflictRequests = LatestRequestGeneration()

    /// Preview every asset currently visible in the browse/search result, plus
    /// selected or deep-linked assets that are outside that result. The server
    /// still rechecks the final selection authoritatively at create time.
    private var conflictPreviewAssetIds: [String] {
        var ids = selectedAssetIds
        for asset in availableAssets {
            ids.insert(asset.id)
        }
        return Array(ids).sorted().prefix(500).map { $0 }
    }

    /// Mirror the web picker’s pre-selection preview for counted supplies:
    /// visible SKUs are checked at quantity one, while selected quantities stay
    /// authoritative. Hidden default-browse supplies are not queried until the
    /// user exposes that category or searches for one.
    private var conflictPreviewBulkItems: [BulkReservationRequest] {
        var quantities = selectedBulkQuantities.filter { $0.value > 0 }
        let query = assetSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        let visibleSkus = availableBulkSkus.filter { sku in
            guard !isHiddenAttachmentCategory(bulkCategoryTitle(sku)) else { return false }
            if !query.isEmpty { return true }
            guard let filter = browseCategoryFilter else { return false }
            return reservationCategory(for: sku) == filter
        }
        for sku in visibleSkus where quantities[sku.id] == nil {
            quantities[sku.id] = 1
        }
        return quantities
            .sorted { $0.key < $1.key }
            .prefix(500)
            .map { BulkReservationRequest(bulkSkuId: $0.key, quantity: $0.value) }
    }

    func scheduleConflictCheck() {
        conflictCheckTask?.cancel()
        isCheckingAvailability = false
        let ids = conflictPreviewAssetIds
        let bulkItems = conflictPreviewBulkItems
        guard (!ids.isEmpty || !bulkItems.isEmpty), !selectedLocationId.isEmpty, endsAt > startsAt else {
            conflictRequests.invalidate()
            clearAvailabilityHints()
            return
        }
        let requestToken = conflictRequests.begin()
        let location = selectedLocationId
        let start = startsAt, end = endsAt
        isCheckingAvailability = true
        availabilityCheckError = nil
        conflictCheckTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled, conflictRequests.owns(requestToken) else { return }
            let outcome = await APIClient.shared.checkAvailabilityOutcome(
                locationId: location,
                serializedAssetIds: ids,
                startsAt: start,
                endsAt: end,
                bookingKind: .reservation,
                bulkItems: bulkItems
            )
            guard !Task.isCancelled, conflictRequests.owns(requestToken) else { return }
            guard let result = outcome.result else {
                // Keep the previous maps visible. An unavailable refresh is
                // not evidence that the item became clear.
                availabilityCheckError = outcome.errorMessage ?? "Availability could not be checked. Try again."
                isCheckingAvailability = false
                return
            }
            conflictDetailsByAssetId = result.conflictsByAssetId
            conflictedAssetIds = Set(result.conflictsByAssetId.keys)
            upcomingCommitmentsByAssetId = result.upcomingCommitmentsByAssetId
            turnaroundRisksByAssetId = result.turnaroundRisksByAssetId
            bulkTurnaroundRisksBySkuId = result.bulkTurnaroundRisksBySkuId
            availabilityCheckError = nil
            isCheckingAvailability = false
        }
    }

    private func clearAvailabilityHints() {
        conflictedAssetIds = []
        conflictDetailsByAssetId = [:]
        upcomingCommitmentsByAssetId = [:]
        turnaroundRisksByAssetId = [:]
        bulkTurnaroundRisksBySkuId = [:]
        availabilityCheckError = nil
    }

    var selectedConflictedAssetIds: Set<String> {
        var ids = selectedAssetIds.intersection(conflictedAssetIds)
        for asset in selectedAssets where !canReserveAssetForWindow(asset) {
            ids.insert(asset.id)
        }
        return ids
    }

    /// Current checkout, pending pickup, and in-progress reservation holds are
    /// selectable once they clear the same 60-minute turnaround the server uses.
    func canReserveAssetForWindow(_ asset: Asset) -> Bool {
        canReserveSerializedAssetForWindow(
            computedStatus: asset.computedStatus,
            holderEndsAt: asset.activeBooking?.endsAt,
            requestedStartsAt: startsAt,
            hasConflict: conflictedAssetIds.contains(asset.id)
        )
    }

    var selectedConflictCount: Int {
        selectedConflictedAssetIds.count
    }

    func conflictMessage(for assetId: String) -> String? {
        availabilityCaption(for: assetId)?.text
    }

    /// Picker-row supporting line. The add slot shows a red alert instead of plus.
    func conflictDetail(for assetId: String) -> String? {
        guard conflictedAssetIds.contains(assetId) else { return nil }
        return availabilityCaption(for: assetId)?.text
    }

    func availabilityCaption(for assetId: String) -> ReservationAvailabilityCaption? {
        if let conflict = conflictDetailsByAssetId[assetId] {
            return ReservationAvailabilityCaption.make(
                requesterName: conflict.conflictingBookingRequesterName,
                kind: conflict.conflictingBookingKind,
                status: conflict.conflictingBookingStatus,
                startsAt: conflict.startsAt,
                endsAt: conflict.endsAt
            )
        }
        guard let commitment = upcomingCommitmentsByAssetId[assetId] else { return nil }
        return ReservationAvailabilityCaption.make(
            requesterName: commitment.requesterName,
            kind: commitment.kind,
            status: commitment.status,
            startsAt: commitment.startsAt,
            endsAt: commitment.endsAt
        )
    }

    func availabilityCaption(for asset: Asset) -> ReservationAvailabilityCaption? {
        if let caption = availabilityCaption(for: asset.id) {
            return caption
        }
        guard let booking = asset.activeBooking else { return nil }
        switch asset.computedStatus {
        case .checkedOut, .pendingPickup, .reserved:
            return ReservationAvailabilityCaption.make(
                requesterName: booking.requesterName,
                kind: booking.kind,
                status: booking.status,
                startsAt: booking.startsAt,
                endsAt: booking.endsAt
            )
        case .available, .maintenance, .retired, .unknown:
            return nil
        }
    }

    var selectedTimingAdvisoryCount: Int {
        let serializedCount = selectedAssetIds.filter { assetId in
            !conflictedAssetIds.contains(assetId)
                && (
                    upcomingCommitmentsByAssetId[assetId] != nil
                    || !(turnaroundRisksByAssetId[assetId] ?? []).isEmpty
                )
        }.count
        let bulkCount = selectedBulkQuantities.filter { skuId, quantity in
            quantity > 0 && !(bulkTurnaroundRisksBySkuId[skuId] ?? []).isEmpty
        }.count
        return serializedCount + bulkCount
    }

    var hasSelectedTimingAdvisories: Bool {
        selectedTimingAdvisoryCount > 0
    }

    /// Next-use copy for rows that can still be added. Hard conflicts use
    /// `conflictDetail` instead so the plus slot can stay a red alert.
    func upcomingCommitmentLabel(for assetId: String) -> String? {
        guard !conflictedAssetIds.contains(assetId) else { return nil }
        return availabilityCaption(for: assetId)?.text
    }

    /// Location-transfer and recent-check-in notices supplement the primary
    /// next-use line. Short-turnaround copy is folded into that line to avoid
    /// repeating “Needed next” twice on a row.
    func turnaroundMessage(for assetId: String) -> String? {
        guard !conflictedAssetIds.contains(assetId) else { return nil }
        let risks = turnaroundRisksByAssetId[assetId] ?? []
        guard !risks.isEmpty else { return nil }
        let risk = risks.first(where: { $0.code != "SHORT_TURNAROUND" }) ?? risks[0]
        if risk.code == "SHORT_TURNAROUND", upcomingCommitmentLabel(for: assetId) != nil {
            return nil
        }
        return availabilityRiskMessage(for: risk)
    }

    func turnaroundIsCritical(for assetId: String) -> Bool {
        guard !conflictedAssetIds.contains(assetId) else { return false }
        return (turnaroundRisksByAssetId[assetId] ?? []).contains {
            $0.severity?.lowercased() == "critical"
        }
    }

    func bulkTurnaroundMessage(for skuId: String) -> String? {
        guard let risk = bulkTurnaroundRisksBySkuId[skuId]?.first else { return nil }
        if let startsAt = risk.startsAt {
            let returnBy = startsAt.addingTimeInterval(-ReservationAvailabilityThresholds.serializedTurnaroundBuffer)
            let quantity = risk.plannedQuantity.map { String($0) } ?? "the next quantity"
            let gap = risk.gapMinutes.map { $0 <= Int(ReservationAvailabilityThresholds.criticalWindow / 60) ? " (\(availabilityDurationLabel($0)) gap)" : "" } ?? ""
            return "Next booking needs \(quantity) at \(startsAt.compactReservationDateTime()) · return by \(returnBy.compactReservationDateTime())\(gap)"
        }
        return risk.message ?? "Tight timing — confirm the return time."
    }

    func bulkTurnaroundIsCritical(for skuId: String) -> Bool {
        (bulkTurnaroundRisksBySkuId[skuId] ?? []).contains {
            $0.severity?.lowercased() == "critical"
        }
    }

    private func turnaroundFallbackMessage(for code: String?) -> String {
        switch code {
        case "LOCATION_TRANSFER":
            return "Needed next at another location; confirm transfer time"
        case "RECENT_CHECKIN_REPORT":
            return "Recent condition report — inspect before reserving"
        default:
            return "Tight timing — confirm return before the next booking"
        }
    }

    private func availabilityRiskMessage(for risk: AvailabilityTurnaroundRisk) -> String {
        switch risk.code {
        case "LOCATION_TRANSFER":
            return risk.message ?? turnaroundFallbackMessage(for: risk.code)
        case "RECENT_CHECKIN_REPORT":
            if risk.reportType == "LOST" { return "Recent lost report — verify item status before reserving" }
            if risk.reportType == "DAMAGED" { return "Recent damage report — inspect before reserving" }
            return risk.message ?? turnaroundFallbackMessage(for: risk.code)
        case "SHORT_TURNAROUND":
            guard let startsAt = risk.startsAt else { return risk.message ?? turnaroundFallbackMessage(for: risk.code) }
            let returnBy = startsAt.addingTimeInterval(-ReservationAvailabilityThresholds.serializedTurnaroundBuffer)
            let gap = risk.gapMinutes.map { $0 <= Int(ReservationAvailabilityThresholds.criticalWindow / 60) ? " (\(availabilityDurationLabel($0)) gap)" : "" } ?? ""
            return "Needed next at \(startsAt.compactReservationDateTime()) · return by \(returnBy.compactReservationDateTime())\(gap)"
        default:
            return risk.message ?? turnaroundFallbackMessage(for: risk.code)
        }
    }

    private func availabilityDurationLabel(_ minutes: Int) -> String {
        if minutes <= 0 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let remainingMinutes = minutes % 60
        return remainingMinutes == 0 ? "\(hours)h" : "\(hours)h \(remainingMinutes)m"
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
    var hasInvalidReusedEventSelection: Bool {
        !reusedGearSourceEventIds.isDisjoint(with: selectedEventIds)
    }
    var isReusingGear: Bool { reusedGearSourceTitle != nil }
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

    var showsBrowseCategoryFilter: Bool {
        isBrowsing && browseCategories.count > 1
    }

    /// Asset groups the picker renders. Default browse is one flat
    /// "Most popular" section in server popularity order (same sort as the
    /// items list); the search-bar category menu switches to that category;
    /// an active search shows category-grouped matches.
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
    /// popular gear); they surface via search or their category menu.
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
        selectedEquipmentCount > 0
            && selectedLocationMismatchCount == 0
            && selectedConflictCount == 0
            && !isCheckingAvailability
            && availabilityCheckError == nil
            && !isSubmitting
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
        let kitId: String?
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
        if selectedLocationId != value {
            selectedKitId = ""
            appliedKitId = ""
            didApplySuggestedKit = false
        }
        selectedLocationId = value
        UserDefaults.standard.set(value, forKey: "preferredReservationPickupLocationId")
        scheduleConflictCheck()
        Task { await loadKits() }
    }

    func selectKit(_ id: String) {
        selectedKitId = id
        if id.isEmpty {
            appliedKitId = ""
            didApplySuggestedKit = true
            return
        }
        didApplySuggestedKit = true
        Task { await applySelectedKit() }
    }

    func kitPickerLabel(_ kit: BookingKitOption) -> String {
        callingKitLabel(name: kit.name, gamedayRole: kit.gamedayRole, contents: kit.contents)
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
        if let sourceStart = reusedSourceStartsAt,
           let sourceEnd = reusedSourceEndsAt,
           let sourceEventStart = reusedSourceEventStartsAt,
           let sourceEventEnd = reusedSourceEventEndsAt {
            let nextStart = first.startsAt.addingTimeInterval(sourceStart.timeIntervalSince(sourceEventStart))
            let nextEnd = last.endsAt.addingTimeInterval(sourceEnd.timeIntervalSince(sourceEventEnd))
            if nextEnd > nextStart {
                startsAt = nextStart
                endsAt = nextEnd
                return
            }
        }
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

    /// Starts a fresh event plan from a past booking. Person, pickup, notes,
    /// title, and original equipment come along; the old event and window stay
    /// behind so the user must pick this week's game.
    func prefillForReuse(from plan: BookingReusePlan) {
        usesEventLinkedSetup = true
        reusedGearSourceTitle = plan.title
        reusedGearSourceEventIds = Set(plan.events.map(\.id))
        reusedSourceStartsAt = plan.startsAt
        reusedSourceEndsAt = plan.endsAt
        reusedSourceEventStartsAt = plan.events.first?.startsAt
        reusedSourceEventEndsAt = plan.events.last?.endsAt
        title = plan.title
        userEditedTitle = plan.keepTitle
        notes = plan.notes ?? ""
        selectedUserId = plan.requesterUserId
        selectedLocationId = plan.locationId
        userEditedLocation = !plan.locationId.isEmpty
        selectedEventIds = []
        prefillEventId = nil
        prefillShiftAssignmentId = nil
        selectedAssetIds = Set(plan.serializedItems.map(\.assetId))
        selectedAssetOrder = plan.serializedItems.map(\.assetId)
        selectedBulkQuantities = Dictionary(
            plan.bulkItems
                .filter { $0.plannedQuantity > 0 }
                .map { ($0.bulkSkuId, $0.plannedQuantity) },
            uniquingKeysWith: { _, later in later }
        )
        if let kitId = plan.kitId {
            selectedKitId = kitId
            appliedKitId = kitId
            didApplySuggestedKit = true
        } else {
            selectedKitId = ""
            appliedKitId = ""
            didApplySuggestedKit = false
        }
        Task { await loadKits() }
        Task { await loadSnapshotsForSelectedAssets(ids: Array(selectedAssetIds)) }
    }

    /// Starts a fresh event plan with the source booking's remaining gear only.
    /// Prefer `prefillForReuse` so completed reservations still copy handed-over cameras.
    func prefillGearForNewEvent(from booking: Booking) {
        usesEventLinkedSetup = true
        reusedGearSourceTitle = booking.title
        reusedGearSourceEventIds = Set(booking.linkedEvents.map(\.id))
        reusedSourceStartsAt = booking.startsAt
        reusedSourceEndsAt = booking.endsAt
        reusedSourceEventStartsAt = nil
        reusedSourceEventEndsAt = nil
        title = booking.title
        userEditedTitle = !booking.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        notes = booking.notes ?? ""
        selectedUserId = booking.requester.id
        selectedLocationId = booking.location.id
        userEditedLocation = true
        selectedEventIds = []
        prefillEventId = nil
        prefillShiftAssignmentId = nil
        selectedAssetIds = Set(booking.serializedItems.map(\.assetId))
        selectedAssetOrder = booking.serializedItems.map(\.assetId)
        selectedBulkQuantities = Dictionary(
            booking.bulkItems
                .filter { $0.plannedQuantity > 0 }
                .map { ($0.bulkSku.id, $0.plannedQuantity) },
            uniquingKeysWith: { _, later in later }
        )
        Task { await loadSnapshotsForSelectedAssets(ids: Array(selectedAssetIds)) }
    }

    func loadOptions() async {
        guard options == nil else { return }
        isLoadingOptions = true
        do {
            options = try await APIClient.shared.formOptions()
            if selectedLocationId.isEmpty,
               let preferredId = UserDefaults.standard.string(forKey: "preferredReservationPickupLocationId"),
               options?.locations.contains(where: { $0.id == preferredId }) == true {
                selectedLocationId = preferredId
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingOptions = false
        await loadKits()
    }

    func loadKits() async {
        guard !selectedLocationId.isEmpty else {
            kits = []
            kitsLoadError = nil
            kitsLoading = false
            return
        }
        let locationId = selectedLocationId
        let requesterUserId = selectedUserId
        kitsLoading = true
        kitsLoadError = nil
        do {
            let response = try await APIClient.shared.reservationKits(
                locationId: locationId,
                requesterUserId: requesterUserId
            )
            guard locationId == selectedLocationId else { return }
            kits = response.kits
                .filter { $0.contents > 0 }
                .sorted {
                    let roleDelta = footballGamedayKitOrder($0.gamedayRole) - footballGamedayKitOrder($1.gamedayRole)
                    if roleDelta != 0 { return roleDelta < 0 }
                    return $0.name.localizedStandardCompare($1.name) == .orderedAscending
                }
            kitsLoading = false
            if !selectedKitId.isEmpty, !kits.contains(where: { $0.id == selectedKitId }) {
                selectedKitId = ""
                appliedKitId = ""
            } else if selectedKitId.isEmpty,
                      !didApplySuggestedKit,
                      let suggestedKitId = response.suggestedKitId,
                      kits.contains(where: { $0.id == suggestedKitId }) {
                didApplySuggestedKit = true
                selectedKitId = suggestedKitId
                await applySelectedKit()
            } else if !selectedKitId.isEmpty {
                await applySelectedKit()
            }
        } catch {
            guard locationId == selectedLocationId else { return }
            kits = []
            kitsLoadError = error.localizedDescription
            kitsLoading = false
        }
    }

    private func applySelectedKit() async {
        let kitId = selectedKitId
        guard !kitId.isEmpty else { return }
        if appliedKitId == kitId { return }
        do {
            let detail = try await APIClient.shared.reservationKitDetail(id: kitId)
            guard selectedKitId == kitId else { return }
            appliedKitId = kitId
            selectedAssetIds = Set(detail.members.map(\.asset.id))
            selectedAssetOrder = detail.members.map(\.asset.id)
            selectedAssetSnapshots = selectedAssetSnapshots.filter { selectedAssetIds.contains($0.key) }
            selectedBulkQuantities = Dictionary(
                detail.bulkMembers.map { ($0.bulkSku.id, $0.quantity) },
                uniquingKeysWith: { _, later in later }
            )
            if detail.members.isEmpty && detail.bulkMembers.isEmpty {
                error = "\(detail.name) has no cameras, lenses, or batteries yet. Add gear on the kit page first."
            }
            Task { await loadSnapshotsForSelectedAssets(ids: Array(selectedAssetIds)) }
            scheduleConflictCheck()
        } catch {
            guard selectedKitId == kitId else { return }
            self.error = error.localizedDescription
        }
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
                // Checked-out, staged, and in-progress gear stays searchable.
                // A later pickup can still take it once the hold clears the
                // turnaround buffer; maintenance and retired stay excluded.
                statuses: [.available, .checkedOut, .pendingPickup, .reserved],
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
            scheduleConflictCheck()
        } catch {
            guard capturedSearch == assetSearch else { return }
            self.error = error.localizedDescription
        }
    }

    /// Adds an asset from a picker result (idempotent). Removal goes through
    /// `toggleAsset`/`removeSelectedAsset` so tap-to-add never un-picks.
    func addAsset(_ asset: Asset) {
        guard isAtPickupLocation(asset), canReserveAssetForWindow(asset) else { return }
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
            guard canReserveAssetForWindow(asset) else { return }
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
        scheduleConflictCheck()
    }

    func incrementBulk(_ sku: FormBulkSku) {
        setBulkQuantity(sku, quantity: quantity(for: sku) + 1)
    }

    func decrementBulk(_ sku: FormBulkSku) {
        setBulkQuantity(sku, quantity: quantity(for: sku) - 1)
    }

    func removeSelectedBulk(_ sku: FormBulkSku) {
        selectedBulkQuantities.removeValue(forKey: sku.id)
        scheduleConflictCheck()
    }

    /// Adds a scanned serialized asset and reports the outcome so the scanner
    /// can stay open (continuous scanning) and show an in-scanner banner.
    func addScannedAsset(id: String) async -> (message: String, success: Bool) {
        do {
            let detail = try await APIClient.shared.asset(id: id)
            let asset = detail.asAsset
            guard isAtPickupLocation(asset) else {
                return ("\(asset.displayName) is at \(asset.location.name). Change the pickup location to add it.", false)
            }
            if selectedAssetIds.contains(asset.id) {
                return ("\(asset.displayName) is already in this reservation.", true)
            }
            guard canReserveAssetForWindow(asset) else {
                if let text = availabilityCaption(for: asset)?.text {
                    return (text, false)
                }
                return ("\(asset.displayName) is \(asset.computedStatus.label.lowercased()).", false)
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
            bulkItems: selectedBulkRequests,
            kitId: selectedKitId.isEmpty ? nil : selectedKitId
        )
    }

    private func submit(
        _ payload: ReservationSubmissionSnapshot,
        sourceDraftId: String,
        recordsUncertainFailure: Bool
    ) async throws -> ReservationSubmissionOutcome {
        do {
            let receipt = try await draftPersistence.createReservation(
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
                bulkItems: payload.bulkItems,
                kitId: payload.kitId
            )
            return await finishCommittedSubmission(receipt: receipt, payload: payload)
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
        receipt: ReservationCreationReceipt,
        payload: ReservationSubmissionSnapshot
    ) async -> ReservationSubmissionOutcome {
        uncertainReservationSubmission = nil
        submissionConflict = nil

        // The route consumes this draft in the creation transaction. Detach it
        // before preserving any edits made after the submitted snapshot.
        serverDraftId = nil

        guard currentReservationSubmissionSnapshot() != payload else {
            onReservationSubmitted?(receipt.id)
            return receipt.consolidated
                ? .consolidated(bookingId: receipt.id)
                : .created(bookingId: receipt.id)
        }

        do {
            let draftId = try await saveDraft(allowDuringSubmission: true)
            return .committedOriginal(
                bookingId: receipt.id,
                preservation: .savedDraft(
                    id: draftId,
                    hasNewerUnsavedInput: hasUnsavedInput
                )
            )
        } catch {
            return .committedOriginal(
                bookingId: receipt.id,
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
        if selectedLocationId.isEmpty { return true }
        if asset.location.id == selectedLocationId { return true }
        guard let pickupName = selectedLocation?.name else { return false }
        return kitPickupNamesShare(pickupName, asset.location.name)
    }

    func isAtPickupLocation(_ sku: FormBulkSku) -> Bool {
        if selectedLocationId.isEmpty { return true }
        guard let skuLocationId = sku.locationId else { return true }
        if skuLocationId == selectedLocationId { return true }
        guard
            let pickupName = selectedLocation?.name,
            let skuName = options?.locations.first(where: { $0.id == skuLocationId })?.name
        else { return false }
        return kitPickupNamesShare(pickupName, skuName)
    }

    private func kitPickupNamesShare(_ left: String, _ right: String) -> Bool {
        let a = normalizedKitPickupName(left)
        let b = normalizedKitPickupName(right)
        if a == b { return true }
        let campRandall: Set<String> = ["camp randall", "camp randall stadium"]
        return campRandall.contains(a) && campRandall.contains(b)
    }

    private func normalizedKitPickupName(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .lowercased()
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
