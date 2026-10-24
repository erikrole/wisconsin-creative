import AppIntents
import CoreSpotlight
import Foundation

/// Shortcuts-facing projection of a `Booking` so users can parameterize
/// automations ("Open <booking>") over their reservations and checkouts.
/// `IndexedEntity` so the Spotlight row for a booking (`SpotlightIndexer`)
/// and the Shortcuts/Siri entity are the same object.
struct BookingEntity: IndexedEntity, Identifiable, Sendable {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Booking")
    static let defaultQuery = BookingEntityQuery()

    let id: String
    let title: String
    let kindLabel: String
    let statusLabel: String
    let endsAt: Date

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title)",
            subtitle: "\(kindLabel) · \(statusLabel) · \(endsAt.formatted(date: .abbreviated, time: .shortened))"
        )
    }

    init(booking: Booking) {
        id = booking.id
        title = booking.title
        kindLabel = booking.kind == .checkout ? "Checkout" : "Reservation"
        statusLabel = booking.status.label
        endsAt = booking.endsAt
    }

    init(summary: BookingSummary) {
        id = summary.id
        title = summary.title
        kindLabel = summary.kind == .checkout ? "Checkout" : "Reservation"
        statusLabel = summary.status.label
        endsAt = summary.endsAt
    }
}

/// Handoff for an open booking: the same booking on another iPhone or iPad,
/// or the web page on a Mac. The web URL is also what the receiving app
/// parses, so Handoff reuses the universal-link route.
enum BookingHandoff {
    static let activityType = "com.erikrole.Wisconsin.booking"

    static func webURL(for booking: Booking) -> URL? {
        let section = booking.kind == .checkout ? "checkouts" : "reservations"
        return URL(string: "https://wisconsincreative.com/\(section)/\(booking.id)")
    }

    static func configure(_ activity: NSUserActivity, for booking: Booking) {
        activity.title = booking.title
        activity.webpageURL = webURL(for: booking)
        activity.isEligibleForHandoff = true
        // Search and prediction stay with `SpotlightIndexer`, which clears at
        // sign-out; a donated activity would outlive the session.
        activity.isEligibleForSearch = false
        activity.isEligibleForPrediction = false
        // Lets Siri and Apple Intelligence resolve "this booking" on screen.
        activity.appEntityIdentifier = EntityIdentifier(for: BookingEntity(booking: booking))
    }
}

struct BookingEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [BookingEntity] {
        var results: [BookingEntity] = []
        for id in identifiers {
            // Tolerate stale ids (cancelled/deleted bookings) instead of
            // failing the whole shortcut.
            if let booking = try? await APIClient.shared.booking(id: id) {
                results.append(BookingEntity(booking: booking))
            }
        }
        return results
    }

    // `bookings` spans both kinds already sorted by due date, so these no
    // longer fan out to one call per kind and re-merge on the client.
    func entities(matching string: String) async throws -> [BookingEntity] {
        let result = try await APIClient.shared.bookings(activeOnly: true, search: string, limit: 20)
        return dedupedEntities(from: result.data)
    }

    func suggestedEntities() async throws -> [BookingEntity] {
        let me = try await APIClient.shared.me()
        let result = try await APIClient.shared.bookings(activeOnly: true, requesterId: me.id, limit: 10)
        return dedupedEntities(from: result.data)
    }

    private func dedupedEntities(from bookings: [Booking]) -> [BookingEntity] {
        var seen = Set<String>()
        return bookings
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.endsAt < $1.endsAt }
            .map(BookingEntity.init)
    }
}

struct OpenBookingIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Booking"
    static let description = IntentDescription("Open a reservation or checkout in the app.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    static let openAppWhenRun = true

    @Parameter(title: "Booking")
    var booking: BookingEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$booking)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        GearTrackerAppIntentHandoff.shared.requestBooking(id: booking.id)
        return .result()
    }
}
