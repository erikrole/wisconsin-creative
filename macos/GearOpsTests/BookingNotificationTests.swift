import Foundation
import XCTest
@testable import GearOps

final class BookingNotificationTests: XCTestCase {
    func testStatusTransitionsUseOperationalLanguage() {
        let booked = snapshot(status: .booked)

        XCTAssertEqual(
            BookingChangeDetector.change(from: nil, to: booked)?.statusLabel,
            "Reserved"
        )
        XCTAssertEqual(
            BookingChangeDetector.change(from: booked, to: snapshot(status: .open))?.statusLabel,
            "Checked Out"
        )
        XCTAssertEqual(
            BookingChangeDetector.change(from: snapshot(status: .open), to: snapshot(status: .completed))?.statusLabel,
            "Checked In"
        )
        XCTAssertEqual(
            BookingChangeDetector.change(from: booked, to: snapshot(status: .cancelled))?.statusLabel,
            "Cancelled"
        )
    }

    func testChangesCarryServerUpdateTimestamp() {
        let updatedAt = Date(timeIntervalSince1970: 1_700_123_456)

        XCTAssertEqual(
            BookingChangeDetector.change(from: nil, to: snapshot(updatedAt: updatedAt))?.timestamp,
            updatedAt
        )
    }

    func testSummaryUsesStackableStatusRequesterTimestampLayout() {
        let updatedAt = Date(timeIntervalSince1970: 1_700_123_456)
        let timestamp = updatedAt.formatted(date: .abbreviated, time: .shortened)

        XCTAssertEqual(
            BookingChangeDetector.change(from: nil, to: snapshot(updatedAt: updatedAt))?.summary,
            "Reserved • Erik Role • \(timestamp)"
        )
    }

    func testLaterDueDateIsAnExtension() {
        let previous = snapshot(endsAt: Date(timeIntervalSince1970: 1_800_000_000))
        let current = snapshot(endsAt: Date(timeIntervalSince1970: 1_800_086_400))

        XCTAssertEqual(
            BookingChangeDetector.change(from: previous, to: current)?.statusLabel,
            "Extended"
        )
    }

    func testSameStatusAndDueDateIsGenericUpdate() {
        let previous = snapshot(title: "Camera")
        let current = snapshot(title: "Camera and audio")

        XCTAssertEqual(
            BookingChangeDetector.change(from: previous, to: current)?.statusLabel,
            "Updated"
        )
    }

    func testAvatarOnlyProjectionChangeDoesNotNotify() {
        let previous = snapshot(avatarURL: nil)
        let current = snapshot(avatarURL: "https://example.com/avatar.jpg")

        XCTAssertNil(BookingChangeDetector.change(from: previous, to: current))
    }

    func testDeepLinksPreserveBookingKind() {
        XCTAssertEqual(
            BookingDeepLink.bookingURL(id: "checkout-1", kind: .checkout)?.absoluteString,
            "https://wisconsincreative.com/bookings?tab=checkouts&highlight=checkout-1"
        )
        XCTAssertEqual(
            BookingDeepLink.bookingURL(id: "reservation-1", kind: .reservation)?.absoluteString,
            "https://wisconsincreative.com/bookings?tab=reservations&highlight=reservation-1"
        )
        XCTAssertEqual(
            BookingDeepLink.pendingPickupsURL?.absoluteString,
            "https://wisconsincreative.com/bookings?tab=all"
        )
        XCTAssertEqual(
            BookingDeepLink.notificationURL(bookingID: "legacy-1", rawKind: nil)?.absoluteString,
            "https://wisconsincreative.com/bookings?tab=all&highlight=legacy-1"
        )
    }

    func testLaterUpdatesReplaceTheSameBookingNotification() {
        let first = BookingChangeDetector.change(from: nil, to: snapshot(status: .booked))
        let second = BookingChangeDetector.change(
            from: snapshot(status: .booked),
            to: snapshot(status: .open)
        )

        XCTAssertEqual(first?.notificationIdentifier, "booking-change-booking-1")
        XCTAssertEqual(second?.notificationIdentifier, first?.notificationIdentifier)
        XCTAssertEqual(CompanionBookingNotification.categoryIdentifier, "GT_BOOKING")
        XCTAssertEqual(CompanionBookingNotification.openActionIdentifier, "OPEN_BOOKING")
    }

    func testForegroundPresentationKeepsSilenceUnlessTheAlertCarriesSound() {
        XCTAssertEqual(
            BookingNotificationPresentation.options(playsSound: false),
            [.banner, .list]
        )
        XCTAssertEqual(
            BookingNotificationPresentation.options(playsSound: true),
            [.banner, .list, .sound]
        )
    }

    func testPayloadStaysVisibleAndSilentUnlessSoundIsOptedIn() {
        let change = BookingChangeDetector.change(from: nil, to: snapshot())!
        let silent = BookingNotificationPayload.content(for: change, playsSound: false)
        XCTAssertEqual(silent.title, "Camera checkout")
        XCTAssertEqual(silent.categoryIdentifier, "GT_BOOKING")
        XCTAssertEqual(silent.threadIdentifier, "booking-booking-1")
        XCTAssertEqual(silent.targetContentIdentifier, "booking-change-booking-1")
        XCTAssertEqual(silent.interruptionLevel, .active)
        XCTAssertNil(silent.sound)
        XCTAssertEqual(silent.relevanceScore, 0.4)

        let audible = BookingNotificationPayload.content(for: change, playsSound: true)
        XCTAssertEqual(audible.sound, .default)
        XCTAssertEqual(audible.interruptionLevel, .active)
    }

    private func snapshot(
        title: String = "Camera checkout",
        status: BookingStatus = .booked,
        endsAt: Date = Date(timeIntervalSince1970: 1_800_000_000),
        updatedAt: Date = Date(timeIntervalSince1970: 1_700_000_000),
        avatarURL: String? = nil
    ) -> BookingActivitySnapshot {
        BookingActivitySnapshot(
            id: "booking-1",
            title: title,
            kind: .reservation,
            status: status,
            startsAt: Date(timeIntervalSince1970: 1_799_000_000),
            endsAt: endsAt,
            updatedAt: updatedAt,
            requester: .init(id: "user-1", name: "Erik Role", avatarUrl: avatarURL),
            location: .init(id: "location-1", name: "Kohl Center")
        )
    }
}
