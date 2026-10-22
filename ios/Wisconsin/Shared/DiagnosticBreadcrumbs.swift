import Foundation

/// The last few things this run of the app did: screens, API calls, and
/// lifecycle changes. Kept on disk by process id, because MetricKit reports a
/// crash a day later from a new run, and the server pairs the two by `pid`.
///
/// Nothing the person typed is recorded. API calls keep their method, path
/// template, and status, never a query string or body.
///
/// Shared by the iPhone app, the kiosk, and the Mac menu bar app.
final class DiagnosticBreadcrumbs: @unchecked Sendable {
    static let shared = DiagnosticBreadcrumbs()

    enum Kind: String, Codable, Sendable {
        case nav, click, api, log, lifecycle
    }

    struct Crumb: Codable, Sendable {
        let at: String
        let type: Kind
        let message: String
        let data: [String: String]?
    }

    struct Session: Codable, Sendable {
        let pid: Int
        var screen: String?
        var breadcrumbs: [Crumb]
    }

    private static let capacity = 30
    private static let keptSessions = 5

    private let lock = NSLock()
    private let writeQueue = DispatchQueue(label: "com.erikrole.diagnostics.breadcrumbs", qos: .utility)
    private var session: Session
    private var writePending = false
    private let directory: URL?

    private init() {
        session = Session(pid: Int(ProcessInfo.processInfo.processIdentifier), screen: nil, breadcrumbs: [])
        directory = Self.makeDirectory()
        writeQueue.async { [directory] in
            Self.pruneSessions(in: directory)
        }
    }

    /// Records one action. Cheap enough to call from any thread.
    func record(_ type: Kind, _ message: String, data: [String: String]? = nil) {
        let crumb = Crumb(
            at: Date.now.ISO8601Format(),
            type: type,
            message: String(message.prefix(200)),
            data: data
        )
        lock.lock()
        session.breadcrumbs.append(crumb)
        if session.breadcrumbs.count > Self.capacity {
            session.breadcrumbs.removeFirst(session.breadcrumbs.count - Self.capacity)
        }
        lock.unlock()
        scheduleWrite()
    }

    /// The screen the person is on. Repeats are ignored.
    func setScreen(_ name: String) {
        lock.lock()
        let changed = session.screen != name
        if changed { session.screen = name }
        lock.unlock()
        if changed { record(.nav, name) }
    }

    /// This run, for a problem report sent from inside the app.
    var current: Session {
        lock.lock()
        defer { lock.unlock() }
        return session
    }

    /// The last few runs, this one included, for a MetricKit upload.
    func recentSessions() -> [Session] {
        var sessions = Self.storedSessions(in: directory)
        let now = current
        sessions.removeAll { $0.pid == now.pid }
        return Array(([now] + sessions).prefix(Self.keptSessions))
    }

    /// `/api/bookings/clx0abc…/extend?x=1` → `/api/bookings/[id]/extend`.
    static func pathTemplate(_ path: String) -> String {
        let bare = path.split(separator: "?", maxSplits: 1).first.map(String.init) ?? path
        return bare
            .split(separator: "/", omittingEmptySubsequences: false)
            .map { segment -> String in
                let value = String(segment)
                let looksLikeId = value.count >= 16 && value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
                    && value.contains(where: \.isNumber)
                let isNumber = !value.isEmpty && value.allSatisfy(\.isNumber)
                return looksLikeId || isNumber ? "[id]" : value
            }
            .joined(separator: "/")
    }

    // MARK: - Storage

    /// Coalesces bursts of actions into one small write.
    private func scheduleWrite() {
        lock.lock()
        let alreadyPending = writePending
        writePending = true
        lock.unlock()
        guard !alreadyPending, let directory else { return }
        writeQueue.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.writePending = false
            let snapshot = self.session
            self.lock.unlock()
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: Self.fileURL(for: snapshot.pid, in: directory), options: [.atomic])
        }
    }

    private static func makeDirectory() -> URL? {
        let manager = FileManager.default
        guard let support = try? manager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else { return nil }
        var directory = support.appendingPathComponent("DiagnosticBreadcrumbs", isDirectory: true)
        guard (try? manager.createDirectory(at: directory, withIntermediateDirectories: true)) != nil else { return nil }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)
        return directory
    }

    private static func fileURL(for pid: Int, in directory: URL) -> URL {
        directory.appendingPathComponent("session-\(pid).json", isDirectory: false)
    }

    private static func sessionFiles(in directory: URL?) -> [URL] {
        guard let directory,
              let files = try? FileManager.default.contentsOfDirectory(
                  at: directory,
                  includingPropertiesForKeys: [.contentModificationDateKey],
                  options: [.skipsHiddenFiles]
              ) else { return [] }
        func modified(_ url: URL) -> Date {
            (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
        }
        return files
            .filter { $0.lastPathComponent.hasPrefix("session-") }
            .sorted { modified($0) > modified($1) }
    }

    private static func storedSessions(in directory: URL?) -> [Session] {
        sessionFiles(in: directory).prefix(keptSessions).compactMap { url in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(Session.self, from: data)
        }
    }

    private static func pruneSessions(in directory: URL?) {
        for url in sessionFiles(in: directory).dropFirst(keptSessions) {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

/// The JSON body every Apple app sends to a diagnostics endpoint.
enum DiagnosticUpload {
    static func body(platform: String, payload: Data) -> Data? {
        guard let json = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] else { return nil }
        let sessions = DiagnosticBreadcrumbs.shared.recentSessions().compactMap { session -> [String: Any]? in
            guard let data = try? JSONEncoder().encode(session) else { return nil }
            return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        }
        guard let body = try? JSONSerialization.data(withJSONObject: [
            "platform": platform,
            "payload": json,
            "sessions": sessions,
        ]), body.count <= 2_000_000 else { return nil }
        return body
    }
}
