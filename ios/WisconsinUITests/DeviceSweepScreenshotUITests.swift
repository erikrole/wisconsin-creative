import XCTest

/// Walks the fixture scenarios on whatever simulator it runs on and attaches a
/// top and a scrolled shot of each, so layout and spacing can be compared
/// across the device sizes users actually carry. Offline: every scenario is
/// served canned API responses, so no session or network is needed.
///
/// Run per device, then export attachments from the .xcresult:
///   TEST_RUNNER_GT_SWEEP_THEME=light xcodebuild test -scheme Wisconsin \
///     -destination 'platform=iOS Simulator,name=iPhone 17' \
///     -only-testing:WisconsinUITests/DeviceSweepScreenshotUITests
/// `TEST_RUNNER_GT_SWEEP_SCENARIOS=home,schedule` narrows the list.
@MainActor
final class DeviceSweepScreenshotUITests: XCTestCase {
    private static let scenarios = [
        "login", "home", "homeStudent", "homeAllClear", "home-getting-started",
        "schedule", "tradeBoardStaff", "tradeBoardStudent",
        "profile", "staffProfile", "scoreboard", "team-scoreboard",
        "latest-browse", "resourcesGuides", "resourcesUsers", "resourcesLicenses",
        "student-bookings", "booking-detail", "booking-extend", "booking-edit",
        "items-list", "item-detail", "search", "reports",
        "event-detail", "user-detail", "availability", "gear-picks",
        "notifications", "notifications-inbox", "accountSecurity", "report-problem",
        "shared-logins", "damage-queue-open", "damage-queue-detail",
        "create-booking-scanner", "create-booking-events",
        "announcement", "announcement-long", "wrapped",
    ]

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    func testSweep() throws {
        let env = ProcessInfo.processInfo.environment
        let theme = env["GT_SWEEP_THEME"] ?? "light"
        let only = env["GT_SWEEP_SCENARIOS"]?.split(separator: ",").map(String.init)
        let list = only ?? Self.scenarios

        for scenario in list {
            let app = XCUIApplication()
            app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = scenario
            app.launchArguments += ["-WisconsinThemeChoice", theme]
            app.launch()
            // Fixture content has no stable sentinel across 40 screens; give
            // the offline payloads time to decode and animations to settle.
            Thread.sleep(forTimeInterval: 4)
            attach(app, name: "\(scenario)-1-top")
            app.swipeUp(velocity: .slow)
            Thread.sleep(forTimeInterval: 0.8)
            attach(app, name: "\(scenario)-2-scrolled")
            app.terminate()
        }
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
