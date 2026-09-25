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
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
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

        // Scrolled away from today, the week strip offers Today, which jumps
        // the one master list back rather than switching modes.
        let today = app.buttons["Today"]
        if today.waitForExistence(timeout: 5) {
            today.tap()
            XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 5),
                          "Today did not scroll the list back")
            Thread.sleep(forTimeInterval: 1) // let the scroll animation settle
            attach(app, name: "schedule-jumped-today")
        }

        // A week-strip day jumps to that day's section in the same list.
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: .now) ?? .now
        let tomorrowLabel = tomorrow.formatted(.dateTime.weekday(.wide).month(.wide).day())
        let tomorrowCell = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", tomorrowLabel)).firstMatch
        if tomorrowCell.waitForExistence(timeout: 5) {
            tomorrowCell.tap()
            XCTAssertTrue(app.staticTexts["Football vs Ohio State"].waitForExistence(timeout: 5),
                          "Tapping tomorrow did not scroll to its section")
            Thread.sleep(forTimeInterval: 1) // let the scroll animation settle
            attach(app, name: "schedule-jumped-tomorrow")
        }

        // The month title expands the week jump bar into a month grid above
        // the same list. Capture it rather than assuming it survived.
        let monthToggle = app.buttons["schedule-month-toggle"]
        if monthToggle.waitForExistence(timeout: 5) {
            monthToggle.tap()
            attach(app, name: "schedule-calendar")
        }
    }

    /// The list starts at today and loads future weeks as it scrolls. The
    /// past sits behind a deliberate pull at the top: a hard flick stops on
    /// today, and a held pull past the threshold reveals two weeks at a time.
    /// The fixture filters by the requested window, so these events only
    /// exist once their weeks load.
    func testScheduleLoadsWeeksWhileScrolling() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 20),
                      "Fixture events never loaded")

        // Flicking down from today does not run into the past.
        app.swipeDown(velocity: .fast)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(app.staticTexts["Wrestling vs Iowa"].exists, "A flick revealed past events")
        attach(app, name: "schedule-flick-stops-at-today")

        // A held pull past the threshold reveals the most recent past weeks.
        let window = app.windows.firstMatch
        func pullDown() {
            let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.42))
            let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.4)
        }
        pullDown()
        XCTAssertTrue(app.staticTexts["Wrestling vs Iowa"].waitForExistence(timeout: 5),
                      "A deliberate pull did not reveal earlier weeks")
        Thread.sleep(forTimeInterval: 1)
        attach(app, name: "schedule-earlier-weeks")

        let later = app.staticTexts["Men's Basketball vs Marquette"]
        for _ in 0..<30 where !later.exists {
            app.swipeUp(velocity: .fast)
        }
        XCTAssertTrue(later.waitForExistence(timeout: 5), "Scrolling down did not load later weeks")
        Thread.sleep(forTimeInterval: 1)
        attach(app, name: "schedule-later-weeks")

        // Back in the future and at rest, the past folds away: flicking all
        // the way up stops on today again.
        for _ in 0..<12 {
            app.swipeDown(velocity: .fast)
        }
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(app.staticTexts["Wrestling vs Iowa"].exists, "The past stayed open after leaving it")
        attach(app, name: "schedule-back-to-today")
    }

    func testScheduleDarkCapture() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launchArguments += ["-WisconsinThemeChoice", "dark"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 20),
                      "Fixture events never loaded")
        attach(app, name: "schedule-dark")
    }

    func testScheduleAccessibilityCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launchArguments += [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL",
            "-WisconsinThemeChoice", "dark"
        ]
        app.launch()
        let event = app.staticTexts["Volleyball vs Nebraska"]
        XCTAssertTrue(event.waitForExistence(timeout: 20))
        attach(app, name: "schedule-accessibility")
        event.tap()
        XCTAssertTrue(app.staticTexts["Bucky Badger"].waitForExistence(timeout: 15))
        attach(app, name: "event-detail-accessibility")
        app.swipeUp(velocity: .slow)
        attach(app, name: "event-crew-accessibility")
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
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
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
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // The all-day event, whose start instant is UTC midnight two days out.
        // Formatting that instant locally named the day before it, so this
        // header disagreed with the list row that pushed it.
        openEvent(app, titled: "Big Ten Swimming Championships")
        attach(app, name: "event-detail-all-day")
    }

    private func openEvent(_ app: XCUIApplication, titled title: String) {
        // Multi-day events appear once under each day in the agenda.
        let row = app.staticTexts.matching(identifier: title).firstMatch
        if !row.waitForExistence(timeout: 15) || !row.isHittable {
            // Later fixture days sit below the fold.
            for _ in 0..<6 where !row.exists || !row.isHittable {
                app.swipeUp()
            }
        }
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

    func testHomeAccessibilityCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "home"
        app.launchArguments = [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL",
            "-WisconsinThemeChoice", "dark"
        ]
        app.launch()

        XCTAssertTrue(app.staticTexts["Overdue"].waitForExistence(timeout: 20),
                      "Home never loaded at accessibility size")
        attach(app, name: "home-accessibility-top")
        app.swipeUp(velocity: .slow)
        attach(app, name: "home-accessibility-queue")
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

    func testLaunchViewCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "launch-view"
        app.launch()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "Launch still never reached the foreground")
        attach(app, name: "launch-still")
    }

    func testLoginIdentityCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "login"
        app.launch()

        let email = app.textFields["Email address"]
        XCTAssertTrue(email.waitForExistence(timeout: 20), "Login never rendered its email field")
        attach(app, name: "login-identity")
    }

    func testPasswordSetupCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "password-setup"
        app.launch()

        XCTAssertTrue(
            app.staticTexts["Set your password"].waitForExistence(timeout: 20),
            "Password setup never rendered"
        )
        attach(app, name: "password-setup")
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

