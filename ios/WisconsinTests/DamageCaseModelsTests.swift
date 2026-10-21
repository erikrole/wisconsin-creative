import XCTest
@testable import Wisconsin

final class DamageCaseModelsTests: XCTestCase {
    private func decode(_ json: String) throws -> AssetConditionReport {
        try JSONDecoder().decode(AssetConditionReport.self, from: Data(json.utf8))
    }

    func testClosedReportFromItemPageDecodesOutcomeAndNullBooking() throws {
        let report = try decode("""
        {"id":"r1","type":"DAMAGED","description":"Cracked","imageUrl":null,
         "createdAt":"2026-10-20T12:00:00.000Z","lastReportedAt":null,
         "reportedBy":{"name":"Sam"},"booking":null,
         "resolution":"REPAIRED","resolvedAt":"2026-10-21T12:00:00.000Z",
         "resolutionNote":"New screen","resolvedBy":{"name":"Riley"}}
        """)
        XCTAssertNil(report.bookingId)
        XCTAssertFalse(report.isOpen)
        XCTAssertEqual(report.outcomeLabel, "Repaired by Riley")
        XCTAssertEqual(report.resolutionNote, "New screen")
    }

    func testOlderServerReportStaysOpen() throws {
        let report = try decode("""
        {"id":"r2","type":"LOST","description":null,"createdAt":"2026-10-20T12:00:00Z",
         "reportedBy":{"name":"Sam"},"booking":{"id":"b1","title":"Game"}}
        """)
        XCTAssertEqual(report.bookingId, "b1")
        XCTAssertTrue(report.isOpen)
        XCTAssertNil(report.outcomeLabel)
    }

    func testResolutionChoicesFollowReportType() {
        XCTAssertEqual(DamageResolution.options(forMissing: true), [.found, .replaced, .writtenOff])
        XCTAssertEqual(DamageResolution.options(forMissing: false), [.repaired, .replaced, .writtenOff, .noIssue])
    }
}
