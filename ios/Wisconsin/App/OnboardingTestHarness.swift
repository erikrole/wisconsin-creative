#if DEBUG
import Foundation
import SwiftUI

/// Presentation and interaction fixtures. They never create a server account.
struct OnboardingHarnessView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ProfileCompletionStore.self) private var completion
    @State private var seeded = false

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            if seeded {
                if completion.route(for: OnboardingFixtureAPI.user, optimisticSession: false) == .app {
                    Text("Home fixture — setup can be resumed from Profile")
                } else {
                    ProfileCompletionWelcomeView()
                }
            }
        }
        .dynamicTypeSize(ProcessInfo.processInfo.environment["GT_FIXTURE_LARGE_TEXT"] == "1" ? .accessibility3 : .large)
        .onAppear {
            session.currentUser = OnboardingFixtureAPI.user
            seeded = true
        }
    }
}

enum OnboardingFixtureAPI {
    static let user = CurrentUser(id: "onboarding-student-fixture", name: "Alex Rivera", email: "alex.onboarding@wisc.edu", role: "STUDENT", avatarUrl: nil, forcePasswordChange: false, onboardingRequired: true)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var profile: [String: Any] = initialProfile

    private static var initialProfile: [String: Any] {
        var profile: [String: Any] = ["id": user.id, "name": user.name, "email": user.email, "role": user.role, "workPhoneNotApplicable": false, "onboardingRequired": true]
        let steps = ["PHONES", "WISCARD", "STUDENT", "APPAREL", "PHOTO"]
        let index = steps.firstIndex(of: ProcessInfo.processInfo.environment["GT_FIXTURE_WELCOME_STEP"] ?? "PHONES") ?? 0
        if index > 0 { profile["personalPhone"] = "(608) 555-0123" }
        if index > 1 { profile.merge(["wiscardCardNumber": "1234567890", "wiscardIssueCode": "1"]) { _, next in next } }
        if index > 2 { profile.merge(["studentYearOverride": "FRESHMAN", "graduationTerm": "SPRING", "gradYear": 2030]) { _, next in next } }
        if index > 3 { profile.merge(["topSizeFit": "UNISEX", "topSize": "M", "shoeSizeSystem": "MENS", "shoeSize": "10"]) { _, next in next } }

        return profile
    }

    static func body(for request: URLRequest) -> Data? {
        lock.withLock {
            switch request.url?.path {
            case "/api/me", "/api/auth/register":
                return try? JSONEncoder().encode(["user": user])
            case "/api/auth/discover":
                return Data(#"{"flow":"onboarding"}"#.utf8)
            case "/api/me/profile-completion":
                if request.httpMethod == "PATCH", let data = requestBody(request),
                   let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if fields["step"] as? String == "SNOOZE" {
                        profile["profilePromptSnoozedUntil"] = "2099-10-23T12:00:00Z"
                    } else {
                        for (key, value) in fields where key != "step" { profile[key] = value }
                    }
                }
                let groups: [(String, [String])] = [("PHONES", ["personalPhone"]), ("WISCARD", ["wiscardCardNumber", "wiscardIssueCode"]), ("STUDENT", ["studentYearOverride", "graduationTerm", "gradYear"]), ("APPAREL", ["topSizeFit", "topSize", "shoeSizeSystem", "shoeSize"]), ("PHOTO", ["avatarUrl"])]
                let first = groups.first { $0.1.contains { profile[$0] == nil } }?.0
                let snoozed = profile["profilePromptSnoozedUntil"] != nil
                let details = [["email"], ["personalPhone"], ["wiscardCardNumber", "wiscardIssueCode"], ["studentYearOverride"], ["graduationTerm", "gradYear"], ["topSizeFit", "topSize"], ["shoeSizeSystem", "shoeSize"], ["avatarUrl"]]
                let requiredComplete = groups.dropLast().allSatisfy { $0.1.allSatisfy { profile[$0] != nil } }
                let completion: [String: Any] = ["profileComplete": first == nil, "requiredComplete": requiredComplete, "requiresSetup": !requiredComplete, "shouldPrompt": !requiredComplete || (first != nil && !snoozed), "isSnoozed": snoozed, "firstIncompleteStep": first as Any? ?? NSNull(), "completedCount": details.filter { $0.allSatisfy { profile[$0] != nil } }.count, "totalCount": 8]
                return try? JSONSerialization.data(withJSONObject: ["data": ["profile": profile, "completion": completion]])
            case "/api/users/\(user.id)/avatar":
                profile["avatarUrl"] = "https://example.invalid/onboarding-fixture-photo.jpg"
                return try? JSONSerialization.data(withJSONObject: ["data": ["avatarUrl": profile["avatarUrl"]!]])
            default: return nil
            }
        }
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