/// Captures Notifications against the local fixture harness. The fixture has
/// a future account pause, so the before/after pair shows whether the screen
/// tells the truth about suppressed delivery and offers a recovery path.
@MainActor
final class NotificationSettingsScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testNotificationSettingsCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "notifications"
        app.launch()

        XCTAssertTrue(app.navigationBars["Notifications"].waitForExistence(timeout: 20),
                      "Notifications never rendered")
        // The fixture's account pause renders near the top on every layout;
        // lower rows (Push alerts) are lazily built only once scrolled to.
        XCTAssertTrue(app.staticTexts["Alerts paused"].waitForExistence(timeout: 15),
                      "Notification preference fixture never rendered")

        attach(app, name: "notifications-top")
        app.swipeUp(velocity: .slow)
        attach(app, name: "notifications-scrolled")
        app.swipeUp(velocity: .slow)
        attach(app, name: "notifications-scrolled-2")
        app.swipeUp(velocity: .slow)
        attach(app, name: "notifications-bottom")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the primary Search surface at the two states that matter for a
/// large result set: the first page exposes the server total and continuation,
/// then the same list after the next page is loaded. The fixture includes a
/// bulk family in the first page so its visible Reserve action is reviewed in
/// the same context as typed and scanned family results.
@MainActor
final class GlobalSearchScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSearchPaginationCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "search"
        app.launch()

        XCTAssertTrue(app.staticTexts["A-cam body"].waitForExistence(timeout: 20),
                      "Search results never rendered")
        attach(app, name: "search-first-page")

        let more = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Show more items")).firstMatch
        if !more.isHittable {
            app.swipeUp(velocity: .slow)
        }
        XCTAssertTrue(more.waitForExistence(timeout: 10),
                      "Search never exposed its paginated continuation")
        attach(app, name: "search-pagination")

        more.tap()
        XCTAssertTrue(app.staticTexts["Football field monitor"].waitForExistence(timeout: 15),
                      "Search did not append the next item page")
        attach(app, name: "search-second-page")
    }

    /// Baseline-only capture used to pair the first page against the same
    /// viewport after the HIG repair. It deliberately does not tap the
    /// continuation, so the pre-change implementation can be captured with
    /// the same fixture and scroll positions.
    func testSearchFirstPageBaselineCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "search"
        app.launch()

        XCTAssertTrue(app.staticTexts["A-cam body"].waitForExistence(timeout: 20),
                      "Search results never rendered")
        attach(app, name: "search-first-page-baseline")
        app.swipeUp(velocity: .slow)
        attach(app, name: "search-pagination-baseline")
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

