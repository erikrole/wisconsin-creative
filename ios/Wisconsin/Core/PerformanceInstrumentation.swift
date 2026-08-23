import Foundation
import MetricKit
import os

enum AppRuntimeMode {
    enum PerformanceScenario: String {
        case launch
        case items
        case equipment
        /// Renders the guide reader against fixture Markdown, so the Resources
        /// article layout can be checked without a signed-in session.
        case guide
        /// The three Resources destinations, served canned API responses so the
        /// real views, view models, and decode paths can be rendered and
        /// screenshotted without a signed-in session.
        case resourcesGuides
        case resourcesUsers
        case resourcesLicenses
        /// Licenses with nothing claimed by the viewer and a code inside the
        /// 30-day expiry window -- the shape that exercises the Claim
        /// affordance and the conditional per-row expiry line.
        case resourcesLicensesOpen
        /// The Schedule list, served canned events and shifts so the real
        /// rows, headers, and control strip can be rendered and screenshotted
        /// without a signed-in session.
        case schedule
        /// The Trade Board as staff see it: claims owed a decision. Exercises
        /// the review queue, which only has rows to show once claims stop
        /// resolving themselves.
        case tradeBoardStaff
        /// The Trade Board as a student sees it: what they can claim, and what
        /// they have already claimed and are waiting on.
        case tradeBoardStudent
        /// The Home dashboard, served a canned payload so the action queue,
        /// its truncation, and the staff follow-up section can be rendered
        /// without a signed-in session.
        case home
        /// Home with nothing personal outstanding but a staff draft waiting --
        /// the shape where "You're all set" used to render directly above a
        /// populated Drafts card.
        case homeAllClear
        /// The native profile Scoreboard against a canned season payload, so
        /// its summary, filters, breakdowns, and event history can be reviewed
        /// without a signed-in session or live network.
        case scoreboard
        /// The current user's Profile against canned identity, badge, and shift
        /// payloads. The Scoreboard entry lives between Next Up and the badge
        /// shelf, and a row's treatment can only be judged beside its neighbours.
        case profile
        /// The signed-out entry screens. Neither needs a session or a fixture
        /// payload -- they are here so the two screens every user meets first
        /// can be captured without typing a credential into the app.
        case login
        case passwordSetup = "password-setup"
        /// Booking detail against a canned booking, plus its three sheets.
        /// Extend, Edit, and Cancel are local state opened by a tap, so each
        /// gets its own scenario rather than a tap script.
        case bookingDetail = "booking-detail"
        case bookingExtend = "booking-extend"
        case bookingEdit = "booking-edit"
        case bookingCancel = "booking-cancel"
        /// Item detail with its edit sheet open, against a canned asset.
        case itemEdit = "item-edit"
        /// The reservation composer with its QR cover open. A simulator has no
        /// camera, so this captures the permission priming a first-time user
        /// actually meets, not a live viewfinder.
        case createBookingScanner = "create-booking-scanner"
        /// Global search with a query already run, so the result destinations
        /// -- items, bookings, and people in one list -- are on screen.
        case search
        /// The real Items list and Reports screens, so a UI pass can look at
        /// what ships rather than at the synthetic `items` performance list.
        case itemsList = "items-list"
        case reports
        /// Search with two of its four sources deliberately failing, so the
        /// partial-result notice can be seen rather than reasoned about.
        case searchPartial = "search-partial"

        /// The booking scenarios share one fixture and differ only in which
        /// sheet is seeded open.
        var isBookingDetail: Bool {
            switch self {
            case .bookingDetail, .bookingExtend, .bookingEdit, .bookingCancel: return true
            default: return false
            }
        }
    }

    static var performanceScenario: PerformanceScenario? {
#if DEBUG
        guard let rawValue = ProcessInfo.processInfo.environment["GT_PERFORMANCE_SCENARIO"] else {
            return nil
        }
        return PerformanceScenario(rawValue: rawValue)
#else
        return nil
#endif
    }

    static var isPerformanceTesting: Bool {
        performanceScenario != nil
    }

    /// Whether a capture scenario wants one of Booking detail's sheets already
    /// open. Each is local state opened by a tap, and a tap script is exactly
    /// what makes a capture flaky, so the scenario seeds the state instead.
    /// Every value is `false` outside DEBUG, so release builds carry none of it.
    enum CaptureSeed {
        static var bookingExtend: Bool { matches(.bookingExtend) }
        static var bookingEdit: Bool { matches(.bookingEdit) }
        static var bookingCancel: Bool { matches(.bookingCancel) }
        static var itemEdit: Bool { matches(.itemEdit) }
        static var createBookingScanner: Bool { matches(.createBookingScanner) }
        static var search: Bool { matches(.search) || matches(.searchPartial) }

