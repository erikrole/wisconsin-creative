import XCTest
@testable import Wisconsin

final class EventCatalogModelsTests: XCTestCase {
    func testSourceLabelPrefersThePublicCalendarHost() {
        let badgers = CalendarEventSource(id: "src", name: "Badgers", url: "webcal://uwbadgers.com/calendar")
        XCTAssertEqual(eventCatalogSourceLabel(source: badgers, createdByName: "Ignored"), "UWBadgers.com")

        let host = CalendarEventSource(id: "src", name: "Feed", url: "https://www.example.edu/sports.ics")
        XCTAssertEqual(eventCatalogSourceLabel(source: host, createdByName: nil), "example.edu")

        XCTAssertEqual(eventCatalogSourceLabel(source: nil, createdByName: "Ada"), "Added by Ada")
        XCTAssertEqual(eventCatalogSourceLabel(source: nil, createdByName: "  "), "Added in Schedule")
    }

    func testGearPlanAndBookingStatusesStayInTheSharedVocabulary() {
        XCTAssertEqual(eventGearPlanStatus("ready_for_pickup").label, "Ready for pickup")
        XCTAssertEqual(eventGearPlanStatus("checked_out").tone, .blue)
        XCTAssertEqual(eventGearPlanStatus("returned").tone, .green)
        XCTAssertEqual(eventCatalogBookingStatusCode("BOOKED").label, "Reserved")
        XCTAssertEqual(eventCatalogBookingStatusCode("OPEN").label, "Checked Out")
        XCTAssertEqual(eventCatalogBookingStatusCode("PENDING_PICKUP").tone, .orange)
        XCTAssertEqual(eventCatalogBookingStatusCode("not-a-status").label, "Gear")
    }