/// Captures the Trade Board review queue as staff. The fixture holds two claims
/// whose shifts fall on different days but whose posts share a timestamp, so the
/// order the rows land in is decided entirely by how the queue sorts them.
@MainActor
final class TradeBoardReviewScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testStaffReviewQueueCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "tradeBoardStaff"
        app.launch()

        XCTAssertTrue(app.navigationBars["Trade Board"].waitForExistence(timeout: 20),
                      "Trade Board never rendered")
        // Wait on fixture rows, not the section chrome: the queue header renders
        // before the trades arrive.
        XCTAssertTrue(app.staticTexts["Admin Review"].waitForExistence(timeout: 15),
                      "Review queue never appeared")
        XCTAssertTrue(app.staticTexts["football vs Minnesota"].waitForExistence(timeout: 15),
                      "Fixture claims never loaded")

        attach(app, name: "trade-board-staff-review")
    }

    func testStudentWaitingStateCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "tradeBoardStudent"
        app.launch()

        XCTAssertTrue(app.navigationBars["Trade Board"].waitForExistence(timeout: 20),
                      "Trade Board never rendered")
        XCTAssertTrue(app.staticTexts["Waiting on Admin"].waitForExistence(timeout: 15),
                      "Waiting section never appeared")

        attach(app, name: "trade-board-student-waiting")
    }

    /// Captures the browse inventory at the student-posted trade. The same
    /// fixture also has an unassigned open slot immediately after it, so the
    /// screenshot proves whether those two sources read as one pool or as two
    /// distinct sections without mutating either claim path.
    func testStudentAvailableInventoryCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "tradeBoardStudent"
        app.launch()

        XCTAssertTrue(app.navigationBars["Trade Board"].waitForExistence(timeout: 20),
                      "Trade Board never rendered")

        let trade = app.staticTexts["football vs Michigan"]
        for _ in 0..<5 where !trade.exists || !trade.isHittable {
            app.swipeUp(velocity: .slow)
        }
        XCTAssertTrue(trade.waitForExistence(timeout: 15),
                      "Student-posted trade never appeared")

        attach(app, name: "trade-board-student-trade-posts")
        app.swipeUp(velocity: .slow)
        attach(app, name: "trade-board-student-open-shifts")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}


/// Captures the Create Booking event picker.
///
/// It reads `/api/calendar-events` -- the one payload carrying `site` -- but
/// derived every venue label, rail colour, and scope filter from the raw
/// `isHome` tri-state, so the neutral-site fixture game (`isHome: true`,
/// `site: "NEUTRAL"`) was listed here as Home while the Schedule tab, which
/// resolves venue properly, showed the same row as Neutral.
@MainActor
final class CreateBookingEventPickerScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testEventPickerCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "create-booking-events"
        app.launch()

        XCTAssertTrue(app.staticTexts["New Reservation"].waitForExistence(timeout: 20), "Composer never opened")
        attach(app, name: "create-booking-details-event-empty")

        let manual = app.buttons["Manual"].firstMatch
        XCTAssertTrue(manual.waitForExistence(timeout: 8), "Manual setup control missing")
        manual.tap()
        XCTAssertTrue(app.staticTexts["When"].waitForExistence(timeout: 8), "Manual When card never appeared")
        attach(app, name: "create-booking-details-manual")

        let eventLinked = app.buttons["Event Linked"].firstMatch
        XCTAssertTrue(eventLinked.waitForExistence(timeout: 5), "Event Linked setup control missing")
        eventLinked.tap()

        // The card's NavigationLink carries an `.accessibilityLabel`, which
        // *replaces* the "Choose Event" text -- querying the visible string
        // finds nothing.
        let choose = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Choose from"))
            .firstMatch
        XCTAssertTrue(choose.waitForExistence(timeout: 20), "Event selection card never rendered")
        choose.tap()

        let duke = app.staticTexts["MBB vs Duke"]
        XCTAssertTrue(duke.waitForExistence(timeout: 15), "Fixture events never loaded into the picker")
        attach(app, name: "create-booking-event-picker")

        // The Neutral scope: the same row has to be reachable through the
        // filter that matches the label the row is showing.
        let all = app.buttons["All"].firstMatch
        let neutral = app.buttons["Neutral"].firstMatch
        if neutral.waitForExistence(timeout: 5) {
            neutral.tap()
            _ = duke.waitForExistence(timeout: 10)
            attach(app, name: "create-booking-event-picker-neutral")
            if all.waitForExistence(timeout: 5) {
                all.tap()
                _ = duke.waitForExistence(timeout: 10)
            }
        }

        let dukeRow = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "MBB vs Duke")).firstMatch
        XCTAssertTrue(dukeRow.waitForExistence(timeout: 5), "Duke event row was not tappable")
        dukeRow.tap()

        let confirm = app.buttons["Confirm event selection"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 8), "Confirm event selection never appeared")
        XCTAssertTrue(confirm.isEnabled, "Confirm stayed disabled after selecting Duke")
        confirm.tap()

        XCTAssertTrue(app.staticTexts["When"].waitForExistence(timeout: 10), "When card never appeared")
        XCTAssertTrue(app.staticTexts["Pickup"].waitForExistence(timeout: 5), "Pickup label missing from the schedule row")
        XCTAssertTrue(app.staticTexts["Return"].waitForExistence(timeout: 5), "Return label missing from the schedule row")
        attach(app, name: "create-booking-details-when")

        let chooseGear = app.buttons["Choose Gear"]
        XCTAssertTrue(chooseGear.waitForExistence(timeout: 8), "Choose Gear never appeared")
        XCTAssertTrue(chooseGear.isEnabled, "Choose Gear stayed disabled after selecting Duke")
        chooseGear.tap()
        var gearSearch = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "Search all equipment", "Search all equipment"))
            .firstMatch
        if !gearSearch.waitForExistence(timeout: 3) {
            gearSearch = app.searchFields["Search all equipment"]
        }
        XCTAssertTrue(gearSearch.waitForExistence(timeout: 15), "Gear search never appeared")
        let conflicted = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "has this item until")).firstMatch
        XCTAssertTrue(conflicted.waitForExistence(timeout: 10), "Conflicted gear never rendered")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "has reserved for")).firstMatch.waitForExistence(timeout: 8),
            "Upcoming reservation copy never rendered"
        )
        attach(app, name: "create-booking-gear")

        let camera = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "CAM-015"))
            .firstMatch
        XCTAssertTrue(camera.waitForExistence(timeout: 8), "Available camera never rendered")
        camera.tap()
        XCTAssertTrue(app.staticTexts["Sony Battery"].waitForExistence(timeout: 8), "Battery recommendation never appeared")
        XCTAssertTrue(app.buttons["Review"].waitForExistence(timeout: 8), "Review never appeared after adding gear")
        attach(app, name: "create-booking-gear-selected")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the Bookings list controls added by the 2026-08-28 quality-of-life
