import XCTest
@testable import Wisconsin

final class BookingModelsTests: XCTestCase {
    func testCheckedOutGearCanBeReservedAfterTheTurnaroundBuffer() {
        let dueBack = Date(timeIntervalSince1970: 1_800_000_000)
        let pickup = dueBack.addingTimeInterval(60 * 60)

        XCTAssertTrue(canReserveSerializedAssetForWindow(
            computedStatus: .checkedOut,
            holderEndsAt: dueBack,
            requestedStartsAt: pickup,
            hasConflict: false
        ))
        XCTAssertFalse(canReserveSerializedAssetForWindow(
            computedStatus: .checkedOut,
            holderEndsAt: dueBack.addingTimeInterval(60),
            requestedStartsAt: pickup,
            hasConflict: false
        ))
        XCTAssertFalse(canReserveSerializedAssetForWindow(
            computedStatus: .pendingPickup,
            holderEndsAt: nil,
            requestedStartsAt: pickup,
            hasConflict: false
        ))
        XCTAssertTrue(canReserveSerializedAssetForWindow(
            computedStatus: .reserved,
            holderEndsAt: dueBack,
            requestedStartsAt: pickup,
            hasConflict: false
        ))
    }

    func testReservationWindowStillBlocksMaintenanceAndKnownOverlaps() {
        let pickup = Date(timeIntervalSince1970: 1_800_003_600)

        XCTAssertTrue(canReserveSerializedAssetForWindow(
            computedStatus: .available,
            holderEndsAt: nil,
            requestedStartsAt: pickup,
            hasConflict: false
        ))
        XCTAssertFalse(canReserveSerializedAssetForWindow(
            computedStatus: .available,
            holderEndsAt: nil,
            requestedStartsAt: pickup,
            hasConflict: true
        ))
        XCTAssertFalse(canReserveSerializedAssetForWindow(
            computedStatus: .maintenance,
            holderEndsAt: nil,
            requestedStartsAt: pickup,
            hasConflict: false
        ))
        XCTAssertFalse(canReserveSerializedAssetForWindow(
            computedStatus: .retired,
            holderEndsAt: pickup,
            requestedStartsAt: pickup.addingTimeInterval(86_400),
            hasConflict: false
        ))
    }

    func testCurrentHoldCopyUsesTheReturnWhenTheListOmitsAStart() {
        let endsAt = Date(timeIntervalSince1970: 1_800_000_000)
        let pending = ReservationAvailabilityCaption.make(
            requesterName: "Ryan",
            kind: "CHECKOUT",
            status: "PENDING_PICKUP",
            startsAt: nil,
            endsAt: endsAt,
            now: endsAt.addingTimeInterval(-3_600)
        )
        let reserved = ReservationAvailabilityCaption.make(
            requesterName: "Ryan",
            kind: "RESERVATION",
            status: "BOOKED",
            startsAt: nil,
            endsAt: endsAt,
            now: endsAt.addingTimeInterval(-3_600)
        )
        let later = ReservationAvailabilityCaption.make(
            requesterName: "Ryan",
            kind: "RESERVATION",
            status: "BOOKED",
            startsAt: endsAt.addingTimeInterval(86_400),
            endsAt: endsAt.addingTimeInterval(90_000),
            now: endsAt
        )

        XCTAssertEqual(pending?.kind, .held)
        XCTAssertTrue(pending?.text.hasPrefix("Ryan has this item until") == true)
        XCTAssertEqual(reserved?.kind, .held)
        XCTAssertEqual(later?.kind, .reserved)
        XCTAssertTrue(later?.text.hasPrefix("Ryan has reserved for") == true)
    }

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
