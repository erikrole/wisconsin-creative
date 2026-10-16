import XCTest
@testable import Wisconsin

/// Trimmed `/api/reports/*` payloads. A decode failure here is the bug that
/// would compile and then show an empty report.
final class ReportLibraryModelTests: XCTestCase {
    func testCheckoutDetailDecodesRowsAndIgnoresTheHeatmap() throws {
        let json = """
        {
          "days": 30,
          "partialFailures": [],
          "totalCheckouts": 2,
          "previousTotalCheckouts": 1,
          "overdueCheckouts": 1,
          "focusDate": null,
          "heatmap": [{ "date": "2026-07-01", "value": 4 }],
          "dailyTrend": [{ "date": "2026-07-11", "count": 2 }],
          "topRequesters": [{ "name": "Ada", "count": 2 }],
          "recentCheckouts": [{
            "id": "b1",
            "title": "Friday kit",
            "status": "OPEN",
            "startsAt": "2026-07-11T15:00:00.000Z",
            "endsAt": "2026-07-12T15:00:00.000Z",
            "createdAt": "2026-07-11T14:00:00.000Z",
            "requester": "Ada",
            "location": "Studio",
            "itemCount": 3,
            "isOverdue": true
          }]
        }
        """
        let report = try JSONDecoder().decode(CheckoutDetailReport.self, from: Data(json.utf8))

        XCTAssertEqual(report.totalCheckouts, 2)
        XCTAssertEqual(report.ranks.first?.name, "Ada")
        XCTAssertEqual(report.rows.first?.itemCount, 3)
        XCTAssertEqual(report.rows.first?.isOverdue, true)
        XCTAssertEqual(report.rows.first?.endsAt, "2026-07-12T15:00:00.000Z")
        XCTAssertFalse(report.isIncomplete)
    }

    func testUtilizationDetailToleratesALegacyBreakdown() throws {
        let json = """
        {
          "totalAssets": 10,
          "statusCounts": { "AVAILABLE": 8, "CHECKED_OUT": 2 },
          "byLocation": [{ "location": "Studio", "count": 10 }],
          "custody": {
            "utilizationRate": 0.25,
            "custodyDays": 4,
            "assetsUsed": 2,
            "checkoutCount": 3,
            "idleCount": 1,
            "neverCheckedOutCount": 0,
            "topUsed": [{
              "assetId": "a1",
              "assetTag": "CAM-1",
              "checkouts": 2,
              "custodyDays": 3.5,
              "name": "Body",
              "utilizationRate": 0.1
            }],
            "idleAssets": [{
              "assetId": "a2",
              "assetTag": "LENS-2",
              "name": "Old lens",
              "category": "Lenses",
              "lastCheckedOutAt": null,
              "purchasePrice": 12.5
            }]
          }
        }
        """
        let report = try JSONDecoder().decode(UtilizationDetailReport.self, from: Data(json.utf8))

        XCTAssertEqual(report.byLocation?.first?.locationId, nil)
        XCTAssertEqual(report.byLocation?.first?.count, 10)
        XCTAssertNil(report.byCategory)
        XCTAssertEqual(report.custody?.idle.first?.name, "Old lens")
        XCTAssertNil(report.custody?.idle.first?.lastCheckedOutAt)
        XCTAssertEqual(report.custody?.ranked.first?.assetTag, "CAM-1")
    }

    func testUsageReportDecodesCountsWithoutNames() throws {
        let json = """
        {
          "days": 30,
          "totalEvents": 12,
          "activeUsers": 3,
          "platforms": [{ "name": "ios", "count": 9 }, { "name": "web", "count": 3 }],
          "surfaces": [{ "name": "bookings", "count": 5 }],
          "events": [],
          "versions": [{ "platform": "ios", "version": "1.3", "count": 9 }],
          "notifications": {
            "deliveries": [{ "name": "push · sent", "count": 4 }],
            "pushReadiness": [],
            "preferenceChanges": [],
            "responses": [],
            "timeToAct": []
          },
          "health": { "jobs": [], "diagnostics": [] }
        }
        """
        let report = try JSONDecoder().decode(UsageReport.self, from: Data(json.utf8))

        XCTAssertEqual(report.activeUsers, 3)
        XCTAssertEqual(report.platforms?.first?.name, "ios")
        XCTAssertEqual(report.notifications?.deliveries?.first?.count, 4)
        XCTAssertEqual(ReportFormatting.phrase("push · sent"), "Push · Sent")
        XCTAssertEqual(ReportFormatting.phrase("ios"), "iOS")
    }

