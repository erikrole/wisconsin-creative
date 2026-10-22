import Foundation

/// When and how long `APIClient` waits before repeating a request.
///
/// Only idempotent reads are repeated. A POST or PATCH that timed out may have
/// reached the server, so repeating it could double-book gear or double-send a
/// blast. Venue wifi drops connections often, so a GET that fails with a
/// transient transport error or a 502/503/504/429 gets a short second chance
/// before the user sees an error.
struct RequestRetryPolicy: Sendable, Equatable {
    var maxAttempts: Int
    var baseDelay: TimeInterval
    var maxDelay: TimeInterval

    static let standard = RequestRetryPolicy(maxAttempts: 3, baseDelay: 0.4, maxDelay: 4)
    static let none = RequestRetryPolicy(maxAttempts: 1, baseDelay: 0, maxDelay: 0)

    /// Reads only. `nil` means URLRequest's default, which is GET.
    func allowsRetry(method: String?) -> Bool {
        switch (method ?? "GET").uppercased() {
        case "GET", "HEAD": true
        default: false
        }
    }

    func isRetryable(statusCode: Int) -> Bool {
        switch statusCode {
        case 429, 502, 503, 504: true
        default: false
        }
    }

    /// `notConnectedToInternet` is deliberately absent: offline is a state the
    /// UI already reports through `NetworkMonitor`, and waiting would only
    /// delay that message.
    func isRetryable(urlErrorCode code: URLError.Code) -> Bool {
        switch code {
        case .timedOut, .networkConnectionLost, .cannotConnectToHost, .dnsLookupFailed: true
        default: false
        }
    }

    /// The pause before attempt `attempt + 1`, or nil when no attempts remain
    /// or the server asked for a wait longer than we are willing to hold a
    /// spinner. `attempt` is 1 for the first request.
    func delay(afterAttempt attempt: Int, retryAfter: TimeInterval? = nil) -> TimeInterval? {
        guard attempt < maxAttempts else { return nil }
        let backoff = min(maxDelay, baseDelay * pow(2, Double(attempt - 1)))
        guard let retryAfter else { return backoff }
        guard retryAfter <= maxDelay else { return nil }
        return max(backoff, retryAfter)
    }

    /// `Retry-After` is either whole seconds or an HTTP date.
    static func retryAfterInterval(from header: String?, now: Date = Date()) -> TimeInterval? {
        guard let header = header?.trimmingCharacters(in: .whitespaces), !header.isEmpty else { return nil }
        if let seconds = TimeInterval(header) {
            return max(0, seconds)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        guard let date = formatter.date(from: header) else { return nil }
        return max(0, date.timeIntervalSince(now))
    }
}
