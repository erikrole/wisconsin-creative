import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case sessionChanged
    case notFound
    case conflict(String)
    case inviteLinkRequired(String)
    case httpError(statusCode: Int, message: String)
    case serverError(String)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized: "Your session has expired. Please sign in again."
        case .sessionChanged: "This request belonged to a previous sign-in and was cancelled."
        case .notFound: "The requested item could not be found."
        case .conflict(let msg): msg
        case .inviteLinkRequired(let message): message
        case .httpError(_, let message): message
        case .serverError(let msg): msg
        case .decodingError: "Unexpected response from server."
        case .networkError(let err): Self.humanize(err)
        }
    }

    private static func humanize(_ error: Error) -> String {
        let code = (error as? URLError)?.code
        switch code {
        case .notConnectedToInternet, .networkConnectionLost: return "No internet connection. Check your network and try again."
        case .timedOut: return "Request timed out. Try again in a moment."
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed: return "Couldn't reach the server. Try again shortly."
        case .cancelled: return "Request was cancelled."
        default: return "Network error. Check your connection and try again."
        }
    }
}

struct BulkReservationRequest: Codable, Equatable {
    let bulkSkuId: String
    let quantity: Int
}

/// Bounds shared with the web booking schemas. The server remains the authority.
enum BookingEditRules {
    static let maxTitleLength = 500
    static let maxNotesLength = 10_000
    static let minReasonLength = 10
    static let maxReasonLength = 1_000
    static let maxSerializedItems = 500
    static let maxBulkLines = 50
    static let maxBulkQuantity = 1_000_000
    static let maxLinkedEvents = 5

    static func validatedTitle(_ value: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maxTitleLength else {
            throw APIError.serverError("Name must be between 1 and 500 characters.")
        }
        return trimmed
    }

    static func validateNotes(_ value: String) throws {
        guard value.count <= maxNotesLength else {
            throw APIError.serverError("Notes must be 10,000 characters or fewer.")
        }
    }

    static func validatedReason(_ value: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= minReasonLength else {
            throw APIError.serverError("Reason must be at least 10 characters")
        }
        guard trimmed.count <= maxReasonLength else {
            throw APIError.serverError("Reason must be 1,000 characters or fewer.")
        }
        return trimmed
    }

    static func validatedOptionalNote(_ value: String) throws -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.count <= maxReasonLength else {
            throw APIError.serverError("Note must be 1,000 characters or fewer.")
        }
        return trimmed
    }

    static func validateSerializedIds(_ ids: [String]) throws {
        guard ids.count <= maxSerializedItems else {
            throw APIError.serverError("A reservation can include at most 500 items.")
        }
    }

    static func validateBulkItems(_ items: [BulkReservationRequest]) throws {
        guard items.count <= maxBulkLines else {
            throw APIError.serverError("A reservation can include at most 50 supply lines.")
        }
        var seen = Set<String>()
        for item in items {
            guard item.quantity >= 1, item.quantity <= maxBulkQuantity else {
                throw APIError.serverError("Quantity must be between 1 and 1000000.")
            }
            guard seen.insert(item.bulkSkuId).inserted else {
                throw APIError.serverError("Duplicate bulk item")
            }
        }
    }

    static func validateEventIds(_ ids: [String]) throws {
        guard ids.count <= maxLinkedEvents else {
            throw APIError.serverError("A booking may link at most 5 events.")
        }
        guard Set(ids).count == ids.count else {
            throw APIError.serverError("eventIds must be unique")
        }
    }
}

/// A preflight check is useful only when the caller can distinguish "clear"
/// from "could not check." Keep the old empty-result API below for rollout
/// compatibility, while new flows preserve the last known availability state
/// and surface the failure instead of presenting an empty result as clear.
struct AvailabilityCheckOutcome {
    let result: AvailabilityCheckResult?
    let errorMessage: String?

    var succeeded: Bool { result != nil && errorMessage == nil }
}

struct CheckoutReturnInsight {
    let nextNeedAt: Date?
    let hasUpcomingNeed: Bool
    /// Title of the booking that needs the gear next, when the server names it.
    var nextNeedTitle: String? = nil
}

struct TestPushResult: Decodable {
    let delivered: Int
    let devices: Int
    let revoked: Int
}

struct PasswordResetRequestResult: Decodable {
    let message: String
    let resetEmailConfigured: Bool
}

enum AuthDiscoveryFlow: String, Decodable {
    case onboarding
    case password

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = AuthDiscoveryFlow(rawValue: value) ?? .password
    }
}