    func testScanReportAppendsTheNextPageWithoutDuplicatingRows() throws {
        let first = try JSONDecoder().decode(ScanHistoryReport.self, from: Data("""
        {
          "data": [{
            "id": "s1", "actor": "Ada", "success": true, "phase": "CHECKOUT",
            "item": "CAM-1", "bookingId": "b1", "bookingTitle": "Friday",
            "createdAt": "2026-07-11T14:00:00.000Z", "scanValue": "secret"
          }],
          "total": 2, "previousTotal": 1, "previousSuccessRate": 50,
          "successCount": 1, "successRate": 100,
          "dailyScans": [{ "date": "2026-07-11", "success": 1, "fail": 0 }],
          "limit": 1, "offset": 0
        }
        """.utf8))
        let page = try JSONDecoder().decode(ScanHistoryReport.self, from: Data("""
        {
          "data": [
            {
              "id": "s1", "actor": "Ada", "success": true, "phase": "CHECKOUT",
              "item": "CAM-1", "bookingId": "b1", "bookingTitle": "Friday",
              "createdAt": "2026-07-11T14:00:00.000Z"
            },
            {
              "id": "s2", "actor": "Bea", "success": false, "phase": "CHECKIN",
              "item": "LENS-2", "bookingId": "b2", "bookingTitle": "Saturday",
              "createdAt": "2026-07-11T15:00:00.000Z"
            }
          ],
          "total": 2, "previousTotal": null, "previousSuccessRate": null,
          "successCount": 1, "successRate": 50,
          "dailyScans": [{ "date": "2026-07-11", "success": 1, "fail": 1 }],
          "limit": 1, "offset": 1
        }
        """.utf8))

        let merged = first.appending(page)
        XCTAssertEqual(merged.rows.map(\.id), ["s1", "s2"])
        XCTAssertEqual(merged.successRate, 50)
        XCTAssertEqual(merged.points.first?.fail, 1)
        XCTAssertEqual(ReportFormatting.scanPhase("CHECKIN"), "Check-in")
    }

    func testMissingUnitsAndBadgesDecodeTheSectionsThePhoneShows() throws {
        let missing = try JSONDecoder().decode(MissingUnitsReport.self, from: Data("""
        {
          "totalLost": 2,
          "categoryId": null,
          "locationId": null,
          "filterOptions": {
            "categories": [{ "id": "c1", "name": "Batteries" }],
            "locations": [{ "id": "l1", "name": "Studio" }]
          },
          "bySku": [{ "skuName": "Sony Battery", "bulkSkuId": "sku1", "count": 2 }],
          "byUser": [{ "name": "Ada", "count": 2 }],
          "recentLosses": [{
            "id": "e1",
            "bookingId": "b1",
            "lostUnits": { "ignored": true },
            "createdAt": "2026-07-11T14:00:00.000Z",
            "actor": { "id": "u1", "name": "Ada", "avatarUrl": null }
          }],
          "batteryAudit": {
            "totals": {
              "skuCount": 1, "totalUnits": 4, "available": 1, "checkedOut": 1,
              "lost": 2, "retired": 0, "lossRate": 0.5, "repeatPatternCount": 1
            },
            "bySku": [{
              "bulkSkuId": "sku1", "skuName": "Sony Battery", "category": "Batteries",
              "location": "Studio", "total": 4, "available": 1, "checkedOut": 1,
              "lost": 2, "retired": 0, "lossRate": 0.5,
              "missingUnitNumbers": [7, 8], "lastMissingAt": null
            }],
            "missingUnits": [{
              "id": "unit7", "bulkSkuId": "sku1", "skuName": "Sony Battery",
              "unitNumber": 7, "notes": null, "markedMissingAt": "2026-07-11T14:00:00.000Z",
              "lastCheckoutAt": null, "lastRequesterId": "u1", "lastRequesterName": "Ada",
              "lastBookingId": "b1", "lastBookingRef": "CO-1", "lastBookingTitle": "Friday"
            }],
            "checkoutHistory": [],
            "repeatPatterns": [{ "type": "sku", "label": "Sony Battery", "count": 2, "detail": "2 missing units" }]
          }
        }
        """.utf8))
        XCTAssertEqual(missing.families.first?.count, 2)
        XCTAssertEqual(missing.events.first?.actor?.name, "Ada")
        XCTAssertEqual(missing.batteryAudit?.units.first?.unitNumber, 7)
        XCTAssertEqual(missing.batteryAudit?.totals?.lossRate, 0.5)

        let badges = try JSONDecoder().decode(BadgeReport.self, from: Data("""
        {
          "totalAwards": 4,
          "manualAwards": 1,
          "automaticAwards": 3,
          "manualAwardRate": 0.25,
          "days": 30,
          "recentAwardCount": 2,
          "previousRecentAwardCount": 1,
          "activeDefinitionCount": 6,
          "leaderboard": [{ "userId": "u1", "name": "Ada", "email": "ada@example.com", "count": 3 }],
          "distribution": [{
            "definitionId": "d1", "key": "on_time", "name": "On time",
            "category": "ON_TIME", "active": true, "count": 3
          }],
          "recentAwards": [{
            "id": "a1",
            "awardedAt": "2026-07-11T14:00:00.000Z",
            "source": "MANUAL",
            "note": "Nice catch",
            "user": { "id": "u1", "name": "Ada", "email": "ada@example.com" },
            "definition": {
              "id": "d1", "key": "on_time", "name": "On time",
              "category": "ON_TIME", "icon": "star", "active": true
            },
            "awardedBy": { "id": "u2", "name": "Bea" }
          }],
          "underusedDefinitions": [{
            "definitionId": "d2", "key": "rare", "name": "Rare",
            "category": "MILESTONE", "count": 0
          }]
        }
        """.utf8))
        XCTAssertEqual(badges.leaders.first?.name, "Ada")
        XCTAssertEqual(badges.awards.first?.definition.name, "On time")
        XCTAssertEqual(badges.awards.first?.awardedBy?.name, "Bea")
        XCTAssertEqual(ReportFormatting.phrase("ON_TIME"), "On Time")
        XCTAssertEqual(ReportFormatting.bookingStatus(status: "OPEN", isOverdue: true).label, "Overdue")
    }
}
