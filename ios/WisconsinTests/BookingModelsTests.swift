import XCTest
@testable import Wisconsin

final class BookingModelsTests: XCTestCase {
    func testBookingDecodesCanonicalActionsAndEveryLinkedEvent() throws {
        let booking = try decodeBooking(extraFields: """
          "events": [
            {"id":"event-1","summary":"Volleyball vs USC","sportCode":"VB","opponent":"USC","isHome":true},
            {"id":"event-2","summary":"Volleyball vs UCLA","sportCode":"VB","opponent":"UCLA","isHome":true}
          ],
          "allowedActions": ["edit", "extend", "cancel"],
        """)

        XCTAssertEqual(booking.linkedEvents.map(\.id), ["event-1", "event-2"])
        XCTAssertEqual(booking.allows("edit"), true)
        XCTAssertEqual(booking.allows("transfer-owner"), false)
    }

    func testBookingFallsBackToLegacyPrimaryEventAndUnknownActions() throws {
        let booking = try decodeBooking(extraFields: "")

        XCTAssertEqual(booking.linkedEvents.map(\.id), ["event-primary"])
        XCTAssertNil(booking.allows("edit"))
    }

    @MainActor
    func testInstallingBookingPreservesExplicitTitleOrder() throws {
        let early = try decodeBooking(extraFields: "", id: "early", title: "Zulu", startsAt: "2026-08-10T10:00:00Z")
        let later = try decodeBooking(extraFields: "", id: "later", title: "Alpha", startsAt: "2026-08-10T15:00:00Z")
        let vm = BookingsViewModel()
        vm.sortOption = .titleAZ
        vm.bookings = [later, early]
        vm.applyServerOrderIfNeeded()
        vm.install(later)
        XCTAssertEqual(vm.sortedBookings.map(\.id), ["later", "early"])
    }

    @MainActor
    func testInstallingBookingKeepsOperationalOrderingByDefault() throws {
        let early = try decodeBooking(extraFields: "", id: "early", title: "Zulu", startsAt: "2026-08-10T10:00:00Z")
        let later = try decodeBooking(extraFields: "", id: "later", title: "Alpha", startsAt: "2026-08-10T15:00:00Z")
        let vm = BookingsViewModel()
        vm.bookings = [later, early]
        vm.install(later)
        XCTAssertEqual(vm.sortedBookings.map(\.id), ["early", "later"])
    }

    private func decodeBooking(extraFields: String, id: String = "booking-1", title: String = "Tournament kit", startsAt: String = "2026-08-10T15:00:00Z") throws -> Booking {
        let json = """
        {
          "id": "\(id)",
          "kind": "RESERVATION",
          "title": "\(title)",
          "status": "BOOKED",
          "startsAt": "\(startsAt)",
          "endsAt": "2026-08-10T20:00:00Z",
          "notes": null,
          "refNumber": "R-100",
          "requester": {"id":"user-1","name":"Bucky Badger","email":"bucky@wisc.edu","avatarUrl":null},
          "location": {"id":"location-1","name":"Kellner Hall"},
          "serializedItems": [],
          "bulkItems": [],
          "event": {"id":"event-primary","summary":"Volleyball vs USC","sportCode":"VB","opponent":"USC","isHome":true},
          \(extraFields)
          "updatedAt": "2026-08-09T20:00:00Z",
          "pickupKioskDevice": null
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Booking.self, from: json)
    }
}
