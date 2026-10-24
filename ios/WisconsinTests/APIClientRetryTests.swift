import XCTest
@testable import Wisconsin

/// Serves canned responses in order and records every request it sees.
private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    enum Step {
        case status(Int, headers: [String: String] = [:], body: String = "{}")
        case failure(URLError.Code)
        case pending
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
        // Decoding failures send asynchronous diagnostic reports through the
        // same session. They must not consume the next test's response script.
        if request.url?.path == "/api/errors" {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(#"{"data":{"stored":1}}"#.utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        Self.lock.lock()
        Self.requests.append(request)
        let step = Self.steps.isEmpty ? Step.status(200) : Self.steps.removeFirst()
        Self.lock.unlock()

        switch step {
        case .pending:
            break
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

    private func jsonBody(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var body = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                body.append(buffer, count: count)
            }
            data = body
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [String: Any])
    }

    func testInviteDiscoveryForwardsTheInboxProofWithTheNormalizedAddress() async throws {
        let client = makeClient([.status(200, body: #"{"flow":"onboarding","inviteLink":"valid"}"#)])
        let result = try await client.discoverAuth(email: " Alex@WISC.EDU ", invite: "raw-inbox-token")
        XCTAssertFalse(result.needsInviteLink(token: "raw-inbox-token"))
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.url?.path, "/api/auth/discover")
        let body = try jsonBody(request)
        XCTAssertEqual(body["email"] as? String, "alex@wisc.edu")
        XCTAssertEqual(body["invite"] as? String, "raw-inbox-token")
    }

    func testRegisterForwardsTheTokenAndReturnsTypedRecoveryForAnExpiredLink() async throws {
        let client = makeClient([.status(403, body: #"{"error":"Open your new invite link.","code":"INVITE_LINK_REQUIRED"}"#)])
        do {
            _ = try await client.register(name: " Alex ", email: " Alex@WISC.EDU ", password: "fixture-password", inviteToken: "retired-token")
            XCTFail("An expired link must not create a local session")
        } catch APIError.inviteLinkRequired(let message) {
            XCTAssertEqual(message, "Open your new invite link.")
        }
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.url?.path, "/api/auth/register")
        let body = try jsonBody(request)
        XCTAssertEqual(body["inviteToken"] as? String, "retired-token")
        XCTAssertEqual(body["email"] as? String, "alex@wisc.edu")
        XCTAssertEqual(body["name"] as? String, "Alex")
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
    }

    func testInviteResendDecodesUnavailableWithoutClaimingDelivery() async throws {
        let client = makeClient([.status(200, body: #"{"message":"Contact your administrator.","inviteEmailConfigured":false}"#)])
        let result = try await client.resendInviteLink(email: " Alex@WISC.EDU ")
        XCTAssertFalse(result.inviteEmailConfigured)
        XCTAssertEqual(result.message, "Contact your administrator.")
        let request = try XCTUnwrap(StubURLProtocol.recordedRequests.first)
        XCTAssertEqual(request.url?.path, "/api/auth/invite/resend")
        XCTAssertEqual(try jsonBody(request)["email"] as? String, "alex@wisc.edu")
    }

    func testMalformedInviteConfirmationIsAnErrorAndThePostIsNotRetried() async {
        let client = makeClient([.status(200, body: #"{"message":"No delivery receipt"}"#)])
        do {
            _ = try await client.resendInviteLink(email: "alex@wisc.edu")
            XCTFail("A missing delivery field must not be shown as Link sent")
        } catch APIError.decodingError {
            // Recovery remains retryable; no confirmed result was returned.
        } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
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

    func testSuccessfulAnnouncementDismissalAcceptsTheTopLevelResponse() async throws {
        let client = makeClient([.status(200, body: #"{"dismissed":true}"#)])
        try await client.dismissAnnouncement(id: "announcement")
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

    func testCancellingAnInFlightAudiencePreviewRemainsCancellation() async throws {
        let client = makeClient([.pending])
        let preview = Task {
            try await client.previewBlast(target: .eventCrew(eventId: "event-a"))
        }
        defer { preview.cancel() }
        let deadline = Date().addingTimeInterval(2)
        while StubURLProtocol.recordedRequests.isEmpty && Date() < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(StubURLProtocol.recordedRequests.count, 1)
        preview.cancel()
        do {
            _ = try await preview.value
            XCTFail("Cancelled audience previews must not publish a response")
        } catch is CancellationError {
            // A replaced audience must not publish a network-error state.
        } catch {
            XCTFail("Expected task cancellation, got \(error)")
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
