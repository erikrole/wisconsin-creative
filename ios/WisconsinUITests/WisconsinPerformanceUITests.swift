import XCTest

@MainActor
final class WisconsinPerformanceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testColdLaunchPerformance() throws {
        let application = XCUIApplication()
        application.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "launch"

        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(
            metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)],
            options: options
        ) {
            application.launch()
        }
    }

    func testItemsScrollingPerformance() throws {
        let application = launch(scenario: "items")
        XCTAssertTrue(application.staticTexts["PERF-0000"].waitForExistence(timeout: 5))

        let options = XCTMeasureOptions()
        options.iterationCount = 5
        measure(
            metrics: interactionMetrics(for: application),
            options: options
        ) {
            application.swipeUp()
            application.swipeUp()
            application.swipeDown()
            application.swipeDown()
        }
    }

    func testEquipmentSearchAndSelectionPerformance() throws {
        let application = launch(scenario: "equipment")
        let search = application.searchFields["Search all equipment"].exists
            ? application.searchFields["Search all equipment"]
            : application.textFields["Search all equipment"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))

        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(
            metrics: interactionMetrics(for: application),
            options: options
        ) {
            search.tap()
            search.typeText("PERF-0299")

            let result = application.buttons.matching(
                NSPredicate(format: "label CONTAINS %@", "PERF-0299")
            ).firstMatch
            XCTAssertTrue(result.waitForExistence(timeout: 2))
            result.tap()

            search.tap()
            search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 9))
        }
    }

    private func launch(scenario: String) -> XCUIApplication {
        let application = XCUIApplication()
        application.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = scenario
        application.launch()
        return application
    }

    private func interactionMetrics(for application: XCUIApplication) -> [any XCTMetric] {
        [
            XCTHitchMetric(application: application),
            XCTCPUMetric(application: application),
            XCTMemoryMetric(application: application),
        ]
    }
}
