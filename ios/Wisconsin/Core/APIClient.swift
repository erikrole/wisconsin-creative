import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case sessionChanged
    case notFound
    case conflict(String)
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

struct CheckoutReturnInsight {
    let nextNeedAt: Date?
    let hasUpcomingNeed: Bool
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

struct AuthDiscoveryResult: Decodable {
    let flow: AuthDiscoveryFlow

    var isOnboarding: Bool { flow == .onboarding }
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

    private var baseURL: URL { AppEnvironment.activeAPIBaseURL }

    private let session: URLSession = {
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
        return URLSession(configuration: config)
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    // MARK: - Auth

    func discoverAuth(email: String) async throws -> AuthDiscoveryResult {
        struct Body: Encodable {
            let email: String
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        prepareAuthHost(for: normalizedEmail)
        var req = request(path: "/api/auth/discover", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(email: normalizedEmail))
        return try await perform(req, broadcastsSessionExpiry: false)
    }

    func login(email: String, password: String) async throws -> CurrentUser {
        struct Body: Encodable {
            let email: String
            let password: String
            let rememberMe: Bool
        }
        prepareAuthHost(for: email)
        var req = request(path: "/api/auth/login", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(email: email, password: password, rememberMe: true))
        let resp: LoginResponse = try await perform(req, broadcastsSessionExpiry: false)
        return resp.user
    }

    func register(name: String, email: String, password: String) async throws -> CurrentUser {
        struct Body: Encodable {
            let name: String
            let email: String
            let password: String
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        prepareAuthHost(for: normalizedEmail)
        var req = request(path: "/api/auth/register", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            email: normalizedEmail,
            password: password
        ))
        let response: LoginResponse = try await perform(req, broadcastsSessionExpiry: false)
        return response.user
    }

    func requestPasswordReset(email: String) async throws -> PasswordResetRequestResult {
        struct Body: Encodable {
            let email: String
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        prepareAuthHost(for: normalizedEmail)
        var req = request(path: "/api/auth/forgot-password", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(email: normalizedEmail))
        return try await perform(req, broadcastsSessionExpiry: false)
    }

    func passkeyAuthenticationOptions(rememberMe: Bool = true) async throws -> PasskeyAuthenticationOptions {
        struct Body: Encodable {
            let rememberMe: Bool
        }

        var req = request(path: "/api/auth/passkey/login/options", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(rememberMe: rememberMe))
        let response: PasskeyOptionsResponse<PasskeyAuthenticationOptions> = try await perform(
            req,
            broadcastsSessionExpiry: false
        )
        return response.options
    }

    func verifyPasskeyAuthentication(_ assertion: PasskeyAssertionPayload) async throws -> CurrentUser {
        struct Body: Encodable {
            let response: PasskeyAssertionPayload
        }

        var req = request(path: "/api/auth/passkey/login/verify", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(response: assertion))
        let response: LoginResponse = try await perform(req, broadcastsSessionExpiry: false)
        return response.user
    }

    func passkeyRegistrationOptions(currentPassword: String) async throws -> PasskeyRegistrationOptions {
        struct Body: Encodable {
            let currentPassword: String
        }

        var req = request(path: "/api/auth/passkey/registration/options", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword))
        let response: PasskeyOptionsResponse<PasskeyRegistrationOptions> = try await perform(req)
        return response.options
    }

    func verifyPasskeyRegistration(
        _ registration: PasskeyRegistrationPayload,
        name: String?
    ) async throws -> PasskeyRegistrationConfirmation {
        struct Body: Encodable {
            let response: PasskeyRegistrationPayload
            let name: String?
        }

        var req = request(path: "/api/auth/passkey/registration/verify", method: "POST")
        let trimmedName = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        req.httpBody = try JSONEncoder().encode(Body(
            response: registration,
            name: trimmedName?.isEmpty == true ? nil : trimmedName
        ))
        let response: DataWrapper<PasskeyRegistrationConfirmation> = try await perform(req)
        return response.data
    }

    func passkeys() async throws -> [PasskeyCredentialSummary] {
        let response: DataWrapper<[PasskeyCredentialSummary]> = try await perform(
            request(path: "/api/me/passkeys")
        )
        return response.data
    }

    func revokePasskey(id: String, currentPassword: String) async throws {
        struct Body: Encodable {
            let currentPassword: String
        }

        var req = request(path: "/api/me/passkeys/\(id)", method: "DELETE")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword))
        let _: SuccessResponse = try await perform(req)
    }

    func logout() async throws {
        let req = request(path: "/api/auth/logout", method: "POST")
        _ = try? await session.data(for: req)
        HTTPCookieStorage.shared.removeCookies(since: .distantPast)
        AppEnvironment.resetActiveAPIHost()
    }

    func registerDeviceToken(_ hexToken: String) async throws {
        struct Body: Encodable { let token: String; let platform: String; let appVersion: String? }
        var req = request(path: "/api/devices", method: "POST")
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        req.httpBody = try JSONEncoder().encode(Body(token: hexToken, platform: "IOS", appVersion: version))
        let _: SuccessResponse = try await perform(req)
    }

    func revokeAllDeviceTokens() async throws {
        let req = request(path: "/api/devices", method: "DELETE")
        let _: SuccessResponse = try await perform(req)
    }

    func sendTestPush(deviceToken: String) async throws -> TestPushResult {
        struct Body: Encodable { let token: String }
        var req = request(path: "/api/devices/test", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(token: deviceToken))
        return try await perform(req)
    }

    func registerCheckoutReturnLiveActivity(bookingId: String, token: String) async throws {
        struct Body: Encodable {
            let bookingId: String
            let token: String
        }
        var req = request(path: "/api/live-activities/checkout-return", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(bookingId: bookingId, token: token))
        let _: SuccessResponse = try await perform(req)
    }

    func registerCheckoutReturnLiveActivityStartToken(_ token: String) async throws {
        struct Body: Encodable { let token: String }
        var req = request(path: "/api/live-activities/checkout-return/start-token", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(token: token))
        let _: SuccessResponse = try await perform(req)
    }

    func revokeCheckoutReturnLiveActivityStartTokens() async throws {
        let req = request(path: "/api/live-activities/checkout-return/start-token", method: "DELETE")
        let _: SuccessResponse = try await perform(req)
    }

    func me() async throws -> CurrentUser {
        let req = request(path: "/api/me")
        let resp: MeResponse = try await perform(req)
        return resp.user
    }

    /// The native presentation control intentionally exposes only the Student
    /// preset. Authorization and the signed read-only cookie remain owned by
    /// the shared server route; `/api/me` is refreshed by `SessionStore` after
    /// this request so the native shell never invents an effective role.
    func startStudentRolePreview() async throws {
        struct Body: Encodable { let role: String }
        var req = request(path: "/api/admin/role-preview", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(role: "STUDENT"))
        let _: DataWrapper<RolePreviewMutationResponse> = try await perform(req)
    }

    func stopRolePreview() async throws {
        let req = request(path: "/api/admin/role-preview", method: "DELETE")
        let _: DataWrapper<RolePreviewMutationResponse> = try await perform(req)
    }

    func changePassword(currentPassword: String, newPassword: String, revokeOtherSessions: Bool = true) async throws {
        struct Body: Encodable {
            let currentPassword: String
            let newPassword: String
            let revokeOtherSessions: Bool
        }

        var req = request(path: "/api/me/change-password", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            currentPassword: currentPassword,
            newPassword: newPassword,
            revokeOtherSessions: revokeOtherSessions
        ))
        let _: ChangePasswordResponse = try await perform(req)
    }

