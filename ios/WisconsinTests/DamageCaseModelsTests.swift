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

    func testQueuePayloadDecodesAndDropsABadRow() throws {
        let json = """
        {"counts":{"open":2,"missing":1,"closed":4},"cases":[
          {"id":"c1","type":"LOST","description":"Gone","imageUrl":null,"reportedAt":"2026-10-20T12:00:00.000Z",
           "item":{"kind":"asset","id":"a1","label":"A-cam","tag":"CAM-014","imageUrl":null,"status":"AVAILABLE"},
           "booking":null,"responsible":{"id":"u1","name":"Priya"},"reportedBy":"Riley","stillBookable":true,
           "resolution":null,"resolvedAt":null,"resolvedBy":null,"resolutionNote":null},
          {"id":"bad"},
          {"id":"c2","type":"DAMAGED","description":null,"imageUrl":null,"reportedAt":"2026-10-19T12:00:00Z",
           "item":{"kind":"unit","id":"u9","label":"Battery","tag":"Unit 9","imageUrl":null,"status":null},
           "booking":null,"responsible":null,"reportedBy":"Sam","stillBookable":false,
           "resolution":"REPAIRED","resolvedAt":"2026-10-20T12:00:00Z","resolvedBy":"Riley","resolutionNote":"Latch"}
        ]}
        """
        let list = try JSONDecoder().decode(DamageCaseList.self, from: Data(json.utf8))
        XCTAssertEqual(list.counts.open, 2)
        XCTAssertEqual(list.cases.map(\.id), ["c1", "c2"])
        XCTAssertTrue(list.cases[0].isMissing)
        XCTAssertTrue(list.cases[0].stillBookable)
        XCTAssertTrue(list.cases[0].item.isAsset)
        XCTAssertFalse(list.cases[1].isOpen)
        XCTAssertEqual(list.cases[1].outcomeLabel, "Repaired by Riley")
        XCTAssertFalse(list.cases[1].item.isAsset)
        XCTAssertTrue(DamageCaseFilter.missing.matches(list.cases[0]))
        XCTAssertFalse(DamageCaseFilter.damaged.matches(list.cases[0]))
    }
}
