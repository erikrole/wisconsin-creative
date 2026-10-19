import XCTest
@testable import Wisconsin_Kiosk

final class KioskCompletionPreparationTests: XCTestCase {
    func testMissingURLThrowsAPIError() {
        var request = URLRequest(url: URL(string: "https://wisconsincreative.com/api/kiosk/checkout/complete")!)
        request.url = nil
        request.httpBody = Data("{}".utf8)

        XCTAssertThrowsError(try KioskCompletionPreparation.prepare(request: request, savedBody: nil, requestId: "req-1")) { error in
            guard case APIError.serverError(let message) = error else {
                return XCTFail("expected APIError.serverError, got \(error)")
            }
            XCTAssertFalse(message.isEmpty)
        }
    }

    func testMissingBodyThrowsAPIError() throws {
        let request = URLRequest(url: URL(string: "https://wisconsincreative.com/api/kiosk/checkout/complete")!)

        XCTAssertThrowsError(try KioskCompletionPreparation.prepare(request: request, savedBody: nil, requestId: "req-1")) { error in
            guard case APIError.serverError = error else {
                return XCTFail("expected APIError.serverError, got \(error)")
            }
        }
    }

    func testNonObjectBodyThrowsAPIError() throws {
        var request = URLRequest(url: URL(string: "https://wisconsincreative.com/api/kiosk/checkout/complete")!)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["not", "an", "object"])

        XCTAssertThrowsError(try KioskCompletionPreparation.prepare(request: request, savedBody: nil, requestId: "req-1")) { error in
            guard case APIError.serverError = error else {
                return XCTFail("expected APIError.serverError, got \(error)")
            }
        }
    }

    func testInvalidJSONThrowsAPIError() {
        var request = URLRequest(url: URL(string: "https://wisconsincreative.com/api/kiosk/checkout/complete")!)
        request.httpBody = Data("not-json".utf8)

        XCTAssertThrowsError(try KioskCompletionPreparation.prepare(request: request, savedBody: nil, requestId: "req-1")) { error in
            guard case APIError.serverError = error else {
                return XCTFail("expected APIError.serverError, got \(error)")
            }
        }
    }

    func testObjectBodyGainsARequestIdAndSortedKeys() throws {
        var request = URLRequest(url: URL(string: "https://wisconsincreative.com/api/kiosk/checkout/complete?unused=1")!)
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "actorId": "student-1",
            "endsAt": "2026-10-16T18:00:00Z",
        ])

        let prepared = try KioskCompletionPreparation.prepare(request: request, savedBody: nil, requestId: "req-42")

        XCTAssertEqual(prepared.path, "/api/kiosk/checkout/complete")
        XCTAssertTrue(prepared.shouldPersist)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: prepared.body) as? [String: Any])
        XCTAssertEqual(object["requestId"] as? String, "req-42")
        XCTAssertEqual(object["actorId"] as? String, "student-1")
        let expected = try JSONSerialization.data(withJSONObject: [
            "actorId": "student-1",
            "endsAt": "2026-10-16T18:00:00Z",
            "requestId": "req-42",
        ], options: [.sortedKeys])
        XCTAssertEqual(prepared.body, expected)
    }

    func testSavedBodyIsReusedWithoutRequiringANewPayload() throws {
        let request = URLRequest(url: URL(string: "https://wisconsincreative.com/api/kiosk/pickup/booking-1/confirm")!)
        let saved = Data("{\"requestId\":\"already-saved\"}".utf8)

        let prepared = try KioskCompletionPreparation.prepare(request: request, savedBody: saved, requestId: "ignored")

        XCTAssertEqual(prepared.path, "/api/kiosk/pickup/booking-1/confirm")
        XCTAssertEqual(prepared.body, saved)
        XCTAssertFalse(prepared.shouldPersist)
    }
}
