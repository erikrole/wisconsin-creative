import XCTest
@testable import GearOps

final class HealthTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    func testOnlineBoundaryIncludesFiveMinutes() {
        XCTAssertEqual(device(lastSeenAt: now.addingTimeInterval(-5 * 60)).connectionState(at: now), .online)
    }

    func testHeartbeatBecomesStaleAfterFiveMinutes() {
        XCTAssertEqual(device(lastSeenAt: now.addingTimeInterval(-(5 * 60 + 1))).connectionState(at: now), .stale)
    }

    func testStaleBoundaryIncludesTwentyFourHours() {
        XCTAssertEqual(device(lastSeenAt: now.addingTimeInterval(-24 * 60 * 60)).connectionState(at: now), .stale)
    }

    func testHeartbeatBecomesOfflineAfterTwentyFourHours() {
        XCTAssertEqual(device(lastSeenAt: now.addingTimeInterval(-(24 * 60 * 60 + 1))).connectionState(at: now), .offline)
    }

    func testUnactivatedAndDeactivatedDevicesAreInactive() {
        XCTAssertEqual(device(active: false, lastSeenAt: now).connectionState(at: now), .inactive)
        XCTAssertEqual(device(activated: false, lastSeenAt: now).connectionState(at: now), .inactive)
    }

    func testFleetCountsUseCanonicalHeartbeatStates() {
        let counts = KioskFleetCounts(devices: [
            device(id: "online", lastSeenAt: now.addingTimeInterval(-60)),
            device(id: "stale-1", lastSeenAt: now.addingTimeInterval(-10 * 60)),
            device(id: "stale-2", lastSeenAt: now.addingTimeInterval(-60 * 60)),
            device(id: "offline", lastSeenAt: now.addingTimeInterval(-25 * 60 * 60)),
            device(id: "inactive", active: false, lastSeenAt: now),
        ], at: now)

        XCTAssertEqual(counts.online, 1)
        XCTAssertEqual(counts.stale, 2)
        XCTAssertEqual(counts.offline, 1)
        XCTAssertEqual(counts.inactive, 1)
        XCTAssertEqual(counts.summary, "1 online · 2 idle · 1 offline · 1 inactive")
    }

    func testIdleHeartbeatIsNotAFault() {
        XCTAssertFalse(device(lastSeenAt: now.addingTimeInterval(-60 * 60)).connectionState(at: now).isFault)
        XCTAssertFalse(device(lastSeenAt: now.addingTimeInterval(-60)).connectionState(at: now).isFault)
        XCTAssertFalse(device(active: false, lastSeenAt: now).connectionState(at: now).isFault)
        XCTAssertTrue(device(lastSeenAt: now.addingTimeInterval(-25 * 60 * 60)).connectionState(at: now).isFault)
        XCTAssertEqual(KioskConnectionState.stale.label, "Idle")
        XCTAssertTrue(KioskConnectionState.offline.appearsInGlance)
        XCTAssertTrue(KioskConnectionState.online.appearsInGlance)
        XCTAssertTrue(KioskConnectionState.stale.appearsInGlance)
        XCTAssertFalse(KioskConnectionState.inactive.appearsInGlance)
    }

    func testEmptyFleetSummaryNamesConfigurationState() {
        XCTAssertEqual(KioskFleetCounts(devices: [], at: now).summary, "0 configured")
    }

    func testSimulationDeviceIsExcludedFromFleetCounts() {
        let counts = KioskFleetCounts(devices: [
            device(id: "real", name: "Video Office", lastSeenAt: now.addingTimeInterval(-60)),
            device(id: "sim", name: "Sim iPad", lastSeenAt: nil),
        ], at: now)

        XCTAssertEqual(counts.summary, "1 online")
        XCTAssertFalse(device(name: "sim ipad", lastSeenAt: nil).isIncludedInMonitoring)
    }

    private func device(
        id: String = "kiosk-1",
        name: String = "Video Office iPad",
        active: Bool = true,
        activated: Bool = true,
        lastSeenAt: Date?
    ) -> KioskDevice {
        KioskDevice(
            id: id,
            name: name,
            location: .init(id: "location-1", name: "Video Office"),
            active: active,
            activated: activated,
            lastSeenAt: lastSeenAt,
            appVersion: "1.0",
            appBuild: "23",
            osVersion: "26.0",
            deviceModel: "iPad",
            pendingPickupCount: 0,
            openCheckoutCount: 3
        )
    }
}