enum InviteLinkStatus: String, Decodable {
    case valid
    case required

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = InviteLinkStatus(rawValue: value) ?? .required
    }
}

struct InviteResendResult: Decodable {
    let message: String
    let inviteEmailConfigured: Bool
}

struct AuthDiscoveryResult: Decodable {
    let flow: AuthDiscoveryFlow
    let inviteLink: InviteLinkStatus?

    var isOnboarding: Bool { flow == .onboarding }

    func needsInviteLink(token: String?) -> Bool {
        guard isOnboarding else { return false }
        switch inviteLink {
        case .required: return true
        case .valid: return token?.isEmpty != false
        case nil: return false // Older servers do not require inbox proof yet.
        }
    }
}

enum AssetTextMutation {
    case unchanged
    case value(String)
    case clear
}

extension Notification.Name {
    /// Fired when an authenticated API call returns 401. The notification
    /// object is the request's captured `AuthSessionBoundary` generation, so a
    /// late response from an older account cannot evict the current account.
    static let sessionDidExpire = Notification.Name("WisconsinSessionDidExpire")
    static let collaboratorPolicyMayHaveChanged = Notification.Name("WisconsinCollaboratorPolicyMayHaveChanged")
}

@MainActor
final class APIClient {
    static let shared = APIClient()

    private init() {
        session = Self.makeSession()
        retryPolicy = .standard
        BrandAssetDownload.removeTemporaryFiles()
    }

    /// Tests inject a session backed by a stub `URLProtocol` and a policy with
    /// no real delays. Production code always uses `shared`.
    init(session: URLSession, retryPolicy: RequestRetryPolicy = .none) {
        self.session = session
        self.retryPolicy = retryPolicy
    }

    private var reportedDecodingPaths: Set<String> = []

    var baseURL: URL { AppEnvironment.activeAPIBaseURL }

    let retryPolicy: RequestRetryPolicy

    let session: URLSession

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.multipathServiceType = .none
#if DEBUG
        // Harness scenarios serve canned payloads so list surfaces can be
        // rendered without a signed-in session. Inert unless the app was
        // launched with a fixture `GT_PERFORMANCE_SCENARIO`.
        if AppRuntimeMode.usesFixtureAPI {
            config.protocolClasses = [FixtureAPIProtocol.self] + (config.protocolClasses ?? [])
        }
#endif
        return AppEnvironment.apiSession(configuration: config)
    }

    /// Brand asset files can be a large PDF on venue wifi. The shared session
    /// cuts a transfer off at 30 seconds, which is too short for that download.
    let fileSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 180
        config.multipathServiceType = .none
#if DEBUG
        if AppRuntimeMode.usesFixtureAPI {
            config.protocolClasses = [FixtureAPIProtocol.self] + (config.protocolClasses ?? [])
        }