    func testOpenBookingPastItsEndIsOverdue() throws {
        let booking = try decodeBooking(status: "OPEN", endsAt: "2020-01-01T00:00:00Z")
        let status = eventBookingStatus(booking, now: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertEqual(status.label, "Overdue")
        XCTAssertEqual(status.tone, .red)
    }

    func testVenueUsesTheCalendarTextNotThePickupLocation() throws {
        let detail = try decodeDetail(extra: """
        "rawLocationText": "Madison, WI, Camp Randall Stadium",
        "location": {"id":"loc","name":"Pickup Cage"},
        """)
        XCTAssertEqual(eventCatalogVenueName(detail), "Camp Randall Stadium")
    }

    func testAllDayLabelUsesTheCalendarDayRatherThanTheRawInstant() {
        let start = Date(timeIntervalSince1970: 1_780_000_000)
        let event = ScheduleEvent(
            id: "e",
            summary: "Setup",
            startsAt: start,
            endsAt: start.addingTimeInterval(86_400),
            allDay: true,
            status: "CONFIRMED",
            sportCode: "VB",
            opponent: nil,
            isHome: nil,
            location: nil
        )
        XCTAssertTrue(eventCatalogWhenLabel(event, now: start).contains("All day"))

        let football = ScheduleEvent(
            id: "fb",
            summary: "Football",
            startsAt: start,
            endsAt: start.addingTimeInterval(86_400),
            allDay: true,
            status: "CONFIRMED",
            sportCode: "FB",
            opponent: nil,
            isHome: nil,
            location: nil
        )
        XCTAssertTrue(eventCatalogWhenLabel(football, now: start).contains("TBD"))
    }

    func testDetailDecodesTheCommandCenterAndIgnoresCrewFields() throws {
        let detail = try decodeDetail(extra: """
        "subtitle": "Homecoming",
        "isHidden": false,
        "source": {"id":"src","name":"Badgers","url":"https://uwbadgers.com/cal"},
        "createdByName": null,
        "combinedInto": {"id":"primary","summary":"Football vs Iowa"},
        "combinedEvents": [{
          "id": "secondary",
          "summary": "Cross Country",
          "startsAt": "2026-10-17T05:00:00Z",
          "endsAt": "2026-10-18T05:00:00Z",
          "allDay": true,
          "sportCode": "XC"
        }],
        """)
        XCTAssertEqual(detail.combinedInto?.id, "primary")
        XCTAssertEqual(detail.combinedEvents?.first?.opponent, nil)
        XCTAssertEqual(detail.asScheduleEvent().combinedIntoId, "primary")
        XCTAssertEqual(eventCatalogSourceLabel(source: detail.source, createdByName: detail.createdByName), "UWBadgers.com")

        let json = """
        {"shifts":[],"gearSummary":{"total":1},"gearPlans":[{
          "requesterUserId":"user-1",
          "requesterName":"Bucky",
          "bookingIds":["booking-1"],
          "title":"Camera kit",
          "state":"reserved",
          "itemCount":2
        }],"missingGear":[],"recentChanges":[]}
        """.data(using: .utf8)!
        let center = try clientDecoder().decode(EventCommandCenter.self, from: json)
        XCTAssertEqual(center.gearPlans?.first?.state, "reserved")
        XCTAssertEqual(center.gearPlans?.first?.itemCount, 2)
    }

    func testRecentWindowIsTheThirtyDaysBeforeToday() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 16, hour: 15))!
        let previous = NSTimeZone.default
        // The helper reads Calendar.current, so pin the zone the assertion uses.
        NSTimeZone.default = TimeZone(secondsFromGMT: 0)!
        defer { NSTimeZone.default = previous }
        let window = eventCatalogRecentWindow(now: now)
        let start = calendar.date(from: DateComponents(year: 2026, month: 9, day: 16))!
        let end = calendar.date(from: DateComponents(year: 2026, month: 10, day: 16))!
        XCTAssertEqual(window.start, start)
        XCTAssertEqual(window.end, end)
    }

    func testGearLinesNameSerializedAndBulkItems() throws {
        let booking = try decodeBooking(
            status: "BOOKED",
            endsAt: "2026-10-17T20:00:00Z",
            items: """
            "serializedItems": [{
              "id": "line-1",
              "assetId": "asset-1",
              "allocationStatus": "reserved",
              "asset": {"id":"asset-1","assetTag":"CAM-1","name":"Camera","brand":null,"model":null,"serialNumber":null,"imageUrl":null}
            }],
            "bulkItems": [{
              "id": "bulk-1",
              "plannedQuantity": 3,
              "checkedOutQuantity": 0,
              "checkedInQuantity": 0,
              "bulkSku": {"id":"sku-1","name":"Battery","unit":"each","imageUrl":null,"trackByNumber":false},
              "unitAllocations": null
            }],
            """
        )
        let lines = eventGearLines(from: booking)
        XCTAssertEqual(lines.map(\.title), ["CAM-1", "Battery"])
        XCTAssertEqual(lines.map(\.bookingId), ["booking-1", "booking-1"])
        XCTAssertTrue(lines[1].subtitle.contains("3 planned"))
    }

    private func decodeDetail(extra: String) throws -> CalendarEventDetail {
        let json = """
        {
          "id": "event-1",
          "summary": "Football vs Iowa",
          "startsAt": "2026-10-17T17:00:00Z",
          "endsAt": "2026-10-17T20:00:00Z",
          "allDay": false,
          "status": "CONFIRMED",
          "sportCode": "FB",
          "opponent": "Iowa",
          "isHome": true,
          "site": "HOME",
          \(extra)
          "createdAt": "2026-10-01T00:00:00Z"
        }
        """.data(using: .utf8)!
        return try clientDecoder().decode(CalendarEventDetail.self, from: json)
    }

    private func decodeBooking(status: String, endsAt: String, items: String = "\"serializedItems\": [], \"bulkItems\": [],") throws -> Booking {
        let json = """
        {
          "id": "booking-1",
          "kind": "RESERVATION",
          "title": "Camera kit",
          "status": "\(status)",
          "startsAt": "2026-10-17T15:00:00Z",
          "endsAt": "\(endsAt)",
          "notes": null,
          "refNumber": "R-100",
          "requester": {"id":"user-1","name":"Bucky Badger","email":null,"avatarUrl":null},
          "location": {"id":"location-1","name":"Kellner Hall"},
          \(items)
          "event": null,
          "updatedAt": "2026-10-16T00:00:00Z",
          "pickupKioskDevice": null
        }
        """.data(using: .utf8)!
        return try clientDecoder().decode(Booking.self, from: json)
    }

    private func clientDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
