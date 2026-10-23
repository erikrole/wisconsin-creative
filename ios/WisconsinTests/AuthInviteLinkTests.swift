import XCTest
@testable import Wisconsin

final class AuthInviteLinkTests: XCTestCase {
    func testAcceptsTheEmailedHTTPSLinkAndNormalizesOnlyTheAddress() throws {
        let link = try XCTUnwrap(AuthInviteLink.parse(URL(string: "https://wisconsincreative.com/login?email=Alex%2BStudent%40WISC.EDU&invite=raw%2Btoken%2Fvalue&returnTo=https%3A%2F%2Fevil.example")!))
        XCTAssertEqual(link.email, "alex+student@wisc.edu")
        XCTAssertEqual(link.token, "raw+token/value")
    }

    func testRejectsUntrustedOrAmbiguousInboxProof() {
        let urls = [
            "http://wisconsincreative.com/login?email=alex@wisc.edu&invite=token",
            "https://wisconsincreative.com.evil.example/login?email=alex@wisc.edu&invite=token",
            "https://evil.example/login?email=alex@wisc.edu&invite=token",
            "https://user:pass@wisconsincreative.com/login?email=alex@wisc.edu&invite=token",
            "https://wisconsincreative.com:443/login?email=alex@wisc.edu&invite=token",
            "https://wisconsincreative.com/other?email=alex@wisc.edu&invite=token",
            "wisconsin://login?email=alex@wisc.edu&invite=token",
            "https://wisconsincreative.com/login?email=alex@wisc.edu",
            "https://wisconsincreative.com/login?invite=token",
            "https://wisconsincreative.com/login?email=invalid&invite=token",
            "https://wisconsincreative.com/login?email=alex@wisc.edu&invite=token&web=1",
            "https://wisconsincreative.com/login?email=alex@wisc.edu&invite=",
            "https://wisconsincreative.com/login?email=alex@wisc.edu&email=other@wisc.edu&invite=token",
            "https://wisconsincreative.com/login?email=alex@wisc.edu&invite=one&invite=two",
            "https://wisconsincreative.com/login?email=alex@wisc.edu&invite=token#another",
            "https://wisconsincreative.com/login?email=alex@wisc.edu&invite=" + String(repeating: "x", count: 129)
        ]
        for raw in urls { XCTAssertNil(AuthInviteLink.parse(URL(string: raw)!), raw) }
    }

    @MainActor
    func testAnIncomingInviteNeverSignsOutAnExistingAccount() throws {
        let session = SessionStore()
        session.currentUser = OnboardingFixtureAPI.user
        let originalID = session.currentUser?.id
        XCTAssertTrue(session.receiveInviteURL(URL(string: "https://wisconsincreative.com/login?email=another.student%40wisc.edu&invite=fresh-token")!))
        XCTAssertEqual(session.currentUser?.id, originalID)
        XCTAssertEqual(session.pendingInvite?.email, "another.student@wisc.edu")
        session.clearPendingInvite()
        XCTAssertNil(session.pendingInvite)
        XCTAssertEqual(session.currentUser?.id, originalID)
    }

    func testDiscoveryRequiresCurrentProofAndToleratesTheOlderBackend() throws {
        func decode(_ json: String) throws -> AuthDiscoveryResult {
            try JSONDecoder().decode(AuthDiscoveryResult.self, from: Data(json.utf8))
        }
        XCTAssertTrue(try decode(#"{"flow":"onboarding","inviteLink":"required"}"#).needsInviteLink(token: "stale"))
        XCTAssertTrue(try decode(#"{"flow":"onboarding","inviteLink":"valid"}"#).needsInviteLink(token: nil))
        XCTAssertFalse(try decode(#"{"flow":"onboarding","inviteLink":"valid"}"#).needsInviteLink(token: "current"))
        XCTAssertTrue(try decode(#"{"flow":"onboarding","inviteLink":"future-unknown-status"}"#).needsInviteLink(token: "current"))
        XCTAssertFalse(try decode(#"{"flow":"password"}"#).needsInviteLink(token: nil))
        XCTAssertFalse(try decode(#"{"flow":"onboarding"}"#).needsInviteLink(token: nil))
    }
}
