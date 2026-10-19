import XCTest
@testable import Wisconsin

@MainActor
final class ReportSessionTests: XCTestCase {
    private final class Clock {
        var date = Date(timeIntervalSince1970: 10_000)
    }

    private func makeSession(clock: Clock) -> ReportSession<Int> {
        ReportSession(freshness: 60, now: { clock.date })
    }

    func testANewKeyClearsThePreviousValueAndRejectsTheOldToken() {
        let clock = Clock()
        let session = makeSession(clock: clock)
        let first = session.begin(key: "30", force: false)
        let firstToken = try? XCTUnwrap(first)
        XCTAssertNotNil(firstToken)
        XCTAssertTrue(session.succeed(firstToken!, value: 3, incomplete: false))
        XCTAssertEqual(session.value, 3)

        let second = session.begin(key: "90", force: false)
        XCTAssertNotNil(second)
        XCTAssertNil(session.value)
        XCTAssertFalse(session.succeed(firstToken!, value: 3, incomplete: false))
        XCTAssertTrue(session.succeed(second!, value: 9, incomplete: false))
        XCTAssertEqual(session.value, 9)
        XCTAssertNil(session.error)
        XCTAssertFalse(session.isLoading)
    }

    func testAFreshValueIsNotFetchedAgain() {
        let clock = Clock()
        let session = makeSession(clock: clock)
        let token = session.begin(key: "30", force: false)
        XCTAssertTrue(session.succeed(token!, value: 4, incomplete: false))
        clock.date = clock.date.addingTimeInterval(30)

        XCTAssertNil(session.begin(key: "30", force: false))
        XCTAssertNotNil(session.begin(key: "30", force: true))
    }

    func testIncompleteResultsDoNotCountAsFresh() {
        let session = makeSession(clock: Clock())
        let token = session.begin(key: "30", force: false)
        XCTAssertTrue(session.succeed(token!, value: 1, incomplete: true))

        XCTAssertNotNil(session.begin(key: "30", force: false))
    }

    func testDiscardDropsTheValueAndInvalidatesTheToken() {
        let session = makeSession(clock: Clock())
        let token = session.begin(key: "30", force: false)
        XCTAssertTrue(session.succeed(token!, value: 2, incomplete: false))
        session.discard()

        XCTAssertNil(session.value)
        XCTAssertNil(session.error)
        XCTAssertTrue(session.isLoading)
        XCTAssertFalse(session.succeed(token!, value: 2, incomplete: false))
    }

    func testReplaceKeepsTheLoadedKeyAndRejectsADifferentOne() {
        let session = makeSession(clock: Clock())
        let token = session.begin(key: "scans", force: false)
        XCTAssertTrue(session.succeed(token!, value: 1, incomplete: false))

        XCTAssertTrue(session.replace(2, key: "scans", revision: token!))
        XCTAssertEqual(session.value, 2)
        XCTAssertFalse(session.replace(3, key: "other", revision: token!))
        XCTAssertEqual(session.value, 2)
    }

    func testAFailedRefreshKeepsThePreviousValue() {
        let session = makeSession(clock: Clock())
        let first = session.begin(key: "30", force: false)!
        XCTAssertTrue(session.succeed(first, value: 8, incomplete: false))
        let refresh = session.begin(key: "30", force: true)!
        XCTAssertEqual(session.value, 8)
        XCTAssertTrue(session.fail(refresh, message: "Offline"))

        XCTAssertEqual(session.value, 8)
        XCTAssertEqual(session.error, "Offline")
        XCTAssertFalse(session.isLoading)
    }
    func testLatePageCannotReplaceARefreshedReportWithTheSameKey() {
        let session = makeSession(clock: Clock())
        let original = session.begin(key: "scans", force: false)!
        session.succeed(original, value: 10, incomplete: false)
        let refresh = session.begin(key: "scans", force: true)!
        session.succeed(refresh, value: 20, incomplete: false)
        XCTAssertFalse(session.replace(11, key: "scans", revision: original))
        XCTAssertEqual(session.value, 20)
        session.note("Page failed")
        XCTAssertTrue(session.replace(21, key: "scans", revision: refresh))
        XCTAssertNil(session.error)
        XCTAssertEqual(session.value, 21)
    }

    func testAccessDenialDiscardsCachedDataOnlyForTheOwningRequest() {
        let session = makeSession(clock: Clock())
        let original = session.begin(key: "usage", force: false)!
        session.succeed(original, value: 10, incomplete: false)
        let refresh = session.begin(key: "usage", force: true)!
        XCTAssertFalse(session.fail(original, message: "Forbidden", discardValue: true))
        XCTAssertEqual(session.value, 10)
        XCTAssertTrue(session.fail(refresh, message: "Forbidden", discardValue: true))
        XCTAssertNil(session.value)
        XCTAssertNotNil(session.begin(key: "usage", force: false))
    }

}
