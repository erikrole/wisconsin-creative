import XCTest
@testable import Wisconsin_Kiosk

final class KioskRetryPolicyTests: XCTestCase {
    private let timeout = APIError.networkError(URLError(.timedOut))

    func testReadRetriesTransientFailureTwiceThenStops() {
        XCTAssertNotNil(KioskRetryPolicy.delay(method: "GET", error: timeout, attempt: 0))
        XCTAssertNotNil(KioskRetryPolicy.delay(method: "GET", error: timeout, attempt: 1))
        XCTAssertNil(KioskRetryPolicy.delay(method: "GET", error: timeout, attempt: 2))
    }

    func testNilMethodIsAGet() {
        XCTAssertNotNil(KioskRetryPolicy.delay(method: nil, error: timeout, attempt: 0))
    }

    func testWritesNeverRetry() {
        for method in ["POST", "PATCH", "PUT", "DELETE"] {
            XCTAssertNil(KioskRetryPolicy.delay(method: method, error: timeout, attempt: 0), method)
        }
    }

    func testNonTransientAndNonNetworkErrorsDoNotRetry() {
        XCTAssertNil(KioskRetryPolicy.delay(method: "GET", error: APIError.networkError(URLError(.notConnectedToInternet)), attempt: 0))
        XCTAssertNil(KioskRetryPolicy.delay(method: "GET", error: APIError.unauthorized, attempt: 0))
        XCTAssertNil(KioskRetryPolicy.delay(method: "GET", error: CancellationError(), attempt: 0))
        XCTAssertNil(KioskRetryPolicy.delay(method: "GET", error: APIError.serverError("x"), attempt: 0))
    }
}
