import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

/// Puts the signed-in user's own gear into system search, so typing a booking
/// title or ref number into Spotlight opens it directly.
///
/// Scope is deliberately narrow. Only the caller's own bookings are indexed —
/// never `teamCheckouts`, and never the item catalog, which is shared data
/// that would put other people's names into this phone's search index. The
/// index is cleared at every session boundary for the same reason: Spotlight
/// results are readable without unlocking the app.
enum SpotlightIndexer {
    /// One domain, so a single `deleteSearchableItems(withDomainIdentifiers:)`
    /// removes everything this app contributed.
    static let domainIdentifier = "com.erikrole.Wisconsin.bookings"

    static func index(from dashboard: DashboardData, now: Date = Date()) {
        let bookings = dashboard.myCheckouts.items + dashboard.myReservations
        Task { await apply(bookings: bookings, now: now) }
    }

    static func clear() {
        Task { await apply(bookings: [], now: Date()) }
    }

    /// `CSSearchableItem` is not `Sendable`, so the items are built inside the
    /// async context that consumes them rather than captured across it.
    private static func apply(bookings: [BookingSummary], now: Date) async {
        let index = CSSearchableIndex.default()
        do {
            // Replace the whole domain rather than merging: a booking that has
            // been returned or cancelled simply drops out of the dashboard
            // payload, and an additive index would keep offering it forever.
            try await index.deleteSearchableItems(withDomainIdentifiers: [domainIdentifier])
            guard !bookings.isEmpty else { return }
            try await index.indexSearchableItems(bookings.map { searchableItem(for: $0, now: now) })
        } catch {
            // Spotlight is an accelerator, never a source of truth. A failed
            // index leaves every in-app path working, so it stays silent
            // rather than surfacing an error the user cannot act on.
        }
    }

    /// The booking id, which is also what `wisconsin://booking/<id>` and the
    /// push router already accept — so a Spotlight tap reuses the one routing
    /// path instead of adding another.
    static func bookingId(from userInfo: [AnyHashable: Any]?) -> String? {
        guard let id = userInfo?[CSSearchableItemActivityIdentifier] as? String,
              !id.isEmpty else { return nil }
        return id
    }

    private static func searchableItem(for booking: BookingSummary, now: Date) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.title = booking.title
        attributes.contentDescription = description(for: booking, now: now)
        attributes.keywords = [
            booking.refNumber,
            booking.locationName,
            booking.kind == .reservation ? "reservation" : "checkout",
        ].compactMap { $0 }.filter { !$0.isEmpty }
        // Surfaces the real deadline in the Spotlight result rather than only
        // in our own description string.
        attributes.dueDate = booking.endsAt
        attributes.completionDate = nil

        let item = CSSearchableItem(
            uniqueIdentifier: booking.id,
            domainIdentifier: domainIdentifier,
            attributeSet: attributes
        )
        // Gear turns over constantly; an index entry that outlives the booking
        // is a dead search result. Expire a week past the due date as a
        // backstop for the case where the app is never opened again.
        item.expirationDate = booking.endsAt.addingTimeInterval(7 * 24 * 60 * 60)
        return item
    }

    private static func description(for booking: BookingSummary, now: Date) -> String {
        var parts: [String] = []
        if booking.isOverdue {
            parts.append("Overdue")
        } else if booking.kind == .reservation {
            parts.append("Pickup \(booking.startsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))")
        } else {
            parts.append("Due \(booking.endsAt.operationalDateTimeLabel(now: now, capitalizesRelativeDay: false))")
        }
        if let location = booking.locationName, !location.isEmpty {
            parts.append(location)
        }
        if booking.itemCount > 0 {
            parts.append("\(booking.itemCount) item\(booking.itemCount == 1 ? "" : "s")")
        }
        return parts.joined(separator: " · ")
    }
}
