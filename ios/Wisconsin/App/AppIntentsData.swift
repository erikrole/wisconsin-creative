import AppIntents
import SwiftUI

// MARK: - Errors

enum GearIntentError: Error, CustomLocalizedStringResourceConvertible {
    case signedOut
    case unavailable

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .signedOut: "You're signed out. Open Wisconsin Creative and sign in first."
        case .unavailable: "That shortcut isn't available for this account. Open Wisconsin Creative to see the tools available to you."
        }
    }
}

/// Maps a thrown API error into the intent-facing error space. Auth failures
/// get the actionable "sign in first" message; everything else keeps the
/// humanized `APIError` copy Siri/Shortcuts will read aloud.
private func mapIntentError(_ error: Error) -> Error {
    if case APIError.unauthorized = error { return GearIntentError.signedOut }
    return error
}

/// Static App Shortcuts remain discoverable in system configuration, so each
/// action verifies the signed-in role before it creates an app handoff. This
/// turns a stale or role-inapplicable shortcut into a spoken, actionable result
/// instead of leaving a pending destination that the app cannot open.
@discardableResult
func requireIntentCapability(_ capability: String) async throws -> CurrentUser {
    do {
        let user = try await APIClient.shared.me()
        guard user.role != "COLLABORATOR"
                || (user.capabilities ?? []).contains(capability) else {
            throw GearIntentError.unavailable
        }
        return user
    } catch {
        throw mapIntentError(error)
    }
}

private func checkedOutSummaries() async throws -> [CheckoutIntentSummary] {
    let me = try await requireIntentCapability("MY_GEAR_VIEW")
    do {
        // `sort: endsAt` means the limited response still contains the
        // soonest due checkouts — exactly the rows a compact snippet should
        // prioritize.
        let checkouts = try await APIClient.shared
            .checkouts(activeOnly: false, status: .open, requesterId: me.id, sort: "endsAt", limit: 10)
            .data
        return checkouts
            .map(CheckoutIntentSummary.init)
            .sorted { $0.endsAt < $1.endsAt }
    } catch {
        throw mapIntentError(error)
    }
}

private func nextShift() async throws -> MyShift? {
    try await requireIntentCapability("PUBLISHED_SCHEDULE_VIEW")
    do {
        let shifts = try await APIClient.shared.myShifts(limit: 10)
        let now = Date()
        return shifts
            .filter { $0.endsAt > now }
            .min(by: { $0.startsAt < $1.startsAt })
    } catch {
        throw mapIntentError(error)
    }
}

// MARK: - What Gear Is Out

struct MyCheckedOutGearIntent: AppIntent {
    static let title: LocalizedStringResource = "What's Out"
    static let description = IntentDescription(
        "Check which gear you currently have checked out and when it's due back, without opening the app."
    )
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
        let summaries = try await checkedOutSummaries()

        guard !summaries.isEmpty else {
            return .result(
                dialog: "You don't have any gear checked out right now.",
                snippetIntent: MyCheckedOutGearSnippetIntent()
            )
        }

        let itemCount = summaries.reduce(0) { $0 + $1.itemCount }
        let itemPhrase = itemCount == 1 ? "1 item" : "\(itemCount) items"
        let checkoutPhrase = summaries.count == 1
            ? "one checkout"
            : "\(summaries.count) checkouts"
        let overdueCount = summaries.count(where: \.isOverdue)

        let dialog: IntentDialog
        if overdueCount > 0 {
            let overduePhrase = overdueCount == 1 ? "One of them is overdue" : "\(overdueCount) of them are overdue"
            dialog = IntentDialog("You have \(itemPhrase) out across \(checkoutPhrase). \(overduePhrase).")
        } else if let lastDue = summaries.map(\.endsAt).max() {
            dialog = IntentDialog(
                "You have \(itemPhrase) out across \(checkoutPhrase). Everything is due back by \(lastDue.formatted(date: .abbreviated, time: .shortened))."
            )
        } else {
            dialog = IntentDialog("You have \(itemPhrase) out across \(checkoutPhrase).")
        }

