import XCTest

/// Drives Browse -> Reports and captures the rendered screen. Swift Charts
/// failures are invisible to a compiler and to model tests: an empty series or
/// a bad axis renders a blank box that still builds and still decodes. This
/// test exists so a human can look at the result.
@MainActor
final class ReportsScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testReportsScreenCaptures() throws {
        let app = XCUIApplication()
        app.launch()

        let browseTab = app.buttons["Browse"]
        XCTAssertTrue(browseTab.waitForExistence(timeout: 20), "Browse tab never appeared -- is the app signed in?")
        browseTab.tap()

        let reportsRow = app.staticTexts["Reports"]
        XCTAssertTrue(reportsRow.waitForExistence(timeout: 10), "Reports row missing from Browse")
        reportsRow.tap()

        // Wait on the checkouts metric, not utilization: utilization only
        // renders when the server is new enough to send the custody block, and
        // this test should still pass against an older deployment.
        let checkoutsMetric = app.staticTexts["CHECKOUTS"]
        let loaded = checkoutsMetric.waitForExistence(timeout: 25)

        // Capture whatever landed, loaded or not, so a failure is diagnosable.
        attach(app, name: "reports-top")
        XCTAssertTrue(loaded, "Reports never loaded checkout activity")

        app.swipeUp(velocity: .slow)
        attach(app, name: "reports-mid")

        app.swipeUp(velocity: .slow)
        attach(app, name: "reports-bottom")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the Schedule list against the fixture harness, so a UI change can
/// be compared shot-for-shot without a signed-in session or a live network.
@MainActor
final class ScheduleScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testScheduleListCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launch()

        let title = app.navigationBars["Schedule"]
        XCTAssertTrue(title.waitForExistence(timeout: 20), "Schedule never rendered")
        // Wait on fixture content, not just the chrome.
        let firstEvent = app.staticTexts["Volleyball vs Nebraska"]
        XCTAssertTrue(firstEvent.waitForExistence(timeout: 15), "Fixture events never loaded")

        attach(app, name: "schedule-top")

        app.swipeUp(velocity: .slow)
        attach(app, name: "schedule-mid")

        app.swipeUp(velocity: .slow)
        attach(app, name: "schedule-bottom")

        // Calendar mode shares EventRow with the list, so a row change lands
        // here too. Capture it rather than assuming it survived.
        let calendar = app.buttons["Calendar"]
        if calendar.waitForExistence(timeout: 5) {
            calendar.tap()
            _ = app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 10)
            attach(app, name: "schedule-calendar")
        }
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures Event detail in both temporal states. The Schedule list grew a NOW
/// badge and a dimmed finished state before detail had either, so these two
/// shots are what prove the screens now agree.
@MainActor
final class EventDetailScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testEventDetailCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launch()

        XCTAssertTrue(app.navigationBars["Schedule"].waitForExistence(timeout: 20),
                      "Schedule never rendered")

        // A finished event the fixture user works, so the crew and gear blocks
        // are populated rather than empty.
        openEvent(app, titled: "Volleyball vs Nebraska")
        attach(app, name: "event-detail-ended")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // The event straddling launch time.
        openEvent(app, titled: "Women's Soccer vs Penn State")
        attach(app, name: "event-detail-live")
    }

    private func openEvent(_ app: XCUIApplication, titled title: String) {
        let row = app.staticTexts[title]
        XCTAssertTrue(row.waitForExistence(timeout: 15), "\(title) never appeared")
        row.tap()
        // Wait on the crew section, not the title: the title is already on the
        // list screen, so it exists before the push finishes.
        _ = app.staticTexts["Crew"].waitForExistence(timeout: 10)
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the Home action queue. The fixture carries more gear than the
/// per-lane caps show and a staff draft with an empty personal queue, so both
/// the truncation and the all-clear contradiction are on screen.
@MainActor
final class HomeScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testHomeCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "home"
        app.launch()

        // Wait on fixture content, not chrome.
        XCTAssertTrue(app.staticTexts["Overdue"].waitForExistence(timeout: 20),
                      "Home never loaded the dashboard fixture")
        attach(app, name: "home-top")

        app.swipeUp(velocity: .slow)
        attach(app, name: "home-queue")

        app.swipeUp(velocity: .slow)
        attach(app, name: "home-bottom")
    }

    func testHomeAllClearWithStaffDraft() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "homeAllClear"
        app.launch()

        XCTAssertTrue(app.staticTexts["Hockey B-roll kit"].waitForExistence(timeout: 20),
                      "Staff draft never rendered")
        attach(app, name: "home-all-clear")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the native Scoreboard against the fixture harness. The states worth
