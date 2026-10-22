import XCTest

/// Exercises the real views, request/decoding and scene lifecycle against local responses.
@MainActor
final class RecentIOSRegressionUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(_ scenario: String, _ extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = extra.merging(["GT_PERFORMANCE_SCENARIO": scenario]) { _, scenario in scenario }
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
        app.launch()
        return app
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        let frame = app.windows.firstMatch.frame
        let viewport = XCTAttachment(string: "viewportPoints=\(frame.width)x\(frame.height)")
        viewport.name = "\(name)-viewport"
        viewport.lifetime = .keepAlways
        add(viewport)
    }

    func testStudentCanCopyTheQRWhenItIsTheHeroTitle() {
        let app = launch("item-detail", ["GT_ITEM_ROLE": "student"])
        let copy = app.buttons["item-hero-qr-copy"]
        XCTAssertTrue(copy.waitForExistence(timeout: 12))
        XCTAssertFalse(app.buttons["More item actions"].exists)
        copy.tap()
        XCTAssertTrue(app.staticTexts["Copied CAM-014"].waitForExistence(timeout: 5))
        attach(app, "student-hero-qr-copy")
    }

    func testWrappedVoiceOverCardIncludesEveryCrewMemberAndCount() {
        let app = launch("wrapped", ["GT_WRAPPED_CARD": "4"])
        let card = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@ AND label CONTAINS %@",
            "Jordan Lee: 21 together", "Sam Ortiz: 12 together", "Ava Stone: 5 together"
        )).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 12))
        attach(app, "wrapped-accessible-crew-details")
    }

    func testHomeUsesPersonalCounts() {
        let app = launch("home")
        let summary = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Your gear: 1 overdue")).firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 15))
        let overdue = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Return Volleyball baseline kit")).firstMatch
        XCTAssertTrue(overdue.exists)
        attach(app, "home-personal-counts")
    }

    func testEmptyLicensePoolKeepsTheExistingHoldersControls() {
        let app = launch("resourcesLicenses", ["GT_LICENSE_POOL_EMPTY": "1"])
        XCTAssertTrue(app.buttons["Copy Code"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Return"].exists || app.buttons["Release"].exists)
        XCTAssertTrue(app.buttons["Code not working?"].exists)
        XCTAssertFalse(app.staticTexts["No licenses"].exists)
        attach(app, "license-empty-pool-active-claim")
    }

    func testLateSharedPasswordStaysHiddenAfterBackgrounding() {
        let app = launch("shared-logins", ["GT_FIXTURE_DELAY_MS": "2500"])
        let show = app.buttons["Show Review Account password"]
        XCTAssertTrue(show.waitForExistence(timeout: 15))
        show.tap()
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 3)
        app.activate()
        XCTAssertTrue(show.waitForExistence(timeout: 12))
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(app.buttons["Hide Review Account password"].exists)
        XCTAssertFalse(app.staticTexts["review-only-secret"].exists)
        attach(app, "shared-password-late-response-hidden")
    }

    func testTypedBulkScanLeavesAnIncompatibleSearchScope() {
        let app = launch("search", ["GT_SEARCH_SCOPE": "people"])
        let scan = app.buttons["Scan QR code"]
        XCTAssertTrue(scan.waitForExistence(timeout: 15))
        scan.tap()
        let manual = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "type code")).firstMatch
        if !manual.waitForExistence(timeout: 3), app.buttons["Continue"].exists {
            app.buttons["Continue"].tap()
        }
        if app.alerts.firstMatch.waitForExistence(timeout: 2) {
            let allow = app.alerts.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "allow")).firstMatch
            if allow.exists { allow.tap() }
        }
        XCTAssertTrue(manual.waitForExistence(timeout: 10))
        manual.tap()
        let code = app.textFields["Asset tag, sticker code, or ref number"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap()
        code.typeText("BIN-REVIEW-1")
        app.buttons["Look up"].tap()
        let family = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Review Batteries")).firstMatch
        XCTAssertTrue(family.waitForExistence(timeout: 12))
        attach(app, "bulk-scan-visible-in-gear")
    }

    func testTradeDetailsAndInlineDecisionStaySeparate() {
        let app = launch("tradeBoardStaff")
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Football vs Nebraska,")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        XCTAssertTrue(app.staticTexts["Area"].waitForExistence(timeout: 5))
        attach(app, "trade-native-details")
        app.terminate()
        app.launch()
        let decline = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Decline trade for")).firstMatch
        XCTAssertTrue(decline.waitForExistence(timeout: 5))
        decline.tap()
        // An inline decision opens its own confirmation instead of the detail sheet.
        XCTAssertTrue(app.buttons["Decline"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Area"].exists)
        attach(app, "trade-native-row-and-sibling-actions")
    }

    func testHomeAttentionOpensItsBooking() {
        let app = launch("home")
        let overdue = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Return Volleyball baseline kit")).firstMatch
        XCTAssertTrue(overdue.waitForExistence(timeout: 15))
        overdue.tap()
        XCTAssertTrue(app.navigationBars["Volleyball baseline kit"].waitForExistence(timeout: 8))
        attach(app, "home-native-attention-route")
    }

    func testComparisonShowsARealZeroPercent() {
        let app = launch("team-scoreboard", ["GT_SCOREBOARD_ZERO": "1"])
        XCTAssertTrue(app.navigationBars["Scoreboard"].waitForExistence(timeout: 15))
        let person = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Ava Stone")).firstMatch
        for _ in 0..<12 {
            if person.exists && person.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(person.isHittable)
        person.tap()
        let compare = app.buttons["Compare"]
        if !compare.isHittable { app.swipeUp() }
        XCTAssertTrue(compare.waitForExistence(timeout: 5))
        compare.tap()
        XCTAssertTrue(app.navigationBars["Head to head"].waitForExistence(timeout: 5))
        let rate = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Win rate:", "0%")).firstMatch
        XCTAssertTrue(rate.waitForExistence(timeout: 5))
        attach(app, "comparison-zero-percent")
    }
}