        return .result(dialog: dialog, snippetIntent: MyCheckedOutGearSnippetIntent())
    }
}

/// The system calls this separately from the spoken result so the dialog can
/// remain complete for Siri/AirPods without being printed above the same
/// information in the onscreen snippet.
struct MyCheckedOutGearSnippetIntent: SnippetIntent {
    static let title: LocalizedStringResource = "Show Checked-Out Gear"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    func perform() async throws -> some IntentResult & ShowsSnippetView {
        .result(view: GearOutSnippetView(checkouts: try await checkedOutSummaries()))
    }
}

/// Immutable, Sendable projection of a checkout for snippet rendering.
struct CheckoutIntentSummary: Identifiable, Sendable {
    let id: String
    let title: String
    let itemLine: String
    let itemCount: Int
    let endsAt: Date
    let isPendingPickup: Bool
    let isOverdue: Bool

    init(booking: Booking) {
        id = booking.id
        title = booking.title
        itemLine = Self.itemLine(for: booking)
        itemCount = booking.serializedItems.count
            + booking.bulkItems.reduce(0) { $0 + $1.plannedQuantity }
        endsAt = booking.endsAt
        isPendingPickup = booking.status == .pendingPickup
        isOverdue = booking.status == .open && booking.endsAt < Date()
    }

    /// "C300 Kit A, Batteries ×4 · +2 more" — first two item names, kiosk-style.
    private static func itemLine(for booking: Booking) -> String {
        var names = booking.serializedItems.map(\.asset.itemListPrimaryTitle)
        names += booking.bulkItems.map { item in
            item.plannedQuantity > 1 ? "\(item.bulkSku.name) ×\(item.plannedQuantity)" : item.bulkSku.name
        }
        guard !names.isEmpty else { return "No items listed" }
        let shown = names.prefix(2).joined(separator: ", ")
        let extra = names.count - 2
        return extra > 0 ? "\(shown) · +\(extra) more" : shown
    }
}

struct GearOutSnippetView: View {
    let checkouts: [CheckoutIntentSummary]

    private let maxVisibleCheckouts = 3

    private var visibleCheckouts: [CheckoutIntentSummary] {
        Array(checkouts.prefix(maxVisibleCheckouts))
    }

