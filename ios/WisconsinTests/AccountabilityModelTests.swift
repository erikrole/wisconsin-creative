import XCTest
@testable import Wisconsin

/// Trimmed `GET /api/accountability` body. A decode failure here is the bug
/// that would compile and then show an empty leaderboard.
final class AccountabilityModelTests: XCTestCase {
    func testFractionalGracePeriodsDecodeAndKeepTheirPrecisionInCopy() throws {
        for (hours, phrase) in [(0.0, "0 hours"), (0.5, "0.5 hours"), (1.0, "1 hour"), (12.5, "12.5 hours")] {
            let body = """
            {"gracePeriodHours":\(hours),"minimumCheckoutsForRate":3,"sort":"events","ranking":"Late events"}
            """
            let methodology = try JSONDecoder().decode(AccountabilityMethodology.self, from: Data(body.utf8))
            XCTAssertEqual(Double(methodology.gracePeriodHours), hours)
            XCTAssertEqual(methodology.graceSentence, "A return is late after \(phrase) past due.")
        }
    }

    func testReportDecodesLeaderboardAndIgnoresAdminFields() throws {
        let json = """
        {
          "generatedAt": "2026-10-16T15:00:00.000Z",
          "truncated": false,
          "scanLimit": 5000,
          "academicYear": {
            "startYear": 2026,
            "label": "2026-27",
            "start": "2026-07-01T05:00:00.000Z",
            "end": "2027-07-01T05:00:00.000Z"
          },
          "methodology": {
            "gracePeriodHours": 2,
            "minimumCheckoutsForRate": 3,
            "sort": "events",
            "ranking": "Late events, then total late time, then most recent incident"
          },
          "metrics": {
            "peopleNeedingAttention": 2,
            "lateEvents": 2,
            "activeOverdue": 1,
            "totalLateHours": 30,
            "excludedRecords": 4
          },
          "capabilities": { "canExport": true, "canManageExclusions": true },
          "spotlightJeers": ["The gear shelf appreciates a little less suspense."],
          "locations": [{ "id": "loc_1", "name": "Studio" }],
          "excluded": [{
            "bookingId": "book_hidden",
            "bookingTitle": "Test checkout",
            "requester": "Ada",
            "dueAt": "2026-09-01T15:00:00.000Z",
            "reason": "TEST_DATA",
            "note": null,
            "excludedAt": "2026-09-02T15:00:00.000Z",
            "excludedBy": "Admin"
          }],
          "leaderboard": [
            {
              "userId": "user_ada",
              "name": "Ada Lovelace",
              "avatarUrl": null,
              "active": true,
              "primaryArea": "LIVE_PRODUCTION",
              "checkoutCount": 6,
              "completedCount": 5,
              "lateEventCount": 1,
              "activeOverdueCount": 1,
              "totalLateHours": 26,
              "medianLateHours": 26,
              "worstLateHours": 26,
              "onTimeRate": 80,
              "lastIncidentAt": "2026-10-15T18:00:00.000Z",
              "incidents": [{
                "incidentId": "book_1:active",
                "bookingId": "book_1",
                "title": "Friday kit",
                "dueAt": "2026-10-14T18:00:00.000Z",
                "returnedAt": null,
                "extendedAt": null,
                "extendedTo": null,
                "lateHours": 26,
                "state": "active",
                "location": { "id": "loc_1", "name": "Studio" },
                "itemSummary": "CAM-1"
              }]
            },
            {
              "userId": "user_grace",
              "name": "Grace Hopper",
              "avatarUrl": "https://example.com/grace.jpg",
              "active": false,
              "primaryArea": null,
              "checkoutCount": 2,
              "completedCount": 2,
              "lateEventCount": 1,
              "activeOverdueCount": 0,
              "totalLateHours": 4,
              "medianLateHours": 4,
              "worstLateHours": 4,
              "onTimeRate": null,
              "lastIncidentAt": "2026-08-01T18:00:00.000Z",
              "incidents": [{
                "incidentId": "book_2:extended",
                "bookingId": "book_2",
                "title": "Sunday lens",
                "dueAt": "2026-08-01T15:00:00.000Z",
                "returnedAt": "2026-08-01T20:00:00.000Z",
                "extendedAt": "2026-08-01T16:00:00.000Z",
                "extendedTo": "2026-08-01T18:00:00.000Z",
                "lateHours": 4,
                "state": "extended",
                "location": { "id": "loc_1", "name": "Studio" },
                "itemSummary": ""
              }]
            }
          ]
        }
        """
        let report = try JSONDecoder().decode(AccountabilityReport.self, from: Data(json.utf8))

        XCTAssertEqual(report.scopeTitle, "2026-27")
        XCTAssertEqual(report.metrics.summary, "2 people · 1 still out · 2 late returns")
        XCTAssertEqual(report.methodology.graceSentence, "A return is late after 2 hours past due.")
        XCTAssertEqual(report.rank(of: "user_grace"), 2)
        XCTAssertEqual(report.person("user_ada")?.areaLabel, "Live Production")
        XCTAssertEqual(report.person("user_grace")?.onTimeLabel, "Not enough checkouts")
        XCTAssertEqual(report.matching("lovelace").map(\.userId), ["user_ada"])
        XCTAssertEqual(report.notes.count, 1)

        let active = try XCTUnwrap(report.person("user_ada")?.incidents.first)
        XCTAssertEqual(active.style.label, "Currently overdue")
        XCTAssertEqual(active.style.tone, .red)
        XCTAssertEqual(active.detailLine.contains("Studio"), true)
        XCTAssertEqual(active.detailLine.contains("1d 2h late"), true)

        let extended = try XCTUnwrap(report.person("user_grace")?.incidents.first)
        XCTAssertEqual(extended.style.label, "Extended after overdue")
        XCTAssertEqual(extended.style.tone, .orange)
        XCTAssertEqual(extended.detailLine.contains("moved to"), true)
    }

