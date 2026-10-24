import XCTest
import UIKit
@testable import Wisconsin

@MainActor
final class ProfileCompletionModelsTests: XCTestCase {
    func testFinishReceiptDecodesActualServerMillisecondsWithoutMakingPhotoRequired() throws {
        let json = #"{"profile":{"id":"s","name":"Student","role":"STUDENT","email":"s@wisc.edu","avatarUrl":null,"onboardingCompletedAt":"2026-10-22T15:10:11.123Z","profilePromptSnoozedUntil":null},"completion":{"requiredComplete":true,"requiresSetup":false,"onboardingComplete":true,"profileComplete":false,"shouldPrompt":false},"versions":{"SHOES":"abc"}}"#.data(using: .utf8)!
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        let result = try decoder.decode(ProfileCompletionResponse.self, from: json)
        XCTAssertNotNil(result.profile.onboardingCompletedAt)
        XCTAssertNil(result.profile.avatarUrl)
        XCTAssertTrue(result.completion.onboardingComplete)
        XCTAssertFalse(result.completion.requiresSetup)
        XCTAssertFalse(result.completion.shouldPrompt)
        XCTAssertEqual(result.versions["SHOES"], "abc")
    }

    func testPartialAutosaveEncodesNullsAndKeepsClothingAndShoesIndependent() throws {
        let draft = ProfileCompletionDraft()
        draft.topSizeFit = "MENS"
        let values = try XCTUnwrap(draft.validValues(for: .clothing))
        let update = ProfileCompletionUpdate.save(group: "CLOTHING", expectedVersion: "version", values: values)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(update)) as? [String: Any])
        let encodedValues = try XCTUnwrap(object["values"] as? [String: Any])
        XCTAssertEqual(object["step"] as? String, "SAVE")
        XCTAssertEqual(object["expectedVersion"] as? String, "version")
        XCTAssertEqual(encodedValues["topSizeFit"] as? String, "MENS")
        XCTAssertTrue(encodedValues["topSize"] is NSNull)
        XCTAssertTrue(draft.shoeSizeSystem.isEmpty)
        draft.personalPhone = "60855"
        XCTAssertNil(draft.validValues(for: .personalPhone))
        draft.personalPhone = "+1 (608) 555-0123"
        XCTAssertEqual(draft.validValues(for: .personalPhone)?["personalPhone"], .string("(608) 555-0123"))
    }

    func testAvatarCropProducesUploadSizedSquareJPEG() async throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 1200)).image { context in
            for (index, color) in [UIColor.red, .green, .blue, .yellow].enumerated() {
                color.setFill()
                context.fill(CGRect(x: CGFloat(index) * 200, y: 0, width: 200, height: 1200))
            }
        }
        // Move the image to the right edge: the chosen region is red/green,
        // while a wrongly centered crop would be green/blue.
        let encoded = await NativeImageProcessor.croppedJPEGData(image: image, cropDiameter: 280, zoom: 2, offset: CGSize(width: 140, height: 0))
        let bytes = try XCTUnwrap(encoded)
        let output = try XCTUnwrap(UIImage(data: bytes)?.cgImage)
        XCTAssertEqual(output.width, 512)
        XCTAssertEqual(output.height, 512)
        XCTAssertLessThan(bytes.count, 500_000)
        func pixel(at x: Int) throws -> [UInt8] {
            let sample = try XCTUnwrap(output.cropping(to: CGRect(x: x, y: 256, width: 1, height: 1)))
            var rgba = [UInt8](repeating: 0, count: 4)
            let context = try XCTUnwrap(CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(sample, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            return rgba
        }
        let left = try pixel(at: 64), right = try pixel(at: 448)
        XCTAssertGreaterThan(left[0], 220)
        XCTAssertLessThan(left[1], 30)
        XCTAssertLessThan(left[2], 30)
        XCTAssertGreaterThan(right[1], 220)
        XCTAssertLessThan(right[0], 30)
        XCTAssertLessThan(right[2], 30)
    }
    func testRoleAwareVisibleSteps() {
        XCTAssertEqual(ProfileCompletionStep.visibleSteps(for: "COLLABORATOR"), [.photo])
        // Students have no athletics email to confirm, so the email step drops off
        // entirely (b9f71a00). Staff and admins keep it.
        XCTAssertEqual(ProfileCompletionStep.visibleSteps(for: "STUDENT"), [.phones, .wiscard, .student, .apparel, .photo])
        XCTAssertEqual(ProfileCompletionStep.visibleSteps(for: "STAFF"), [.email, .phones, .wiscard, .apparel, .photo])
    }

    func testCompletionPayloadToleratesMissingAdditiveFields() throws {
        let json = """
        {
          "profile": {
            "id": "user-1",
            "name": "Bucky Badger",
            "role": "STUDENT",
            "email": "bucky@wisc.edu"
          },
          "completion": {
            "profileComplete": false,
            "shouldPrompt": true,
            "firstIncompleteStep": "EMAIL"
          }
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let response = try decoder.decode(ProfileCompletionResponse.self, from: json)

        XCTAssertFalse(response.profile.workPhoneNotApplicable)
        XCTAssertEqual(response.completion.firstIncompleteStep, .email)
        XCTAssertEqual(response.completion.missingFields, [])
        XCTAssertEqual(response.completion.completedCount, 0)
    }

    func testStudentPhoneUpdateOmitsWorkPhoneFields() throws {
        let data = try JSONEncoder().encode(
            ProfileCompletionUpdate.phones(
                personalPhone: "(608) 555-1212",
                workPhone: nil,
                workPhoneNotApplicable: nil
            )
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["step"] as? String, "PHONES")
        XCTAssertEqual(object["personalPhone"] as? String, "(608) 555-1212")
        XCTAssertNil(object["workPhone"])
        XCTAssertNil(object["workPhoneNotApplicable"])
    }

    func testWiscardDraftRequiresTenCardDigitsAndOneIssueDigit() throws {
        let profile = try profile(role: "STUDENT")
        let draft = ProfileCompletionDraft(profile: profile)

        draft.wiscardCardNumber = "123456789"
        draft.wiscardIssueCode = "1"
        XCTAssertFalse(draft.canContinue(.wiscard, profile: profile))

        draft.wiscardCardNumber = "1234567890"
        draft.wiscardIssueCode = ""
        XCTAssertFalse(draft.canContinue(.wiscard, profile: profile))

        draft.wiscardIssueCode = "1"
        XCTAssertTrue(draft.canContinue(.wiscard, profile: profile))
    }

    func testAthleticsEmailRequiresLocalPartAndExactDomain() throws {
        let profile = try profile(role: "STAFF")
        let draft = ProfileCompletionDraft(profile: profile)

        draft.athleticsEmail = "@athletics.wisc.edu"
        XCTAssertFalse(draft.canContinue(.email, profile: profile))

        draft.athleticsEmail = "bucky@athletics.wisc.edu.example.com"
        XCTAssertFalse(draft.canContinue(.email, profile: profile))

        draft.athleticsEmail = "bucky@athletics.wisc.edu"
        XCTAssertTrue(draft.canContinue(.email, profile: profile))
    }

    func testPhoneAutofillPreservesTheNumberWithUSCountryCode() throws {
        let profile = try profile(role: "STUDENT")
        let draft = ProfileCompletionDraft(profile: profile)
        for input in ["+1 (608) 555-0123", "16085550123", "6085550123"] {
            draft.personalPhone = input
            XCTAssertTrue(draft.canContinue(.phones, profile: profile))
            let update = try XCTUnwrap(draft.update(for: .phones, profile: profile))
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(update)) as? [String: Any])
            XCTAssertEqual(object["personalPhone"] as? String, "(608) 555-0123")
        }
    }

    func testRequiredSetupCannotBeBypassedBeforeItsStatusLoads() {
        let user = CurrentUser(id: "new-student-requires-setup", name: "New Student", email: "new@wisc.edu", role: "STUDENT", avatarUrl: nil, onboardingRequired: true)
        let store = ProfileCompletionStore()
        XCTAssertEqual(store.route(for: user, optimisticSession: true), .welcome)
        store.continueForSession(for: user.id)
        XCTAssertEqual(store.route(for: user, optimisticSession: true), .welcome)
    }

    private func profile(role: String) throws -> ProfileCompletionProfile {
        let json = """
        {"id":"user-1","name":"Bucky Badger","role":"\(role)","email":"bucky@wisc.edu"}
        """.data(using: .utf8)!
        return try JSONDecoder().decode(ProfileCompletionProfile.self, from: json)
    }
}