/// pass: the status/sort menu on the leading edge, and the row swipe actions.
///
/// Both states only exist after the change, so they are captured on their own
/// rather than paired against a baseline that had nowhere to show them.
@MainActor
final class BookingsFilterScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFilterMenuAndSwipeActionCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "student-bookings"
        app.launch()

        // Wait on fixture content, not chrome: the navigation bar exists before
        // the rows decode.
        XCTAssertTrue(app.staticTexts["Student camera kit"].waitForExistence(timeout: 20),
                      "Booking rows never rendered")

        let filter = app.buttons["Filter and sort bookings"]
        XCTAssertTrue(filter.waitForExistence(timeout: 10), "Filter menu button never rendered")
        filter.tap()

        // The menu is a system popover; wait on one of its own rows.
        XCTAssertTrue(app.buttons["Pending Pickup"].waitForExistence(timeout: 10),
                      "Filter menu never opened")
        attach(app, name: "bookings-filter-menu")

        // Dismiss by re-selecting the scope that is already checked: a bare
        // `app.tap()` lands on a booking row and navigates into detail, and the
        // swipe capture below silently becomes a screenshot of that screen.
        app.buttons["Active"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Student camera kit"].waitForExistence(timeout: 10),
                      "List never came back after dismissing the menu")
        XCTAssertTrue(app.navigationBars["Bookings"].exists,
                      "Dismissing the menu navigated away from the list")

        let row = app.cells.containing(.staticText, identifier: "Student camera kit").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Booking row never resolved as a cell")
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Extend"].waitForExistence(timeout: 10),
                      "Trailing swipe actions never revealed")
        attach(app, name: "bookings-swipe-trailing")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures an open checkout whose camera is booked again later. This is the
/// policy edge where Booking Detail used to remove Extend entirely even though
/// there is still time available before the next booking starts.
@MainActor
final class BookingExtensionScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testUpcomingNeedExtensionCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "booking-detail"
        app.launch()

        XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 20),
                      "Booking Detail never rendered")
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Needed again")
        ).firstMatch.waitForExistence(timeout: 15),
                      "Upcoming commitment guidance never rendered")
        XCTAssertTrue(app.buttons["Extend Return Date"].waitForExistence(timeout: 10),
                      "Upcoming demand removed the eligible Extend action")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "booking-extension-upcoming-need"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// Baseline-only capture for the same fixture and viewport. Kept separate
    /// because the old policy intentionally has no Extend action to assert.
    func testUpcomingNeedExtensionBaselineCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "booking-detail"
        app.launch()

        XCTAssertTrue(app.staticTexts["Volleyball vs Nebraska"].waitForExistence(timeout: 20),
                      "Booking Detail never rendered")
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Needed again")
        ).firstMatch.waitForExistence(timeout: 15),
                      "Upcoming commitment guidance never rendered")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "booking-extension-upcoming-need-baseline"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the Item detail overflow menu, where Needs Maintenance was added.
