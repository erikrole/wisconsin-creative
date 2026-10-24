import Photos
import UIKit
import XCTest

/// Live acceptance driver. No fixture scenario or production credentials.
@MainActor
final class OnboardingLiveUITests: XCTestCase {
    private struct Configuration: Decodable {
        let origin: String
        let token: String
        let email: String
        let password: String
    }

    private func configuration() throws -> Configuration {
        let raw = try XCTUnwrap(ProcessInfo.processInfo.environment["WC_HANDOFF_CONFIG"])
        let config = try JSONDecoder().decode(Configuration.self, from: Data(raw.utf8))
        let url = try XCTUnwrap(URL(string: config.origin))
        XCTAssertEqual(url.scheme, "https")
        XCTAssertTrue(url.host?.hasSuffix(".vercel.app") == true)
        XCTAssertFalse(config.token.isEmpty)
        return config
    }

    private func launch(_ config: Configuration) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["WC_PREVIEW_ORIGIN"] = config.origin
        app.launchEnvironment["WC_PREVIEW_ACCESS_TOKEN"] = config.token
        app.launch()
        return app
    }

    private func login(_ app: XCUIApplication, _ config: Configuration) {
        let email = app.textFields["Email address"]
        XCTAssertTrue(email.waitForExistence(timeout: 30), "Expected the real sign-in form")
        email.tap()
        email.typeText(config.email)
        app.buttons["Continue"].tap()
        let password = app.secureTextFields["Password"]
        XCTAssertTrue(password.waitForExistence(timeout: 30))
        password.tap()
        password.typeText(config.password)
        app.buttons["Sign in"].tap()
    }

    func testWebToNativeResumesPartialWiscardAndFinishesWithoutPhoto() throws {
        let config = try configuration()
        let app = launch(config)
        login(app, config)
        XCTAssertTrue(app.staticTexts["Link your Wiscard"].waitForExistence(timeout: 40))
        XCTAssertEqual(app.textFields.element(boundBy: 0).value as? String, "1234567890")
        app.buttons["Back"].tap()
        XCTAssertTrue(app.staticTexts["Add your phone number"].waitForExistence(timeout: 5))
        XCTAssertTrue((app.textFields.firstMatch.value as? String)?.contains("555") == true)
        app.buttons["Continue"].tap()
        let issue = app.textFields.element(boundBy: 1)
        issue.tap()
        issue.typeText("1")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your student details"].waitForExistence(timeout: 20))
        choose(app, field: "Year", value: "Freshman")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your apparel sizes"].waitForExistence(timeout: 20))
        choose(app, field: "Clothing sizing", value: "Men’s")
        choose(app, field: "Top size", value: "M")
        choose(app, field: "US shoe sizing", value: "Women’s")
        choose(app, field: "Shoe size", value: "8")
        attach(app, "physical-web-to-native-apparel")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add a profile photo"].waitForExistence(timeout: 20))
        app.buttons["Finish"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "You’re all set,")).firstMatch.waitForExistence(timeout: 30))
        attach(app, "physical-photo-skipped-finish")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 30))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.staticTexts["Add a profile photo"].exists)
    }

    func testNativeToWebSavesAndStopsAtApparel() throws {
        let config = try configuration()
        let app = launch(config)
        signOut(app)
        login(app, config)
        XCTAssertTrue(app.staticTexts["Add your phone number"].waitForExistence(timeout: 40))
        app.textFields.firstMatch.tap()
        app.textFields.firstMatch.typeText("+1 (608) 555-0142")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Link your Wiscard"].waitForExistence(timeout: 20))
        app.textFields.element(boundBy: 0).tap()
        app.textFields.element(boundBy: 0).typeText("2345678901")
        app.textFields.element(boundBy: 1).tap()
        app.textFields.element(boundBy: 1).typeText("2")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your student details"].waitForExistence(timeout: 20))
        choose(app, field: "Year", value: "Sophomore")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Add your apparel sizes"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Saved to your account"].waitForExistence(timeout: 20))
        attach(app, "physical-native-to-web-paused")
        app.terminate()
    }

    func testWebFinishResumesOnNativeAndPhotosPickerUploadsSample() throws {
        let app = launch(try configuration())
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 40))
        XCTAssertFalse(app.staticTexts["Add your apparel sizes"].exists)
        app.buttons["Profile"].tap()
        XCTAssertTrue(app.buttons["Add photo"].waitForExistence(timeout: 25))
        try addTechnicalPhoto()
        app.activate()
        app.buttons["Add photo"].tap()
        let crop = try selectTechnicalPhoto(app)
        crop.pinch(withScale: 1.3, velocity: 1)
        crop.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: crop.coordinate(withNormalizedOffset: CGVector(dx: 0.58, dy: 0.54)))
        attach(app, "physical-photos-picker-crop")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Change photo"].waitForExistence(timeout: 40))
        XCTAssertFalse(app.navigationBars["Crop photo"].exists)
        attach(app, "physical-photo-uploaded")
    }

    func testPhysicalPhotosPickerSelectsAndDecodesOnlyTheTechnicalSample() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["GT_PERFORMANCE_SCENARIO"] = "onboarding"
        app.launchEnvironment["GT_FIXTURE_WELCOME_STEP"] = "APPAREL"
        app.launch()
        XCTAssertTrue(app.staticTexts["Add your apparel sizes"].waitForExistence(timeout: 20))
        choose(app, field: "Clothing sizing", value: "Men’s")
        choose(app, field: "Top size", value: "M")
        choose(app, field: "US shoe sizing", value: "Men’s")
        choose(app, field: "Shoe size", value: "10")
        advance(app)
        XCTAssertTrue(app.staticTexts["Add a profile photo"].waitForExistence(timeout: 20))
        try addTechnicalPhoto()
        app.activate()
        app.buttons["Choose photo"].tap()
        _ = try selectTechnicalPhoto(app)
        attach(app, "physical-sample-selected-and-decoded")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Add a profile photo"].waitForExistence(timeout: 10))
    }

    private func selectTechnicalPhoto(_ app: XCUIApplication) throws -> XCUIElement {
        // PhotosPicker owns the library UI. Never attach its personal-photo grid.
        let picker = app.scrollViews.firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 15))
        let image = app.images.matching(NSPredicate(format: "label CONTAINS[c] %@", "Photo")).firstMatch
        XCTAssertTrue(image.waitForExistence(timeout: 15), "Expected a PhotosPicker image cell")
        image.tap()
        let crop = app.descendants(matching: .any).matching(identifier: "profile-photo-crop").firstMatch
        XCTAssertTrue(crop.waitForExistence(timeout: 20))
        // Gate the upload on the synthetic image's two colors. If picker order
        // differs, stop before Save rather than uploading an unrelated photo.
        try assertTechnicalPhoto(crop.screenshot().image)
        XCTAssertEqual(app.sliders.count, 0)
        return crop
    }

    private func addTechnicalPhoto() throws {
        if UserDefaults.standard.bool(forKey: "WCAddedTechnicalPhoto20261022") { return }
        if PHPhotoLibrary.authorizationStatus(for: .addOnly) != .authorized {
            let permission = expectation(description: "Add-only photo permission")
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { @Sendable _ in permission.fulfill() }
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let alert = springboard.alerts.firstMatch
            if alert.waitForExistence(timeout: 5) {
                let allow = alert.buttons["Allow"]
                XCTAssertTrue(allow.exists, "Expected the add-only Photos permission")
                allow.tap()
            }
            wait(for: [permission], timeout: 20)
        }
        XCTAssertEqual(PHPhotoLibrary.authorizationStatus(for: .addOnly), .authorized)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 800), format: format).image { ctx in
            UIColor(red: 0.98, green: 0.32, blue: 0.08, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 400, height: 800))
            UIColor(red: 0.04, green: 0.69, blue: 0.68, alpha: 1).setFill()
            ctx.fill(CGRect(x: 400, y: 0, width: 400, height: 800))
            let title = "WC PHOTO TEST · OCT 22"
            title.draw(at: CGPoint(x: 125, y: 65), withAttributes: [.font: UIFont.boldSystemFont(ofSize: 32), .foregroundColor: UIColor.white])
        }
        let saved = expectation(description: "Synthetic sample added")
        PHPhotoLibrary.shared().performChanges({ @Sendable in PHAssetChangeRequest.creationRequestForAsset(from: image) }) { @Sendable success, _ in
            XCTAssertTrue(success)
            saved.fulfill()
        }
        wait(for: [saved], timeout: 20)
        UserDefaults.standard.set(true, forKey: "WCAddedTechnicalPhoto20261022")
    }

    private func assertTechnicalPhoto(_ image: UIImage) throws {
        let cg = try XCTUnwrap(image.cgImage)
        var pixels = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = try XCTUnwrap(CGContext(data: &pixels, width: cg.width, height: cg.height, bitsPerComponent: 8, bytesPerRow: cg.width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        let left = (cg.height / 2 * cg.width + cg.width / 4) * 4
        let right = (cg.height / 2 * cg.width + cg.width * 3 / 4) * 4
        XCTAssertGreaterThan(pixels[left], 180, "Stop before uploading: expected the orange test image")
        XCTAssertLessThan(pixels[left + 2], 70)
        XCTAssertLessThan(pixels[right], 70, "Stop before uploading: expected the teal test image")
        XCTAssertGreaterThan(pixels[right + 1], 120)
        XCTAssertGreaterThan(pixels[right + 2], 120)
    }

    private func signOut(_ app: XCUIApplication) {
        if app.textFields["Email address"].waitForExistence(timeout: 3) { return }
        if app.buttons["Sign out"].exists { app.buttons["Sign out"].tap(); return }
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 25))
        app.buttons["Profile"].tap()
        app.buttons["Settings"].tap()
        for _ in 0..<8 {
            if app.buttons["Sign Out"].isHittable { break }
            app.swipeUp()
        }
        app.buttons["Sign Out"].tap()
        let confirm = app.buttons.matching(identifier: "Sign Out")
        XCTAssertGreaterThan(confirm.count, 0)
        confirm.element(boundBy: confirm.count - 1).tap()
    }

    private func choose(_ app: XCUIApplication, field: String, value: String) {
        app.buttons[field].tap()
        let option = app.buttons[value]
        for _ in 0..<6 {
            if option.exists && option.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        option.tap()
    }

    private func advance(_ app: XCUIApplication) {
        let status = app.staticTexts["onboarding-save-status"]
        if status.exists {
            let saved = NSPredicate(format: "label == %@", "Saved to your account")
            expectation(for: saved, evaluatedWith: status)
            waitForExpectations(timeout: 30)
        }
        let button = app.buttons["Continue"]
        expectation(for: NSPredicate(format: "enabled == true AND hittable == true"), evaluatedWith: button)
        waitForExpectations(timeout: 15)
        button.tap()
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
