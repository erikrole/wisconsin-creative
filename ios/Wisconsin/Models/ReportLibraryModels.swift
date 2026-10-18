import Foundation

// Read-only shapes for the report screens staff open from Reports.
// Each struct decodes the shared `/api/reports/*` JSON and ignores keys the
// phone does not draw, including every CSV-only field. Optional lists keep a
// shipped build readable when a server omits a section.

struct CheckoutDetailReport: Decodable, Sendable {
    let days: Int
    let partialFailures: [String]?
    let totalCheckouts: Int
    let previousTotalCheckouts: Int?
    let overdueCheckouts: Int
    let dailyTrend: [CheckoutTrendPoint]?
    let recentCheckouts: [CheckoutReportRow]?
    let topRequesters: [CheckoutRequesterRank]?

    var rows: [CheckoutReportRow] { recentCheckouts ?? [] }
    var ranks: [CheckoutRequesterRank] { topRequesters ?? [] }
    var isIncomplete: Bool { !(partialFailures ?? []).isEmpty }
}

struct CheckoutReportRow: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String
    let endsAt: String?
    let requester: String
    let location: String?
    let itemCount: Int
    let isOverdue: Bool
}

struct CheckoutRequesterRank: Decodable, Hashable, Sendable {
    let name: String
    let count: Int
}

struct UtilizationDetailReport: Decodable, Sendable {
    let days: Int?
    let activeAssets: Int?
    let partialFailures: [String]?
    let totalAssets: Int
    let statusCounts: [String: Int]
    let custody: UtilizationDetailCustody?
    let byLocation: [UtilizationLocationCount]?
    let byType: [UtilizationTypeCount]?
    let byCategory: [UtilizationCategoryCount]?
    let byDepartment: [UtilizationDepartmentCount]?

    var isIncomplete: Bool { !(partialFailures ?? []).isEmpty }
}

struct UtilizationDetailCustody: Decodable, Sendable {
    let utilizationRate: Double
    let custodyDays: Double
    let assetsUsed: Int
    let checkoutCount: Int
    let idleCount: Int
    let neverCheckedOutCount: Int
    let topUsed: [UtilizationTopUsedAsset]?
    let idleAssets: [UtilizationIdleAsset]?

    var ranked: [UtilizationTopUsedAsset] { topUsed ?? [] }
    var idle: [UtilizationIdleAsset] { idleAssets ?? [] }
}

struct UtilizationLocationCount: Decodable, Identifiable, Sendable {
    let location: String
    let locationId: String?
    let count: Int
    var id: String { locationId ?? location }
}

struct UtilizationTypeCount: Decodable, Identifiable, Sendable {
    let type: String
    let count: Int
    var id: String { type }
}

struct UtilizationCategoryCount: Decodable, Identifiable, Sendable {
    let category: String
    let categoryId: String?
    let count: Int
    var id: String { categoryId ?? category }
}

struct UtilizationDepartmentCount: Decodable, Identifiable, Sendable {
    let department: String
    let departmentId: String?
    let count: Int
    var id: String { departmentId ?? department }
}

struct UtilizationIdleAsset: Decodable, Identifiable, Sendable {
    let assetId: String
    let assetTag: String
    let name: String
    let category: String?
    let lastCheckedOutAt: String?
    var id: String { assetId }
}

struct UsageReport: Decodable, Sendable {
    let days: Int
    let totalEvents: Int
    let activeUsers: Int
    let platforms: [UsageCount]?
    let surfaces: [UsageCount]?
    let events: [UsageCount]?
    let versions: [UsageVersion]?
    let notifications: UsageNotifications?
    let health: UsageHealth?
}

struct UsageCount: Decodable, Identifiable, Sendable {
    let name: String
    let count: Int
    var id: String { name }
}

struct UsageVersion: Decodable, Identifiable, Sendable {
    let platform: String
    let version: String?
    let count: Int
    var id: String { "\(platform) \(version ?? "")" }
}

struct UsageNotifications: Decodable, Sendable {
    let deliveries: [UsageCount]?
    let pushReadiness: [UsageCount]?
    let preferenceChanges: [UsageCount]?
    let responses: [UsageCount]?
    let timeToAct: [UsageCount]?
}

struct UsageHealth: Decodable, Sendable {
    let jobs: [UsageCount]?
    let diagnostics: [UsageCount]?
}

struct ScanHistoryReport: Decodable, Sendable {
    let data: [ScanHistoryRow]?
    let total: Int
    let previousTotal: Int?
    let previousSuccessRate: Int?
    let successCount: Int
    let successRate: Int
    let dailyScans: [ScanDailyPoint]?
    let limit: Int?
    let offset: Int?

    var rows: [ScanHistoryRow] { data ?? [] }
    var points: [ScanDailyPoint] { dailyScans ?? [] }

    func appending(_ page: ScanHistoryReport) -> ScanHistoryReport {
        let seen = Set(rows.map(\.id))
        let more = page.rows.filter { !seen.contains($0.id) }
        return ScanHistoryReport(
            data: rows + more,
            total: page.total,
            previousTotal: page.previousTotal ?? previousTotal,
            previousSuccessRate: page.previousSuccessRate ?? previousSuccessRate,
            successCount: page.successCount,
            successRate: page.successRate,
            dailyScans: page.points.isEmpty ? points : page.points,
            limit: page.limit,
            offset: page.offset
        )
    }
}

