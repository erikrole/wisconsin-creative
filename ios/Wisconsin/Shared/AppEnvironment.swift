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
#if DEBUG
        if let host = managedPreviewURL?.host { return host }
#endif
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

#if DEBUG
    /// Explicit launch configuration for an attested branch-owned preview.
    /// Neither the origin nor its short-lived access token is persisted.
    static func validatedPreviewURL(_ value: String?) -> URL? {
        guard let value, let parts = URLComponents(string: value),
              parts.scheme == "https", let host = parts.host,
              host.lowercased().hasSuffix(".vercel.app"),
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        return URL(string: "https://\(host.lowercased())")
    }

    static var managedPreviewURL: URL? {
        guard let origin = ProcessInfo.processInfo.environment["WC_PREVIEW_ORIGIN"] else { return nil }
        guard let url = validatedPreviewURL(origin) else {
            preconditionFailure("Invalid WC_PREVIEW_ORIGIN; refusing to route a managed-preview launch to production.")
        }
        return url
    }

    static func authorizeManagedPreview(_ request: inout URLRequest, origin: URL? = managedPreviewURL, token: String? = ProcessInfo.processInfo.environment["WC_PREVIEW_ACCESS_TOKEN"]) {
        guard let preview = validatedPreviewURL(origin?.absoluteString),
              request.url?.scheme == preview.scheme, request.url?.host == preview.host,
              (request.url?.port ?? 443) == 443,
              request.url?.user == nil, request.url?.password == nil,
              let token, !token.isEmpty else { return }
        request.setValue(token, forHTTPHeaderField: "x-vercel-trusted-oidc-idp-token")
    }
#endif

    static func apiSession(configuration: URLSessionConfiguration) -> URLSession {
#if DEBUG
        if managedPreviewURL != nil {
            return URLSession(configuration: configuration, delegate: ManagedPreviewRedirectGuard(), delegateQueue: nil)
        }
#endif
        return URLSession(configuration: configuration)
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

#if DEBUG
/// Preview credentials must never be forwarded through an HTTP redirect.
private final class ManagedPreviewRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
#endif