    func testAllTimeReportToleratesAMissingYearAndMissingJeers() throws {
        let json = """
        {
          "generatedAt": "2026-10-16T15:00:00.000Z",
          "truncated": true,
          "academicYear": null,
          "methodology": {
            "gracePeriodHours": 1,
            "minimumCheckoutsForRate": 3,
            "sort": "time",
            "ranking": "Total late time"
          },
          "metrics": {
            "peopleNeedingAttention": 0,
            "lateEvents": 0,
            "activeOverdue": 0,
            "totalLateHours": 0
          },
          "leaderboard": []
        }
        """
        let report = try JSONDecoder().decode(AccountabilityReport.self, from: Data(json.utf8))

        XCTAssertEqual(report.scopeTitle, "All time")
        XCTAssertEqual(report.truncated, true)
        XCTAssertTrue(report.notes.isEmpty)
        XCTAssertEqual(report.methodology.graceSentence, "A return is late after 1 hour past due.")
        XCTAssertNil(report.rank(of: "missing"))
    }

    func testQuerySendsSortAndOnlyAllTimeYear() {
        let current = AccountabilityQuery.items(scope: .thisYear, sort: .events)
        XCTAssertEqual(current.map(\.name), ["sort"])
        XCTAssertEqual(current.first?.value, "events")

        let allTime = AccountabilityQuery.items(scope: .allTime, sort: .recent)
        XCTAssertEqual(allTime.map(\.name), ["sort", "year"])
        XCTAssertEqual(allTime.map(\.value), ["recent", "all"])
    }

    func testDurationAndOrdinalStayInProductLanguage() {
        XCTAssertEqual(accountabilityLateDuration(0), "0h")
        XCTAssertEqual(accountabilityLateDuration(23), "23h")
        XCTAssertEqual(accountabilityLateDuration(24), "1d")
        XCTAssertEqual(accountabilityLateDuration(25), "1d 1h")
        XCTAssertEqual(accountabilityOrdinal(1), "1st")
        XCTAssertEqual(accountabilityOrdinal(2), "2nd")
        XCTAssertEqual(accountabilityOrdinal(3), "3rd")
        XCTAssertEqual(accountabilityOrdinal(11), "11th")
        XCTAssertEqual(accountabilityOrdinal(12), "12th")
        XCTAssertEqual(accountabilityOrdinal(13), "13th")
        XCTAssertEqual(accountabilityOrdinal(21), "21st")
    }

    func testUnknownIncidentStateDoesNotShowTheRawToken() {
        let incident = AccountabilityIncident(
            incidentId: "x",
            bookingId: "b",
            title: "Kit",
            dueAt: "not-a-date",
            returnedAt: nil,
            extendedAt: nil,
            extendedTo: nil,
            lateHours: 3,
            state: "MYSTERY",
            location: AccountabilityLocation(id: "l", name: ""),
            itemSummary: ""
        )
        XCTAssertEqual(incident.style.label, "Late return")
        XCTAssertEqual(incident.style.tone, .gray)
        XCTAssertEqual(incident.detailLine.contains("MYSTERY"), false)
        XCTAssertEqual(incident.detailLine.contains("not-a-date"), true)
        XCTAssertEqual(incident.detailLine.contains("3h late"), true)
    }
}
