#if DEBUG
import Foundation

/// Local responses for the actual recovery screens exercised by the review.
enum RecentIOSReviewFixtures {
    static let software = Data(#"{"data":[{"id":"review-login","name":"Review Account","category":"Demo","websiteUrl":null,"accountEmail":"review@example.test","hasPassword":true,"visibleTo":["STAFF"],"archivedAt":null,"updatedAt":"2026-10-22T12:00:00Z"}]}"#.utf8)
    static let secret = Data(#"{"data":{"password":"review-only-secret"}}"#.utf8)
    static let family = Data(#"{"data":[],"bulkItems":[{"id":"review-family","kind":"bulk","name":"Review Batteries","category":"Power","unit":"battery","trackByNumber":true,"onHandQuantity":8,"availableQuantity":3,"checkedOutQuantity":5,"lostQuantity":0,"retiredQuantity":0,"matchedUnitNumber":1,"matchedUnitStatus":"AVAILABLE","locationName":"Camp Randall","locationId":"review-location","binQrCodeValue":"BIN-REVIEW"}],"itemOrder":["bulk-review-family"],"total":1,"limit":30,"offset":0}"#.utf8)
    static func scoreboard(_ source: Data) -> Data {
        guard ProcessInfo.processInfo.environment["GT_SCOREBOARD_ZERO"] == "1",
              var payload = try? JSONSerialization.jsonObject(with: source) as? [String: Any],
              var data = payload["data"] as? [String: Any],
              var people = data["leaderboard"] as? [[String: Any]],
              !people.isEmpty, var summary = people[0]["summary"] as? [String: Any]
        else { return source }
        summary["winRate"] = 0
        summary["wins"] = 0
        summary["losses"] = 3
        summary["games"] = 3
        people[0]["summary"] = summary
        data["leaderboard"] = people
        payload["data"] = data
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? source
    }

}
#endif
