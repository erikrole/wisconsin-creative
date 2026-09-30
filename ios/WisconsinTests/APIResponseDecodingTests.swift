import XCTest
@testable import Wisconsin

@MainActor
final class APIResponseDecodingTests: XCTestCase {
    private struct DecodeProbe: Decodable, Sendable {
        let decodedOnMainThread: Bool
        let startsAt: Date
        let itemCount: Int

        enum CodingKeys: String, CodingKey { case startsAt, itemCount }

        init(from decoder: Decoder) throws {
            decodedOnMainThread = Thread.isMainThread
            let values = try decoder.container(keyedBy: CodingKeys.self)
            startsAt = try values.decode(Date.self, forKey: .startsAt)
            itemCount = try values.decode(Int.self, forKey: .itemCount)
        }
    }

    func testDecodingLeavesMainThreadAndPreservesAPIKeysAndDates() async throws {
        let data = Data(#"{"starts_at":"2026-09-27T15:00:00Z","item_count":300}"#.utf8)
        let decoded = try await APIResponseDecoder.decode(DecodeProbe.self, from: data)
        XCTAssertFalse(decoded.decodedOnMainThread, "Large response decoding must leave the UI thread")
        XCTAssertEqual(decoded.itemCount, 300)
        XCTAssertEqual(decoded.startsAt.timeIntervalSince1970, 1_790_521_200)
    }

    func testMalformedResponsesRemainDecodingErrors() async {
        do {
            _ = try await APIResponseDecoder.decode(DecodeProbe.self, from: Data(#"{"item_count":"bad"}"#.utf8))
            XCTFail("Malformed required API fields must not become a successful empty response")
        } catch {
            XCTAssertTrue(error is DecodingError)
        }
    }

    func testConcurrentResponsesKeepIndependentDecoderState() async throws {
        let dates = ["2026-09-27T15:00:00Z", "2026-09-28T16:00:00Z"]
        let values = try await withThrowingTaskGroup(of: DecodeProbe.self) { group in
            for index in 0..<20 {
                let data = Data("{\"starts_at\":\"\(dates[index % 2])\",\"item_count\":\(index)}".utf8)
                group.addTask { try await APIResponseDecoder.decode(DecodeProbe.self, from: data) }
            }
            var decoded: [DecodeProbe] = []
            for try await value in group { decoded.append(value) }
            return decoded.sorted { $0.itemCount < $1.itemCount }
        }
        XCTAssertEqual(values.map(\.itemCount), Array(0..<20))
        XCTAssertTrue(values.allSatisfy { !$0.decodedOnMainThread })
        for (index, value) in values.enumerated() {
            XCTAssertEqual(value.startsAt.timeIntervalSince1970, index % 2 == 0 ? 1_790_521_200 : 1_790_611_200)
        }
    }

    /// Matched CPU-work comparison with the exact former decoder settings.
    /// Total duration includes the worker hop; only the baseline duration is
    /// spent synchronously blocking the main actor. No flaky speed threshold.
    func testAssetResponseBenchmark() async throws {
        let baseline = JSONDecoder()
        baseline.keyDecodingStrategy = .convertFromSnakeCase
        baseline.dateDecodingStrategy = .iso8601
        for count in [30, 300, 3_000] {
            let rows = (0..<count).map { index in
                """
                {"id":"asset-\(index)","assetTag":"PERF-\(index)","name":null,
                 "brand":"Sony","model":"FX3","computedStatus":"CHECKED_OUT",
                 "location":{"id":"cr","name":"Camp Randall"},
                 "category":{"id":"cameras","name":"Cameras"},
                 "activeBooking":{"id":"booking-\(index)","kind":"CHECKOUT","title":"Football",
                   "requesterName":"Fixture User","startsAt":"2026-09-27T14:00:00Z","endsAt":"2026-09-28T14:00:00Z"},
                 "isFavorited":false}
                """
            }
            let data = Data("[\(rows.joined(separator: ","))]".utf8)
            _ = try baseline.decode([Asset].self, from: data)
            _ = try await APIResponseDecoder.decode([Asset].self, from: data)
            var before: [Double] = []
            var after: [Double] = []
            for iteration in 0..<7 {
                for isBaseline in (iteration.isMultiple(of: 2) ? [true, false] : [false, true]) {
                    let start = ContinuousClock.now
                    let assets: [Asset]
                    if isBaseline {
                        assets = try baseline.decode([Asset].self, from: data)
                    } else {
                        assets = try await APIResponseDecoder.decode([Asset].self, from: data)
                    }
                    let duration = start.duration(to: .now).components
                    let milliseconds = Double(duration.seconds) * 1_000 + Double(duration.attoseconds) / 1e15
                    if isBaseline { before.append(milliseconds) } else { after.append(milliseconds) }
                    XCTAssertEqual(assets.count, count)
                    XCTAssertEqual(assets.last?.id, "asset-\(count - 1)")
                    XCTAssertEqual(assets.first?.activeBooking?.requesterName, "Fixture User")
                    XCTAssertEqual(assets.first?.activeBooking?.endsAt.timeIntervalSince1970, 1_790_604_000)
                }
            }
            let report: [String: Any] = [
                "rows": count, "bytes": data.count,
                "mainActorBeforeMs": before, "concurrentTotalAfterMs": after,
                "note": "Synthetic API assets; current production decoder vs former cached synchronous decoder; total decode CPU is not eliminated"
            ]
            let json = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
            print("PERF_API_DECODE \(String(decoding: json, as: UTF8.self))")
        }
    }
}