        /// The query a search capture types on appear. Lives here rather than
        /// on the DEBUG-only fixture type because the call site is ordinary
        /// view code that has to compile in Release too.
        static var searchQuery: String? {
            #if DEBUG
            return search ? "fx3" : nil
            #else
            return nil
            #endif
        }

        private static func matches(_ scenario: PerformanceScenario) -> Bool {
            #if DEBUG
            return performanceScenario == scenario
            #else
            return false
            #endif
        }
    }

    /// Scenarios whose surfaces read from the API. Their requests are served by
    /// `FixtureAPIProtocol` rather than the network.
    static var usesFixtureAPI: Bool {
#if DEBUG
        switch performanceScenario {
        case .resourcesGuides, .resourcesUsers, .resourcesLicenses, .resourcesLicensesOpen,
             .schedule, .tradeBoardStaff, .tradeBoardStudent,
             .home, .homeAllClear, .scoreboard, .profile,
             .bookingDetail, .bookingExtend, .bookingEdit, .bookingCancel,
             .itemEdit, .createBookingScanner, .search, .searchPartial,
             .itemsList, .reports:
            return true
        default:
            return false
        }
#else
        return false
#endif
    }

    /// Optional artificial latency for fixture responses, so loading and
    /// skeleton states can be held still long enough to inspect.
    static var fixtureResponseDelayMilliseconds: Int {
#if DEBUG
        guard let raw = ProcessInfo.processInfo.environment["GT_FIXTURE_DELAY_MS"],
              let milliseconds = Int(raw), milliseconds > 0 else { return 0 }
        return milliseconds
#else
        return 0
#endif
    }
}

enum AppPerformanceSignposts {
    private static let signposter = OSSignposter(
        subsystem: "com.erikrole.Wisconsin",
        category: "Performance"
    )

    static func begin(_ name: StaticString) -> OSSignpostIntervalState {
        signposter.beginInterval(name, id: signposter.makeSignpostID())
    }

    static func end(_ name: StaticString, _ state: OSSignpostIntervalState) {
        signposter.endInterval(name, state)
    }
}

/// Receives Apple's daily MetricKit reports and keeps a small, protected,
/// on-device diagnostic ring. Nothing is uploaded or added to normal logs.
/// Developers can retrieve the app container when a device exhibits a launch,
/// hang, CPU, memory, or disk regression that a local trace cannot reproduce.
final class AppMetricMonitor: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = AppMetricMonitor()

    private let lock = NSLock()
    private var started = false
    private let maximumStoredReports = 12
    private let logger = Logger(
        subsystem: "com.erikrole.Wisconsin",
        category: "MetricKit"
    )

    private override init() {
        super.init()
    }

    func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        persist(payloads.map { $0.jsonRepresentation() }, prefix: "metrics")
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        persist(payloads.map { $0.jsonRepresentation() }, prefix: "diagnostics")
    }

    private func persist(_ reports: [Data], prefix: String) {
        guard !reports.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }

        do {
            let directory = try reportDirectory()
            for report in reports {
                let filename = "\(prefix)-\(Int(Date.now.timeIntervalSince1970))-\(UUID().uuidString).json"
                let url = directory.appendingPathComponent(filename, isDirectory: false)
                try report.write(to: url, options: [.atomic])
                try FileManager.default.setAttributes(
                    [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                    ofItemAtPath: url.path
                )
            }
            try pruneReports(in: directory)
            logger.info("Stored \(reports.count, privacy: .public) local MetricKit report(s)")
        } catch {
            logger.error("Unable to store local MetricKit report: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func reportDirectory() throws -> URL {
        let manager = FileManager.default
        let applicationSupport = try manager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        var directory = applicationSupport.appendingPathComponent("PerformanceMetrics", isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory
    }

    private func pruneReports(in directory: URL) throws {
        let manager = FileManager.default
        let reports = try manager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.creationDateKey],
            options: [.skipsHiddenFiles]
        )
        let ordered = try reports.sorted {
            let left = try $0.resourceValues(forKeys: [.creationDateKey]).creationDate ?? .distantPast
            let right = try $1.resourceValues(forKeys: [.creationDateKey]).creationDate ?? .distantPast
            return left > right
        }
        for staleReport in ordered.dropFirst(maximumStoredReports) {
            try manager.removeItem(at: staleReport)
        }
    }
}