    func deleteAccount(currentPassword: String) async throws {
        struct Body: Encodable {
            let currentPassword: String
            let confirmation: String
        }

        var req = request(path: "/api/me/account", method: "DELETE")
        req.httpBody = try JSONEncoder().encode(Body(currentPassword: currentPassword, confirmation: "DELETE"))
        let _: SuccessResponse = try await perform(req)
    }

    // MARK: - Bookings

    /// Checkouts and reservations in one stream, soonest-finishing first.
    ///
    /// `/api/bookings` applies no `kind` filter, so one paginated, server-sorted
    /// request backs the merged Bookings list. Merging two independently paged
    /// calls client-side would let a later page insert rows above ones already
    /// on screen.
    func bookings(activeOnly: Bool = true, search: String? = nil, requesterId: String? = nil, filter: String? = nil, sort: String? = "endsAt", limit: Int = 30, offset: Int = 0) async throws -> PaginatedResponse<Booking> {
        try await perform(bookingListRequest(
            path: "/api/bookings",
            active: activeOnly,
            status: nil,
            statusList: nil,
            search: search,
            requesterId: requesterId,
            filter: filter,
            sort: sort,
            limit: limit,
            offset: offset
        ))
    }

    /// Single-kind lists, used where checkouts and reservations stay separate
    /// result groups (global search). `sort` defaults to nil so these keep the
    /// server's `startsAt desc` recency order, which is what search wants;
    /// callers that page through operational work pass an explicit key.
    func reservations(activeOnly: Bool = true, search: String? = nil, requesterId: String? = nil, filter: String? = nil, sort: String? = nil, limit: Int = 30, offset: Int = 0) async throws -> PaginatedResponse<Booking> {
        try await perform(bookingListRequest(path: "/api/reservations", active: activeOnly, status: nil, statusList: nil, search: search, requesterId: requesterId, filter: filter, sort: sort, limit: limit, offset: offset))
    }

    func checkouts(activeOnly: Bool = true, status: BookingStatus? = nil, search: String? = nil, requesterId: String? = nil, filter: String? = nil, sort: String? = nil, limit: Int = 30, offset: Int = 0) async throws -> PaginatedResponse<Booking> {
        try await perform(bookingListRequest(
            path: "/api/checkouts",
            active: false,
            status: status,
            statusList: status == nil && activeOnly ? [.open, .pendingPickup] : nil,
            search: search,
            requesterId: requesterId,
            filter: filter,
            sort: sort,
            limit: limit,
            offset: offset
        ))
    }

    private func bookingListRequest(path: String, active: Bool, status: BookingStatus?, statusList: [BookingStatus]?, search: String?, requesterId: String?, filter: String?, sort: String?, limit: Int, offset: Int) -> URLRequest {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if active { items.append(.init(name: "active", value: "true")) }
        if let status { items.append(.init(name: "status", value: status.rawValue)) }
        if let statusList, !statusList.isEmpty {
            items.append(.init(name: "status_in", value: statusList.map(\.rawValue).joined(separator: ",")))
        }
        if let search, !search.isEmpty { items.append(.init(name: "q", value: search)) }
        if let requesterId, !requesterId.isEmpty { items.append(.init(name: "requester_id", value: requesterId)) }
        if let filter, !filter.isEmpty { items.append(.init(name: "filter", value: filter)) }
        if let sort, !sort.isEmpty { items.append(.init(name: "sort", value: sort)) }
        return request(path: path, queryItems: items)
    }

    func booking(id: String) async throws -> Booking {
        let req = request(path: "/api/bookings/\(id)")
        let resp: DataWrapper<Booking> = try await perform(req)
        return resp.data
    }

    func cancelBooking(id: String) async throws -> Booking {
        let req = request(path: "/api/bookings/\(id)/cancel", method: "POST")
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    // MARK: - Booking drafts

    /// Current user's saved drafts, newest first. The server prunes drafts
    /// older than 30 days on read, so this list is already scoped to work the
    /// user could plausibly still want.
    func bookingDrafts() async throws -> [BookingDraftSummary] {
        let req = request(path: "/api/drafts")
        let resp: DataWrapper<[BookingDraftSummary]> = try await perform(req)
        return resp.data
    }

    func bookingDraft(id: String) async throws -> BookingDraftDetail {
        let req = request(path: "/api/drafts/\(id)")
        let resp: DataWrapper<BookingDraftDetail> = try await perform(req)
        return resp.data
    }

    /// Creates or updates a draft. Passing `id` updates in place, which is how
    /// repeated saves of the same composer avoid piling up rows.
    func saveBookingDraft(
        id: String?,
        title: String,
        requesterUserId: String?,
        locationId: String?,
        startsAt: Date,
        endsAt: Date,
        notes: String?,
        eventIds: [String] = [],
        serializedAssetIds: [String] = [],
        bulkItems: [BulkReservationRequest] = []
    ) async throws -> String {
        struct Body: Encodable {
            let id: String?
            let kind: String
            let title: String
            let requesterUserId: String?
            let locationId: String?
            let startsAt: String
            let endsAt: String
            let notes: String?
            let eventIds: [String]?
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
        }
        var req = request(path: "/api/drafts", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(
            id: id,
            kind: "RESERVATION",
            title: title,
            requesterUserId: requesterUserId?.isEmpty == true ? nil : requesterUserId,
            locationId: locationId?.isEmpty == true ? nil : locationId,
            startsAt: iso.string(from: startsAt),
            endsAt: iso.string(from: endsAt),
            notes: notes?.isEmpty == true ? nil : notes,
            eventIds: eventIds.isEmpty ? nil : eventIds,
            serializedAssetIds: serializedAssetIds,
            bulkItems: bulkItems
        ))
        let resp: DataWrapper<BookingStub> = try await perform(req)
        return resp.data.id
    }

    func deleteBookingDraft(id: String) async throws {
        let req = request(path: "/api/drafts/\(id)", method: "DELETE")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            // A draft that is already gone is the outcome the caller wanted.
            if http.statusCode == 404 { return }
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Discard failed"
            throw APIError.serverError(msg)
        }
    }

    func updateAssetQR(id: String, qrCodeValue: String) async throws {
        struct Body: Encodable { let qrCodeValue: String }
        var req = request(path: "/api/assets/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(qrCodeValue: qrCodeValue))
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Update failed"
            throw APIError.serverError(msg)
        }
    }

