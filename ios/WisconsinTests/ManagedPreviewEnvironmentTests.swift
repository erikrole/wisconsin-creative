import XCTest
@testable import Wisconsin

#if DEBUG
final class ManagedPreviewEnvironmentTests: XCTestCase {
    func testManagedPreviewAcceptsOnlyAnHTTPSVercelOrigin() {
        XCTAssertEqual(AppEnvironment.validatedPreviewURL("https://wc-branch.vercel.app/")?.absoluteString, "https://wc-branch.vercel.app")
        for value in ["http://wc-branch.vercel.app", "https://wisconsincreative.com", "https://vercel.app.attacker.test", "https://user:password@wc-branch.vercel.app", "https://wc-branch.vercel.app:444", "https://wc-branch.vercel.app/api", "https://wc-branch.vercel.app?token=secret", "https://wc-branch.vercel.app#secret"] {
            XCTAssertNil(AppEnvironment.validatedPreviewURL(value), value)
        }
    }

    func testPreviewAccessTokenIsLimitedToTheExactHTTPSOrigin() {
        let preview = URL(string: "https://wc-branch.vercel.app")!
        for (url, expected) in [("https://wc-branch.vercel.app/api/me", "test-token"), ("https://wc-branch.vercel.app:443/api/me", "test-token"), ("https://wc-branch.vercel.app:444/api/me", nil), ("http://wc-branch.vercel.app/api/me", nil), ("https://another.vercel.app/api/me", nil), ("https://wisconsincreative.com/api/me", nil), ("https://user:password@wc-branch.vercel.app/api/me", nil)] as [(String, String?)] {
            var request = URLRequest(url: URL(string: url)!)
            AppEnvironment.authorizeManagedPreview(&request, origin: preview, token: "test-token")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-vercel-trusted-oidc-idp-token"), expected, url)
        }
    }
}
#endif
