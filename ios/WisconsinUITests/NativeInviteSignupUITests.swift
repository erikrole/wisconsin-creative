import XCTest

@MainActor
final class NativeInviteSignupUITests: XCTestCase {
    private let email = "alex.onboarding@wisc.edu"

    private func launch(_ mode: String, linked: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "login"
        app.launchEnvironment["GT_FIXTURE_INVITE"] = mode
        if linked {
            app.launchEnvironment["GT_FIXTURE_INVITE_URL"] = "https://wisconsincreative.com/login?email=alex.onboarding%40wisc.edu&invite=fixture-native-invite"
        }
        app.launchArguments += ["-WisconsinThemeChoice", "light", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    private func enterAddress(_ app: XCUIApplication) {
        let field = app.textFields["Email address"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        field.typeText(email)
        app.buttons["Continue"].tap()
    }

    private func fillRegistration(_ app: XCUIApplication) {
        let name = app.textFields["Full name"]
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        type("Alex Student", into: name)
        type("Student82A", into: app.secureTextFields["Password"])
        type("Student82A", into: app.secureTextFields["Confirm password"])
        XCTAssertTrue(app.buttons["Create account"].isEnabled, "Both password fields must receive the same input")
        app.swipeUp()
        XCTAssertTrue(app.buttons["Create account"].isHittable, "Account creation must stay reachable above the keyboard")
    }

    private func type(_ text: String, into field: XCUIElement) {
        field.tap()
        let focus = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hasKeyboardFocus == true"), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [focus], timeout: 5), .completed)
        // UIKit focus changes can finish after the tap animation. Slow typing
        // avoids sending the first key to the previous secure field on iOS 27.
        for character in text { field.typeText(String(character)) }
    }

    func testColdInviteCreatesAccountAndEntersNativeWelcome() {
        let app = launch("valid", linked: true)
        fillRegistration(app)
        attach(app, "native-valid-invite")
        app.buttons["Create account"].tap()
        XCTAssertTrue(app.staticTexts["Add your phone number"].waitForExistence(timeout: 15))
        attach(app, "native-signup-welcome")
    }

    func testMissingLinkResendsOnceAndChangeResetsRecovery() {
        let app = launch("required")
        enterAddress(app)
        XCTAssertTrue(app.staticTexts["Check your email"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.secureTextFields.count, 0)
        attach(app, "native-missing-link")
        app.buttons["Email me my invite link"].tap()
        XCTAssertTrue(app.buttons["Link sent"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Link sent"].isEnabled)
        attach(app, "native-link-sent")
        app.buttons["Change"].tap()
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Email me my invite link"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Email me my invite link"].isEnabled)
        XCUIDevice.shared.system.open(URL(string: "wisconsin://fixture-invite?email=alex.onboarding%40wisc.edu&invite=fixture-refreshed-invite")!)
        XCTAssertTrue(app.textFields["Full name"].waitForExistence(timeout: 10))
    }

    func testExpiredSubmitPreservesInputAndAcceptsTheRefreshedLink() {
        let app = launch("expired-on-submit", linked: true)
        fillRegistration(app)
        app.buttons["Create account"].tap()
        XCTAssertTrue(app.buttons["Email me my invite link"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.textFields["Full name"].value as? String, "Alex Student")
        XCTAssertFalse(app.buttons["Create account"].isEnabled)
        attach(app, "native-expired-link")
        app.buttons["Email me my invite link"].tap()
        XCTAssertTrue(app.buttons["Link sent"].waitForExistence(timeout: 10))
        XCUIDevice.shared.system.open(URL(string: "wisconsin://fixture-invite?email=alex.onboarding%40wisc.edu&invite=fixture-refreshed-invite")!)
        let create = app.buttons["Create account"]
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: create)
        let resumed = XCTWaiter.wait(for: [enabled], timeout: 10)
        XCTAssertEqual(resumed, .completed)
        XCTAssertEqual(app.textFields["Full name"].value as? String, "Alex Student")
        XCTAssertFalse(app.staticTexts["Open the link in your invite email to finish signing up."].exists)
        attach(app, "native-refreshed-link-preserves-input")
        create.tap()
        XCTAssertTrue(app.staticTexts["Add your phone number"].waitForExistence(timeout: 15))
    }

    func testUnavailableAndRateLimitedEmailRemainHonest() {
        var app = launch("unconfigured")
        enterAddress(app)
        app.buttons["Email me my invite link"].tap()
        XCTAssertTrue(app.buttons["Email unavailable"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Email unavailable"].isEnabled)
        XCTAssertFalse(app.buttons["Link sent"].exists)
        attach(app, "native-email-unavailable")
        app.terminate()
        app = launch("rate-limited")
        enterAddress(app)
        app.buttons["Email me my invite link"].tap()
        XCTAssertTrue(app.staticTexts["Too many requests. Wait a moment and try again."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Email me my invite link"].isEnabled)
        attach(app, "native-resend-rate-limited")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