struct ScanHistoryRow: Decodable, Identifiable, Sendable {
    let id: String
    let actor: String
    let success: Bool
    let phase: String?
    let item: String
    let bookingId: String?
    let bookingTitle: String?
    let createdAt: String
}

struct ScanDailyPoint: Decodable, Identifiable, Sendable {
    let date: String
    let success: Int
    let fail: Int
    var id: String { date }
}

struct MissingUnitsReport: Decodable, Sendable {
    let totalLost: Int
    let filterOptions: MissingUnitFilters?
    let bySku: [MissingUnitFamily]?
    let byUser: [MissingUnitPerson]?
    let recentLosses: [MissingUnitEvent]?
    let batteryAudit: BatteryMissingAudit?

    var families: [MissingUnitFamily] { bySku ?? [] }
    var people: [MissingUnitPerson] { byUser ?? [] }
    var events: [MissingUnitEvent] { recentLosses ?? [] }
}

struct MissingUnitFilters: Decodable, Sendable {
    let categories: [ReportNamedID]?
    let locations: [ReportNamedID]?
}

struct ReportNamedID: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
}

struct MissingUnitFamily: Decodable, Identifiable, Sendable {
    let skuName: String
    let bulkSkuId: String
    let count: Int
    var id: String { bulkSkuId }
}

struct MissingUnitPerson: Decodable, Hashable, Sendable {
    let name: String
    let count: Int
}

struct MissingUnitEvent: Decodable, Identifiable, Sendable {
    let id: String
    let bookingId: String?
    let createdAt: String
    let actor: ReportPersonName?
}

struct ReportPersonName: Decodable, Sendable {
    let id: String
    let name: String
}

struct BatteryMissingAudit: Decodable, Sendable {
    let totals: BatteryMissingTotals?
    let bySku: [BatteryFamilySummary]?
    let missingUnits: [BatteryMissingUnit]?
    let checkoutHistory: [BatteryCheckoutHistoryRow]?
    let repeatPatterns: [BatteryRepeatPattern]?

    var families: [BatteryFamilySummary] { bySku ?? [] }
    var units: [BatteryMissingUnit] { missingUnits ?? [] }
    var history: [BatteryCheckoutHistoryRow] { checkoutHistory ?? [] }
    var patterns: [BatteryRepeatPattern] { repeatPatterns ?? [] }
}

struct BatteryMissingTotals: Decodable, Sendable {
    let skuCount: Int
    let totalUnits: Int
    let available: Int
    let checkedOut: Int
    let lost: Int
    let retired: Int
    let lossRate: Double
    let repeatPatternCount: Int
}

struct BatteryFamilySummary: Decodable, Identifiable, Sendable {
    let bulkSkuId: String
    let skuName: String
    let category: String?
    let location: String?
    let total: Int
    let available: Int
    let checkedOut: Int
    let lost: Int
    let lossRate: Double
    let missingUnitNumbers: [Int]?
    let lastMissingAt: String?
    var id: String { bulkSkuId }

    var missingNumbers: [Int] { missingUnitNumbers ?? [] }
}

struct BatteryMissingUnit: Decodable, Identifiable, Sendable {
    let id: String
    let skuName: String
    let unitNumber: Int
    let notes: String?
    let markedMissingAt: String?
    let lastRequesterName: String?
    let lastBookingTitle: String?
    let lastBookingRef: String?
}

struct BatteryCheckoutHistoryRow: Decodable, Identifiable, Sendable {
    let id: String
    let skuName: String
    let unitNumber: Int
    let status: String
    let checkedOutAt: String
    let checkedInAt: String?
    let requesterName: String
    let bookingTitle: String?
    let bookingRef: String?
}

struct BatteryRepeatPattern: Decodable, Hashable, Sendable {
    let type: String
    let label: String
    let count: Int
    let detail: String?
}

struct BadgeReport: Decodable, Sendable {
    let totalAwards: Int
    let manualAwards: Int
    let automaticAwards: Int?
    let manualAwardRate: Double
    let days: Int?
    let recentAwardCount: Int
    let previousRecentAwardCount: Int?
    let activeDefinitionCount: Int
    let leaderboard: [BadgeLeaderRow]?
    let distribution: [BadgeDistributionRow]?
    let recentAwards: [BadgeAwardRow]?
    let underusedDefinitions: [BadgeUnderusedRow]?

    var leaders: [BadgeLeaderRow] { leaderboard ?? [] }
    var spread: [BadgeDistributionRow] { distribution ?? [] }
    var awards: [BadgeAwardRow] { recentAwards ?? [] }
    var underused: [BadgeUnderusedRow] { underusedDefinitions ?? [] }
}

struct BadgeLeaderRow: Decodable, Identifiable, Sendable {
    let userId: String
    let name: String
    let count: Int
    var id: String { userId }
}

struct BadgeDistributionRow: Decodable, Identifiable, Sendable {
    let definitionId: String
    let name: String
    let category: String?
    let count: Int
    var id: String { definitionId }
}

struct BadgeUnderusedRow: Decodable, Identifiable, Sendable {
    let definitionId: String
    let name: String
    let category: String?
    let count: Int
    var id: String { definitionId }
}

struct BadgeAwardRow: Decodable, Identifiable, Sendable {
    let id: String
    let awardedAt: String
    let source: String
    let note: String?
    let user: ReportPersonName
    let definition: BadgeAwardDefinition
    let awardedBy: ReportPersonName?
}

struct BadgeAwardDefinition: Decodable, Sendable {
    let name: String
    let category: String?
}
