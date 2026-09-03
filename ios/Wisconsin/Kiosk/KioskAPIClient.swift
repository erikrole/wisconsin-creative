import Foundation

extension Notification.Name {
    static let kioskSessionUnauthorized = Notification.Name("kioskSessionUnauthorized")
}

/// Identifies the kiosk credential lifetime that owns an API request.
///
/// Kiosk requests can still finish after a device is reactivated. A late 401
/// from the replaced token must not clear the new cookie and Keychain item, so
/// every request captures this generation before its first suspension.
final class KioskCredentialBoundary: @unchecked Sendable {
    private let lock = NSLock()
    private var generation = UUID()

    func capture() -> UUID {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    @discardableResult
    func advance() -> UUID {
        lock.lock()
        defer { lock.unlock() }
        generation = UUID()
        return generation
    }

    func owns(_ capturedGeneration: UUID) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return generation == capturedGeneration
    }
}

let kioskCredentialBoundary = KioskCredentialBoundary()

// Standalone kiosk API client. Uses HTTPCookieStorage.shared so the
// kiosk_session cookie set during activation is sent automatically.
struct KioskAPI {
    static let shared = KioskAPI()

    /// Host the kiosk_session cookie is scoped to — KioskStore re-creates the
    /// cookie from the Keychain against this domain after a reinstall.
    static let host = AppEnvironment.canonicalHost

    private let baseURL = AppEnvironment.baseURL

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.multipathServiceType = .none
        #if DEBUG
        // Fixture scenarios answer locally so UI captures never touch the real
        // host with real credentials. Inert unless GT_KIOSK_SCENARIO is set.
        if KioskFixtureScenario.active != nil {
            config.protocolClasses = [KioskFixtureURLProtocol.self] + (config.protocolClasses ?? [])
        }
        #endif
        return URLSession(configuration: config)
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = KioskAPI.parseISODate(value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return d
    }()

    // MARK: - Session

    struct KioskMeResponse: Decodable {
        let kioskId: String
        let locationId: String
        let locationName: String
        // Optional: older deployed servers don't return the device name yet.
        let name: String?
    }

    func kioskMe() async throws -> KioskMeResponse {
        // `/api/kiosk/me` returns the context at the TOP level — no `data`
        // envelope. Decoding a wrapper here failed every call, and
        // KioskStore.validateSession treated that as a dead session, so the
        // kiosk forced re-activation on every app re-entry.
        let req = request(path: "/api/kiosk/me")
        return try await perform(req)
    }

    func kioskActivate(code: String) async throws -> KioskActivationResponse {
        struct Body: Encodable { let code: String }
        // Entering activation establishes a new credential attempt. Any
        // outstanding request from the prior kiosk session is obsolete even if
        // this code is ultimately rejected.
        kioskCredentialBoundary.advance()
        var req = request(path: "/api/kiosk/activate", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(code: code))
        // A 401 here means "invalid activation code", not "the active kiosk
        // session expired", so it must never broadcast a credential reset.
        let result: (KioskActivationResponse, HTTPURLResponse) = try await performWithResponse(
            req,
            broadcastsUnauthorizedSession: false
        )
        let response = result.0
        let http = result.1
        guard response.sessionToken == nil, let headerToken = kioskSessionToken(from: http) else {
            return response
        }
        return KioskActivationResponse(
            kioskId: response.kioskId,
            name: response.name,
            location: response.location,
            sessionToken: headerToken
        )
    }

    func kioskHeartbeat() async throws {
        struct Response: Decodable { let status: String; let kioskId: String }
        var req = request(path: "/api/kiosk/heartbeat", method: "POST")
        // Report build identity so the fleet is legible from the server. The
        // route persists this only when a value actually changes, so sending it
        // on every beat costs nothing beyond the bytes.
        req.httpBody = try? JSONEncoder().encode(KioskBuildIdentity.current)
        // Route through `perform` so a 401 reaches the generation-bound
        // unauthorized observer and returns the kiosk to activation.
        let _: Response = try await perform(req)
    }

    // MARK: - Dashboard

    func kioskDashboard() async throws -> KioskDashboard {
        let req = request(path: "/api/kiosk/dashboard")
        return try await perform(req)
    }

