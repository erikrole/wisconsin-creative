import CoreGraphics
import UIKit
import XCTest
@testable import Wisconsin

final class SignatureStrokeRecorderTests: XCTestCase {
    private let settings = SignatureCaptureSettings(strokeColor: "#000000", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900)

    private func sample(_ x: Double, _ y: Double, _ t: TimeInterval = 0) -> SignatureSample {
        SignatureSample(x: x, y: y, time: t)
    }

    func testDropsASampleBatchDeliveredTwice() {
        var recorder = SignatureStrokeRecorder(logicalSize: CGSize(width: 800, height: 400))
        recorder.begin(sample(25.5, 40))
        recorder.append([sample(25.5, 41), sample(25.5, 41.5)])
        recorder.append([sample(25.5, 41), sample(25.5, 41.5)])
        recorder.append([sample(25.5, 43), sample(25.5, 45), sample(25.5, 43), sample(25.5, 45)])
        recorder.end()
        XCTAssertEqual(recorder.payload.first?.points.map(\.y), [40, 41, 41.5, 43, 45])
    }

    func testKeepsARealReturnPath() {
        var recorder = SignatureStrokeRecorder(logicalSize: CGSize(width: 800, height: 400))
        recorder.begin(sample(10, 10))
        recorder.append([sample(10, 20), sample(10, 30), sample(10, 20), sample(10, 10)])
        XCTAssertEqual(recorder.payload.first?.points.map(\.y), [10, 20, 30, 20, 10])
    }

    func testClampsToTheCanvasAndRoundsThePayload() {
        var recorder = SignatureStrokeRecorder(logicalSize: CGSize(width: 100, height: 50))
        recorder.begin(sample(-4, 12.123456))
        recorder.append([sample(140, 80)])
        XCTAssertEqual(recorder.payload.first?.points, [
            SignaturePointPayload(x: 0, y: 12.123),
            SignaturePointPayload(x: 100, y: 50),
        ])
    }

    func testAStrokeThatReachesTheEdgeClipsTheSignatureUntilUndone() {
        var recorder = SignatureStrokeRecorder(logicalSize: CGSize(width: 100, height: 50))
        recorder.begin(sample(10, 10)); recorder.append([sample(90, 40)]); recorder.end()
        XCTAssertFalse(recorder.isClipped)
        recorder.begin(sample(50, 25)); recorder.append([sample(140, 25)]); recorder.end()
        XCTAssertTrue(recorder.isClipped)
        recorder.undo()
        XCTAssertFalse(recorder.isClipped)
        recorder.begin(sample(50, 0.5)); recorder.end()
        XCTAssertTrue(recorder.isClipped)
    }

    func testIgnoresSamplesWithoutAnActiveStrokeAndUndoesWholeStrokes() {
        var recorder = SignatureStrokeRecorder(logicalSize: CGSize(width: 100, height: 100))
        recorder.append([sample(1, 1)])
        XCTAssertTrue(recorder.isEmpty)
        recorder.begin(sample(1, 1)); recorder.end()
        recorder.begin(sample(5, 5)); recorder.append([sample(6, 6)]); recorder.end()
        recorder.append([sample(7, 7)])
        XCTAssertEqual(recorder.strokes.count, 2)
        XCTAssertEqual(recorder.strokes[1].count, 2)
        recorder.undo()
        XCTAssertEqual(recorder.strokes.count, 1)
    }

    func testStopsAtTheServerStrokeLimit() {
        var recorder = SignatureStrokeRecorder(logicalSize: CGSize(width: 100, height: 100))
        for index in 0..<SignatureStrokeRecorder.maxStrokes {
            XCTAssertTrue(recorder.begin(sample(Double(index % 100), 1)))
            recorder.end()
        }
        XCTAssertFalse(recorder.begin(sample(1, 2)))
        XCTAssertEqual(recorder.strokes.count, SignatureStrokeRecorder.maxStrokes)
    }

    func testLogicalSizeKeepsTheWorstCaseCropInsideTheExportBox() {
        let large = SignatureCaptureGeometry.logicalSize(available: CGSize(width: 1366, height: 1024), settings: settings)
        // ink extent + 2x configured width + padding on both sides + outward rounding
        XCTAssertLessThanOrEqual(large.width + 2 * 4 + 2 * 24 + 4, 1600)
        XCTAssertLessThanOrEqual(large.height + 2 * 4 + 2 * 24 + 4, 900)
        XCTAssertEqual(large.width, 1366)
        let small = SignatureCaptureGeometry.logicalSize(available: CGSize(width: 700.6, height: 300.4), settings: settings)
        XCTAssertEqual(small, CGSize(width: 700, height: 300))
    }

