import XCTest

@MainActor
final class ScheduleWeekSelectionCaptureTests: XCTestCase {
    func testSparseScheduleCapture() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launchArguments += ["-WisconsinThemeChoice", "light", "-ScheduleFilters.fixture-staff.sport", "VB", "-ScheduleFilters.fixture-staff.mine", "NO", "-ScheduleFilters.fixture-staff.type", "All"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 4)
        attach(app, name: "sparse-schedule")
        let today = app.buttons["Today"]
        if today.exists { today.tap() }
        Thread.sleep(forTimeInterval: 2)
        attach(app, name: "sparse-schedule-today")
    }

    func testLongScheduleReturnsToToday() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launchArguments += ["-WisconsinThemeChoice", "light", "-ScheduleFilters.fixture-staff.mine", "NO", "-ScheduleFilters.fixture-staff.type", "All"]
        app.launch()
        let sport = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Sport, ")).firstMatch
        XCTAssertTrue(sport.waitForExistence(timeout: 20))
        sport.tap()
        let allSports = app.buttons["All Sports"]
        XCTAssertTrue(allSports.waitForExistence(timeout: 5))
        allSports.tap()
        XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 20))
        let window = app.windows.firstMatch
        let frame = window.frame
        let metadata = XCTAttachment(string: "width=\(frame.width),height=\(frame.height),locale=\(Locale.current.identifier),timezone=\(TimeZone.current.identifier)")
        metadata.name = "window-geometry"
        metadata.lifetime = .keepAlways
        add(metadata)
        let today = app.buttons["Today"]
        for _ in 0..<10 where !today.exists { app.swipeUp(velocity: .fast) }
        XCTAssertTrue(today.waitForExistence(timeout: 5), "Scrolling away from today must offer Today")
        today.tap()
        Thread.sleep(forTimeInterval: 2)
        attach(app, name: "long-schedule-returned-today")
        XCTAssertFalse(today.exists, "Today must restore the selected day after a real scroll")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
