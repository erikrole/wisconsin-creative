import XCTest
import UIKit
import os
@testable import Wisconsin

private final class FixtureImageProtocol: URLProtocol, @unchecked Sendable {
    struct State {
        var requests = 0
        var data = Data()
        var status = 200
    }
    static let state = OSAllocatedUnfairLock(initialState: State())
    private let stopped = OSAllocatedUnfairLock(initialState: false)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let responseState = Self.state.withLock { state in
            state.requests += 1
            return state
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(50)) { [self] in
            stopped.withLock { cancelled in
                guard !cancelled else { return }
                let response = HTTPURLResponse(url: request.url!, statusCode: responseState.status,
                    httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "image/png"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: responseState.data)
                client?.urlProtocolDidFinishLoading(self)
            }
        }
    }
    override func stopLoading() { stopped.withLock { $0 = true } }
}

@MainActor
final class ThumbnailLoadingTests: XCTestCase {
    private func makeCache() -> ThumbnailCache {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200))
        let png = renderer.pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 200))
        }
        FixtureImageProtocol.state.withLock { $0 = .init(data: png) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureImageProtocol.self]
        configuration.urlCache = nil
        return ThumbnailCache(session: URLSession(configuration: configuration))
    }

    private func waitForRequest() async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while FixtureImageProtocol.state.withLock({ $0.requests }) == 0 {
            if ContinuousClock.now >= deadline {
                XCTFail("The thumbnail request did not start")
                throw URLError(.timedOut)
            }
            try await Task.sleep(for: .milliseconds(1))
        }
    }

    func testConcurrentRowsShareOneDownloadAndDecodedImage() async throws {
        let cache = makeCache()
        let url = URL(string: "https://thumbnail.invalid/shared-avatar.png")!
        let started = ContinuousClock.now
        let images = await withTaskGroup(of: UIImage?.self) { group in
            for _ in 0..<24 {
                group.addTask { await cache.thumbnail(url: url, size: 44, scale: 3) }
            }
            var results: [UIImage] = []
            for await result in group { if let result { results.append(result) } }
            return results
        }
        let duration = started.duration(to: .now).components
        let elapsed = Double(duration.seconds) * 1_000 + Double(duration.attoseconds) / 1e15
        let requests = FixtureImageProtocol.state.withLock { $0.requests }
        let distinctImages = Set(images.map(ObjectIdentifier.init)).count
        print("PERF_THUMBNAILS {\"rows\":24,\"requests\":\(requests),\"decodedImages\":\(distinctImages),\"elapsedMs\":\(elapsed)}")
        XCTAssertEqual(images.count, 24)
        XCTAssertEqual(requests, 1, "Concurrent rows should share the same cold-cache image request")
        XCTAssertEqual(distinctImages, 1, "Decode and allocate the shared thumbnail only once")
        let first = try XCTUnwrap(images.first)
        let cached = await cache.thumbnail(url: url, size: 44, scale: 3)
        XCTAssertTrue(cached === first)
        XCTAssertEqual(FixtureImageProtocol.state.withLock { $0.requests }, 1)
    }

    func testDisplaySizeAndScaleHaveIndependentCacheEntries() async throws {
        let cache = makeCache()
        let url = URL(string: "https://thumbnail.invalid/sizes.png")!
        let smallResult = await cache.thumbnail(url: url, size: 20, scale: 2)
        let largeResult = await cache.thumbnail(url: url, size: 44, scale: 3)
        let small = try XCTUnwrap(smallResult)
        let large = try XCTUnwrap(largeResult)
        XCTAssertEqual(small.cgImage?.width, 40)
        XCTAssertEqual(large.cgImage?.width, 132)
        XCTAssertEqual(small.scale, 2)
        XCTAssertEqual(large.scale, 3)
        XCTAssertFalse(small === large)
    }

    func testSignOutRejectsAnInFlightImageAndDoesNotRefillTheCache() async throws {
        let cache = makeCache()
        let url = URL(string: "https://thumbnail.invalid/private.png")!
        let pending = Task { await cache.thumbnail(url: url, size: 44, scale: 3) }
        try await waitForRequest()
        cache.clearForSignOut()
        let freshRequest = Task { await cache.thumbnail(url: url, size: 44, scale: 3) }
        let oldImage = await pending.value
        XCTAssertNil(oldImage, "An obsolete account's download must not be published or cached")
        let fresh = await freshRequest.value
        XCTAssertNotNil(fresh)
        let cached = await cache.thumbnail(url: url, size: 44, scale: 3)
        XCTAssertTrue(fresh === cached)
        XCTAssertEqual(FixtureImageProtocol.state.withLock { $0.requests }, 2)
    }

    func testCancellingOneRowKeepsTheOtherRowsDownloadAlive() async throws {
        let cache = makeCache()
        let url = URL(string: "https://thumbnail.invalid/shared.png")!
        let first = Task { await cache.thumbnail(url: url, size: 44, scale: 3) }
        let second = Task { await cache.thumbnail(url: url, size: 44, scale: 3) }
        try await waitForRequest()
        first.cancel()
        let cancelled = await first.value
        let visible = await second.value
        XCTAssertNil(cancelled)
        XCTAssertNotNil(visible)
        XCTAssertEqual(FixtureImageProtocol.state.withLock { $0.requests }, 1)
    }

    func testFailuresCanRetryWithoutAPoisonedInFlightEntry() async {
        let cache = makeCache()
        let url = URL(string: "https://thumbnail.invalid/retry.png")!
        FixtureImageProtocol.state.withLock { $0.status = 500 }
        let failed = await cache.thumbnail(url: url, size: 44, scale: 3)
        XCTAssertNil(failed)
        FixtureImageProtocol.state.withLock { $0.status = 200 }
        let retried = await cache.thumbnail(url: url, size: 44, scale: 3)
        XCTAssertNotNil(retried)
        XCTAssertEqual(FixtureImageProtocol.state.withLock { $0.requests }, 2)
    }

    func testCancellingAllRowsStopsTheLoadWithoutWarmingAnUnusedImage() async throws {
        let cache = makeCache()
        let url = URL(string: "https://thumbnail.invalid/scrolled-away.png")!
        let pending = Task { await cache.thumbnail(url: url, size: 44, scale: 3) }
        try await waitForRequest()
        pending.cancel()
        let cancelled = await pending.value
        XCTAssertNil(cancelled)
        let requestedAgain = await cache.thumbnail(url: url, size: 44, scale: 3)
        XCTAssertNotNil(requestedAgain)
        XCTAssertEqual(FixtureImageProtocol.state.withLock { $0.requests }, 2)
    }
}