#endif
        return AppEnvironment.apiSession(configuration: config)
    }()

    let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    // MARK: - Draft identity storage

    /// The draft each shift group's editor last showed. A value of `.some(nil)`
    /// means "no draft yet"; a missing key means unknown (send nothing).
    /// Stored properties cannot live in an extension, so these stay here;
    /// `rememberDraft` and `expectedDraft` are in `APIClient+Schedule.swift`.
    var draftIds: [String: String?] = [:]
    let draftIdsLock = NSLock()

    /// A response the app could not read is a bug on one side or the other,
    /// and the person only sees a generic error. Report each endpoint's first
    /// failure per launch, without any of the response's values.
    private func reportDecodingFailure(_ error: Error, for request: URLRequest) {
        let path = DiagnosticBreadcrumbs.pathTemplate(request.url?.path ?? "")
        guard !Self.ignoredDiagnosticPaths.contains(path),
              reportedDecodingPaths.insert(path).inserted else { return }
        let description = Self.describeDecodingError(error)
        DiagnosticBreadcrumbs.shared.record(.log, "Could not read \(path): \(description)")
        let session = DiagnosticBreadcrumbs.shared.current
        let report: [String: Any] = [
            "kind": "error",
            "name": "DecodingError",
            "message": description,
            "screen": "\(request.httpMethod ?? "GET") \(path)",
            "occurredAt": Date.now.ISO8601Format(),
            "breadcrumbs": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(session.breadcrumbs))) ?? [],
        ]
        guard let client = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(ProblemReportClient.current)),
              let body = try? JSONSerialization.data(withJSONObject: ["client": client, "reports": [report]]) else { return }
        var errorRequest = self.request(path: "/api/errors", method: "POST")
        errorRequest.httpBody = body
        let upload = errorRequest
        Task {
            struct Stored: Decodable { let stored: Int }
            let _: DataWrapper<Stored>? = try? await perform(upload, broadcastsSessionExpiry: false)
        }
    }

    /// Endpoints that report problems are never reported or recorded themselves.
    private static let ignoredDiagnosticPaths: Set<String> = [
        "/api/diagnostics", "/api/errors", "/api/product-events", "/api/support-reports",
    ]

    /// `keyNotFound "title" at data.[id].event` — the shape of the mismatch,
    /// never the values that were in the response.
    private static func describeDecodingError(_ error: Error) -> String {
        guard let decoding = error as? DecodingError else { return String(describing: type(of: error)) }
        func path(_ context: DecodingError.Context) -> String {
            let keys = context.codingPath.map { $0.intValue.map { _ in "[]" } ?? $0.stringValue }
            return keys.isEmpty ? "the top level" : keys.joined(separator: ".")
        }
        switch decoding {
        case .keyNotFound(let key, let context):
            return "Missing \"\(key.stringValue)\" at \(path(context))"
        case .valueNotFound(let type, let context):
            return "Missing \(type) value at \(path(context))"
        case .typeMismatch(let type, let context):
            return "Expected \(type) at \(path(context))"
        case .dataCorrupted(let context):
            return "Unreadable value at \(path(context))"
        @unknown default:
            return "Decoding failed"
        }
    }

    private func recordAPIBreadcrumb(_ request: URLRequest, response: HTTPURLResponse?) {
        let path = DiagnosticBreadcrumbs.pathTemplate(request.url?.path ?? "")
        guard !Self.ignoredDiagnosticPaths.contains(path) else { return }
        let method = request.httpMethod ?? "GET"
        guard let response else {
            DiagnosticBreadcrumbs.shared.record(.api, "\(method) \(path) → no response")
            return
        }
        var data: [String: String]?
        if response.statusCode >= 400, let id = response.value(forHTTPHeaderField: "x-vercel-id") {
            data = ["requestId": String(id.prefix(120))]
        }
        DiagnosticBreadcrumbs.shared.record(.api, "\(method) \(path) → \(response.statusCode)", data: data)
    }

    // MARK: - Internals

    func mutateWorkingSchedule(
        shiftGroupId: String,
        expectedVersion: Int,
        command: WorkingScheduleCommand
    ) async throws -> WorkingScheduleEditor {
        struct Extra: Encodable { let command: WorkingScheduleCommand }
        var req = request(path: "/api/shift-groups/\(shiftGroupId)/working-copy", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(VersionedBody(
            expectedVersion: expectedVersion,
            expectedDraft: expectedDraft(for: shiftGroupId),
            extra: Extra(command: command)
        ))
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(req)
        return rememberDraft(response.data)
    }

    func changeWorkingScheduleHistory(
        shiftGroupId: String,
        expectedVersion: Int,
        action: String
    ) async throws -> WorkingScheduleEditor {
        struct Extra: Encodable { let action: String }
        var req = request(path: "/api/shift-groups/\(shiftGroupId)/working-copy", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(VersionedBody(
            expectedVersion: expectedVersion,
            expectedDraft: expectedDraft(for: shiftGroupId),
            extra: Extra(action: action)
        ))
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(req)
        return rememberDraft(response.data)
    }

    func prepareAuthHost(for email: String) {
        let nextHost = AppEnvironment.apiHost(forLoginEmail: email)
        if nextHost != AppEnvironment.activeAPIHost {
            HTTPCookieStorage.shared.removeCookies(since: .distantPast)
            AppEnvironment.setActiveAPIHost(nextHost)
        }
    }

    /// `path` must be a pure path — `appendingPathComponent` percent-encodes
    /// `?`, so a query string embedded in `path` becomes part of the last
    /// route param (`shifts/abc%3Fforce=true` → shiftId "abc?force=true").
    /// Pass query parameters via `queryItems` instead.
    func request(path: String, method: String = "GET", queryItems: [URLQueryItem]? = nil) -> URLRequest {
        var url = baseURL.appendingPathComponent(path)
        if let queryItems, !queryItems.isEmpty {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            components.queryItems = queryItems
            url = components.url!
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("WisconsinApp/1.0 iOS", forHTTPHeaderField: "User-Agent")
        req.setValue(AppEnvironment.activeAPIOrigin, forHTTPHeaderField: "Origin")
#if DEBUG
        AppEnvironment.authorizeManagedPreview(&req)
#endif
        return req
    }

    func bookingSnapshotString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    func authenticatedData(
        for request: URLRequest
    ) async throws -> (data: Data, response: URLResponse, boundary: UUID) {
        let requestBoundary = authSessionBoundary.capture()
        var attempt = 1
        while true {
            let pause: TimeInterval
            do {
                let (data, response) = try await session.data(for: request)
                guard authSessionBoundary.owns(requestBoundary) else {
                    throw APIError.sessionChanged
                }
                guard retryPolicy.allowsRetry(method: request.httpMethod),
                      let http = response as? HTTPURLResponse,
                      retryPolicy.isRetryable(statusCode: http.statusCode),
                      let wait = retryPolicy.delay(
                        afterAttempt: attempt,
                        retryAfter: RequestRetryPolicy.retryAfterInterval(
                            from: http.value(forHTTPHeaderField: "Retry-After")
                        )
                      )
                else {
                    return (data, response, requestBoundary)
                }
                pause = wait
            } catch let error as URLError {
                guard retryPolicy.allowsRetry(method: request.httpMethod),
                      retryPolicy.isRetryable(urlErrorCode: error.code),
                      let wait = retryPolicy.delay(afterAttempt: attempt)
                else { throw error }
                pause = wait
            }
            try await Task.sleep(for: .seconds(pause))
            guard authSessionBoundary.owns(requestBoundary) else {
                throw APIError.sessionChanged
            }
            attempt += 1
        }
    }

    func broadcastSessionExpiry(for requestBoundary: UUID) {
        NotificationCenter.default.post(
            name: .sessionDidExpire,
            object: requestBoundary
        )
    }

    func perform<T: Decodable & Sendable>(
        _ request: URLRequest,
        broadcastsSessionExpiry: Bool = true
    ) async throws -> T {
        let data: Data
        let response: URLResponse
        let requestBoundary: UUID
        do {
            (data, response, requestBoundary) = try await authenticatedData(for: request)
        } catch let error as APIError {
            try Task.checkCancellation()
            throw error
        } catch {
            // URLSession reports cancellation as URLError.cancelled. Keep task
            // cancellation out of view error states for superseded requests.
            try Task.checkCancellation()
            if (error as? URLError)?.code != .cancelled {
                recordAPIBreadcrumb(request, response: nil)
            }
            throw APIError.networkError(error)
        }

        try Task.checkCancellation()

        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        recordAPIBreadcrumb(request, response: http)

        switch http.statusCode {
        case 200...299:
            let decoded: T
            do {
                decoded = try await APIResponseDecoder.decode(T.self, from: data)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                reportDecodingFailure(error, for: request)
                throw APIError.decodingError(error)
            }
            // Decoding now suspends the main actor. An account change during
            // that work must not publish the previous account's response.
            try Task.checkCancellation()
            guard authSessionBoundary.owns(requestBoundary) else {
                throw APIError.sessionChanged
            }
            return decoded
        case 401:
            if broadcastsSessionExpiry {
                // Authenticated requests broadcast globally so SessionStore can
                // route the user back to login when their session expires.
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let message = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error
                ?? "Invalid credentials"
            throw APIError.serverError(message)
        case 404:
            throw APIError.notFound
        case 429:
            throw APIError.httpError(
                statusCode: 429,
                message: "Too many requests. Wait a moment and try again."
            )
        case 403:
            if request.url?.path != "/api/me" {
                NotificationCenter.default.post(name: .collaboratorPolicyMayHaveChanged, object: nil)
            }
            let body = try? JSONDecoder().decode(ServerErrorBody.self, from: data)
            let message = body?.error ?? "You do not have access to this feature."
            if request.url?.path == "/api/auth/register", body?.code == "INVITE_LINK_REQUIRED" {
                throw APIError.inviteLinkRequired(message)
            }
            throw APIError.httpError(statusCode: http.statusCode, message: message)
        case 409:
            if let body = try? decoder.decode(ServerErrorBody.self, from: data), body.code == "ONBOARDING_CONFLICT" {
                throw APIError.conflict(body.error)
            }
            if let body = try? decoder.decode(ConflictResponseBody.self, from: data),
               let d = body.data {
                var parts: [String] = []
                for c in d.conflicts ?? [] {
                    if let title = c.conflictingBookingTitle {
                        parts.append("conflicts with \"\(title)\"")
                    } else {
                        parts.append("scheduling conflict")
                    }
                }
                for u in d.unavailableAssets ?? [] {
                    let readable = u.status.lowercased().replacingOccurrences(of: "_", with: " ")
                    parts.append("unavailable (\(readable))")
                }
                for s in d.shortages ?? [] {
                    parts.append("only \(s.available) of \(s.requested) available")
                }
                if !parts.isEmpty {
                    throw APIError.conflict("Some equipment is no longer available: \(parts.joined(separator: "; ")). Remove it and try again.")
                }
            }
            let msg409 = (try? decoder.decode(ServerErrorBody.self, from: data))?.error
                ?? "This equipment is no longer available — please try again."
            // Only structured availability responses route reservation creation
            // back to Gear. Other 409s include booking-window policy and
            // concurrency limits, which need their normal submit error dialog.
            throw APIError.httpError(statusCode: http.statusCode, message: msg409)
        default:
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error
                ?? "Server error (\(http.statusCode))"
            throw APIError.httpError(statusCode: http.statusCode, message: msg)
        }
    }

    // MARK: - Signatures (iPad Apple Pencil capture; STAFF/ADMIN)

    func signatureCollections() async throws -> [SignatureCollectionSummary] {
        let resp: SignatureCollectionListResponse = try await perform(request(path: "/api/signatures/collections"))
        return resp.collections
    }

    func signatureCollection(id: String) async throws -> SignatureCollectionDetail {
        try await perform(request(path: "/api/signatures/collections/\(id)"))
    }

    func signatureCaptureBootstrap(collectionId: String, memberId: String) async throws -> SignatureCaptureBootstrap {
        try await perform(request(path: "/api/signatures/collections/\(collectionId)/members/\(memberId)"))
    }

    /// Idempotent by `requestId`: replaying the same request after an
    /// ambiguous failure returns the original committed result.
    func saveSignatureCapture(
        collectionId: String,
        memberId: String,
        body: SignatureCaptureRequest
    ) async throws -> SignatureCaptureResult {
        var req = request(path: "/api/signatures/collections/\(collectionId)/capture/\(memberId)", method: "POST")
        req.httpBody = try JSONEncoder().encode(body)
        return try await perform(req)
    }

    /// Inline transparent PNG of a READY revision (`signature:download`), for
    /// the roster preview. Revisions are immutable, so callers may cache by ID.
    func signatureArtifactPNG(revisionId: String) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response, _) = try await authenticatedData(for: request(path: "/api/signatures/artifacts/\(revisionId)/png"))
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.serverError("Invalid response") }
        switch http.statusCode {
        case 200...299: return data
        case 401: throw APIError.unauthorized
        case 404: throw APIError.notFound
        default: throw APIError.httpError(statusCode: http.statusCode, message: "Signature preview unavailable")
        }
    }

    // MARK: - ICS Calendar Feed

    /// Whether the user has a feed, plus the raw token when the server can
    /// still return it. The server stores a hash, so `token` is nil for a
    /// hashed feed; it is present for a pre-hashing token, once, as the server
    /// upgrades it. An older server returns only `token`.
    struct ICSTokenStatus {
        let token: String?
        let hasToken: Bool
        /// Whether `checking` is still the current token; nil when not asked
        /// or when the server predates the check.
        let matches: Bool?
    }

    func icsTokenStatus(checking localToken: String? = nil) async throws -> ICSTokenStatus {
        struct Response: Decodable { let data: TokenData }
        struct TokenData: Decodable {
            let token: String?
            let hasToken: Bool?
            let matches: Bool?
        }
        var req = request(path: "/api/shifts/ics-token")
        if let localToken { req.setValue(localToken, forHTTPHeaderField: "X-ICS-Token-Check") }
        let resp: Response = try await perform(req)
        // An older server returns the raw token itself; compare directly.
        let matches = resp.data.matches ?? localToken.flatMap { local in resp.data.token.map { $0 == local } }
        return ICSTokenStatus(
            token: resp.data.token,
            hasToken: resp.data.hasToken ?? (resp.data.token != nil),
            matches: matches
        )
    }

    /// Generates (or rotates) the user's ICS token. Returns the new token.
    func generateICSToken() async throws -> String {
        struct Response: Decodable { let data: TokenData }
        struct TokenData: Decodable { let token: String }
        var req = request(path: "/api/shifts/ics-token", method: "POST")
        req.httpBody = Data()
        let resp: Response = try await perform(req)
        return resp.data.token
    }
}

extension APIClient: ReservationDraftPersistence {}

/// A request-local decoder on the concurrent executor. Large list responses
/// must not occupy the main actor while SwiftUI is rendering or scrolling.
enum APIResponseDecoder {
    @concurrent
    static func decode<T: Decodable & Sendable>(_ type: T.Type, from data: Data) async throws -> T {
        try Task.checkCancellation()
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        let value = try decoder.decode(type, from: data)
        try Task.checkCancellation()
        return value
    }
}
