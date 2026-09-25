import XCTest
@testable import Wisconsin

final class GearTrackerRouteTests: XCTestCase {
    func testParsesCustomSchemeDestinations() {
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://scan")!), .scan)
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://bookings")!), .myGear)
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://booking/bk_1")!), .booking("bk_1"))
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://schedule/evt_1")!), .event("evt_1"))
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://reserve")!), .createReservation)
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://licenses")!), .licenses)
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://notifications")!), .inbox)
    }

    func testParsesUniversalLinksFromCalendarAndMail() {
        XCTAssertEqual(
            GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/events/evt_1")!),
            .event("evt_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/reservations/bk_1")!),
            .booking("bk_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/checkouts/bk_2")!),
            .booking("bk_2")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/items?search=Sony%20Battery")!),
            .itemsSearch("Sony Battery")
        )
        XCTAssertNil(GearTrackerRouteParser.parse(URL(string: "https://evil.example/events/evt_1")!))
        XCTAssertNil(GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/settings/calendar-sources")!))
    }

    func testIgnoresMutationQueryParametersOnBookingLinks() {
        XCTAssertEqual(
            GearTrackerRouteParser.parse(URL(string: "wisconsin://booking/bk_1?action=extend")!),
            .booking("bk_1")
        )
    }

    func testNotificationPayloadsCoverEveryFamily() {
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["bookingId": "bk_1"]),
            .booking("bk_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["checkoutId": "bk_2"]),
            .booking("bk_2")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["eventId": "evt_1"], type: "shift_assigned"),
            .event("evt_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["assetId": "ast_1"], type: "checkin_item_damaged"),
            .item("ast_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["userId": "usr_1"], type: "badge_awarded"),
            .user("usr_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["type": "license_expiry"]),
            .licenses
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["href": "/items?search=Sony"]),
            .itemsSearch("Sony")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["blastId": "bl_1"]),
            .blast("bl_1")
        )
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: [:], type: "calendar_sync_failure"),
            .inbox
        )
    }

    func testRecipientUserIdIsNotADestination() {
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["userId": "usr_1"], type: "shift_assigned"),
            .inbox
        )
    }

    func testNotificationSettingsRoutesEverywhere() {
        XCTAssertEqual(
            GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/settings/notifications")!),
            .notificationSettings
        )
        XCTAssertEqual(GearTrackerRouteParser.parse(URL(string: "wisconsin://settings/notifications")!), .notificationSettings)
        // Other settings pages have no native home and stay on the web.
        XCTAssertNil(GearTrackerRouteParser.parse(URL(string: "https://wisconsincreative.com/settings/calendar-sources")!))
        XCTAssertEqual(
            GearTrackerRouteParser.parseNotification(userInfo: ["href": "/settings/notifications"]),
            .notificationSettings
        )
        let url = GearTrackerRouteParser.wisconsinURL(for: .notificationSettings)
        XCTAssertEqual(url.flatMap(GearTrackerRouteParser.parse), .notificationSettings)
    }
}
