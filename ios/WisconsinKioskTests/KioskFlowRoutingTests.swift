import XCTest
@testable import Wisconsin_Kiosk

final class KioskFlowRoutingTests: XCTestCase {
    private let usman = KioskUser(id: "usman", name: "Usman", avatarUrl: nil, role: "STUDENT", affiliation: nil, affiliationBadge: nil)

    func testExpectedRequesterRejectsAnotherIdentityWithoutChangingIntent() {
        let other = KioskUser(id: "other", name: "Other", avatarUrl: nil, role: "STUDENT", affiliation: nil, affiliationBadge: nil)
        let intent = KioskFlowIntent(
            action: .pickup, source: .scan, identifiedUser: nil, expectedRequester: usman,
            selectedEvent: nil, targetBooking: nil, pendingScanValues: ["secret"],
            createdAt: Date(), ambiguity: .none
        )
        XCTAssertFalse(KioskFlowIntentReducer.canIdentify(other, for: intent))
        XCTAssertTrue(KioskFlowIntentReducer.canIdentify(usman, for: intent))
        XCTAssertEqual(intent.pendingScanValues.count, 1)
    }

    func testPendingScansAreConsumedExactlyOnce() {
        let intent = KioskFlowIntent(
            action: .checkout, source: .scan, identifiedUser: usman, expectedRequester: nil,
            selectedEvent: nil, targetBooking: nil, pendingScanValues: ["one"],
            createdAt: Date(), ambiguity: .none
        )
        let first = KioskFlowIntentReducer.consumePendingScans(in: intent)
        let second = KioskFlowIntentReducer.consumePendingScans(in: first.intent)
        XCTAssertEqual(first.scans, ["one"])
        XCTAssertTrue(second.scans.isEmpty)
    }

    func testHIDBurstRestoresOriginalTextAndSuppressesTheRemainder() {
        var detector = KioskHIDBurstDetector()
        let start = Date()
        var text = "Practice"
        for offset in 0..<5 {
            XCTAssertEqual(detector.evaluate(replacement: "X", currentText: text, at: start.addingTimeInterval(Double(offset) * 0.02)), .allow)
            text += "X"
        }
        XCTAssertEqual(detector.evaluate(replacement: "X", currentText: text, at: start.addingTimeInterval(0.10)), .reject(baseline: "Practice"))
        XCTAssertEqual(detector.evaluate(replacement: "Y", currentText: "Practice", at: start.addingTimeInterval(0.12)), .suppress)
    }

    func testHumanTypingWithPausesIsAllowed() {
        var detector = KioskHIDBurstDetector()
        let start = Date()
        for offset in 0..<8 {
            XCTAssertEqual(detector.evaluate(replacement: "a", currentText: String(repeating: "a", count: offset), at: start.addingTimeInterval(Double(offset) * 0.2)), .allow)
        }
    }

    func testQuarterHourRoundsForwardWithoutMovingAnExactBoundary() {
        let base = Date(timeIntervalSinceReferenceDate: 8 * 60 * 60)
        XCTAssertEqual(KioskQuarterHour.roundedUp(base), base)
        XCTAssertEqual(
            KioskQuarterHour.roundedUp(base.addingTimeInterval(7 * 60)),
            base.addingTimeInterval(15 * 60)
        )
    }

    func testQuarterHourClampNeverFallsBeforeTheRoundedMinimum() {
        let base = Date(timeIntervalSinceReferenceDate: 8 * 60 * 60)
        let minimum = base.addingTimeInterval(8 * 60)
        XCTAssertEqual(
            KioskQuarterHour.clamped(base, minimum: minimum),
            base.addingTimeInterval(15 * 60)
        )
    }

    @MainActor
    func testScannerHasOnlyOneLogicalOwner() {
        let scanner = KioskScannerCoordinator()
        scanner.claim(.home) { _ in }
        scanner.claim(.identity) { _ in }
        XCTAssertEqual(scanner.owner, .identity)
        scanner.setEditing(true)
        XCTAssertFalse(scanner.acceptsScans)
        XCTAssertEqual(scanner.statusText, "Scanner paused while editing")
    }

    func testCredentialBoundaryRejectsRequestsFromAReplacedKioskSession() {
        let boundary = KioskCredentialBoundary()
        let replacedSession = boundary.capture()

        boundary.advance()
        let activeSession = boundary.capture()

        XCTAssertFalse(boundary.owns(replacedSession))
        XCTAssertTrue(boundary.owns(activeSession))
    }
    @MainActor
    func testQueuedScansWaitForTheirOwnResponseAndPreserveBurstOrder() {
        let queue = KioskScanQueue()
        XCTAssertTrue(queue.enqueue(" A "))
        let first = queue.next()!
        XCTAssertFalse(queue.enqueue("a"))
        XCTAssertTrue(queue.enqueue("B"))
        XCTAssertNil(queue.next())
        XCTAssertEqual(queue.count, 2)
        queue.finish(first)
        let second = queue.next()!
        XCTAssertEqual(second.value, "B")
        queue.finish(first)
        XCTAssertEqual(queue.active, second)
        queue.finish(second)
        XCTAssertTrue(queue.isEmpty)
        XCTAssertTrue(queue.enqueue("A"))
    }

    @MainActor
    func testLateScanResponseCannotConsumeANewSessionsInput() {
        let queue = KioskScanQueue()
        queue.enqueue("A")
        let old = queue.next()!
        queue.reset()
        queue.enqueue("A")
        let current = queue.next()!
        queue.finish(old)
        XCTAssertEqual(queue.active, current)
        XCTAssertEqual(queue.count, 1)
        XCTAssertFalse(queue.enqueue("  "))
    }

    func testTrailingScansFollowTheOpeningScanOnceEach() {
        XCTAssertEqual(KioskFlowIntent.orderedScans("CAM-1", then: ["CAM-2", "CAM-1", "CAM-3", "CAM-2"]), ["CAM-1", "CAM-2", "CAM-3"])
        XCTAssertEqual(KioskFlowIntent.orderedScans("CAM-1", then: []), ["CAM-1"])
    }

    @MainActor
    func testAbandonedCartsExpireAfterRetention() {
        let store = KioskStore()
        let item = KioskCartItem(id: "a1", name: "Sony FX3", tagName: "CAM-014", type: "serialized", imageUrl: nil, bulkSkuId: nil, unitNumber: nil)
        store.setCart([item], for: "u-1")
        XCTAssertEqual(store.cart(for: "u-1"), [item])

        store.pruneExpiredCheckouts(now: Date().addingTimeInterval(KioskStore.cartRetention - 60))
        XCTAssertEqual(store.cart(for: "u-1"), [item], "a short step away keeps the scans")

        store.pruneExpiredCheckouts(now: Date().addingTimeInterval(KioskStore.cartRetention + 60))
        XCTAssertTrue(store.cart(for: "u-1").isEmpty, "an old cart must not reopen into scanning")
    }

    @MainActor
    func testInactivityNeverRunsOnTheActivationScreen() {
        let store = KioskStore()
        store.screen = .activation
        store.resetInactivity()
        XCTAssertFalse(store.inactivityWarningVisible)
        XCTAssertEqual(store.screen, .activation)
    }
}
