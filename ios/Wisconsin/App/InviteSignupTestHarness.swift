#if DEBUG
import Foundation
import SwiftUI

/// Uses the production root, parser, discovery, registration and Welcome views.
/// The existing fixture URL protocol owns every API request in this scenario.
struct InviteSignupHarnessView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        RootView()
            .task {
                if let raw = ProcessInfo.processInfo.environment["GT_FIXTURE_INVITE_URL"],
                   let url = URL(string: raw) { session.receiveInviteURL(url) }
            }
    }
}

enum InviteSignupFixtureAPI {
    static var enabled: Bool {
        AppRuntimeMode.performanceScenario == .login && ProcessInfo.processInfo.environment["GT_FIXTURE_INVITE"] != nil
    }

    /// A local UI test can deliver a warm link through the app's registered
    /// scheme without consulting Apple's CDN or opening a real website.
    static func incomingLink(_ url: URL) -> URL? {
        guard enabled, url.scheme == "wisconsin", url.host == "fixture-invite",
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        var link = URLComponents(string: "https://wisconsincreative.com/login")!
        link.queryItems = query
        return link.url
    }

    static func response(for request: URLRequest) -> (status: Int, body: Data)? {
        guard enabled else { return nil }
        let mode = ProcessInfo.processInfo.environment["GT_FIXTURE_INVITE"]
        let input = requestBody(request).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let token = input["invite"] as? String ?? input["inviteToken"] as? String
        switch request.url?.path {
        case "/api/auth/discover":
            let valid = token == "fixture-native-invite" || token == "fixture-refreshed-invite"
            return json(200, ["flow": "onboarding", "inviteLink": valid ? "valid" : "required"])
        case "/api/auth/register":
            let valid = token == "fixture-refreshed-invite" || (token == "fixture-native-invite" && mode != "expired-on-submit")
            guard valid else {
                return json(403, ["error": "Open the link in your invite email to finish signing up.", "code": "INVITE_LINK_REQUIRED"])
            }
            return (201, try! JSONEncoder().encode(["user": OnboardingFixtureAPI.user]))
        case "/api/auth/invite/resend":
            if mode == "rate-limited" { return json(429, ["error": "Too many requests. Please try again later."]) }
            if mode == "malformed" { return json(200, ["message": "No confirmed delivery state"]) }
            return json(200, ["message": mode == "unconfigured" ? "Invite email is not configured yet. Contact Erik Role for your sign-up link." : "If that address has a pending invite, we sent the link.", "inviteEmailConfigured": mode != "unconfigured"])
        default:
            guard let body = OnboardingFixtureAPI.body(for: request) else { return nil }
            return (200, body)
        }
    }

    private static func json(_ status: Int, _ value: [String: Any]) -> (Int, Data) {
        (status, try! JSONSerialization.data(withJSONObject: value))
    }

    private static func requestBody(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
#endif
