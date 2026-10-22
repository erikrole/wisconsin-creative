import Foundation

// Favorites, notifications, blasts, and notification preferences.

extension APIClient {
    // MARK: - Favorites

    @discardableResult
    func toggleFavorite(assetId: String) async throws -> Bool {
        struct Response: Decodable { let favorited: Bool }
        let req = request(path: "/api/assets/\(assetId)/favorite", method: "POST")
        let resp: Response = try await perform(req)
        return resp.favorited
    }

    /// Toggles an item between MAINTENANCE and AVAILABLE. Server-side this is
    /// a SERIALIZABLE transaction so two people flagging the same camera cannot
    /// lose one another's update, and it writes an audit entry either way.
    ///
    /// Only `status` is decoded. The route replies with the raw Prisma row,
    /// whose `status` is the stored enum — not the derived `computedStatus`
    /// every Swift asset model reads — so decoding the whole row as an `Asset`
    /// would fail. Callers refetch the detail for display state.
    func toggleAssetMaintenance(assetId: String) async throws -> Bool {
        struct AssetStatus: Decodable { let status: String }
        let req = request(path: "/api/assets/\(assetId)/maintenance", method: "POST")
        let resp: DataWrapper<AssetStatus> = try await perform(req)
        return resp.data.status == "MAINTENANCE"
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

    func markAllNotificationsRead() async throws -> [String] {
        struct Body: Encodable { let action: String }
        struct Response: Decodable { let success: Bool; let ids: [String] }
        var req = request(path: "/api/notifications", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(Body(action: "mark_all_read"))
        let resp: Response = try await perform(req)
        return resp.ids
    }

    func markNotificationsUnread(ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        struct Body: Encodable { let action: String; let ids: [String] }
        let body = Body(action: "mark_unread", ids: ids)
        var req = request(path: "/api/notifications", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(body)
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
        BlastArchive.markAcknowledged(id)
    }

    // MARK: - Notification preferences

    func notificationPreferences() async throws -> NotificationPreferences {
        let req = request(path: "/api/me/notification-preferences")
        let resp: DataWrapper<NotificationPreferences> = try await perform(req)
        return resp.data
    }

    /// Preferences plus the categories this account's role receives. The
    /// catalog is absent from servers that predate per-category levels.
    struct NotificationPreferencesPayload: Decodable {
        let data: NotificationPreferences
        let catalog: [NotificationCategoryEntry]?
    }

    func notificationPreferencesWithCatalog() async throws -> NotificationPreferencesPayload {
        let req = request(path: "/api/me/notification-preferences")
        return try await perform(req)
    }

    func patchNotificationPreferences(_ patch: NotificationPreferencesPatch) async throws -> NotificationPreferencesPayload {
        var req = request(path: "/api/me/notification-preferences", method: "PATCH")
        req.httpBody = try JSONEncoder().encode(patch)
        return try await perform(req)
    }

    func updateNotificationPreferences(_ prefs: NotificationPreferences) async throws {
        var req = request(path: "/api/me/notification-preferences", method: "PUT")
        req.httpBody = try JSONEncoder().encode(prefs)
        // Server returns `{ data: prefs }` on success — we don't reuse the
        // response body (the caller already holds the value it sent), but
        // running through `perform` gives us 401 propagation + error decode.
        let _: DataWrapper<NotificationPreferences> = try await perform(req)
    }
}
