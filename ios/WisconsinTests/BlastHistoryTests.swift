import XCTest
@testable import Wisconsin

final class BlastHistoryTests: XCTestCase {
    func testDismissedBlastStaysWhenTheServerOmitsIt() {
        let urgent = sample(id: "urgent", severity: .urgent, sentAt: date(1))
        let info = sample(id: "info", severity: .info, sentAt: date(2))
        let stored = [
            RememberedBlast(blast: urgent, acknowledged: true),
            RememberedBlast(blast: info, acknowledged: false),
        ]

        let merged = BlastHistory.merge(stored: stored, active: [info])

        XCTAssertEqual(merged.map(\.id), ["info", "urgent"])
        XCTAssertFalse(merged[0].acknowledged)
        XCTAssertTrue(merged[1].acknowledged)
        XCTAssertEqual(merged[1].blast.title, "Call time moved")
    }

    func testActiveBlastClearsAStaleAcknowledgedFlag() {
        let blast = sample(id: "still-open", severity: .warning, sentAt: date(1))
        let stored = [RememberedBlast(blast: blast, acknowledged: true)]

        let merged = BlastHistory.merge(stored: stored, active: [blast])

        XCTAssertEqual(merged.count, 1)
        XCTAssertFalse(merged[0].acknowledged)
    }

    func testMarkAcknowledgedKeepsTheMessageAndSortsItAfterOpenBlasts() {
        let open = sample(id: "open", severity: .info, sentAt: date(1))
        let closing = sample(id: "closing", severity: .urgent, sentAt: date(2))
        let entries = [
            RememberedBlast(blast: open, acknowledged: false),
            RememberedBlast(blast: closing, acknowledged: false),
        ]

        let updated = BlastHistory.markAcknowledged("closing", in: entries)

        XCTAssertEqual(updated.map(\.id), ["open", "closing"])
        XCTAssertTrue(updated[1].acknowledged)
        XCTAssertEqual(updated[1].blast.body, "Gate B moved.")
    }

    func testRoundTripKeepsADismissedBlastForTheSamePerson() throws {
        let entry = RememberedBlast(
            blast: sample(id: "saved", severity: .warning, sentAt: date(3)),
            acknowledged: true
        )

        let data = try BlastHistory.encode([entry], userId: "person-1")

        let restored = try XCTUnwrap(BlastHistory.decode(data, userId: "person-1"))
        XCTAssertEqual(restored, [entry])
        XCTAssertNil(BlastHistory.decode(data, userId: "person-2"))
    }

    func testLimitDropsTheOldestDismissedBlastFirst() {
        let entries = (0..<BlastHistory.limit).map { index in
            RememberedBlast(
                blast: sample(id: "old-\(index)", severity: .info, sentAt: date(index)),
                acknowledged: true
            )
        } + [RememberedBlast(blast: sample(id: "fresh", severity: .urgent, sentAt: date(100)), acknowledged: false)]

        let ordered = BlastHistory.displayOrder(entries)

        XCTAssertEqual(ordered.count, BlastHistory.limit)
        XCTAssertEqual(ordered.first?.id, "fresh")
        XCTAssertFalse(ordered.contains { $0.id == "old-0" })
    }

    private func sample(id: String, severity: BlastSeverity, sentAt: Date) -> ActiveBlast {
        ActiveBlast(
            id: id,
            title: "Call time moved",
            body: "Gate B moved.",
            severity: severity,
            sentAt: sentAt,
            senderName: "Crew desk",
            requiresAck: true,
            readAt: nil
        )
    }

    private func date(_ minutes: Int) -> Date {
        Date(timeIntervalSince1970: TimeInterval(minutes) * 60)
    }
}