    func updateAsset(
        id: String,
        name: AssetTextMutation = .unchanged,
        serialNumber: AssetTextMutation = .unchanged,
        notes: AssetTextMutation = .unchanged
    ) async throws -> AssetUpdateConfirmation {
        struct Body: Encodable {
            let name: AssetTextMutation
            let serialNumber: AssetTextMutation
            let notes: AssetTextMutation

            enum CodingKeys: String, CodingKey {
                case name, serialNumber, notes
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                switch name {
                case .unchanged: break
                case .value(let value): try container.encode(value, forKey: .name)
                case .clear: try container.encodeNil(forKey: .name)
                }
                switch serialNumber {
                case .unchanged: break
                case .value(let value): try container.encode(value, forKey: .serialNumber)
                case .clear: try container.encodeNil(forKey: .serialNumber)
                }
                switch notes {
                case .unchanged: break
                case .value(let value): try container.encode(value, forKey: .notes)
                case .clear: try container.encode("", forKey: .notes)
                }
            }
        }
        var req = request(path: "/api/assets/\(id)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(name: name, serialNumber: serialNumber, notes: notes))
        let response: DataWrapper<AssetUpdateConfirmation> = try await perform(req)
        return response.data
    }

    func updateBooking(id: String, title: String? = nil, notes: String? = nil, locationId: String? = nil, startsAt: Date? = nil, endsAt: Date? = nil, updatedAt: Date? = nil) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before editing it.")
        }
        struct Body: Encodable {
            let title: String?
            let notes: String?
            let locationId: String?
            let startsAt: String?
            let endsAt: String?
        }
        var req = request(path: "/api/bookings/\(id)", method: "PATCH")
        req.setValue(httpDateString(updatedAt), forHTTPHeaderField: "If-Unmodified-Since")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(
            title: title,
            notes: notes,
            locationId: locationId,
            startsAt: startsAt.map { iso.string(from: $0) },
            endsAt: endsAt.map { iso.string(from: $0) }
        ))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func transferBookingOwner(id: String, targetUserId: String, updatedAt: Date?) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before transferring ownership.")
        }
        struct Body: Encodable {
            let targetUserId: String
        }
        var req = request(path: "/api/bookings/\(id)/transfer-owner", method: "POST")
        req.setValue(httpDateString(updatedAt), forHTTPHeaderField: "If-Unmodified-Since")
        req.httpBody = try JSONEncoder().encode(Body(targetUserId: targetUserId))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func bookingAvailability(for booking: Booking, endsAt: Date) async throws -> BookingAvailabilityResult {
        struct Body: Encodable {
            let locationId: String
            let startsAt: String
            let endsAt: String
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
            let excludeBookingId: String
            let kind: String
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var req = request(path: "/api/availability/check", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            locationId: booking.location.id,
            startsAt: iso.string(from: booking.startsAt),
            endsAt: iso.string(from: endsAt),
            serializedAssetIds: booking.serializedItems.map(\.assetId),
            bulkItems: booking.bulkItems.map {
                BulkReservationRequest(bulkSkuId: $0.bulkSku.id, quantity: $0.plannedQuantity)
            },
            excludeBookingId: booking.id,
            kind: booking.kind.rawValue
        ))
        return try await perform(req)
    }

    func extendBooking(id: String, endsAt: Date, updatedAt: Date?) async throws -> Booking {
        guard let updatedAt else {
            throw APIError.serverError("Refresh this booking before extending it.")
        }
        struct Body: Encodable { let endsAt: String }
        var req = request(path: "/api/bookings/\(id)/extend", method: "POST")
        req.setValue(httpDateString(updatedAt), forHTTPHeaderField: "If-Unmodified-Since")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(endsAt: iso.string(from: endsAt)))
        let response: DataWrapper<Booking> = try await perform(req)
        return response.data
    }

    func createReservation(
        title: String,
        requesterUserId: String,
        locationId: String,
        startsAt: Date,
        endsAt: Date,
        notes: String?,
        eventId: String? = nil,
        eventIds: [String] = [],
        shiftAssignmentId: String? = nil,
        sourceDraftId: String? = nil,
        serializedAssetIds: [String] = [],
        bulkItems: [BulkReservationRequest] = []
    ) async throws -> String {
        struct Body: Encodable {
            let title: String
            let requesterUserId: String
            let locationId: String
            let startsAt: String
            let endsAt: String
            let notes: String?
            let serializedAssetIds: [String]
            let bulkItems: [BulkReservationRequest]
            let eventId: String?
            let eventIds: [String]?
            let shiftAssignmentId: String?
            let sourceDraftId: String?
        }
        var req = request(path: "/api/reservations", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        req.httpBody = try JSONEncoder().encode(Body(
            title: title,
            requesterUserId: requesterUserId,
            locationId: locationId,
            startsAt: iso.string(from: startsAt),
            endsAt: iso.string(from: endsAt),
            notes: notes?.isEmpty == true ? nil : notes,
            serializedAssetIds: serializedAssetIds,
            bulkItems: bulkItems,
            eventId: eventId,
            eventIds: eventIds.isEmpty ? nil : eventIds,
            shiftAssignmentId: shiftAssignmentId,
            sourceDraftId: sourceDraftId
        ))
        let resp: DataWrapper<BookingStub> = try await perform(req)
        return resp.data.id
    }

    /// Returns scheduling conflicts keyed by asset ID for the given window, or an
    /// empty map on network/decode failure — callers treat this as a non-blocking
    /// hint (server enforcement at create/checkout is authoritative).
    ///
    /// `locationId` is required by the server schema; omitting it (or sending the
    /// wrong key) returns a 400 the caller never sees, so the map silently stays
    /// empty. Pass `excludeBookingId` so an existing booking does not conflict
    /// with itself.
    func checkAvailability(
        locationId: String,
        serializedAssetIds: [String],
        startsAt: Date,
        endsAt: Date,
        excludeBookingId: String? = nil
    ) async -> [String: AssetConflict] {
        guard !serializedAssetIds.isEmpty, !locationId.isEmpty else { return [:] }
        struct Body: Encodable {
            let locationId: String
            let serializedAssetIds: [String]
            let startsAt: String
            let endsAt: String
            let excludeBookingId: String?
        }
        // The server returns the availability result at the TOP level
        // (`{ conflicts, shortages, ... }`), not wrapped in `{ data: ... }`.
        // Decoding a `data` envelope here silently empties the conflict map
        // (this call swallows decode failures by design).
        struct CheckResponse: Decodable { let conflicts: [AssetConflict]? }

        var req = request(path: "/api/availability/check", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let body = try? JSONEncoder().encode(Body(
            locationId: locationId,
            serializedAssetIds: serializedAssetIds,
            startsAt: iso.string(from: startsAt),
            endsAt: iso.string(from: endsAt),
            excludeBookingId: excludeBookingId
        )) else { return [:] }
        req.httpBody = body
        guard let (data, response, requestBoundary) = try? await authenticatedData(for: req),
              let http = response as? HTTPURLResponse else { return [:] }
        // Hint-style call, but a swallowed 401 hides an expired session until the
        // next mutation (IOS_PATTERNS R3 / the kioskHeartbeat P0). Broadcast it.
        if http.statusCode == 401 {
            broadcastSessionExpiry(for: requestBoundary)
            return [:]
        }
        guard (200...299).contains(http.statusCode),
              let resp = try? decoder.decode(CheckResponse.self, from: data) else { return [:] }
        var map: [String: AssetConflict] = [:]
        for conflict in resp.conflicts ?? [] { map[conflict.assetId] = conflict }
        return map
    }

    func checkoutReturnInsight(for booking: Booking) async -> CheckoutReturnInsight {
        guard !booking.serializedItems.isEmpty, !booking.location.id.isEmpty else {
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        struct Body: Encodable {
            let locationId: String
            let serializedAssetIds: [String]
            let startsAt: String
            let endsAt: String
            let excludeBookingId: String?
        }
        struct UpcomingCommitment: Decodable {
            let startsAt: Date
        }
        struct CheckResponse: Decodable {
            let upcomingCommitments: [UpcomingCommitment]?
        }

        var req = request(path: "/api/availability/check", method: "POST")
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let body = try? JSONEncoder().encode(Body(
            locationId: booking.location.id,
            serializedAssetIds: booking.serializedItems.map(\.assetId),
            startsAt: iso.string(from: booking.startsAt),
            endsAt: iso.string(from: booking.endsAt),
            excludeBookingId: booking.id
        )) else { return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false) }
        req.httpBody = body

        guard let (data, response, requestBoundary) = try? await authenticatedData(for: req),
              let http = response as? HTTPURLResponse else {
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        if http.statusCode == 401 {
            broadcastSessionExpiry(for: requestBoundary)
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        guard (200...299).contains(http.statusCode),
              let resp = try? decoder.decode(CheckResponse.self, from: data) else {
            return CheckoutReturnInsight(nextNeedAt: nil, hasUpcomingNeed: false)
        }
        let nextNeedAt = resp.upcomingCommitments?.map(\.startsAt).min()
        return CheckoutReturnInsight(nextNeedAt: nextNeedAt, hasUpcomingNeed: nextNeedAt != nil)
    }

    /// Availability conflicts for a shift, keyed by userId → human note (e.g.
    /// "Conflicts with class 14:00–15:00"). Non-blocking hint for the assign
    /// picker — empty on failure so the picker still works; broadcasts 401 so a
    /// swallowed expired session can't hide here (IOS_PATTERNS R3).
    func shiftConflicts(shiftId: String) async -> [String: String] {
        let req = request(path: "/api/shifts/\(shiftId)/conflicts")
        guard let (data, response, requestBoundary) = try? await authenticatedData(for: req),
              let http = response as? HTTPURLResponse else { return [:] }
        if http.statusCode == 401 {
            broadcastSessionExpiry(for: requestBoundary)
            return [:]
        }
        struct ConflictResponse: Decodable { let data: [String: String] }
        guard (200...299).contains(http.statusCode),
              let resp = try? decoder.decode(ConflictResponse.self, from: data) else { return [:] }
        return resp.data
    }

    /// Staff-only candidate recommendations for the assignment picker. The
    /// server remains authoritative for eligibility and the final mutation.
    func shiftCandidateScores(shiftId: String) async throws -> [CandidateRecommendation] {
        let req = request(path: "/api/shifts/\(shiftId)/candidate-scores")
        let resp: DataWrapper<[CandidateRecommendation]> = try await perform(req)
        return resp.data
    }

    // MARK: - Availability blocks

    func availabilityBlocks(userId: String) async throws -> [AvailabilityBlock] {
        let req = request(path: "/api/users/\(userId)/availability")
        let resp: AvailabilityBlocksResponse = try await perform(req)
        return resp.data
    }

    func createAvailabilityBlock(
        userId: String,
        kind: String = "WEEKLY",
        intent: String = "CANNOT_WORK",
        dayOfWeek: Int,
        date: String? = nil,
        dateEndsOn: String? = nil,
        allDay: Bool = false,
        startsAt: String,
        endsAt: String,
        label: String?,
        semesterLabel: String? = nil,
        semesterStartsOn: String? = nil,
        semesterEndsOn: String? = nil
    ) async throws -> AvailabilityBlock {
        struct Body: Encodable {
            let kind: String
            let intent: String
            let dayOfWeek: Int?
            let date: String?
            let dateEndsOn: String?
            let allDay: Bool
            let startsAt: String
            let endsAt: String
            let label: String?
            let semesterLabel: String?
            let semesterStartsOn: String?
            let semesterEndsOn: String?
        }
        var req = request(path: "/api/users/\(userId)/availability", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            kind: kind,
            intent: intent,
            dayOfWeek: kind == "WEEKLY" ? dayOfWeek : nil,
            date: kind == "AD_HOC" ? date : nil,
            dateEndsOn: kind == "AD_HOC" ? dateEndsOn ?? date : nil,
            allDay: kind == "AD_HOC" && allDay,
            startsAt: startsAt,
            endsAt: endsAt,
            label: label,
            semesterLabel: semesterLabel,
            semesterStartsOn: semesterStartsOn,
            semesterEndsOn: semesterEndsOn
        ))
        let resp: DataWrapper<AvailabilityBlock> = try await perform(req)
        return resp.data
    }

    func updateAvailabilityBlock(
        userId: String,
        blockId: String,
        kind: String,
        intent: String,
        dayOfWeek: Int,
        date: String?,
        dateEndsOn: String? = nil,
        allDay: Bool = false,
        startsAt: String,
        endsAt: String,
        label: String?,
        semesterLabel: String? = nil,
        semesterStartsOn: String? = nil,
        semesterEndsOn: String? = nil
    ) async throws -> AvailabilityBlock {
        struct Body: Encodable {
            let kind: String
            let intent: String
            let dayOfWeek: Int?
            let date: String?
            let dateEndsOn: String?
            let allDay: Bool
            let startsAt: String
            let endsAt: String
            let label: String?
            let semesterLabel: String?
            let semesterStartsOn: String?
            let semesterEndsOn: String?
        }
        var req = request(path: "/api/users/\(userId)/availability/\(blockId)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(
            kind: kind,
            intent: intent,
            dayOfWeek: kind == "WEEKLY" ? dayOfWeek : nil,
            date: kind == "AD_HOC" ? date : nil,
            dateEndsOn: kind == "AD_HOC" ? dateEndsOn ?? date : nil,
            allDay: kind == "AD_HOC" && allDay,
            startsAt: startsAt,
            endsAt: endsAt,
            label: label,
            semesterLabel: semesterLabel,
            semesterStartsOn: semesterStartsOn,
            semesterEndsOn: semesterEndsOn
        ))
        let resp: DataWrapper<AvailabilityBlock> = try await perform(req)
        return resp.data
    }

    func deleteAvailabilityBlock(userId: String, blockId: String) async throws {
        let req = request(path: "/api/users/\(userId)/availability/\(blockId)", method: "DELETE")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't remove block"
            throw APIError.serverError(msg)
        }
    }

    func formOptions() async throws -> FormOptions {
        let req = request(path: "/api/form-options")
        let resp: DataWrapper<FormOptions> = try await perform(req)
        return resp.data
    }

    // MARK: - Dashboard

    func dashboard() async throws -> DashboardData {
        let req = request(path: "/api/dashboard", queryItems: [.init(name: "scope", value: "ios-home")])
        let resp: DataWrapper<DashboardData> = try await perform(req)
        return resp.data
    }

    /// Lightweight stats-only fetch for badge refresh. Avoids the heavy
    /// `/api/dashboard` payload when only counters and role are needed. Carries
    /// the same `ios-home` scope so a tab badge can never count work that
    /// belongs to somebody else while Home shows only the caller's own.
    func dashboardStats() async throws -> DashboardStatsPayload {
        let req = request(path: "/api/dashboard/stats", queryItems: [.init(name: "scope", value: "ios-home")])
        let resp: DataWrapper<DashboardStatsPayload> = try await perform(req)
        return resp.data
    }

    // MARK: - Reports

    /// `/api/reports/overdue` returns the report shape directly (no `data` envelope).
    func overdueReport() async throws -> OverdueReport {
        let req = request(path: "/api/reports/overdue")
        return try await perform(req)
    }

    /// `/api/reports/utilization`. `days` must be one of the server's accepted
    /// windows (30, 90, 365); anything else silently falls back to 90.
    func utilizationReport(days: Int) async throws -> UtilizationReport {
        let req = request(
            path: "/api/reports/utilization",
            queryItems: [.init(name: "days", value: String(days))]
        )
        return try await perform(req)
    }

    /// `/api/reports/checkouts`. `days` must be 7, 30, or 90 — the route rejects
    /// anything outside 1...366 with a 400.
    func checkoutActivityReport(days: Int) async throws -> CheckoutActivityReport {
        let req = request(
            path: "/api/reports/checkouts",
            queryItems: [.init(name: "days", value: String(days))]
        )
        return try await perform(req)
    }

    // MARK: - Licenses

    func licenses() async throws -> [LicenseCode] {
        let req = request(path: "/api/licenses")
        let resp: DataWrapper<[LicenseCode]> = try await perform(req)
        return resp.data
    }

    func myLicense() async throws -> ActiveLicenseClaim? {
        let req = request(path: "/api/licenses/my")
        let resp: DataWrapper<ActiveLicenseClaim?> = try await perform(req)
        return resp.data
    }

    func claimLicense(id: String) async throws -> LicenseClaimResult {
        let req = request(path: "/api/licenses/\(id)/claim", method: "POST")
        let resp: DataWrapper<LicenseClaimResult> = try await perform(req)
        return resp.data
    }

    @discardableResult
    func releaseLicense(id: String) async throws -> LicenseCode {
        var req = request(path: "/api/licenses/\(id)/release", method: "POST")
        req.httpBody = Data()
        let resp: DataWrapper<LicenseCode> = try await perform(req)
        return resp.data
    }

    // MARK: - Resources

    func guides(search: String? = nil, category: String? = nil) async throws -> [GuideListItem] {
        var items: [URLQueryItem] = []
        if let search, !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(.init(name: "q", value: search))
        }
        if let category, !category.isEmpty {
            items.append(.init(name: "category", value: category))
        }
        let resp: DataWrapper<[GuideListItem]> = try await perform(request(path: "/api/resources", queryItems: items))
        return resp.data
    }

    func guide(slug: String) async throws -> GuideListItem {
        let resp: DataWrapper<GuideListItem> = try await perform(request(path: "/api/resources/\(slug)"))
        return resp.data
    }

    // MARK: - Assets

    func assets(
        search: String? = nil,
        qr: String? = nil,
        statuses: Set<AssetComputedStatus> = [],
        categoryId: String? = nil,
        locationId: String? = nil,
        sort: String? = nil,
        favoritesOnly: Bool = false,
        includeAccessories: Bool = false,
        limit: Int = 30,
        offset: Int = 0
    ) async throws -> AssetsResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty { items.append(.init(name: "q", value: search)) }
        if let qr, !qr.isEmpty { items.append(.init(name: "qr", value: qr)) }
        for status in statuses {
            items.append(.init(name: "status", value: status.rawValue))
        }
        if let categoryId { items.append(.init(name: "category_id", value: categoryId)) }
        if let locationId, !locationId.isEmpty { items.append(.init(name: "location_id", value: locationId)) }
        if let sort, !sort.isEmpty { items.append(.init(name: "sort", value: sort)) }
        if favoritesOnly { items.append(.init(name: "favorites_only", value: "true")) }
        if includeAccessories { items.append(.init(name: "include_accessories", value: "true")) }
        return try await perform(request(path: "/api/assets", queryItems: items))
    }

    func asset(id: String) async throws -> AssetDetail {
        let req = request(path: "/api/assets/\(id)")
        let resp: DataWrapper<AssetDetail> = try await perform(req)
        return resp.data
    }

    func assetsLookup(rawScan: String) async throws -> String? {
        let resp = try await scannedAssets(rawScan: rawScan, limit: 5)
        return resp.data.first?.id
    }

    func scannedAssets(rawScan: String, limit: Int = 5) async throws -> AssetsResponse {
        // Old kiosk QR codes encoded the asset's CUID as bg://item/{id}.
        // Try direct ID lookup first; if 404, fall through to the qrCodeValue
        // search below (which handles bg://item/{assetTag} stored verbatim).
        if rawScan.hasPrefix("bg://item/") {
            let embedded = String(rawScan.dropFirst("bg://item/".count))
            if !embedded.isEmpty {
                do {
                    let found = try await asset(id: embedded).asAsset
                    return AssetsResponse(data: [found], bulkItems: Array(), total: 1, limit: limit, offset: 0)
                } catch APIError.notFound {
                    // Not a raw CUID — fall through to qrCodeValue search.
                }
            }
        }

        // Pass the full raw scan as ?qr= so the server can do exact qrCodeValue
        // and derived item-family unit matches. Strip URL-scheme prefixes only
        // for the ?q= general-text search.
        let stripped = rawScan
            .replacingOccurrences(of: "bg://item/", with: "")
            .replacingOccurrences(of: "bg://case/", with: "")
        let req = request(path: "/api/assets", queryItems: [
            .init(name: "q", value: stripped),
            .init(name: "qr", value: rawScan),
            .init(name: "limit", value: "\(limit)"),
        ])
        return try await perform(req)
    }

    func assetByQR(qrValue: String) async throws -> Asset? {
        let req = request(path: "/api/assets", queryItems: [
            .init(name: "qr", value: qrValue),
            .init(name: "limit", value: "1"),
        ])
        let resp: AssetsResponse = try await perform(req)
        return resp.data.first
    }

    // MARK: - Users

    func users(
        search: String? = nil,
        role: String? = nil,
        includeInactive: Bool = false,
        limit: Int = 50,
        offset: Int = 0
    ) async throws -> PaginatedResponse<AppUser> {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty { items.append(.init(name: "q", value: search)) }
        if let role, !role.isEmpty { items.append(.init(name: "role", value: role)) }
        if includeInactive { items.append(.init(name: "active", value: "all")) }
        return try await perform(request(path: "/api/users", queryItems: items))
    }

    func user(id: String) async throws -> AppUserDetail {
        let req = request(path: "/api/users/\(id)")
        let resp: DataWrapper<AppUserDetail> = try await perform(req)
        return resp.data
    }

    func userBadgeProfile(userId: String) async throws -> BadgeProfile {
        let req = request(path: "/api/badges/user/\(userId)")
        let resp: DataWrapper<BadgeProfile> = try await perform(req)
        return resp.data
    }

    /// Shared, read-only team totals. The server owns the window, stacked
    /// filter intersection, and counting rules; iOS only supplies exact facet
    /// selections and ranks the returned people for display.
    func teamScoreboard(
        sportCode: String? = nil,
        venue: String? = nil,
        opponent: String? = nil,
        site: String? = nil
    ) async throws -> TeamScoreboard {
        var items: [URLQueryItem] = []
        if let sportCode, !sportCode.isEmpty { items.append(.init(name: "sportCode", value: sportCode)) }
        if let venue, !venue.isEmpty { items.append(.init(name: "venue", value: venue)) }
        if let opponent, !opponent.isEmpty { items.append(.init(name: "opponent", value: opponent)) }
        if let site, !site.isEmpty { items.append(.init(name: "site", value: site)) }
        let response: DataWrapper<TeamScoreboard> = try await perform(
            request(path: "/api/scoreboard", queryItems: items)
        )
        return response.data
    }

    /// Read-only profile record. The route owns season scope, event counting,
    /// result classification, and visibility; the app only supplies display
    /// filters and pagination.
    func scoreboard(
        userId: String,
        season: String? = nil,
        sportCode: String? = nil,
        result: String? = nil,
        limit: Int = 25,
        offset: Int = 0
    ) async throws -> UserScoreboard {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let season, !season.isEmpty {
            items.append(.init(name: "season", value: season))
        }
        if let sportCode, !sportCode.isEmpty {
            items.append(.init(name: "sportCode", value: sportCode))
        }
        if let result, !result.isEmpty {
            items.append(.init(name: "result", value: result))
        }
        let response: DataWrapper<UserScoreboard> = try await perform(
            request(path: "/api/users/\(userId)/scoreboard", queryItems: items)
        )
        return response.data
    }

    func recentBadgeAwards(after: String?) async throws -> RecentBadgeRewards {
        var queryItems: [URLQueryItem] = []
        if let after, !after.isEmpty {
            queryItems.append(.init(name: "after", value: after))
        }
        let response: DataWrapper<RecentBadgeRewards> = try await perform(
            request(path: "/api/badges/recent", queryItems: queryItems)
        )
        return response.data
    }

    func recordBadgeAppOpen() async throws {
        struct AppOpenResponse: Decodable {
            let accepted: Bool
        }

        let response: DataWrapper<AppOpenResponse> = try await perform(
            request(path: "/api/badges/events/app-open", method: "POST")
        )
        _ = response.data.accepted
    }

    func recordProductEvent(eventName: String, surface: String) async {
        struct Body: Encodable {
            let eventName: String
            let platform: String
            let surface: String
            let appVersion: String?
            let appBuild: String?
            let osVersion: String?
            let deviceModel: String?
            let releaseChannel: String
            let installationKey: String
            let sessionKey: String
        }
        struct Accepted: Decodable { let accepted: Bool }

        let sessionKey = Self.persistedUsageKey(named: "WisconsinUsageSessionKey")
        let installationKey = Self.persistedUsageKey(named: "WisconsinUsageInstallationKey")
        let identity = AppBuildIdentity.current
        var req = request(path: "/api/product-events", method: "POST")
        req.httpBody = try? JSONEncoder().encode(Body(
            eventName: eventName,
            platform: "ios",
            surface: surface,
            appVersion: identity.appVersion,
            appBuild: identity.appBuild,
            osVersion: identity.osVersion,
            deviceModel: identity.deviceModel,
            releaseChannel: identity.releaseChannel,
            installationKey: installationKey,
            sessionKey: sessionKey
        ))
        let _: DataWrapper<Accepted>? = try? await perform(req, broadcastsSessionExpiry: false)
    }

    private static func persistedUsageKey(named key: String) -> String {
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        UserDefaults.standard.set(created, forKey: key)
        return created
    }

    /// `activeOnly` keeps this to reservations that still stand. The route
    /// otherwise returns cancelled and completed ones too, so a profile listed
    /// rows stamped "Cancelled" under a heading promising upcoming work.
    func reservationsByUser(userId: String, activeOnly: Bool = false, limit: Int = 10) async throws -> PaginatedResponse<Booking> {
        var items: [URLQueryItem] = [
            .init(name: "requester_id", value: userId),
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "0"),
        ]
        if activeOnly {
            items.append(.init(name: "status_in", value: BookingStatus.booked.rawValue))
        }
        return try await perform(request(path: "/api/reservations", queryItems: items))
    }

    /// `activeOnly` narrows to gear actually in this person's hands -- open
    /// checkouts and pickups still waiting at the kiosk. Without it the route
    /// returns completed and cancelled history too, which is right for an
    /// activity log and wrong for anything claiming to show current custody.
    func checkoutsByUser(userId: String, activeOnly: Bool = false, limit: Int = 10) async throws -> PaginatedResponse<Booking> {
        var items: [URLQueryItem] = [
            .init(name: "requester_id", value: userId),
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "0"),
        ]
        if activeOnly {
            items.append(.init(name: "status_in", value: [BookingStatus.open, .pendingPickup].map(\.rawValue).joined(separator: ",")))
        }
        return try await perform(request(path: "/api/checkouts", queryItems: items))
    }

    // MARK: - Schedule

    func calendarEvents(
        includePast: Bool = false,
        limit: Int = 60
    ) async throws -> [ScheduleEvent] {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "0"),
        ]
        if includePast { items.append(.init(name: "includePast", value: "true")) }
        let resp: ScheduleEventsResponse = try await perform(request(path: "/api/calendar-events", queryItems: items))
        return resp.data
    }

    func shiftGroup(eventId: String) async throws -> EventShiftGroup? {
        let req = request(path: "/api/shift-groups", queryItems: [
            .init(name: "eventId", value: eventId),
            .init(name: "limit", value: "1"),
        ])
        let resp: ShiftGroupsResponse = try await perform(req)
        return resp.data.first
    }

    /// Staff-only versioned working schedule. The relational shift group stays
    /// the published read model; this additive editor contract carries private
    /// draft slots and the optimistic version needed for every mutation.
    func workingScheduleEditor(shiftGroupId: String) async throws -> WorkingScheduleEditor {
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(
            request(path: "/api/shift-groups/\(shiftGroupId)/working-copy")
        )
        return response.data
    }

    /// Creates a new shift group for an event (STAFF/ADMIN).
    func createShiftGroup(eventId: String) async throws -> EventShiftGroup {
        struct Body: Encodable { let eventId: String }
        var req = request(path: "/api/shift-groups", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(eventId: eventId))
        struct Resp: Decodable { let data: EventShiftGroup }
        let resp: Resp = try await perform(req)
        return resp.data
    }

    /// `userId` defaults to the caller. Pass one to read a teammate's upcoming
    /// shifts for their profile.
    ///
    /// When asking about somebody else, the response has to say whose shifts it
    /// contains. A server without the `userId` filter ignores the parameter and
    /// returns the caller's own, which would silently print your shifts on a
    /// teammate's profile; if the answer cannot be attributed, return nothing.
    func myShifts(userId: String? = nil, limit: Int = 20) async throws -> [MyShift] {
        var items: [URLQueryItem] = [.init(name: "limit", value: "\(limit)")]
        if let userId { items.append(.init(name: "userId", value: userId)) }
        let req = request(path: "/api/my-shifts", queryItems: items)
        let resp: MyShiftsResponse = try await perform(req)
        if let userId, resp.userId != userId { return [] }
        return resp.data
    }

    func publishedSchedule(limit: Int = 100, offset: Int = 0) async throws -> PublishedScheduleResponse {
        try await perform(request(path: "/api/schedule/published", queryItems: [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]))
    }

    func publishedScheduleEvent(eventId: String) async throws -> PublishedScheduleEvent {
        let response: DataWrapper<PublishedScheduleEvent> = try await perform(
            request(path: "/api/schedule/published/\(eventId)")
        )
        return response.data
    }

    func setPublishedScheduleFollow(eventId: String, following: Bool) async throws -> Bool {
        struct Body: Encodable { let following: Bool }
        var req = request(path: "/api/schedule/published/\(eventId)/follow", method: "PUT")
        req.httpBody = try JSONEncoder().encode(Body(following: following))
        struct FollowState: Decodable { let eventId: String; let isFollowing: Bool }
        let response: DataWrapper<FollowState> = try await perform(req)
        return response.data.isFollowing
    }

    // MARK: - Favorites

    @discardableResult
    func toggleFavorite(assetId: String) async throws -> Bool {
        struct Response: Decodable { let favorited: Bool }
        let req = request(path: "/api/assets/\(assetId)/favorite", method: "POST")
        let resp: Response = try await perform(req)
        return resp.favorited
    }

    // MARK: - Notifications

    func notifications(unreadOnly: Bool = false, limit: Int = 20, offset: Int = 0) async throws -> NotificationsResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if unreadOnly { items.append(.init(name: "unread", value: "true")) }
        return try await perform(request(path: "/api/notifications", queryItems: items))
    }

    func markNotificationRead(id: String) async throws {
        struct Body: Encodable { let action: String; let id: String }
        var req = request(path: "/api/notifications", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(action: "mark_read", id: id))
        let _: SuccessResponse = try await perform(req)
    }

    func markAllNotificationsRead() async throws {
        struct Body: Encodable { let action: String }
        var req = request(path: "/api/notifications", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(action: "mark_all_read"))
        let _: SuccessResponse = try await perform(req)
    }

    func notificationUnreadCount() async throws -> Int {
        struct Response: Decodable { let unreadCount: Int }
        let req = request(path: "/api/notifications/count")
        let resp: Response = try await perform(req)
        return resp.unreadCount
    }

    // MARK: - Blasts

    /// Deliberately its own endpoint rather than a slice of `/api/dashboard`: the
    /// home view's freshness window would delay a blast, and a dashboard section
    /// failure must not be able to hide a message someone has to acknowledge.
    func activeBlasts() async throws -> [ActiveBlast] {
        let resp: DataWrapper<[ActiveBlast]> = try await perform(request(path: "/api/me/blasts"))
        return resp.data
    }

    /// "The banner rendered." Idempotent server-side, so a replay is harmless.
    func markBlastRead(id: String) async throws {
        var req = request(path: "/api/me/blasts/\(id)/read", method: "POST")
        req.httpBody = Data()
        let _: SuccessResponse = try await perform(req)
    }

    /// "Got it." Also stamps read server-side, for a tap-through from a push
    /// where the banner never rendered.
    func acknowledgeBlast(id: String) async throws {
        var req = request(path: "/api/me/blasts/\(id)/ack", method: "POST")
        req.httpBody = Data()
        let _: SuccessResponse = try await perform(req)
    }

    // MARK: - Notification preferences

    func notificationPreferences() async throws -> NotificationPreferences {
        let req = request(path: "/api/me/notification-preferences")
        let resp: DataWrapper<NotificationPreferences> = try await perform(req)
        return resp.data
    }

    func updateNotificationPreferences(_ prefs: NotificationPreferences) async throws {
        var req = request(path: "/api/me/notification-preferences", method: "PUT")
        req.httpBody = try JSONEncoder().encode(prefs)
        // Server returns `{ data: prefs }` on success — we don't reuse the
        // response body (the caller already holds the value it sent), but
        // running through `perform` gives us 401 propagation + error decode.
        let _: DataWrapper<NotificationPreferences> = try await perform(req)
    }

    // MARK: - Shift Trades

    func shiftTrades(status: String? = nil, area: String? = nil, limit: Int = 30, offset: Int = 0) async throws -> ShiftTradesResponse {
        var items: [URLQueryItem] = [
            .init(name: "limit", value: "\(limit)"),
            .init(name: "offset", value: "\(offset)"),
        ]
        if let status { items.append(.init(name: "status", value: status)) }
        if let area { items.append(.init(name: "area", value: area)) }
        return try await perform(request(path: "/api/shift-trades", queryItems: items))
    }

    func scheduleOpenWork(area: String? = nil) async throws -> OpenWorkResponse {
        var items: [URLQueryItem] = []
        if let area { items.append(.init(name: "area", value: area)) }
        let resp: DataWrapper<OpenWorkResponse> = try await perform(request(path: "/api/schedule/open-work", queryItems: items))
        return resp.data
    }

    func postShiftTrade(assignmentId: String, notes: String?) async throws -> ShiftTrade {
        struct Body: Encodable { let shiftAssignmentId: String; let notes: String? }
        var req = request(path: "/api/shift-trades", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(shiftAssignmentId: assignmentId, notes: notes))
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func claimShiftTrade(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/claim", method: "POST")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func approveShiftTrade(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/approve", method: "PATCH")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func declineShiftTrade(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/decline", method: "PATCH")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func cancelShiftTrade(id: String) async throws -> ShiftTrade {
        let req = request(path: "/api/shift-trades/\(id)/cancel", method: "PATCH")
        let resp: DataWrapper<ShiftTrade> = try await perform(req)
        return resp.data
    }

    func pickupOpenShift(id: String) async throws {
        struct Body: Encodable { let shiftId: String }
        var req = request(path: "/api/shift-assignments/pickup", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(shiftId: id))
        let _: DataWrapper<ShiftAssignmentActionResponse> = try await perform(req)
    }

    // MARK: - Shift assignment / authoring

    /// Roster of users assigned to a sport (used as the eligibility list for
    /// assigning students to ST shifts on iOS).
    func sportRoster(sportCode: String) async throws -> [RosterEntry] {
        let req = request(path: "/api/sport-configs/\(sportCode)/roster")
        let resp: DataWrapper<[RosterEntry]> = try await perform(req)
        return resp.data
    }

    func workingScheduleCandidateScores(
        shiftGroupId: String,
        slotKey: String,
        workerType: String? = nil
    ) async throws -> [CandidateRecommendation] {
        var queryItems: [URLQueryItem] = [.init(name: "slotKey", value: slotKey)]
        if let workerType {
            queryItems.append(.init(name: "workerType", value: workerType))
        }
        let response: DataWrapper<[CandidateRecommendation]> = try await perform(
            request(
                path: "/api/shift-groups/\(shiftGroupId)/working-copy/candidate-scores",
                queryItems: queryItems
            )
        )
        return response.data
    }

    func addWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        area: String,
        workerType: String,
        callStartsAt: Date? = nil,
        callEndsAt: Date? = nil
    ) async throws -> WorkingScheduleEditor {
        let iso = ISO8601DateFormatter()
        return try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "adjustSlots",
                area: area,
                workerType: workerType,
                delta: 1,
                callStartsAt: callStartsAt.map { iso.string(from: $0) },
                callEndsAt: callEndsAt.map { iso.string(from: $0) }
            )
        )
    }

    func assignWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String,
        userId: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(type: "assign", slotKey: slotKey, userId: userId)
        )
    }

    func convertAndReplaceWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String,
        workerType: String,
        userId: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "convertAndReplace",
                workerType: workerType,
                slotKey: slotKey,
                userId: userId
            )
        )
    }

    func unassignWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(type: "unassign", slotKey: slotKey)
        )
    }

    func removeWorkingScheduleSlot(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String
    ) async throws -> WorkingScheduleEditor {
        try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(type: "removeSlot", slotKey: slotKey)
        )
    }

    func setWorkingScheduleCallWindow(
        shiftGroupId: String,
        expectedVersion: Int,
        slotKey: String,
        callStartsAt: Date?,
        callEndsAt: Date?
    ) async throws -> WorkingScheduleEditor {
        let iso = ISO8601DateFormatter()
        return try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "setCallWindow",
                slotKey: slotKey,
                callStartsAt: callStartsAt.map { iso.string(from: $0) },
                callEndsAt: callEndsAt.map { iso.string(from: $0) }
            )
        )
    }

    func setWorkingScheduleCallWindowForAll(
        shiftGroupId: String,
        expectedVersion: Int,
        callStartsAt: Date?,
        callEndsAt: Date?
    ) async throws -> WorkingScheduleEditor {
        let iso = ISO8601DateFormatter()
        return try await mutateWorkingSchedule(
            shiftGroupId: shiftGroupId,
            expectedVersion: expectedVersion,
            command: WorkingScheduleCommand(
                type: "setCallWindowForAll",
                callStartsAt: callStartsAt.map { iso.string(from: $0) },
                callEndsAt: callEndsAt.map { iso.string(from: $0) }
            )
        )
    }

    func discardWorkingSchedule(shiftGroupId: String, expectedVersion: Int) async throws -> WorkingScheduleEditor {
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(
            request(
                path: "/api/shift-groups/\(shiftGroupId)/working-copy",
                method: "DELETE",
                queryItems: [.init(name: "expectedVersion", value: "\(expectedVersion)")]
            )
        )
        return response.data
    }

    /// Direct-assign a user to a shift (STAFF/ADMIN).
    func assignShift(shiftId: String, userId: String) async throws {
        struct Body: Encodable { let shiftId: String; let userId: String }
        var req = request(path: "/api/shift-assignments", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(shiftId: shiftId, userId: userId))
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't assign shift"
            throw APIError.serverError(msg)
        }
    }

    /// Remove an assignment (STAFF/ADMIN).
    func unassignShift(assignmentId: String) async throws {
        let req = request(path: "/api/shift-assignments/\(assignmentId)", method: "DELETE")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't remove assignment"
            throw APIError.serverError(msg)
        }
    }

    func updateShiftTimes(shiftId: String, startsAt: Date, endsAt: Date) async throws {
        struct Body: Encodable { let startsAt: String; let endsAt: String }
        let iso = ISO8601DateFormatter()
        var req = request(path: "/api/shifts/\(shiftId)", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(startsAt: iso.string(from: startsAt), endsAt: iso.string(from: endsAt)))
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't update shift times"
            throw APIError.serverError(msg)
        }
    }

    func approveShift(assignmentId: String) async throws {
        let req = request(path: "/api/shift-assignments/\(assignmentId)/approve", method: "PATCH")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't approve request"
            throw APIError.serverError(msg)
        }
    }

    func declineShift(assignmentId: String) async throws {
        let req = request(path: "/api/shift-assignments/\(assignmentId)/decline", method: "PATCH")
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't decline request"
            throw APIError.serverError(msg)
        }
    }

    /// Delete a shift from a shift group (STAFF/ADMIN). Pass force=true to remove even if assigned.
    func deleteShift(shiftGroupId: String, shiftId: String) async throws {
        let req = request(
            path: "/api/shift-groups/\(shiftGroupId)/shifts/\(shiftId)",
            method: "DELETE",
            queryItems: [.init(name: "force", value: "true")]
        )
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't delete shift"
            throw APIError.serverError(msg)
        }
    }

    /// Add a new shift to a shift group (STAFF/ADMIN).
    func addShift(
        shiftGroupId: String,
        area: String,
        workerType: String,
        startsAt: Date? = nil,
        endsAt: Date? = nil
    ) async throws {
        struct Body: Encodable {
            let area: String
            let workerType: String
            let startsAt: String?
            let endsAt: String?
        }
        let isoFormatter = ISO8601DateFormatter()
        let body = Body(
            area: area,
            workerType: workerType,
            startsAt: startsAt.map { isoFormatter.string(from: $0) },
            endsAt: endsAt.map { isoFormatter.string(from: $0) }
        )
        var req = request(path: "/api/shift-groups/\(shiftGroupId)/shifts", method: "POST")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response, requestBoundary) = try await authenticatedData(for: req)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 {
                broadcastSessionExpiry(for: requestBoundary)
                throw APIError.unauthorized
            }
            let msg = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error ?? "Couldn't add shift"
            throw APIError.serverError(msg)
        }
    }

    // MARK: - Profile completion

    func profileCompletion() async throws -> ProfileCompletionResponse {
        let response: DataWrapper<ProfileCompletionResponse> = try await perform(
            request(path: "/api/me/profile-completion")
        )
        return response.data
    }

    func updateProfileCompletion(_ update: ProfileCompletionUpdate) async throws -> ProfileCompletionResponse {
        var req = request(path: "/api/me/profile-completion", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(update)
        let response: DataWrapper<ProfileCompletionResponse> = try await perform(req)
        return response.data
    }

    func uploadProfileAvatar(userId: String, jpegData: Data) async throws -> String {
        struct AvatarData: Decodable { let avatarUrl: String }

        let boundary = "WisconsinAvatar-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"profile.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpegData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var req = request(path: "/api/users/\(userId)/avatar", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let response: DataWrapper<AvatarData> = try await perform(req)
        return response.data.avatarUrl
    }

    // MARK: - Internals

    private func mutateWorkingSchedule(
        shiftGroupId: String,
        expectedVersion: Int,
        command: WorkingScheduleCommand
    ) async throws -> WorkingScheduleEditor {
        struct Body: Encodable {
            let expectedVersion: Int
            let command: WorkingScheduleCommand
        }
        var req = request(path: "/api/shift-groups/\(shiftGroupId)/working-copy", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(expectedVersion: expectedVersion, command: command))
        let response: DataWrapper<WorkingScheduleEditor> = try await perform(req)
        return response.data
    }

    private func prepareAuthHost(for email: String) {
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
    private func request(path: String, method: String = "GET", queryItems: [URLQueryItem]? = nil) -> URLRequest {
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
        return req
    }

    private func httpDateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        return formatter.string(from: date)
    }

    private func authenticatedData(
        for request: URLRequest
    ) async throws -> (data: Data, response: URLResponse, boundary: UUID) {
        let requestBoundary = authSessionBoundary.capture()
        let (data, response) = try await session.data(for: request)
        guard authSessionBoundary.owns(requestBoundary) else {
            throw APIError.sessionChanged
        }
        return (data, response, requestBoundary)
    }

    private func broadcastSessionExpiry(for requestBoundary: UUID) {
        NotificationCenter.default.post(
            name: .sessionDidExpire,
            object: requestBoundary
        )
    }

    private func perform<T: Decodable>(
        _ request: URLRequest,
        broadcastsSessionExpiry: Bool = true
    ) async throws -> T {
        let data: Data
        let response: URLResponse
        let requestBoundary: UUID
        do {
            (data, response, requestBoundary) = try await authenticatedData(for: request)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        switch http.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
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
        case 403:
            if request.url?.path != "/api/me" {
                NotificationCenter.default.post(name: .collaboratorPolicyMayHaveChanged, object: nil)
            }
            let message = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.error
                ?? "You do not have access to this feature."
            throw APIError.httpError(statusCode: http.statusCode, message: message)
        case 409:
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

    // MARK: - ICS Calendar Feed

    /// Returns the user's existing ICS token, or nil if one hasn't been generated yet.
    func icsToken() async throws -> String? {
        struct Response: Decodable { let data: TokenData }
        struct TokenData: Decodable { let token: String? }
        let req = request(path: "/api/shifts/ics-token")
        let resp: Response = try await perform(req)
        return resp.data.token
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

// MARK: - Private response shapes

private struct DataWrapper<T: Decodable>: Decodable {
    let data: T
}

private struct WorkingScheduleCommand: Encodable {
    let type: String
    let area: String?
    let workerType: String?
    let delta: Int?
    let slotKey: String?
    let userId: String?
    let callStartsAt: String?
    let callEndsAt: String?

    init(
        type: String,
        area: String? = nil,
        workerType: String? = nil,
        delta: Int? = nil,
        slotKey: String? = nil,
        userId: String? = nil,
        callStartsAt: String? = nil,
        callEndsAt: String? = nil
    ) {
        self.type = type
        self.area = area
        self.workerType = workerType
        self.delta = delta
        self.slotKey = slotKey
        self.userId = userId
        self.callStartsAt = callStartsAt
        self.callEndsAt = callEndsAt
    }
}

private struct LoginResponse: Decodable {
    let user: CurrentUser
}

private struct PasskeyOptionsResponse<T: Decodable>: Decodable {
    let options: T
}

private struct MeResponse: Decodable {
    let user: CurrentUser
}

private struct RolePreviewMutationResponse: Decodable {
    let preview: RolePreviewInfo?
    let success: Bool?
}

private struct ChangePasswordResponse: Decodable {
    let success: Bool
}

private struct SuccessResponse: Decodable {
    let success: Bool
}

private struct AppBuildIdentity {
    let appVersion: String?
    let appBuild: String?
    let osVersion: String?
    let deviceModel: String?
    let releaseChannel: String

    static var current: AppBuildIdentity {
        let info = Bundle.main.infoDictionary
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return AppBuildIdentity(
            appVersion: info?["CFBundleShortVersionString"] as? String,
            appBuild: info?["CFBundleVersion"] as? String,
            osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            deviceModel: hardwareModel,
            releaseChannel: releaseChannel
        )
    }

    private static var hardwareModel: String {
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        guard size > 0 else { return "unknown" }
        var machine = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        let bytes = machine.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
        return String(decoding: bytes, as: UTF8.self)
    }

    private static var releaseChannel: String {
        #if DEBUG
        return "development"
        #else
        guard let receipt = Bundle.main.appStoreReceiptURL else { return "unknown" }
        return receipt.lastPathComponent == "sandboxReceipt" ? "testflight" : "app_store"
        #endif
    }
}

private struct ServerErrorBody: Decodable {
    let error: String
}

private struct ConflictResponseBody: Decodable {
    let error: String?
    let data: ConflictData?

    struct ConflictData: Decodable {
        let conflicts: [ConflictItem]?
        let unavailableAssets: [UnavailableItem]?
        let shortages: [Shortage]?

        struct ConflictItem: Decodable {
            let assetId: String
            let conflictingBookingTitle: String?
        }
        struct UnavailableItem: Decodable {
            let assetId: String
            let status: String
        }
        struct Shortage: Decodable {
            let bulkSkuId: String
            let requested: Int
            let available: Int
        }
    }
}