    func kioskUsers() async throws -> [KioskUser] {
        struct Resp: Decodable { let data: [KioskUser] }
        let req = request(path: "/api/kiosk/users")
        let resp: Resp = try await perform(req)
        return resp.data
    }

    func kioskIdentify(scanValue: String) async throws -> KioskIdentifyResult {
        struct Body: Encodable { let scanValue: String }
        var req = request(path: "/api/kiosk/identify", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(scanValue: scanValue))
        return try await perform(req)
    }

    func kioskResolveScan(scanValue: String, userId: String? = nil) async throws -> KioskResolveScanResult {
        struct Body: Encodable { let scanValue: String; let userId: String? }
        var req = request(path: "/api/kiosk/resolve-scan", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(scanValue: scanValue, userId: userId))
        return try await perform(req)
    }

    // MARK: - Student

    func kioskStudentContext(userId: String) async throws -> KioskStudentContext {
        let req = request(path: "/api/kiosk/student/\(userId)")
        return try await perform(req)
    }

    // MARK: - Checkout

    func kioskCheckoutScan(actorId: String, scanValue: String) async throws -> KioskScanResult {
        struct Body: Encodable { let actorId: String; let scanValue: String }
        var req = request(path: "/api/kiosk/checkout/scan", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            actorId: actorId,
            scanValue: scanValue
        ))
        return try await perform(req)
    }

    /// `requesterId` lets the server mark which events the person checking out
    /// is actually working, so checkout setup can lead with their own shifts.
    func kioskCheckoutEvents(requesterId: String? = nil) async throws -> [KioskCheckoutEvent] {
        struct Resp: Decodable { let data: [KioskCheckoutEvent] }
        let query = requesterId.flatMap { id in
            id.isEmpty ? nil : [URLQueryItem(name: "userId", value: id)]
        } ?? []
        let req = request(path: "/api/kiosk/events", query: query)
        let resp: Resp = try await perform(req)
        return resp.data
    }

    func kioskCheckoutAvailability(
        locationId: String,
        items: [KioskCartItem],
        startsAt: Date,
        endsAt: Date
    ) async throws -> KioskCheckoutAvailabilityResult {
        struct Body: Encodable {
            let locationId: String
            let items: [KioskCheckoutItemRef]
            let startsAt: String
            let endsAt: String
        }
        var req = request(path: "/api/kiosk/checkout/availability", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            locationId: locationId,
            items: checkoutItemRefs(from: items),
            startsAt: isoString(from: startsAt),
            endsAt: isoString(from: endsAt)
        ))
        return try await perform(req)
    }

    func kioskCheckoutComplete(
        actorId: String,
        locationId: String,
        items: [KioskCartItem],
        eventId: String?,
        customPurpose: String?,
        endsAt: Date
    ) async throws -> [EarnedBadgeReward] {
        struct Body: Encodable {
            let actorId: String
            let locationId: String
            let items: [KioskCheckoutItemRef]
            let eventId: String?
            let customPurpose: String?
            let endsAt: String
        }
        var req = request(path: "/api/kiosk/checkout/complete", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            actorId: actorId,
            locationId: locationId,
            items: checkoutItemRefs(from: items),
            eventId: eventId,
            customPurpose: customPurpose,
            endsAt: isoString(from: endsAt)
        ))
        struct Response: Decodable {
            let bookingId: String
            let earnedBadges: [EarnedBadgeReward]?
        }
        let response: Response = try await perform(req)
        return response.earnedBadges ?? []
    }

    func kioskCheckoutDetail(id: String) async throws -> KioskCheckoutDetail {
        let req = request(path: "/api/kiosk/checkout/\(id)")
        return try await perform(req)
    }

    func kioskUpdateActiveCheckout(id: String, actorId: String, title: String?, endsAt: Date?) async throws -> KioskActiveCheckoutMutationResult {
        struct Body: Encodable {
            let actorId: String
            let title: String?
            let endsAt: String?
        }
        var req = request(path: "/api/kiosk/checkout/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(
            actorId: actorId,
            title: title,
            endsAt: endsAt.map { isoString(from: $0) }
        ))
        return try await perform(req)
    }

    func kioskAddActiveCheckoutItem(id: String, actorId: String, scanValue: String) async throws -> KioskActiveCheckoutMutationResult {
        struct Body: Encodable {
            let actorId: String
            let scanValue: String
        }
        var req = request(path: "/api/kiosk/checkout/\(id)", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(actorId: actorId, scanValue: scanValue))
        return try await perform(req)
    }

    func kioskRemoveActiveCheckoutItem(id: String, actorId: String, item: KioskCheckoutDetail.ReturnItem) async throws -> KioskActiveCheckoutMutationResult {
        struct Body: Encodable {
            let actorId: String
            let assetId: String?
            let bulkSkuId: String?
            let unitNumber: Int?
        }
        var req = request(path: "/api/kiosk/checkout/\(id)", method: "DELETE")
        req.httpBody = try JSONEncoder().encode(Body(
            actorId: actorId,
            assetId: item.isNumberedBulk ? nil : item.id,
            bulkSkuId: item.isNumberedBulk ? item.bulkSkuId : nil,
            unitNumber: item.isNumberedBulk ? item.unitNumber : nil
        ))
        return try await perform(req)
    }

    // MARK: - Checkin (Return)

    func kioskCheckinScan(bookingId: String, actorId: String, scanValue: String) async throws -> KioskScanResult {
        struct Body: Encodable { let actorId: String; let scanValue: String }
        var req = request(path: "/api/kiosk/checkin/\(bookingId)/scan", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(actorId: actorId, scanValue: scanValue))
        return try await perform(req)
    }

    func kioskCheckinComplete(bookingId: String, actorId: String) async throws -> KioskCheckinCompleteResult {
        struct Body: Encodable { let actorId: String }
        var req = request(path: "/api/kiosk/checkin/\(bookingId)/complete", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(actorId: actorId))
        // Route through `perform` so 401/404/409/5xx propagate as APIError —
        // the prior `try?` swallowed every failure mode and produced phantom
        // successes (booking stayed OPEN server-side, kiosk showed the
        // success screen, asset showed up on tomorrow's overdue report).
        return try await perform(req)
    }

    // MARK: - Pickup

    func kioskPickupScan(bookingId: String, scanValue: String) async throws -> KioskScanResult {
        struct Body: Encodable { let scanValue: String }
        var req = request(path: "/api/kiosk/pickup/\(bookingId)/scan", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(scanValue: scanValue))
        return try await perform(req)
    }

    func kioskPickupConfirm(
        bookingId: String,
        actorId: String,
        partial: Bool = false
    ) async throws -> KioskPickupConfirmResult {
        struct Body: Encodable {
            let actorId: String
            let partial: Bool
        }
        var req = request(path: "/api/kiosk/pickup/\(bookingId)/confirm", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(actorId: actorId, partial: partial))
        // Route through `perform` so 401/404/409/5xx propagate as APIError —
        // the prior `try?` swallowed every failure mode and produced phantom
        // successes (booking stayed PENDING_PICKUP server-side, kiosk showed
        // the confirmation screen).
        return try await perform(req)
    }

    // MARK: - Internals

    private struct KioskCheckoutItemRef: Encodable {
        let assetId: String?
        let bulkSkuId: String?
        let unitNumber: Int?
    }

    private func checkoutItemRefs(from items: [KioskCartItem]) -> [KioskCheckoutItemRef] {
        items.map { item in
            if let bulkSkuId = item.bulkSkuId, let unitNumber = item.unitNumber {
                return KioskCheckoutItemRef(assetId: nil, bulkSkuId: bulkSkuId, unitNumber: unitNumber)
            }
            return KioskCheckoutItemRef(assetId: item.id, bulkSkuId: nil, unitNumber: nil)
        }
    }

    private func isoString(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func parseISODate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    /// `query` must go through `URLComponents`, not into `path`.
    /// `appendingPathComponent` percent-escapes `?` to `%3F`, which turns a
    /// query string into part of the path and returns a 404.
    private func request(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = []
    ) -> URLRequest {
        var url = baseURL.appendingPathComponent(path)
        if !query.isEmpty,
           var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.queryItems = query
            url = components.url ?? url
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("WisconsinApp/1.0 iOS Kiosk", forHTTPHeaderField: "User-Agent")
        req.setValue(AppEnvironment.origin, forHTTPHeaderField: "Origin")
        return req
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let result: (T, HTTPURLResponse) = try await performWithResponse(request)
        return result.0
    }

    private func performWithResponse<T: Decodable>(
        _ request: URLRequest,
        broadcastsUnauthorizedSession: Bool = true
    ) async throws -> (T, HTTPURLResponse) {
        let requestGeneration = kioskCredentialBoundary.capture()
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            guard kioskCredentialBoundary.owns(requestGeneration) else {
                throw CancellationError()
            }
            throw APIError.networkError(error)
        }
        // Activation or deactivation replaced the credential while this request
        // was suspended. Ignore every result from that obsolete identity,
        // including a success payload that could otherwise republish old state.
        guard kioskCredentialBoundary.owns(requestGeneration) else {
            throw CancellationError()
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        switch http.statusCode {
        case 200...299:
            let decoded: T
            do {
                decoded = try decoder.decode(T.self, from: data)
            } catch {
                #if DEBUG
                print("[KioskAPI] decode failed for \(request.url?.path ?? "unknown path"): \(error)")
                #endif
                throw APIError.decodingError(error)
            }
            // Decoding runs off the main actor. Reactivation can therefore
            // advance the credential while a large payload is being decoded,
            // after the post-network check above but before this value returns.
            guard kioskCredentialBoundary.owns(requestGeneration) else {
                throw CancellationError()
            }
            return (decoded, http)
        case 401:
            if broadcastsUnauthorizedSession {
                NotificationCenter.default.post(
                    name: .kioskSessionUnauthorized,
                    object: requestGeneration
                )
                // The generation-bound observer is the sole owner of session
                // teardown. A caller handling this error later must not clear a
                // replacement credential installed after the notification.
                throw CancellationError()
            }
            throw APIError.unauthorized
        case 404:
            throw APIError.notFound
        case 500...:
            // Raw 5xx bodies ("Internal server error") aren't actionable at
            // the kiosk; staff just needs to know it's our side and retryable.
            throw APIError.serverError("Something went wrong on our end. Try that scan again.")
        default:
            let msg = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? "Server error (\(http.statusCode))"
            throw APIError.serverError(msg)
        }
    }

    private func kioskSessionToken(from response: HTTPURLResponse) -> String? {
        for (key, value) in response.allHeaderFields {
            guard String(describing: key).caseInsensitiveCompare("Set-Cookie") == .orderedSame else {
                continue
            }
            let header = String(describing: value)
            guard let token = cookieValue(named: "kiosk_session", in: header) else {
                continue
            }
            return token
        }
        return nil
    }

    private func cookieValue(named name: String, in header: String) -> String? {
        let prefix = "\(name)="
        guard let start = header.range(of: prefix) else { return nil }
        let valueStart = start.upperBound
        let valueEnd = header[valueStart...].firstIndex(of: ";") ?? header.endIndex
        let value = String(header[valueStart..<valueEnd])
        return value.isEmpty ? nil : value
    }
}

