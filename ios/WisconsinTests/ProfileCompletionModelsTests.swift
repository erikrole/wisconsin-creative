import XCTest
@testable import Wisconsin

@MainActor
final class ProfileCompletionModelsTests: XCTestCase {
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
