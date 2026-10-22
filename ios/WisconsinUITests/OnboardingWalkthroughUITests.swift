import XCTest

@MainActor
final class OnboardingWalkthroughUITests: XCTestCase {
    func testNewStudentMustSaveRequiredDetailsAndCanSkipOnlyPhoto() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "onboarding"
        app.launch()
        XCTAssertTrue(app.staticTexts["Add your phone number"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["Remind tomorrow"].exists)
        let phone = app.textFields.firstMatch
        phone.tap()
        phone.typeText("+1 (608) 555-0123")
        XCTAssertEqual(phone.value as? String, "+1 (608) 555-0123")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Link your Wiscard"].waitForExistence(timeout: 10))
        let card = app.textFields.element(boundBy: 0)
        card.tap()
        card.typeText("1234567890")
        let issue = app.textFields.element(boundBy: 1)
        issue.tap()
        issue.typeText("1")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your student details"].waitForExistence(timeout: 10))
        choose(app, field: "Year", value: "Freshman")
        choose(app, field: "Graduation term", value: "Spring")
        choose(app, field: "Graduation year", value: "2030")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your apparel sizes"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Skip"].exists)
        XCTAssertFalse(app.buttons["Remind tomorrow"].exists)
        app.buttons["Back"].tap()
        XCTAssertTrue(app.staticTexts["Add your student details"].waitForExistence(timeout: 10))
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your apparel sizes"].waitForExistence(timeout: 10))
        choose(app, field: "Clothing fit", value: "Unisex")
        choose(app, field: "Top size", value: "M")
        choose(app, field: "US shoe sizing", value: "Men’s")
        choose(app, field: "Shoe size", value: "10")
        attach(app, "required-apparel")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add a profile photo"].waitForExistence(timeout: 10))
        attach(app, "optional-photo")
        app.buttons["Finish"].tap()
        XCTAssertTrue(app.staticTexts["Home fixture — setup can be resumed from Profile"].waitForExistence(timeout: 10))
    }

    func testLargeTextApparelChoicesRemainReachable() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment = ["GT_PERFORMANCE_SCENARIO": "onboarding", "GT_FIXTURE_WELCOME_STEP": "APPAREL", "GT_FIXTURE_LARGE_TEXT": "1"]
        app.launchArguments += ["-WisconsinThemeChoice", "light"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Add your apparel sizes"].waitForExistence(timeout: 15))
        choose(app, field: "Clothing fit", value: "Unisex")
        for (field, value) in [("Top size", "M"), ("US shoe sizing", "Men’s"), ("Shoe size", "10")] {
            let control = app.buttons[field]
            for _ in 0..<6 {
                if control.exists && control.isHittable { break }
                app.swipeUp()
            }
            choose(app, field: field, value: value)
        }
        XCTAssertTrue(app.buttons["Continue"].isEnabled)
        attach(app, "large-text-apparel-reachable")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add a profile photo"].waitForExistence(timeout: 10))
    }

    private func choose(_ app: XCUIApplication, field: String, value: String) {
        app.buttons[field].tap()
        let option = app.buttons[value]
        for _ in 0..<6 {
            if option.exists && option.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(option.waitForExistence(timeout: 5), "Missing \(value) in \(field)")
        option.tap()
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
