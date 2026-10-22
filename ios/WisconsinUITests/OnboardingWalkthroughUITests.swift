import XCTest

@MainActor
final class OnboardingWalkthroughUITests: XCTestCase {
    func testCropKeepsAdjustmentsAvailableAfterAnUnconfirmedUpload() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "onboarding"
        app.launchEnvironment["GT_FIXTURE_AVATAR_CROP"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Crop photo"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.sliders.count, 0)
        let crop = app.descendants(matching: .any).matching(identifier: "profile-photo-crop").firstMatch
        XCTAssertTrue(crop.waitForExistence(timeout: 5))
        let originalZoom = crop.value as? String
        crop.pinch(withScale: 1.6, velocity: 1)
        XCTAssertNotEqual(crop.value as? String, originalZoom)
        let adjustedZoom = crop.value as? String
        crop.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.1, thenDragTo: crop.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.6)))
        attach(app, "avatar-crop")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["The photo could not be saved. Check your connection and try again."].waitForExistence(timeout: 10))
        XCTAssertEqual(crop.value as? String, adjustedZoom)
        XCTAssertEqual(app.sliders.count, 0)
        XCTAssertTrue(app.buttons["Save"].isEnabled)
        attach(app, "avatar-upload-retry")
    }

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
        XCTAssertFalse(app.buttons["Top size"].isEnabled)
        XCTAssertFalse(app.buttons["Shoe size"].isEnabled)
        choose(app, field: "Clothing sizing", value: "Women’s")
        choose(app, field: "Top size", value: "M")
        XCTAssertFalse(app.buttons["Shoe size"].isEnabled)
        choose(app, field: "US shoe sizing", value: "Men’s")
        choose(app, field: "Shoe size", value: "10")
        XCTAssertTrue(app.staticTexts["Women’s M · US Men’s 10"].exists)
        choose(app, field: "Clothing sizing", value: "Men’s")
        XCTAssertTrue(app.staticTexts["Men’s M · US Men’s 10"].exists)
        choose(app, field: "US shoe sizing", value: "Women’s")
        XCTAssertFalse(app.buttons["Continue"].isEnabled)
        choose(app, field: "Shoe size", value: "8")
        XCTAssertTrue(app.staticTexts["Men’s M · US Women’s 8"].exists)
        choose(app, field: "US shoe sizing", value: "Men’s")
        choose(app, field: "Shoe size", value: "10")
        attach(app, "required-apparel")
        let summary = app.staticTexts["Men’s M · US Men’s 10"]
        if !summary.isHittable { app.swipeUp() }
        XCTAssertTrue(summary.isHittable)
        attach(app, "apparel-confirmation")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add a profile photo"].waitForExistence(timeout: 10))
        attach(app, "optional-photo")
        app.buttons["Finish"].tap()
        XCTAssertTrue(app.staticTexts["You’re all set, Alex"].waitForExistence(timeout: 10))
        attach(app, "photo-skipped-setup-complete")
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
