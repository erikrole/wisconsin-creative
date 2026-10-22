import XCTest
@testable import Wisconsin

/// Serves canned responses in order and records every request it sees.
private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    enum Step {
        case status(Int, headers: [String: String] = [:], body: String = "{}")
        case failure(URLError.Code)
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var steps: [Step] = []
    nonisolated(unsafe) private static var requests: [URLRequest] = []

    static func reset(_ newSteps: [Step]) {
        lock.lock()
        steps = newSteps
        requests = []
        lock.unlock()
    }

    static var recordedRequests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request)
        let step = Self.steps.isEmpty ? Step.status(200) : Self.steps.removeFirst()
        Self.lock.unlock()

        switch step {
        case .failure(let code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        case .status(let code, let headers, let body):
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: code,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}

@MainActor
final class APIClientRetryTests: XCTestCase {
    private let fastPolicy = RequestRetryPolicy(maxAttempts: 3, baseDelay: 0.001, maxDelay: 0.01)

    private func makeClient(_ steps: [StubURLProtocol.Step]) -> APIClient {
        StubURLProtocol.reset(steps)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return APIClient(session: URLSession(configuration: config), retryPolicy: fastPolicy)
    }

    func testGetRetriesTransientServerErrorThenSucceeds() async throws {
        let client = makeClient([
            .status(503),
            .status(200, body: #"{"data":[]}"#)
        ])
        let passkeys = try await client.passkeys()
        XCTAssertTrue(passkeys.isEmpty)
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 2)
    }

    func testGetRetriesDroppedConnection() async throws {
        let client = makeClient([
            .failure(.networkConnectionLost),
            .status(200, body: #"{"data":[]}"#)
        ])
        _ = try await client.passkeys()
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 2)
    }

    func testGetHonoursRetryAfterOn429() async throws {
        let client = makeClient([
            .status(429, headers: ["Retry-After": "0"]),
            .status(200, body: #"{"data":[]}"#)
        ])
        _ = try await client.passkeys()
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 2)
    }

    func testGetStopsAfterMaxAttemptsAndReportsServerError() async {
        let client = makeClient([.status(503), .status(503), .status(503), .status(200)])
        do {
            _ = try await client.passkeys()
            XCTFail("Expected an error")
        } catch let APIError.httpError(statusCode, _) {
            XCTAssertEqual(statusCode, 503)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 3)
    }

    func testRateLimitWithLongRetryAfterSurfacesFriendlyMessageWithoutRetry() async {
        let client = makeClient([.status(429, headers: ["Retry-After": "120"])])
        do {
            _ = try await client.passkeys()
            XCTFail("Expected an error")
        } catch let APIError.httpError(statusCode, message) {
            XCTAssertEqual(statusCode, 429)
            XCTAssertTrue(message.localizedCaseInsensitiveContains("too many"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
    }

    func testPostIsNeverRetried() async {
        let client = makeClient([.status(503), .status(200)])
        do {
            _ = try await client.cancelBooking(id: "b1")
            XCTFail("Expected an error")
        } catch let APIError.httpError(statusCode, _) {
            XCTAssertEqual(statusCode, 503)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
    }

    func testOfflineFailsFastWithoutRetry() async {
        let client = makeClient([.failure(.notConnectedToInternet), .status(200)])
        do {
            _ = try await client.passkeys()
            XCTFail("Expected an error")
        } catch let APIError.networkError(underlying) {
            XCTAssertEqual((underlying as? URLError)?.code, .notConnectedToInternet)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
    }

    func testNotFoundMapsWithoutRetry() async {
        let client = makeClient([.status(404)])
        do {
            _ = try await client.passkeys()
            XCTFail("Expected an error")
        } catch APIError.notFound {
            // expected
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
    }
}

final class RequestRetryPolicyTests: XCTestCase {
    func testOnlyReadsAreRetryable() {
        let policy = RequestRetryPolicy.standard
        XCTAssertTrue(policy.allowsRetry(method: nil))
        XCTAssertTrue(policy.allowsRetry(method: "get"))
        XCTAssertTrue(policy.allowsRetry(method: "HEAD"))
        XCTAssertFalse(policy.allowsRetry(method: "POST"))
        XCTAssertFalse(policy.allowsRetry(method: "PATCH"))
        XCTAssertFalse(policy.allowsRetry(method: "DELETE"))
    }

    func testBackoffDoublesAndCaps() {
        let policy = RequestRetryPolicy(maxAttempts: 6, baseDelay: 1, maxDelay: 3)
        XCTAssertEqual(policy.delay(afterAttempt: 1), 1)
        XCTAssertEqual(policy.delay(afterAttempt: 2), 2)
        XCTAssertEqual(policy.delay(afterAttempt: 3), 3)
        XCTAssertEqual(policy.delay(afterAttempt: 4), 3)
        XCTAssertNil(policy.delay(afterAttempt: 6))
    }

    func testRetryAfterRaisesWaitButNeverBeyondCap() {
        let policy = RequestRetryPolicy(maxAttempts: 3, baseDelay: 0.5, maxDelay: 4)
        XCTAssertEqual(policy.delay(afterAttempt: 1, retryAfter: 2), 2)
        XCTAssertEqual(policy.delay(afterAttempt: 1, retryAfter: 0), 0.5)
        XCTAssertNil(policy.delay(afterAttempt: 1, retryAfter: 30))
    }

    func testRetryAfterParsesSecondsAndHTTPDates() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(RequestRetryPolicy.retryAfterInterval(from: "7", now: now), 7)
        XCTAssertNil(RequestRetryPolicy.retryAfterInterval(from: nil, now: now))
        XCTAssertNil(RequestRetryPolicy.retryAfterInterval(from: "soon", now: now))
        let later = now.addingTimeInterval(10)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        let interval = RequestRetryPolicy.retryAfterInterval(from: formatter.string(from: later), now: now)
        XCTAssertEqual(interval ?? -1, 10, accuracy: 0.5)
    }
}
