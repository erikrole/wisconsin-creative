import Foundation

enum AppEnvironment {
    static let canonicalHost = "wisconsincreative.com"
    static let legacyHost = "gear.erikrole.com"
    static let appReviewHost = "review.wisconsincreative.com"
    static let appReviewEmail = "appreview@wisconsincreative.com"
    static let appReviewTestEmails: Set<String> = [
        appReviewEmail,
        "jordan.lee.demo@wisc.edu",
        "alex.rivera.demo@wisc.edu",
    ]
    static let baseURL = URL(string: "https://\(canonicalHost)")!
    static let origin = baseURL.absoluteString

    private static let activeAPIHostKey = "WisconsinActiveAPIHost"
    private static let allowedAPIHosts: Set<String> = [canonicalHost, appReviewHost]

    static var activeAPIHost: String {
        guard let storedHost = UserDefaults.standard.string(forKey: activeAPIHostKey),
              allowedAPIHosts.contains(storedHost) else {
            UserDefaults.standard.removeObject(forKey: activeAPIHostKey)
            return canonicalHost
        }
        return storedHost
    }

    static var activeAPIBaseURL: URL {
        URL(string: "https://\(activeAPIHost)") ?? baseURL
    }

    static var activeAPIOrigin: String {
        activeAPIBaseURL.absoluteString
    }

    static func apiHost(forLoginEmail email: String) -> String {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return appReviewTestEmails.contains(normalized) ? appReviewHost : canonicalHost
    }

    static func setActiveAPIHost(_ host: String) {
        guard allowedAPIHosts.contains(host) else {
            resetActiveAPIHost()
            return
        }
        if host == canonicalHost {
            UserDefaults.standard.removeObject(forKey: activeAPIHostKey)
        } else {
            UserDefaults.standard.set(host, forKey: activeAPIHostKey)
        }
    }

    static func resetActiveAPIHost() {
        UserDefaults.standard.removeObject(forKey: activeAPIHostKey)
    }

    static func url(path: String) -> URL {
        baseURL.appendingPathComponent(path)
    }

    static func webcalURL(path: String) -> URL? {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        // The host that issued the token serves its feed; the App Review host
        // may not share the canonical host's data.
        return URL(string: "webcal://\(activeAPIHost)\(normalizedPath)")
    }
}
