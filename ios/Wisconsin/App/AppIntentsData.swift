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
func requireIntentCapability(_ capability: String) async throws {
    do {
        let user = try await APIClient.shared.me()
        guard user.role != "COLLABORATOR"
                || (user.capabilities ?? []).contains(capability) else {
            throw GearIntentError.unavailable
        }
    } catch {
        throw mapIntentError(error)
    }
}

private func checkedOutSummaries() async throws -> [CheckoutIntentSummary] {
    try await requireIntentCapability("MY_GEAR_VIEW")
    do {
        let me = try await APIClient.shared.me()
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