    func testPathMatchesTheServerMidpointCurve() {
        let stroke = [sample(0, 0), sample(10, 0), sample(20, 10), sample(30, 10)]
        var elements: [CGPathElementType] = []
        SignatureCaptureGeometry.path(for: stroke).applyWithBlock { elements.append($0.pointee.type) }
        // M, then one Q per interior sample, then the closing Q to the last sample.
        XCTAssertEqual(elements, [.moveToPoint, .addQuadCurveToPoint, .addQuadCurveToPoint, .addQuadCurveToPoint])
        XCTAssertEqual(SignatureCaptureGeometry.path(for: [sample(4, 4)]).boundingBoxOfPath.origin, CGPoint(x: 4, y: 4))
    }

    func testRetainsTheRequestIDOnlyForAmbiguousFailures() {
        let retained: [Error] = [
            APIError.networkError(URLError(.timedOut)),
            APIError.httpError(statusCode: 425, message: "still saving"),
            APIError.httpError(statusCode: 429, message: "slow down"),
            APIError.httpError(statusCode: 503, message: "unavailable"),
            APIError.decodingError(URLError(.cannotParseResponse)),
        ]
        let discarded: [Error] = [
            APIError.httpError(statusCode: 409, message: "changed on another iPad"),
            APIError.httpError(statusCode: 400, message: "too large"),
            APIError.notFound,
            APIError.unauthorized,
            URLError(.unknown),
        ]
        XCTAssertTrue(retained.allSatisfy(SignatureSaveRetry.retainsRequestID(after:)))
        XCTAssertFalse(discarded.contains(where: SignatureSaveRetry.retainsRequestID(after:)))
    }