private struct DataWrapper<T: Decodable>: Decodable { let data: T }
private struct ErrorBody: Decodable { let error: String }

// MARK: - Build identity

/// What this kiosk app is, reported on every heartbeat.
///
/// The server previously knew only that *a* kiosk had checked in — not which
/// build it was running. That made every rollout unverifiable from the
/// database ("did the new build land on Video Office?") and left field bug
/// reports with no version to correlate against.
struct KioskBuildIdentity: Encodable {
    let appVersion: String
    let appBuild: String
    let osVersion: String
    let deviceModel: String

    /// Deliberately free of UIKit. `UIDevice` is main-actor isolated under
    /// Swift 6, which would force the heartbeat — a background task — to hop to
    /// the main actor just to read a version string. `ProcessInfo` and `sysctl`
    /// carry no such isolation and give the same answers.
    static var current: KioskBuildIdentity {
        let info = Bundle.main.infoDictionary
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return KioskBuildIdentity(
            appVersion: info?["CFBundleShortVersionString"] as? String ?? "unknown",
            appBuild: info?["CFBundleVersion"] as? String ?? "unknown",
            osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            deviceModel: Self.hardwareModel
        )
    }

    /// `UIDevice.model` only ever says "iPad". The sysctl machine identifier is
    /// what distinguishes an M2 iPad Air from the retired 10.5-inch Pro, which
    /// is the distinction that actually matters when triaging the fleet.
    private static var hardwareModel: String {
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        guard size > 0 else { return "unknown" }
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        let bytes = machine.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
        return String(decoding: bytes, as: UTF8.self)
    }
}
