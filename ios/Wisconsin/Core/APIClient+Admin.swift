import Foundation

// Dashboard, accountability, reports, licenses, and shared logins.

extension APIClient {
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

    // MARK: - Accountability

    /// `GET /api/accountability`. The body is the report itself, same as the
    /// report routes, not a `{ data }` envelope. Sends only `sort` and, for
    /// all-time, `year=all`. Those are the values the route validates.
    func accountabilityReport(
        scope: AccountabilityScope,
        sort: AccountabilitySort
    ) async throws -> AccountabilityReport {
        let req = request(
            path: "/api/accountability",
            queryItems: AccountabilityQuery.items(scope: scope, sort: sort)
        )
        return try await perform(req)
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

    /// Same checkout payload as `checkoutActivityReport`, including the rows
    /// and requester ranking the glance does not draw. Never requests CSV.
    func checkoutDetailReport(days: Int) async throws -> CheckoutDetailReport {
        let req = request(
            path: "/api/reports/checkouts",
            queryItems: [.init(name: "days", value: String(days))]
        )
        return try await perform(req)
    }

    /// Same utilization payload as `utilizationReport`, including breakdowns
    /// and idle gear. Never requests CSV.
    func utilizationDetailReport(days: Int) async throws -> UtilizationDetailReport {
        let req = request(
            path: "/api/reports/utilization",
            queryItems: [.init(name: "days", value: String(days))]
        )
        return try await perform(req)
    }

    /// Owner-only aggregate counts. The server returns 403 for everyone else.
    func usageReport(days: Int) async throws -> UsageReport {
        let req = request(
            path: "/api/reports/usage",
            queryItems: [.init(name: "days", value: String(days))]
        )
        return try await perform(req)
    }

    func scanReport(startDate: String?, endDate: String?, phase: String?, limit: Int, offset: Int) async throws -> ScanHistoryReport {
        var items = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let startDate {
            items.append(URLQueryItem(name: "startDate", value: startDate))
        }
        if let endDate {
            items.append(URLQueryItem(name: "endDate", value: endDate))
        }
        if let phase {
            items.append(URLQueryItem(name: "phase", value: phase))
        }
        return try await perform(request(path: "/api/reports/scans", queryItems: items))
    }

    func missingUnitsReport(categoryId: String?, locationId: String?) async throws -> MissingUnitsReport {
        var items: [URLQueryItem] = []
        if let categoryId {
            items.append(URLQueryItem(name: "category", value: categoryId))
        }
        if let locationId {
            items.append(URLQueryItem(name: "location", value: locationId))
        }
        return try await perform(request(
            path: "/api/reports/bulk-losses",
            queryItems: items.isEmpty ? nil : items
        ))
    }

    func badgeReport(days: Int) async throws -> BadgeReport {
        let req = request(
            path: "/api/reports/badges",
            queryItems: [.init(name: "days", value: String(days))]
        )
        return try await perform(req)
    }

    /// `/api/me` already returns this allowlist flag beside the user. Missing
    /// on an older server means the report stays hidden.
    func canViewUsageAnalytics() async throws -> Bool {
        let req = request(path: "/api/me")
        let resp: MeResponse = try await perform(req)
        return resp.canViewUsageAnalytics ?? false
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

    func myLicenseHistory() async throws -> [LicenseHistoryEntry] {
        let req = request(path: "/api/licenses/my/history")
        let resp: DataWrapper<[LicenseHistoryEntry]> = try await perform(req)
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

    func reportBrokenLicense(id: String) async throws -> LicenseReportBrokenResult {
        var req = request(path: "/api/licenses/\(id)/report-broken", method: "POST")
        req.httpBody = Data()
        let resp: DataWrapper<LicenseReportBrokenResult> = try await perform(req)
        return resp.data
    }

    // MARK: - Shared logins

    /// Active department logins this person may see. The payload has emails, never passwords.
    func softwareLogins() async throws -> [SoftwareLogin] {
        let req = request(path: "/api/software")
        let resp: DataWrapper<[SoftwareLogin]> = try await perform(req)
        return resp.data
    }

    func sharedWifi() async throws -> SharedWifi {
        let resp: DataWrapper<SharedWifi> = try await perform(request(path: "/api/wifi"))
        return resp.data
    }

    /// One audited password reveal. The caller must not log or persist the result.
    func softwareLoginPassword(id: String) async throws -> String {
        struct Secret: Decodable { let password: String }
        var req = request(path: "/api/software/\(id)/secret", method: "POST")
        req.httpBody = Data()
        let resp: DataWrapper<Secret> = try await perform(req)
        guard !resp.data.password.isEmpty else {
            throw APIError.serverError("Password response was incomplete")
        }
        return resp.data.password
    }
}
