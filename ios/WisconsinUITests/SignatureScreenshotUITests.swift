import XCTest

/// Captures the iPad Signatures screens against the fixture harness
/// (`signature-collections`, `signature-roster`, `signature-capture`) in
/// landscape, plus the portrait rotate prompt, for UI review. Run on an iPad
/// simulator; the canvas only appears in landscape.
@MainActor
final class SignatureScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    func testSignatureScreensCapture() throws {
        for scenario in ["signature-collections", "signature-roster", "signature-capture"] {
            XCUIDevice.shared.orientation = .landscapeLeft
            let app = XCUIApplication()
            app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = scenario
            app.launch()
            XCTAssertTrue(app.staticTexts.firstMatch.waitForExistence(timeout: 20), "\(scenario) never rendered")
            // Let the fixture load and the capture scenario seed its ink.
            Thread.sleep(forTimeInterval: 3)
            attach(app, name: "\(scenario)-landscape")
            app.terminate()
        }
    }

    func testCaptureAsksForLandscapeInPortrait() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "signature-capture"
        app.launch()
        XCTAssertTrue(app.staticTexts["Rotate iPad to landscape"].waitForExistence(timeout: 20))
        attach(app, name: "signature-capture-portrait")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
