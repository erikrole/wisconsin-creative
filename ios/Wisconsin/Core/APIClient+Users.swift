import Foundation

// Users and usage tracking.

extension APIClient {
    // MARK: - Users

    func users(
        search: String? = nil,
        role: String? = nil,
        includeInactive: Bool = false,
        limit: Int = 50,
        offset: Int = 0
    ) async throws -> UserListResponse {
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

    /// Every shift this person is on, newest first. One read, capped at 500.
    func personShifts(userId: String) async throws -> [PersonShift] {
        let resp: DataWrapper<[PersonShift]> = try await perform(request(path: "/api/users/\(userId)/shifts"))
        return resp.data
    }

    /// Next shift, gear in hand, this week's shifts and returns performance.
    func userRightNow(userId: String) async throws -> RightNowPayload {
        let resp: DataWrapper<RightNowPayload> = try await perform(request(path: "/api/users/\(userId)/right-now"))
        return resp.data
    }

    /// The staff award catalog. `manualOnly` is the same filter the website
    /// uses on `/badges`. Awarding stays on the web.
    func teamBadgeCatalog() async throws -> TeamBadgeCatalog {
        try await perform(request(
            path: "/api/badges",
            queryItems: [URLQueryItem(name: "manualOnly", value: "true")]
        ))
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
        site: String? = nil,
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
        if let site, !site.isEmpty {
            items.append(.init(name: "site", value: site))
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

    /// Records a foreground and returns everything earned since `after`,
    /// including what this open minted, so a foreground is one request.
    /// Nil when the server had no usable cursor to answer from.
    func recordBadgeAppOpen(after: String?) async throws -> RecentBadgeRewards? {
        struct AppOpenResponse: Decodable {
            let accepted: Bool
            let awards: [EarnedBadgeReward]?
            let nextCursor: String?
        }

        var queryItems: [URLQueryItem] = []
        if let after, !after.isEmpty {
            queryItems.append(.init(name: "after", value: after))
        }
        let response: DataWrapper<AppOpenResponse> = try await perform(
            request(path: "/api/badges/events/app-open", method: "POST", queryItems: queryItems)
        )
        guard let awards = response.data.awards, let nextCursor = response.data.nextCursor else { return nil }
        return RecentBadgeRewards(awards: awards, nextCursor: nextCursor)
    }

    /// The one announcement this person should see now, or nil. Read on launch
    /// and on foreground only; there is no polling behind it.
    func activeAnnouncement() async throws -> ActiveAnnouncement? {
        let response: DataWrapper<ActiveAnnouncement?> = try await perform(
            request(
                path: "/api/announcements/active",
                queryItems: [URLQueryItem(name: "platform", value: "ios")]
            )
        )
        return response.data
    }

    /// Every announcement this person could have been shown, newest first,
    /// for the Browse "What's new" list. Read on appear and pull-to-refresh.
    func announcementHistory() async throws -> [AnnouncementHistoryEntry] {
        let response: DataWrapper<[AnnouncementHistoryEntry]> = try await perform(
            request(
                path: "/api/announcements/history",
                queryItems: [URLQueryItem(name: "platform", value: "ios")]
            )
        )
        return response.data
    }

    /// Records that this person has seen the announcement. Idempotent server-side.
    func dismissAnnouncement(id: String) async throws {
        struct Dismissed: Decodable { let dismissed: Bool }
        let _: Dismissed = try await perform(
            request(path: "/api/announcements/\(id)/dismiss", method: "POST")
        )
    }

    /// Uploads one MetricKit diagnostic payload (crashes, hangs, resource
    /// exceptions). Carries no user identity; best-effort.
    func uploadDiagnosticPayload(_ json: Data) async {
        guard let body = DiagnosticUpload.body(platform: "ios", payload: json) else { return }
        struct Stored: Decodable { let stored: Int }
        var req = request(path: "/api/diagnostics", method: "POST")
        req.httpBody = body
        let _: DataWrapper<Stored>? = try? await perform(req, broadcastsSessionExpiry: false)
    }

    /// `properties` keys are limited server-side to source, mode, and reason;
    /// values are lowercase snake case, at most 32 characters.
    func recordProductEvent(
        eventName: String,
        surface: String,
        outcome: String? = nil,
        properties: [String: String]? = nil
    ) async {
        struct Body: Encodable {
            let eventName: String
            let platform: String
            let surface: String
            let outcome: String?
            let properties: [String: String]?
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
            outcome: outcome,
            properties: properties,
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

    static func persistedUsageKey(named key: String) -> String {
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

    func sendProblemReport(message: String) async throws {
        struct Body: Encodable {
            let message: String
            let client: ProblemReportClient
            let screen: String?
            let breadcrumbs: [DiagnosticBreadcrumbs.Crumb]
        }
        struct Created: Decodable { let id: String }
        let session = DiagnosticBreadcrumbs.shared.current
        var req = request(path: "/api/support-reports", method: "POST")
        req.httpBody = try JSONEncoder().encode(Body(
            message: message,
            client: ProblemReportClient.current,
            screen: session.screen,
            breadcrumbs: session.breadcrumbs
        ))
        let _: DataWrapper<Created> = try await perform(req)
    }

}
