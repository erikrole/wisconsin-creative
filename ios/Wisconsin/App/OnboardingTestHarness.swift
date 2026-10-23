#if DEBUG
import Foundation
import SwiftUI
import UIKit

/// Presentation and interaction fixtures. They never create a server account.
struct OnboardingHarnessView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ProfileCompletionStore.self) private var completion
    @State private var seeded = false

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            if seeded {
                if ProcessInfo.processInfo.environment["GT_FIXTURE_AVATAR_CROP"] == "1" {
                    ProfilePhotoCropView(image: Self.cropImage, profileName: "Alex Rivera", onSave: { _ in false })
                } else if completion.route(for: OnboardingFixtureAPI.user, optimisticSession: false) == .app {
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

    private static var cropImage: UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 800, height: 1000)).image { context in
            UIColor.systemTeal.setFill(); context.fill(CGRect(x: 0, y: 0, width: 800, height: 1000))
            UIColor.systemOrange.setFill(); context.fill(CGRect(x: 200, y: 200, width: 400, height: 600))
        }
    }
}

enum OnboardingFixtureAPI {
    static let user = CurrentUser(id: "onboarding-student-fixture", name: "Alex Rivera", email: "alex.onboarding@wisc.edu", role: "STUDENT", avatarUrl: nil, forcePasswordChange: false, onboardingRequired: true)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var profile: [String: Any] = initialProfile
    nonisolated(unsafe) private static var revisions: [String: Int] = [:]

    private static var initialProfile: [String: Any] {
        var profile: [String: Any] = ["id": user.id, "name": user.name, "email": user.email, "role": user.role, "workPhoneNotApplicable": false, "onboardingRequired": true]
        let steps = ["PHONES", "WISCARD", "STUDENT", "APPAREL", "PHOTO"]
        let index = steps.firstIndex(of: ProcessInfo.processInfo.environment["GT_FIXTURE_WELCOME_STEP"] ?? "PHONES") ?? 0
        if index > 0 { profile["personalPhone"] = "(608) 555-0123" }
        if index > 1 { profile.merge(["wiscardCardNumber": "1234567890", "wiscardIssueCode": "1"]) { _, next in next } }
        if index > 2 { profile.merge(["studentYearOverride": "FRESHMAN", "graduationTerm": "SPRING", "gradYear": 2030]) { _, next in next } }
        if index > 3 { profile.merge(["topSizeFit": "MENS", "topSize": "M", "shoeSizeSystem": "US_MENS", "shoeSize": "10"]) { _, next in next } }
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
                    if fields["step"] as? String == "SAVE", let values = fields["values"] as? [String: Any], let group = fields["group"] as? String {
                        for (key, value) in values { profile[key] = value is NSNull ? nil : value }
                        revisions[group, default: 0] += 1
                    } else if fields["step"] as? String == "FINISH" {
                        profile["onboardingRequired"] = false
                        profile["onboardingCompletedAt"] = "2026-10-22T15:00:00.123Z"
                    } else if fields["step"] as? String == "SNOOZE" {
                        profile["profilePromptSnoozedUntil"] = "2099-10-23T12:00:00Z"
                    } else {
                        for (key, value) in fields where key != "step" { profile[key] = value }
                    }
                }
                let groups: [(String, [String])] = [("PHONES", ["personalPhone"]), ("WISCARD", ["wiscardCardNumber", "wiscardIssueCode"]), ("STUDENT", ["studentYearOverride"]), ("APPAREL", ["topSizeFit", "topSize", "shoeSizeSystem", "shoeSize"]), ("PHOTO", ["avatarUrl"])]
                let first = groups.first { $0.1.contains { profile[$0] == nil } }?.0
                let snoozed = profile["profilePromptSnoozedUntil"] != nil
                let details = [["email"], ["personalPhone"], ["wiscardCardNumber", "wiscardIssueCode"], ["studentYearOverride"], ["graduationTerm", "gradYear"], ["topSizeFit", "topSize"], ["shoeSizeSystem", "shoeSize"], ["avatarUrl"]]
                let requiredComplete = groups.dropLast().allSatisfy { $0.1.allSatisfy { profile[$0] != nil } }
                let finished = profile["onboardingCompletedAt"] != nil
                let needsSetup = profile["onboardingRequired"] as? Bool == true && !finished
                let versions = Dictionary(uniqueKeysWithValues: ["EMAIL", "PERSONAL_PHONE", "WORK_PHONE", "WISCARD", "STUDENT", "GRADUATION", "CLOTHING", "SHOES"].map { ($0, String(format: "%064x", revisions[$0, default: 0])) })
                let completion: [String: Any] = ["profileComplete": first == nil, "requiredComplete": requiredComplete, "requiresSetup": needsSetup, "onboardingComplete": finished, "shouldPrompt": needsSetup || (!finished && first != nil && !snoozed), "isSnoozed": snoozed, "firstIncompleteStep": first as Any? ?? NSNull(), "completedCount": details.filter { $0.allSatisfy { profile[$0] != nil } }.count, "totalCount": 8]
                return try? JSONSerialization.data(withJSONObject: ["data": ["profile": profile, "completion": completion, "versions": versions]])
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