/// looking at are the filtered ones: the route narrows its own breakdowns, so a
/// screenshot of the unfiltered screen alone cannot show whether the sport menu
/// still offers the sports you have not picked.
@MainActor
final class ScoreboardScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testScoreboardStateCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "scoreboard"
        app.launch()

        XCTAssertTrue(app.navigationBars["Scoreboard"].waitForExistence(timeout: 20), "Scoreboard never rendered")
        // Wait on fixture content, not the chrome.
        XCTAssertTrue(app.staticTexts["Most worked"].waitForExistence(timeout: 15), "Fixture season never loaded")
        attach(app, name: "scoreboard-top")

        app.swipeUp(velocity: .slow)
        attach(app, name: "scoreboard-breakdowns")

        // The opponent table is the long one, so it carries the row cap.
        let opponentTab = app.buttons["Opponent"]
        if opponentTab.waitForExistence(timeout: 5) {
            opponentTab.tap()
            attach(app, name: "scoreboard-breakdown-opponent")
        }

        app.swipeUp(velocity: .slow)
        app.swipeUp(velocity: .slow)
        attach(app, name: "scoreboard-games")
        app.swipeDown(velocity: .slow)
        app.swipeDown(velocity: .slow)
        app.swipeDown(velocity: .slow)
        app.swipeDown(velocity: .slow)

        // Men's Basketball is winless in the fixture, so it carries both the
        // filtered view and the filtered-empty result.
        let sportChip = app.buttons["Men's Basketball"]
        XCTAssertTrue(sportChip.waitForExistence(timeout: 10), "Sport filter strip missing")
        sportChip.tap()
        XCTAssertTrue(
            app.staticTexts["Men's Basketball vs Marquette"].waitForExistence(timeout: 15),
            "Sport filter never applied"
        )
        attach(app, name: "scoreboard-filtered-sport")

        let wins = app.buttons["Wins"]
        XCTAssertTrue(wins.waitForExistence(timeout: 10), "Result filter missing")
        wins.tap()
        XCTAssertTrue(
            app.staticTexts["No games match these filters"].waitForExistence(timeout: 15),
            "Filtered-empty state never rendered"
        )
        attach(app, name: "scoreboard-filtered-empty")

        // The empty state's own actions sit below the breakdown card.
        app.swipeUp(velocity: .slow)
        attach(app, name: "scoreboard-filtered-empty-actions")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the current user's Profile, where the Scoreboard entry sits between
/// the Next Up card and the badge shelf. A row's treatment is only reviewable
/// beside its neighbours.
@MainActor
final class ProfileScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testProfileScoreboardEntryCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "profile"
        app.launch()

        // Wait on fixture identity, not the chrome.
        XCTAssertTrue(app.staticTexts["Jordan Lee"].waitForExistence(timeout: 20), "Profile never rendered")
        XCTAssertTrue(app.staticTexts["Scoreboard"].waitForExistence(timeout: 10), "Scoreboard entry missing")
        attach(app, name: "profile-top")

        app.swipeUp(velocity: .slow)
        attach(app, name: "profile-mid")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures Login's password step and Account & Security against the fixture
/// harness. Both screens grew an account field so a password manager has a
/// username to file the credential under, and both are places where a wrong
/// text treatment would only be visible in a screenshot.
@MainActor
final class PasswordManagerScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLoginPasswordStepCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "login"
        app.launch()

        let email = app.textFields["Email address"]
        XCTAssertTrue(email.waitForExistence(timeout: 20), "Login never rendered its email field")
        email.tap()
        email.typeText("jordan.lee@wisc.edu")

        app.buttons["Continue"].tap()

        // The fixture answers account discovery with the password flow, so the
        // password step is what should land.
        let signingInAs = app.staticTexts["Signing in as"]
        XCTAssertTrue(signingInAs.waitForExistence(timeout: 15), "Login never reached its password step")

        attach(app, name: "login-password-step")
    }

    func testAccountSecurityCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "accountSecurity"
        app.launch()

        let title = app.navigationBars["Account & Security"]
        XCTAssertTrue(title.waitForExistence(timeout: 20), "Account & Security never rendered")
        XCTAssertTrue(app.staticTexts["iPhone"].waitForExistence(timeout: 15), "Fixture passkeys never loaded")

        attach(app, name: "account-security-top")

        app.swipeUp(velocity: .slow)
        attach(app, name: "account-security-password")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the real Student preview shell against local fixtures so the
/// persistent mode marker can be compared without credentials or production
/// data. The pair intentionally visits the same Guides surface as the kickoff
/// presentation flow.
@MainActor
final class PreviewChromeScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testStudentPreviewChromeCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "preview-chrome"
        app.launch()

        let browseTab = app.buttons["Browse"]
        XCTAssertTrue(browseTab.waitForExistence(timeout: 20), "Browse tab never rendered")
        browseTab.tap()

        let guides = app.staticTexts["Guides"]
        XCTAssertTrue(guides.waitForExistence(timeout: 15), "Guides destination never rendered")
        guides.tap()

        let firstGuide = app.staticTexts["Key contacts"]
        XCTAssertTrue(firstGuide.waitForExistence(timeout: 20), "Guide fixture never loaded")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "preview-chrome-guides"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the real native Bookings tab as a Student. The fixture honors the
/// request's requester filter, so the committed Mine default and the changed
/// shared All default can be compared against the same data and viewport.
@MainActor
final class StudentBookingsScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testStudentBookingsVisibilityCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "student-bookings"
        app.launch()

        let title = app.navigationBars["Bookings"]
        XCTAssertTrue(title.waitForExistence(timeout: 20), "Bookings never rendered")
        XCTAssertTrue(app.staticTexts["Student camera kit"].waitForExistence(timeout: 20),
                      "Booking rows never rendered")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "student-bookings"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
