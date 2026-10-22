import Testing
import Foundation
import AppIntents
@testable import Wisconsin

@Suite @MainActor
struct RecentIOSRegressionTests {
    @Test func failedLegacyCacheEnumerationRetriesAndPreservesUnrelatedFiles() throws {
        let manager = FileManager.default
        let suiteName = "legacy-cache-review-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        let root = manager.temporaryDirectory.appendingPathComponent(suiteName, isDirectory: true)
        defer {
            defaults.removePersistentDomain(forName: suiteName)
            try? manager.removeItem(at: root)
        }
        LegacyGearCache.purgeIfNeeded(defaults: defaults, directory: root)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        let legacy = root.appendingPathComponent("GearCache.store-wal")
        let unrelated = root.appendingPathComponent("Other.store")
        try Data("old account".utf8).write(to: legacy)
        try Data("keep".utf8).write(to: unrelated)

        LegacyGearCache.purgeIfNeeded(defaults: defaults, directory: root)

        #expect(!manager.fileExists(atPath: legacy.path))
        #expect(try Data(contentsOf: unrelated) == Data("keep".utf8))
    }

    @Test func gearSearchIncludesAvailableAndUnavailableFamilies() throws {
        let response = try JSONDecoder().decode(AssetsResponse.self, from: RecentIOSReviewFixtures.family)
        let matches = response.orderedRows.map(GearSearchMatch.init)
        #expect(matches.count == 1)
        #expect(matches[0].title == "Review Batteries")
        #expect(matches[0].status == "3 of 8 units available")
        #expect(matches[0].isAvailable)
        let empty = RecentIOSReviewFixtures.family.replacingUTF8("\"availableQuantity\":3", with: "\"availableQuantity\":0")
        let unavailable = try JSONDecoder().decode(AssetsResponse.self, from: empty)
        #expect(!unavailable.orderedRows.map(GearSearchMatch.init)[0].isAvailable)
    }

    @Test func searchGearRequiresLocalAuthentication() {
        #expect(SearchGearIntent.authenticationPolicy == .requiresLocalDeviceAuthentication)
    }

    @Test func staffHomeDescribesThePersonalProjectionAndKeepsOwnOverdueItems() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let response = try decoder.decode(DataWrapper<DashboardData>.self, from: HomeFixtureAPI.dashboard)
        let dashboard = response.data
        #expect(HomeModel.daySummary(dash: dashboard).contains("Your gear: 1 overdue"))
        #expect(!HomeModel.daySummary(dash: dashboard).contains("Team gear"))
        #expect(HomeModel.attention(dash: dashboard, claimedTrades: []).contains { $0.id == "my-overdue-od1" })
        #expect(dashboard.teamCheckouts.items.isEmpty)
        #expect(dashboard.upcomingEvents.isEmpty)
    }
}

private extension Data {
    func replacingUTF8(_ text: String, with replacement: String) -> Data {
        Data(String(decoding: self, as: UTF8.self).replacingOccurrences(of: text, with: replacement).utf8)
    }
}