///
/// Reuses the `item-edit` scenario because its harness already signs in a STAFF
/// user — the role the action is gated to — and dismisses the seeded edit sheet
/// before opening the menu.
@MainActor
final class ItemMaintenanceMenuScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testItemOverflowMenuCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "item-edit"
        app.launch()

        let cancel = app.buttons["Cancel"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 20), "Seeded edit sheet never appeared")
        cancel.tap()

        let more = app.buttons["More item actions"]
        XCTAssertTrue(more.waitForExistence(timeout: 15), "Overflow menu button never rendered")
        more.tap()

        XCTAssertTrue(app.buttons["Edit Item"].waitForExistence(timeout: 10),
                      "Overflow menu never opened")
        attach(app, name: "item-overflow-menu")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Captures the long-press menus added by the 2026-08-28 contextual-actions
/// pass, on the two surfaces where the gesture previously did nothing.
@MainActor
final class LongPressMenuScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testSearchResultLongPressCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "search"
        app.launch()

        let row = app.staticTexts["A-cam body"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "Search results never rendered")
        row.press(forDuration: 1.2)

        XCTAssertTrue(app.buttons["Copy Asset Tag"].waitForExistence(timeout: 10),
                      "Search result menu never opened")
        attach(app, name: "search-long-press")
    }

    /// The gate, not the affordance.
    ///
    /// This scenario renders `LicensesView` without seeding a session, so
    /// `canRevealCode` is false for every row and the visible line reads "Code
    /// hidden until claimed". Long press must offer nothing there — otherwise
    /// the gesture becomes a way around the rule the row is enforcing.
    func testLicenseCodeStaysHiddenOnLongPress() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "resourcesLicenses"
        app.launch()

        let row = app.cells.element(boundBy: 0)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "License rows never rendered")
        row.press(forDuration: 1.2)

        XCTAssertFalse(
            app.buttons["Copy License Code"].waitForExistence(timeout: 3),
            "Long press offered a code the row is deliberately hiding"
        )
    }

    /// The Items list menu the Search menu now matches. Captured so the two
    /// can be compared side by side: the claim is parity, and parity is the
    /// kind of thing that quietly stops being true.
    func testItemsListLongPressCaptures() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "items-list"
        app.launch()

        let row = app.cells.element(boundBy: 0)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "Item rows never rendered")
        row.press(forDuration: 1.2)

        XCTAssertTrue(app.buttons["Copy Asset Tag"].waitForExistence(timeout: 10),
                      "Items list menu never opened")
        attach(app, name: "items-long-press")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Failure paths use the fixture protocol's unmapped mutation responses; no
/// credentials or real booking/crew records are used.
@MainActor
final class ActionErrorRecoveryUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testExtensionFailureStaysVisibleAndKeepsChanges() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "booking-extend"
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Extend Booking"].waitForExistence(timeout: 20))
        let preset = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Extend by 1 day")).firstMatch
        XCTAssertTrue(preset.waitForExistence(timeout: 10))
        preset.tap()
        app.buttons["Extend booking"].tap()
        XCTAssertTrue(app.staticTexts["The requested item could not be found."].waitForExistence(timeout: 10))
        attach(app, name: "extension-error")
        let dismiss = app.buttons["Dismiss"]
        XCTAssertTrue(dismiss.isHittable, "Failure recovery must be visible without scrolling")
        dismiss.tap()
        XCTAssertTrue(app.navigationBars["Extend Booking"].exists)
        XCTAssertTrue(app.buttons["Extend booking"].isEnabled, "Selected extension must survive dismissal")
        app.buttons["Extend booking"].tap()
        XCTAssertTrue(app.buttons["Dismiss"].waitForExistence(timeout: 10), "Repeated failure must be presented again")
    }

    func testEventFailureAfterConfirmationStaysVisible() throws {
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "schedule"
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
        app.launch()
        let event = app.staticTexts["Volleyball vs Nebraska"]
        XCTAssertTrue(event.waitForExistence(timeout: 20))
        event.tap()
        let actions = app.buttons["Actions for Student shift"].firstMatch
        for _ in 0..<4 where !actions.exists || !actions.isHittable { app.swipeUp() }
        XCTAssertTrue(actions.waitForExistence(timeout: 10))
        actions.tap()
        app.buttons["Remove Bucky Badger"].tap()
        let confirm = app.buttons["Remove assignment"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(app.staticTexts["Couldn't remove assignment"].waitForExistence(timeout: 10))
        attach(app, name: "event-action-error")
        XCTAssertTrue(app.buttons["Dismiss"].isHittable)
        XCTAssertTrue(app.buttons["Refresh"].isHittable)
        XCTAssertFalse(app.alerts.firstMatch.exists, "Action failures must not compete with confirmation dialogs")
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}