    private var remainingCount: Int {
        max(0, checkouts.count - visibleCheckouts.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if checkouts.isEmpty {
                Label("Nothing checked out", systemImage: "checkmark.circle")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(visibleCheckouts) { checkout in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: checkout.isOverdue ? "exclamationmark.triangle.fill" : "backpack")
                            .font(.subheadline)
                            .foregroundStyle(checkout.isOverdue ? Color.statusText(.red) : Color.statusText(.blue))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(checkout.title)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Text(checkout.itemLine)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Text(dueLine(for: checkout))
                                .font(.caption.weight(checkout.isOverdue ? .semibold : .regular))
                                .foregroundStyle(checkout.isOverdue ? Color.statusText(.red) : .secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityElement(children: .combine)
                }
                if remainingCount > 0 {
                    Text("+\(remainingCount) more in My Gear")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                Button(intent: ShowMyGearIntent()) {
                    Label("Open My Gear", systemImage: "arrow.up.forward.app")
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
    }

    private func dueLine(for checkout: CheckoutIntentSummary) -> String {
        let when = checkout.endsAt.formatted(date: .abbreviated, time: .shortened)
        if checkout.isOverdue { return "Overdue — was due \(when)" }
        if checkout.isPendingPickup { return "Pickup ready — due back \(when)" }
        return "Due back \(when)"
    }
}

// MARK: - Next Shift

struct NextShiftIntent: AppIntent {
    static let title: LocalizedStringResource = "Next Shift"
    static let description = IntentDescription(
        "Find out when your next shift is and whether gear is ready, without opening the app."
    )
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
        let now = Date()
        guard let shift = try await nextShift()
        else {
            return .result(
                dialog: "You don't have any upcoming shifts.",
                snippetIntent: NextShiftSnippetIntent()
            )
        }

        let summary = shift.event.summary
        let time = shift.startsAt.formatted(date: .abbreviated, time: .shortened)
        let place = shift.event.locationName.map { " at \($0)" } ?? ""
        let dialog: IntentDialog
        if shift.startsAt <= now {
            dialog = IntentDialog(
                "You're on shift now — \(summary)\(place), until \(shift.endsAt.formatted(date: .omitted, time: .shortened))."
            )
        } else {
            dialog = IntentDialog("Your next shift is \(time) — \(summary)\(place).")
        }
        return .result(dialog: dialog, snippetIntent: NextShiftSnippetIntent())
    }
}

/// Separates the concise visual result from the complete spoken response and
/// lets the system refresh the snippet without repeating the dialog visually.
struct NextShiftSnippetIntent: SnippetIntent {
    static let title: LocalizedStringResource = "Show Next Shift"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    func perform() async throws -> some IntentResult & ShowsSnippetView {
        let shift = try await nextShift()
        return .result(view: NextShiftSnippetView(shift: shift.map(ShiftIntentSummary.init)))
    }
}

/// Immutable, Sendable projection of a shift for snippet rendering.
struct ShiftIntentSummary: Sendable {
    let eventSummary: String
    let area: String
    let startsAt: Date
    let endsAt: Date
    let locationName: String?
    let gearLabel: String?

    init(shift: MyShift) {
        eventSummary = shift.event.summary
        area = shift.area
        startsAt = shift.startsAt
        endsAt = shift.endsAt
        locationName = shift.event.locationName
        gearLabel = shift.gear.hasGear ? shift.gear.gearLabel : nil
    }
}

struct NextShiftSnippetView: View {
    let shift: ShiftIntentSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let shift {
                Text(shift.eventSummary)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                Label(
                    "\(shift.startsAt.formatted(date: .abbreviated, time: .shortened)) – \(shift.endsAt.formatted(date: .omitted, time: .shortened))",
                    systemImage: "clock"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                if let location = shift.locationName {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Label(shift.area, systemImage: "person.badge.shield.checkmark")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let gearLabel = shift.gearLabel {
                    Label(gearLabel, systemImage: "backpack")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.statusText(.blue))
                }
            } else {
                Label("No upcoming shifts", systemImage: "calendar")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            Button(intent: ShowTodayScheduleIntent()) {
                Label("Open Schedule", systemImage: "arrow.up.forward.app")
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Search Gear

/// "Search gear <name>": looks the phrase up in the item catalog and answers
/// with what it found and whether it is available, spoken and as a short list.
/// Read-only; opening an item stays in the app.
struct SearchGearIntent: AppIntent {
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    static let title: LocalizedStringResource = "Search Gear"
    static let description = IntentDescription("Find gear by name, tag, or model and see whether it's available.")

    @Parameter(title: "Gear", requestValueDialog: "What gear are you looking for?")
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Search gear for \(\.$query)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetIntent {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else {
            return .result(dialog: "Tell me what gear to look for.", snippetIntent: GearSearchSnippetIntent(query: ""))
        }
        let (matches, total) = try await searchGearMatches(term)
        let dialog: IntentDialog
        if total == 0 {
            dialog = IntentDialog("I didn't find any gear matching \(term).")
        } else if let first = matches.first, total == 1 {
            dialog = IntentDialog("Found \(first.title). It's \(first.status.lowercased()).")
        } else {
            let available = matches.filter { $0.isAvailable }.count
            dialog = IntentDialog("Found \(total) matches for \(term). \(available) of the top \(matches.count) are available.")
        }
        return .result(dialog: dialog, snippetIntent: GearSearchSnippetIntent(query: term))
    }
}

@MainActor
private func searchGearMatches(_ term: String) async throws -> ([GearSearchMatch], Int) {
    try await requireIntentCapability("GEAR_CATALOG_VIEW")
    do {
        let response = try await APIClient.shared.assets(search: term, limit: 5)
        return (response.orderedRows.map(GearSearchMatch.init), response.total)
    } catch {
        throw mapIntentError(error)
    }
}

/// The visual half of Search Gear, kept separate from the spoken answer like
/// the other snippet intents so the system can refresh it on its own.
struct GearSearchSnippetIntent: SnippetIntent {
    static let title: LocalizedStringResource = "Show Gear Results"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Gear")
    var query: String

    init() { query = "" }
    init(query: String) { self.query = query }

    func perform() async throws -> some IntentResult & ShowsSnippetView {
        guard !query.isEmpty else {
            return .result(view: GearSearchSnippetView(query: "", matches: [], total: 0))
        }
        let (matches, total) = try await searchGearMatches(query)
        return .result(view: GearSearchSnippetView(query: query, matches: matches, total: total))
    }
}

struct GearSearchMatch: Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String
    let status: String
    let isAvailable: Bool

    init(_ row: ItemListRow) {
        switch row {
        case .asset(let asset):
            id = asset.id
            title = asset.itemListPrimaryTitle
            detail = asset.displayName
            status = asset.computedStatus.label
            isAvailable = asset.computedStatus == .available
        case .family(let family):
            id = "bulk-\(family.id)"
            title = family.name
            detail = family.category
            status = family.availabilityLabel
            isAvailable = family.availableQuantity > 0
        }
    }

}

struct GearSearchSnippetView: View {
    let query: String
    let matches: [GearSearchMatch]
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if matches.isEmpty {
                Label(query.isEmpty ? "Nothing to search for" : "No gear matches \"\(query)\"", systemImage: "magnifyingglass")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(matches.prefix(3)) { match in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle()
                            .fill(match.isAvailable ? Color.statusText(.green) : Color.statusText(.orange))
                            .frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(match.title)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            Text("\(match.detail) · \(match.status)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityElement(children: .combine)
                }
                if total > 3 {
                    Text("+\(total - 3) more in Search")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
    }
}

// MARK: - Extend Checkout

enum ExtendIntentError: Error, CustomLocalizedStringResourceConvertible {
    case nothingOut
    case notExtendable(String)
    case noRoom(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .nothingOut: "You don't have any gear checked out right now."
        case .notExtendable(let title): "\(title) can't be extended. Open Wisconsin Creative to see why."
        case .noRoom(let title): "Someone needs the gear in \(title) soon, so it can't be extended. Plan to return it on time."
        }
    }
}

enum ExtendDuration: String, AppEnum {
    case oneHour
    case twoHours

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Extension"
    static let caseDisplayRepresentations: [ExtendDuration: DisplayRepresentation] = [
        .oneHour: "1 more hour",
        .twoHours: "2 more hours",
    ]

    var interval: TimeInterval {
        switch self {
        case .oneHour: 60 * 60
        case .twoHours: 2 * 60 * 60
        }
    }
}

/// The one intent that writes. It runs the same POST as the Extend sheet,
/// with the same next-booking limit (`ExtendWindow`), and always asks for a
/// spoken or tapped confirmation first, so a mis-heard phrase can't move a
/// return time. Offers only short extensions; anything longer stays a
/// deliberate choice in the sheet, where the calendar and the limit are shown.
struct ExtendCheckoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Extend Checkout"
    static let description = IntentDescription(
        "Push back the return time on gear you have checked out, without opening the app."
    )
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication

    @Parameter(title: "Checkout")
    var checkout: BookingEntity?

    @Parameter(title: "Extend By", default: .oneHour)
    var duration: ExtendDuration

    static var parameterSummary: some ParameterSummary {
        Summary("Extend \(\.$checkout) by \(\.$duration)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let me = try await requireIntentCapability("MY_GEAR_VIEW")
        let booking = try await resolveCheckout(for: me)

        let canExtend = booking.allows("extend")
            ?? (booking.requester.id == me.id && booking.status == .open)
        guard booking.kind == .checkout, canExtend else {
            throw ExtendIntentError.notExtendable(booking.title)
        }

        let base = ExtendWindow.base(currentEndsAt: booking.endsAt)
        var newEndsAt = QuarterHour.roundedUp(base.addingTimeInterval(duration.interval))
        let insight = await APIClient.shared.checkoutReturnInsight(for: booking)
        if let latest = ExtendWindow.latestEndsAt(nextNeedAt: insight.nextNeedAt) {
            // Shorten to the limit rather than fail, as long as it still buys
            // at least a quarter hour; the confirmation names the real time.
            guard latest >= QuarterHour.roundedUp(base.addingTimeInterval(15 * 60)) else {
                throw ExtendIntentError.noRoom(booking.title)
            }
            newEndsAt = min(newEndsAt, latest)
        }

        let label = newEndsAt.operationalDateTimeLabel(now: Date(), capitalizesRelativeDay: false)
        try await requestConfirmation(
            dialog: "Extend \(booking.title) until \(label)?"
        )

        do {
            let updated = try await APIClient.shared.extendBooking(
                id: booking.id,
                endsAt: newEndsAt,
                updatedAt: booking.updatedAt
            )
            let dueLabel = updated.endsAt.operationalDateTimeLabel(now: Date(), capitalizesRelativeDay: false)
            return .result(dialog: "Done. \(updated.title) is now due back \(dueLabel).")
        } catch {
            throw mapIntentError(error)
        }
    }

    /// Uses the checkout the shortcut names; otherwise the one due back
    /// soonest. Always re-reads the booking so the
    /// write carries a fresh `updatedAt`.
    private func resolveCheckout(for me: CurrentUser) async throws -> Booking {
        do {
            if let checkout {
                return try await APIClient.shared.booking(id: checkout.id)
            }
            let open = try await APIClient.shared
                .checkouts(activeOnly: false, status: .open, requesterId: me.id, sort: "endsAt", limit: 10)
                .data
            // Sorted by due time, so the first is the one most likely to need
            // more time. The confirmation names it, so a wrong guess is a "No".
            guard let first = open.first else { throw ExtendIntentError.nothingOut }
            return try await APIClient.shared.booking(id: first.id)
        } catch let error as ExtendIntentError {
            throw error
        } catch {
            throw mapIntentError(error)
        }
    }
}

// MARK: - Focus Filter

/// What the server stamps on each push as `filter-criteria`: the catalog
/// group (src/lib/notification-catalog.ts), or `blast` for staff blasts.
enum CreativeAlertGroup: String, AppEnum {
    case gear
    case schedule
    case blast
    case account
    case admin

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Alert Type"
    static let caseDisplayRepresentations: [CreativeAlertGroup: DisplayRepresentation] = [
        .gear: "Gear",
        .schedule: "Shifts and schedule",
        .blast: "Staff blasts",
        .account: "Licenses",
        .admin: "Staff reviews",
    ]
}

/// Lets a Focus (Work, Game Day) keep gear and shift alerts while holding the
/// rest. iOS applies the predicate to each alert's `filterCriteria`; nothing
/// is filtered in the app itself.
struct CreativeFocusFilter: SetFocusFilterIntent {
    static let title: LocalizedStringResource = "Set Creative Alerts"
    static let description = IntentDescription(
        "Choose which Wisconsin Creative alerts come through while this Focus is on."
    )

    @Parameter(title: "Allow", default: [.gear, .schedule, .blast])
    var allowed: [CreativeAlertGroup]

    var displayRepresentation: DisplayRepresentation {
        let names = allowed.map { Self.label(for: $0) }
        return DisplayRepresentation(
            title: "Creative alerts",
            subtitle: names.isEmpty ? "None" : "\(names.joined(separator: ", "))"
        )
    }

    var appContext: FocusFilterAppContext {
        FocusFilterAppContext(
            notificationFilterPredicate: NSPredicate(format: "SELF IN %@", allowed.map(\.rawValue))
        )
    }

    func perform() async throws -> some IntentResult {
        .result()
    }

    private static func label(for group: CreativeAlertGroup) -> String {
        switch group {
        case .gear: "Gear"
        case .schedule: "Shifts"
        case .blast: "Blasts"
        case .account: "Licenses"
        case .admin: "Reviews"
        }
    }
}
