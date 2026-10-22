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
        XCTAssertEqual(report.person("user_ada")?.areaLabel, "Live Production")
        XCTAssertEqual(report.person("user_grace")?.onTimeLabel, "Not enough checkouts")
        XCTAssertEqual(report.matching("lovelace").map(\.userId), ["user_ada"])

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

    func testAllTimeReportToleratesAMissingYear() throws {
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
        XCTAssertEqual(report.methodology.graceSentence, "A return is late after 1 hour past due.")
        XCTAssertNil(report.person("missing"))
        XCTAssertTrue(report.overdueNow().isEmpty)
        XCTAssertEqual(report.repeatPeople.count, 0)
    }

    func testQuerySendsSortAndOnlyAllTimeYear() {
        let current = AccountabilityQuery.items(scope: .thisYear, sort: .events)
        XCTAssertEqual(current.map(\.name), ["sort"])
        XCTAssertEqual(current.first?.value, "events")

        let allTime = AccountabilityQuery.items(scope: .allTime, sort: .recent)
        XCTAssertEqual(allTime.map(\.name), ["sort", "year"])
        XCTAssertEqual(allTime.map(\.value), ["recent", "all"])
    }

    func testDurationStaysInProductLanguage() {
        XCTAssertEqual(accountabilityLateDuration(0), "0h")
        XCTAssertEqual(accountabilityLateDuration(23), "23h")
        XCTAssertEqual(accountabilityLateDuration(24), "1d")
        XCTAssertEqual(accountabilityLateDuration(25), "1d 1h")
    }

    func testOverdueNowIsLongestFirstActiveOnlyAndCappedAtFive() throws {
        func incident(_ id: String, hours: Int, state: String) -> String {
            """
            {"incidentId":"\(id)","bookingId":"b_\(id)","title":"Kit \(id)","dueAt":"2026-10-14T18:00:00.000Z",
             "returnedAt":null,"extendedAt":null,"extendedTo":null,"lateHours":\(hours),"state":"\(state)",
             "location":{"id":"l","name":"Studio"},"itemSummary":""}
            """
        }
        func person(_ id: String, late: Int, incidents: [String]) -> String {
            """
            {"userId":"\(id)","name":"\(id)","avatarUrl":null,"active":true,"primaryArea":null,"checkoutCount":4,
             "completedCount":3,"lateEventCount":\(late),"activeOverdueCount":1,"totalLateHours":10,"medianLateHours":5,
             "worstLateHours":9,"onTimeRate":75,"lastIncidentAt":"2026-10-15T18:00:00.000Z",
             "incidents":[\(incidents.joined(separator: ","))]}
            """
        }
        let people = [
            person("a", late: 1, incidents: [incident("a1", hours: 5, state: "active")]),
            person("b", late: 2, incidents: [incident("b1", hours: 52, state: "active"), incident("b2", hours: 90, state: "resolved")]),
            person("c", late: 1, incidents: [incident("c1", hours: 30, state: "active")]),
            person("d", late: 1, incidents: [incident("d1", hours: 7, state: "active"), incident("d2", hours: 8, state: "extended")]),
            person("e", late: 1, incidents: [incident("e1", hours: 9, state: "active")]),
            person("f", late: 1, incidents: [incident("f1", hours: 11, state: "active")]),
        ]
        let json = """
        {"generatedAt":"2026-10-16T15:00:00.000Z","truncated":false,
         "methodology":{"gracePeriodHours":2,"minimumCheckoutsForRate":3,"sort":"events","ranking":"x"},
         "metrics":{"peopleNeedingAttention":6,"lateEvents":7,"activeOverdue":6,"totalLateHours":0},
         "leaderboard":[\(people.joined(separator: ","))]}
        """
        let report = try JSONDecoder().decode(AccountabilityReport.self, from: Data(json.utf8))

        let overdue = report.overdueNow()
        XCTAssertEqual(overdue.map(\.incident.incidentId), ["b1", "c1", "f1", "e1", "d1"])
        XCTAssertEqual(overdue.first?.overdueLabel, "2d 4h overdue")
        XCTAssertEqual(overdue.first?.incident.bookingId, "b_b1")
        XCTAssertEqual(report.overdueNow(limit: 2).count, 2)
    }

    func testRepeatListHidesLateOnceUnlessNobodyIsRepeat() throws {
        func report(lateCounts: [Int]) throws -> AccountabilityReport {
            let rows = lateCounts.enumerated().map { index, late in
                """
                {"userId":"u\(index)","name":"Person \(index)","avatarUrl":null,"active":true,"primaryArea":null,
                 "checkoutCount":5,"completedCount":5,"lateEventCount":\(late),"activeOverdueCount":0,"totalLateHours":\(late),
                 "medianLateHours":1,"worstLateHours":1,"onTimeRate":\(index == 0 ? "80" : "null"),
                 "lastIncidentAt":"2026-10-15T18:00:00.000Z","incidents":[]}
                """
            }
            let json = """
            {"generatedAt":"2026-10-16T15:00:00.000Z","truncated":false,
             "methodology":{"gracePeriodHours":2,"minimumCheckoutsForRate":3,"sort":"events","ranking":"x"},
             "metrics":{"peopleNeedingAttention":\(lateCounts.count),"lateEvents":0,"activeOverdue":0,"totalLateHours":0},
             "leaderboard":[\(rows.joined(separator: ","))]}
            """
            return try JSONDecoder().decode(AccountabilityReport.self, from: Data(json.utf8))
        }

        let mixed = try report(lateCounts: [3, 2, 1, 1])
        XCTAssertEqual(mixed.repeatPeople.map(\.userId), ["u0", "u1"])
        XCTAssertEqual(mixed.lateOnceCount, 2)

        let allOnce = try report(lateCounts: [1, 1])
        XCTAssertEqual(allOnce.repeatPeople.count, 2)
        XCTAssertEqual(allOnce.lateOnceCount, 0)
    }

    func testRecordSummaryHasNoRankAndOmitsMissingOnTimeRate() throws {
        let json = """
        {"userId":"u","name":"U","avatarUrl":null,"active":true,"primaryArea":null,"checkoutCount":5,
         "completedCount":5,"lateEventCount":2,"activeOverdueCount":0,"totalLateHours":6,"medianLateHours":3,
         "worstLateHours":4,"onTimeRate":60,"lastIncidentAt":"2026-10-15T18:00:00.000Z","incidents":[]}
        """
        let person = try JSONDecoder().decode(AccountabilityPerson.self, from: Data(json.utf8))
        XCTAssertEqual(person.recordSummary, "2 late returns · 60% on time")
        XCTAssertEqual(person.lateShortLabel, "2 late")

        let quiet = try JSONDecoder().decode(
            AccountabilityPerson.self,
            from: Data(json.replacingOccurrences(of: "\"onTimeRate\":60", with: "\"onTimeRate\":null")
                .replacingOccurrences(of: "\"lateEventCount\":2", with: "\"lateEventCount\":1").utf8)
        )
        XCTAssertEqual(quiet.recordSummary, "1 late return")
        XCTAssertNil(quiet.onTimePercentLabel)
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
