import Foundation

/// Owns one report read so a newer period, filter, or pull-to-refresh wins.
///
/// The view model copies `value`, `isLoading`, and `error` onto its own
/// observed properties. This type stays free of SwiftUI so the ownership rules
/// can be tested without a view.
@MainActor
final class ReportSession<Value: Sendable> {
    private(set) var value: Value?
    private(set) var isLoading = false
    private(set) var error: String?
    private var requests = LatestRequestGeneration()
    private var activeKey: String?
    private var loadedKey: String?
    private var loadedAt: Date?
    private let freshness: TimeInterval
    private let now: @MainActor () -> Date

    init(freshness: TimeInterval = 60, now: @escaping @MainActor () -> Date = { Date() }) {
        self.freshness = freshness
        self.now = now
    }

    /// Nil means the current value is still the one to show.
    func begin(key: String, force: Bool) -> UUID? {
        if !force,
           key == loadedKey,
           let loadedAt,
           now().timeIntervalSince(loadedAt) < freshness,
           value != nil {
            return nil
        }
        guard !isLoading || activeKey != key else { return nil }

        let token = requests.begin()
        let changingKey = loadedKey != key
        activeKey = key
        isLoading = true
        if changingKey {
            value = nil
            error = nil
            loadedKey = nil
            loadedAt = nil
        } else if force {
            error = nil
        }
        return token
    }

    @discardableResult
    func succeed(_ token: UUID, value: Value, incomplete: Bool) -> Bool {
        guard requests.owns(token) else { return false }
        if Task.isCancelled {
            isLoading = false
            return false
        }
        self.value = value
        error = nil
        loadedKey = activeKey
        loadedAt = incomplete ? nil : now()
        isLoading = false
        return true
    }

    @discardableResult
    func fail(_ token: UUID, message: String) -> Bool {
        guard requests.owns(token) else { return false }
        isLoading = false
        if Task.isCancelled { return false }
        error = message
        return true
    }

    /// Replaces a finished page without opening a new request. Used when a
    /// report appends the next page of rows onto data it already showed.
    @discardableResult
    func replace(_ value: Value, key: String) -> Bool {
        guard loadedKey == key, !isLoading else { return false }
        self.value = value
        return true
    }

    func note(_ message: String) {
        error = message
    }

    /// Drops the visible value immediately so a new period cannot keep wearing
    /// the previous period's numbers. Loading stays on until the replacement
    /// request settles, which avoids an empty flash.
    func discard() {
        requests.invalidate()
        value = nil
        error = nil
        loadedKey = nil
        loadedAt = nil
        activeKey = nil
        isLoading = true
    }
}
