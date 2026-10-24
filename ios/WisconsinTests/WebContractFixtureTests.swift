import XCTest
@testable import Wisconsin

/// Decodes the JSON the web routes really send, written by
/// `tests/ios-contract-fixtures.test.ts` from the real handlers. A field the
/// web renames, drops or retypes fails here instead of in the app.
final class WebContractFixtureTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("tests/fixtures/ios-contract/\(name).json")
        return try Data(contentsOf: url)
    }

    private func date(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso)
    }

    @MainActor
    func testNewStudentSession() async throws {
        let response = try await APIResponseDecoder.decode(MeResponse.self, from: fixture("me-new-student"))
        XCTAssertEqual(response.user.role, "STUDENT")
        XCTAssertEqual(response.user.staffingType, "ST")
        XCTAssertTrue(response.user.onboardingRequired)
        XCTAssertFalse(response.user.forcePasswordChange)
        XCTAssertEqual(response.user.capabilities, [])
        XCTAssertNotNil(response.user.accountCreatedAt)
        XCTAssertEqual(response.canViewUsageAnalytics, false)
    }

    @MainActor
    func testProfileCompletionBeforeSetup() async throws {
        let response = try await APIResponseDecoder.decode(
            DataWrapper<ProfileCompletionResponse>.self,
            from: fixture("profile-completion-new-student")
        ).data
        XCTAssertTrue(response.completion.requiresSetup)
        XCTAssertTrue(response.completion.shouldPrompt)
        XCTAssertEqual(response.completion.firstIncompleteStep, .phones)
        XCTAssertEqual(response.completion.completeByField["campusEmail"], true)
        XCTAssertNil(response.profile.onboardingCompletedAt)
        XCTAssertEqual(Set(response.versions.keys), Set(OnboardingGroup.allCases.map(\.rawValue)))
    }

    @MainActor
    func testProfileCompletionAfterSetupWithoutPhoto() async throws {
        let response = try await APIResponseDecoder.decode(
            DataWrapper<ProfileCompletionResponse>.self,
            from: fixture("profile-completion-set-up-student")
        ).data
        XCTAssertFalse(response.completion.requiresSetup)
        XCTAssertTrue(response.completion.isSnoozed)
        XCTAssertFalse(response.completion.shouldPrompt)
        XCTAssertEqual(response.completion.snoozedUntil, date("2026-10-27T15:00:00.000Z"))
        XCTAssertEqual(response.profile.onboardingCompletedAt, date("2026-10-26T14:30:00.000Z"))
        XCTAssertEqual(response.profile.gradYear, 2029)
    }

    @MainActor
    func testNotificationInbox() async throws {
        let response = try await APIResponseDecoder.decode(NotificationsResponse.self, from: fixture("notifications-inbox"))
        XCTAssertEqual(response.data.count, 2)
        XCTAssertEqual(response.unreadCount, 1)
        let unread = try XCTUnwrap(response.data.first)
        XCTAssertTrue(unread.isUnread)
        XCTAssertEqual(unread.sentAt, date("2026-10-26T14:55:00.123Z"))
        XCTAssertEqual(unread.payload?.assignmentId, "cm00000000000000000assign1")
        let read = try XCTUnwrap(response.data.last)
        XCTAssertFalse(read.isUnread)
        XCTAssertNil(read.payload)
        XCTAssertNil(read.sentAt)
    }

    func testOnboardingGateError() throws {
        let body = try JSONDecoder().decode(ServerErrorBody.self, from: fixture("error-onboarding-required"))
        XCTAssertEqual(body.code, "ONBOARDING_REQUIRED")
        XCTAssertFalse(body.error.isEmpty)
    }
}