    func testDecodesTheBareCaptureBootstrap() throws {
        let json = """
        {"collection":{"id":"c1","season":"2026-27","status":"OPEN","collectionVersion":3},
         "member":{"id":"m1","name":"Caia Rose","jerseyNumber":11,"title":"Guard","roleGroup":"PLAYER","active":true,
                   "captureVersion":2,"settingsVersion":1,
                   "captureSettings":{"strokeColor":"#111827","strokeWidth":4,"cropPadding":24,"maxWidth":1600,"maxHeight":900},
                   "artifact":null}}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let bootstrap = try decoder.decode(SignatureCaptureBootstrap.self, from: Data(json.utf8))
        XCTAssertEqual(bootstrap.member.captureVersion, 2)
        XCTAssertEqual(bootstrap.member.captureSettings.maxHeight, 900)
        XCTAssertNil(bootstrap.member.artifact)
    }
}

@MainActor
final class SignatureCaptureViewModelTests: XCTestCase {
    private func bootstrap(version: Int) -> SignatureCaptureBootstrap {
        SignatureCaptureBootstrap(
            collection: .init(id: "c", season: "2026-27", status: "OPEN"),
            member: .init(id: "m", name: "Avery", jerseyNumber: 4, title: nil, roleGroup: "PLAYER", active: true,
                          captureVersion: version, settingsVersion: 1,
                          captureSettings: .init(strokeColor: "#000000", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900),
                          artifact: nil)
        )
    }

    private func inked(_ vm: SignatureCaptureViewModel) async {
        await vm.load()
        vm.prepareCanvas(available: CGSize(width: 900, height: 500))
        vm.begin(SignatureSample(x: 10, y: 10, time: 0))
        vm.append([SignatureSample(x: 40, y: 20, time: 0.01)])
        vm.end(cancelled: false)
    }

    func testReplaysTheSameRequestIDAfterAnAmbiguousFailure() async {
        var sent: [SignatureCaptureRequest] = []
        var failures: [Error] = [APIError.httpError(statusCode: 425, message: "Still saving")]
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in self.bootstrap(version: 3) }) { _, _, body in
            sent.append(body)
            if !failures.isEmpty { throw failures.removeFirst() }
            return SignatureCaptureResult(status: "committed", captureVersion: 4)
        }
        await inked(vm)
        await vm.submit()
        XCTAssertFalse(vm.didSave)
        await vm.submit()
        XCTAssertTrue(vm.didSave)
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(sent[0].requestId, sent[1].requestId)
        XCTAssertEqual(sent[0].expectedCaptureVersion, 3)
        XCTAssertEqual(sent[0].strokes.first?.points.count, 2)
    }

    func testAStaleVersionKeepsTheInkReloadsAndUsesANewRequestID() async {
        var sent: [SignatureCaptureRequest] = []
        var version = 3
        var failures: [Error] = [APIError.httpError(statusCode: 409, message: "Changed on another iPad")]
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in self.bootstrap(version: version) }) { _, _, body in
            sent.append(body)
            if !failures.isEmpty { version = 4; throw failures.removeFirst() }
            return SignatureCaptureResult(status: "committed", captureVersion: 5)
        }
        await inked(vm)
        await vm.submit()
        XCTAssertTrue(vm.hasInk)
        XCTAssertEqual(vm.saveError, "Changed on another iPad")
        await vm.submit()
        XCTAssertTrue(vm.didSave)
        XCTAssertNotEqual(sent[0].requestId, sent[1].requestId)
        XCTAssertEqual(sent[1].expectedCaptureVersion, 4)
    }

    func testNewInkAfterAFailureStartsANewRequest() async {
        var sent: [SignatureCaptureRequest] = []
        var failures: [Error] = [APIError.networkError(URLError(.timedOut))]
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in self.bootstrap(version: 1) }) { _, _, body in
            sent.append(body)
            if !failures.isEmpty { throw failures.removeFirst() }
            return SignatureCaptureResult(status: "committed", captureVersion: 2)
        }
        await inked(vm)
        await vm.submit()
        vm.begin(SignatureSample(x: 60, y: 60, time: 1))
        vm.end(cancelled: false)
        await vm.submit()
        XCTAssertNotEqual(sent[0].requestId, sent[1].requestId)
        XCTAssertEqual(sent[1].strokes.count, 2)
    }
}

@MainActor
final class SignatureRosterViewModelTests: XCTestCase {
    private func member(_ id: String, _ group: String, signed: Bool, number: Int? = nil, active: Bool = true) -> SignatureRosterMember {
        SignatureRosterMember(id: id, name: "Name \(id)", jerseyNumber: number, title: nil, roleGroup: group, required: group == "PLAYER",
                              active: active, artifact: signed ? SignatureArtifactSummary(id: "a\(id)") : nil)
    }

    private func loaded(_ members: [SignatureRosterMember]) async -> SignatureRosterViewModel {
        let vm = SignatureRosterViewModel(collectionId: "c") { _ in
            SignatureCollectionDetail(id: "c", sportCode: "MBB", season: "2026-27", status: "OPEN", members: members)
        }
        await vm.load()
        return vm
    }

    func testFiltersBySearchAndRosterGroup() async {
        let vm = await loaded([
            member("p1", "PLAYER", signed: true, number: 4),
            member("p2", "PLAYER", signed: false, number: 11),
            member("c1", "COACHING_STAFF", signed: false),
            member("gone", "PLAYER", signed: false, active: false),
        ])
        XCTAssertEqual(vm.visibleMembers.map(\.id), ["p1", "p2", "c1"])
        vm.groupFilter = .coachingStaff
        XCTAssertEqual(vm.visibleMembers.map(\.id), ["c1"])
        vm.groupFilter = .all
        vm.searchText = "4"
        XCTAssertEqual(vm.visibleMembers.map(\.id), ["p1"])
        vm.searchText = "name p2"
        XCTAssertEqual(vm.visibleMembers.map(\.id), ["p2"])
        vm.searchText = ""
        XCTAssertEqual(vm.sections.map(\.roleGroup), ["PLAYER", "COACHING_STAFF"])
        XCTAssertEqual(vm.sections.first?.percent, 50)
    }

    func testJerseyPadFindsActiveMembersByNumber() async {
        let vm = await loaded([
            member("p1", "PLAYER", signed: true, number: 4),
            member("p2", "PLAYER", signed: false, number: 11),
            member("gone", "PLAYER", signed: false, number: 11, active: false),
            member("c1", "COACHING_STAFF", signed: false),
        ])
        XCTAssertEqual(vm.members(withJersey: 11).map(\.id), ["p2"])
        XCTAssertEqual(vm.members(withJersey: 4).map(\.id), ["p1"])
        XCTAssertTrue(vm.members(withJersey: 1).isEmpty)
    }
}

@MainActor
final class SignatureCaptureHistoryTests: XCTestCase {
    private func vm() async -> SignatureCaptureViewModel {
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in
            SignatureCaptureBootstrap(
                collection: .init(id: "c", season: "2026-27", status: "OPEN"),
                member: .init(id: "m", name: "Avery", jerseyNumber: nil, title: nil, roleGroup: "PLAYER", active: true,
                              captureVersion: 1, settingsVersion: 1,
                              captureSettings: .init(strokeColor: "#000000", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900),
                              artifact: nil)
            )
        }, save: { _, _, _ in SignatureCaptureResult(status: "committed", captureVersion: 2) })
        await vm.load()
        vm.prepareCanvas(available: CGSize(width: 900, height: 500))
        return vm
    }

    private func stroke(_ vm: SignatureCaptureViewModel, _ x: Double, at t: TimeInterval) {
        vm.begin(SignatureSample(x: x, y: 10, time: t))
        vm.append([SignatureSample(x: x + 10, y: 20, time: t + 0.1)])
        vm.end(cancelled: false)
    }

    func testUndoRedoAndUndoableClear() async {
        let vm = await vm()
        stroke(vm, 10, at: 0); stroke(vm, 40, at: 1)
        vm.undo()
        XCTAssertEqual(vm.recorder?.strokes.count, 1)
        XCTAssertTrue(vm.canRedo)
        vm.redo()
        XCTAssertEqual(vm.recorder?.strokes.count, 2)
        vm.clear()
        XCTAssertFalse(vm.hasInk)
        XCTAssertTrue(vm.canUndo)
        vm.undo()
        XCTAssertEqual(vm.recorder?.strokes.count, 2, "Undo restores a Clear")
        vm.undo()
        stroke(vm, 70, at: 2)
        XCTAssertFalse(vm.canRedo, "A new stroke drops the redo branch")
    }

    func testReplayUsesPencilTimingWithCappedLifts() {
        let strokes = [
            [SignatureSample(x: 0, y: 0, time: 10), SignatureSample(x: 1, y: 0, time: 10.2)],
            [SignatureSample(x: 5, y: 0, time: 13), SignatureSample(x: 6, y: 0, time: 13.1)],
        ]
        let timeline = SignatureReplay.timeline(strokes)
        XCTAssertEqual(timeline[0][0], 0)
        XCTAssertEqual(timeline[0][1], 0.2, accuracy: 0.0001)
        XCTAssertEqual(timeline[1][0], 0.2 + SignatureReplay.maxLift, accuracy: 0.0001)
        XCTAssertEqual(SignatureReplay.duration(timeline), 0.8, accuracy: 0.0001)
        XCTAssertEqual(SignatureReplay.strokes(strokes, timeline: timeline, at: 0.1).map(\.count), [1])
        XCTAssertEqual(SignatureReplay.strokes(strokes, timeline: timeline, at: 0.75).map(\.count), [2, 1])
    }
}

@MainActor
final class SignatureCaptureReviewFixTests: XCTestCase {
    private func bootstrap(version: Int, signed: Bool) -> SignatureCaptureBootstrap {
        SignatureCaptureBootstrap(
            collection: .init(id: "c", season: "2026-27", status: "OPEN"),
            member: .init(id: "m", name: "Avery", jerseyNumber: nil, title: nil, roleGroup: "PLAYER", active: true,
                          captureVersion: version, settingsVersion: 1,
                          captureSettings: .init(strokeColor: "#000000", strokeWidth: 4, cropPadding: 24, maxWidth: 1600, maxHeight: 900),
                          artifact: signed ? SignatureArtifactSummary(id: "other-ipad") : nil)
        )
    }

    private func ink(_ vm: SignatureCaptureViewModel) async {
        await vm.load()
        vm.prepareCanvas(available: CGSize(width: 900, height: 500))
        vm.begin(SignatureSample(x: 10, y: 10, time: 0))
        vm.append([SignatureSample(x: 40, y: 20, time: 0.01)])
        vm.end(cancelled: false)
    }

    func testAStaleIPadMustConfirmBeforeReplacingAnotherIPadsSave() async {
        var otherIPadSaved = false
        var saves = 0
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in
            self.bootstrap(version: otherIPadSaved ? 2 : 1, signed: otherIPadSaved)
        }) { _, _, _ in
            saves += 1
            if saves == 1 { otherIPadSaved = true; throw APIError.httpError(statusCode: 409, message: "Already signed on another iPad") }
            return SignatureCaptureResult(status: "committed", captureVersion: 3)
        }
        await ink(vm)
        await vm.submit()
        XCTAssertTrue(vm.needsReplaceConfirmation)
        await vm.submit()
        XCTAssertEqual(saves, 1, "Save alone must not replace the other iPad's signature")
        await vm.submit(replacingConfirmed: true)
        XCTAssertTrue(vm.didSave)
        XCTAssertEqual(saves, 2)
    }

    func testADecodeFailureAfterACommittedSaveCountsAsSaved() async {
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in self.bootstrap(version: 1, signed: false) }) { _, _, _ in
            throw APIError.decodingError(URLError(.cannotParseResponse))
        }
        await ink(vm)
        await vm.submit()
        XCTAssertTrue(vm.didSave)
    }

    func testTellsTheSignerWhenAStrokeHitsTheSampleLimit() async {
        let vm = SignatureCaptureViewModel(collectionId: "c", memberId: "m", loadBootstrap: { _, _ in self.bootstrap(version: 1, signed: false) }) { _, _, _ in
            SignatureCaptureResult(status: "committed", captureVersion: 2)
        }
        await vm.load()
        vm.prepareCanvas(available: CGSize(width: 900, height: 500))
        vm.begin(SignatureSample(x: 0, y: 0, time: 0))
        let samples = (1...SignatureStrokeRecorder.maxSamplesPerStroke).map { SignatureSample(x: Double($0 % 800), y: Double($0 / 800), time: 0) }
        vm.append(samples)
        XCTAssertNotNil(vm.notice)
        XCTAssertEqual(vm.recorder?.strokes.last?.count, SignatureStrokeRecorder.maxSamplesPerStroke)
    }
}

@MainActor
final class SignaturePreviewStoreTests: XCTestCase {
    private var savedLoader: SignaturePreviewStore.Loader!
    private var savedDirectory: URL!

    override func setUp() async throws {
        savedLoader = SignaturePreviewStore.loader
        savedDirectory = SignaturePreviewStore.directory
        SignaturePreviewStore.directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("SignaturePreviewStoreTests-\(UUID().uuidString)", isDirectory: true)
        SignaturePreviewStore.clearMemory()
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: SignaturePreviewStore.directory)
        SignaturePreviewStore.loader = savedLoader
        SignaturePreviewStore.directory = savedDirectory
        SignaturePreviewStore.clearMemory()
    }

    private let png = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 2)).pngData { context in
        UIColor.black.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 4, height: 2))
    }

    func testSharesOneDownloadAndServesLaterLoadsFromDisk() async {
        var calls = 0
        let png = png
        SignaturePreviewStore.loader = { _ in
            calls += 1
            try await Task.sleep(for: .milliseconds(20))
            return png
        }
        async let first = SignaturePreviewStore.image(for: "rev-1")
        async let second = SignaturePreviewStore.image(for: "rev-1")
        let images = await [first, second]
        XCTAssertTrue(images.allSatisfy { $0 != nil })
        XCTAssertEqual(calls, 1)

        // A cold launch: memory is gone, the disk copy is used.
        SignaturePreviewStore.clearMemory()
        SignaturePreviewStore.loader = { _ in XCTFail("should read from disk"); return Data() }
        let fromDisk = await SignaturePreviewStore.image(for: "rev-1")
        XCTAssertNotNil(fromDisk)
    }

    func testPrefetchWarmsEveryRevisionAndSkipsCachedOnes() async {
        var requested: [String] = []
        let png = png
        SignaturePreviewStore.loader = { id in requested.append(id); return png }
        await SignaturePreviewStore.prefetch(["a", "b", "c", "d", "e", "f"])
        XCTAssertEqual(Set(requested), ["a", "b", "c", "d", "e", "f"])
        await SignaturePreviewStore.prefetch(["a", "b"])
        XCTAssertEqual(requested.count, 6)
        XCTAssertNotNil(SignaturePreviewStore.cached("f"))
    }
}
