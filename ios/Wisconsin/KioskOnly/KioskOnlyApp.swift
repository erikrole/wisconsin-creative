import Foundation
import SwiftUI
import UIKit

@main
struct WisconsinKioskApp: App {
    @State private var kioskStore: KioskStore

    init() {
        // Fixture device info must land in UserDefaults before `KioskStore()`
        // reads it in its own initializer, so this cannot move into `onAppear`.
        #if DEBUG
        KioskFixtures.bootstrap()
        #endif
        _kioskStore = State(initialValue: KioskStore())
    }

    var body: some Scene {
        WindowGroup {
            KioskShellView()
                .environment(kioskStore)
                .preferredColorScheme(.dark)
                .frame(minWidth: 640, minHeight: 540)
                .onAppear {
                    sharedKioskStore = kioskStore
                }
                #if DEBUG
                .task { await applyFixtureScenarioWhenReady() }
                #endif
        }
        .windowResizability(.contentMinSize)
    }

    #if DEBUG
    /// The shell's cold-launch resume validates the session and then lands on
    /// `.idle`, so a scenario applied in `onAppear` is overwritten a moment
    /// later. Wait for that to actually settle rather than racing it with a
    /// fixed sleep, which is the difference between a repeatable capture and a
    /// flaky one.
    private func applyFixtureScenarioWhenReady() async {
        guard let scenario = KioskFixtureScenario.active, scenario != .idle else { return }
        for _ in 0..<50 {
            if !kioskStore.isResuming, case .idle = kioskStore.screen { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        applyFixtureScenario()
    }

    /// Drops the shell straight onto the screen under review. Without this only
    /// the idle screen is reachable without tapping through a live flow, and a
    /// hand-driven capture is exactly what makes a before/after pair unmatched.
    private func applyFixtureScenario() {
        guard let scenario = KioskFixtureScenario.active else { return }
        let user = KioskFixtures.primaryUser
        let kioskUser = KioskUser(
            id: user.id,
            name: user.name,
            avatarUrl: nil,
            role: user.role,
            affiliation: nil,
            affiliationBadge: user.affiliationBadge
        )
        switch scenario {
        case .idle:
            kioskStore.screen = .idle
        case .operatorHub, .checkoutSheet:
            kioskStore.screen = .operatorHub(kioskUser)
        case .resume:
            // The splash is a store state, not a screen, so it is the one
            // scenario that re-enters a phase the shell has already left.
            kioskStore.screen = .idle
            kioskStore.isResuming = true
        case .eventDetail:
            // The sheet binds to a dashboard event, so `KioskIdleView` seeds it
            // once its own load finishes; nothing to set here but the screen.
            kioskStore.screen = .idle
        case .scanning, .scanAccepted, .scannerHelp:
            kioskStore.setCart(KioskFixtures.cart, for: kioskUser.id)
            kioskStore.setIntent(KioskFlowIntent(
                action: .checkout, source: .person, identifiedUser: kioskUser,
                expectedRequester: nil,
                selectedEvent: KioskIntentEvent(id: "ev-1", title: "Volleyball vs Minnesota", endsAt: KioskFixtures.hours(9)),
                targetBooking: nil, pendingScanValues: [], createdAt: Date(), ambiguity: .none
            ))
            kioskStore.screen = .checkout(user: kioskUser)
        case .badge:
            kioskStore.screen = .success(KioskSuccessInfo(
                kind: .checkout,
                message: "Checked out 4 items for Volleyball vs Minnesota from Camp Randall.",
                earnedBadges: [KioskFixtures.badge]
            ))
        case .inactivity:
            kioskStore.screen = .operatorHub(kioskUser)
            kioskStore.inactivityWarningVisible = true
        case .sleep:
            kioskStore.screen = .idle
        case .pickup:
            kioskStore.screen = .pickup(bookingId: "co-1", userId: kioskUser.id)
        case .returnFlow, .returnAccepted:
            kioskStore.screen = .return(bookingId: "co-1", userId: kioskUser.id)
        case .identity:
            kioskStore.setIntent(KioskFlowIntent(
                action: .checkout, source: .event, identifiedUser: nil, expectedRequester: nil,
                selectedEvent: KioskIntentEvent(id: "ev-1", title: "Volleyball vs Minnesota", endsAt: KioskFixtures.hours(9)),
                targetBooking: nil, pendingScanValues: [], createdAt: Date(), ambiguity: .none
            ))
            kioskStore.screen = .identity
        case .activation:
            kioskStore.screen = .activation
        case .checkoutDetails, .checkoutDetailsLinked, .keyboardTip:
            kioskStore.setIntent(KioskFlowIntent(
                action: .checkout,
                source: .person,
                identifiedUser: kioskUser,
                expectedRequester: nil,
                selectedEvent: nil,
                targetBooking: nil,
                pendingScanValues: [],
                createdAt: Date(),
                ambiguity: .none
            ))
            kioskStore.screen = .checkout(user: kioskUser)
        }
    }
    #endif
}

enum APIError: LocalizedError {
    case unauthorized
    case notFound
    case conflict(String)
    case serverError(String)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "This kiosk session expired. Enter a fresh activation code."
        case .notFound:
            return "The requested item could not be found."
        case .conflict(let message):
            return message
        case .serverError(let message):
            return message
        case .decodingError:
            return "Unexpected response from server."
        case .networkError(let error):
            return Self.humanize(error)
        }
    }

    private static func humanize(_ error: Error) -> String {
        let code = (error as? URLError)?.code
        switch code {
        case .notConnectedToInternet, .networkConnectionLost:
            return "No internet connection. Check the kiosk network and try again."
        case .timedOut:
            return "Request timed out. Try again in a moment."
        case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return "Couldn't reach the server. Try again shortly."
        case .cancelled:
            return "Request was cancelled."
        default:
            return "Network error. Check the kiosk connection and try again."
        }
    }
}

enum Haptics {
    @MainActor static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    @MainActor static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    @MainActor static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }

    @MainActor static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    @MainActor static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

enum StatusTone: String, CaseIterable {
    case green, blue, red, purple, orange, gray
}

extension Color {
    static func statusText(_ tone: StatusTone) -> Color {
        switch tone {
        case .green:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.32, green: 0.85, blue: 0.45, alpha: 1)
                : UIColor(red: 0.086, green: 0.639, blue: 0.290, alpha: 1)
            }))
        case .blue:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.40, green: 0.65, blue: 1.0, alpha: 1)
                : UIColor(red: 0.149, green: 0.388, blue: 0.922, alpha: 1)
            }))
        case .red:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.40, blue: 0.40, alpha: 1)
                : UIColor(red: 0.863, green: 0.149, blue: 0.149, alpha: 1)
            }))
        case .purple:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.70, green: 0.55, blue: 1.0, alpha: 1)
                : UIColor(red: 0.486, green: 0.227, blue: 0.929, alpha: 1)
            }))
        case .orange:
            return Color(UIColor(dynamicProvider: { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.0, green: 0.70, blue: 0.30, alpha: 1)
                : UIColor(red: 0.851, green: 0.467, blue: 0.024, alpha: 1)
            }))
        case .gray:
            return Color.secondary
        }
    }
}

extension Font {
    static func gothamBlack(size: CGFloat, relativeTo textStyle: Font.TextStyle? = nil) -> Font {
        let style = textStyle ?? scalableTextStyle(for: size)
        if UIFont(name: "Gotham-Black", size: size) != nil {
            return Font.custom("Gotham-Black", size: size, relativeTo: style)
        }
        return Font.system(style).weight(.heavy)
    }

    static func gothamBold(size: CGFloat, relativeTo textStyle: Font.TextStyle? = nil) -> Font {
        let style = textStyle ?? scalableTextStyle(for: size)
        if UIFont(name: "Gotham-Bold", size: size) != nil {
            return Font.custom("Gotham-Bold", size: size, relativeTo: style)
        }
        return Font.system(style).weight(.bold)
    }

    private static func scalableTextStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case 30...: return .largeTitle
        case 24...: return .title2
        case 20...: return .title3
        case 17...: return .headline
        default: return .body
        }
    }
}

/// Whether a capture scenario wants a sheet already open when its screen
/// appears. Two kiosk surfaces are reachable only by tapping a control, and
/// synthetic taps are the one thing that does not work reliably on a kiosk
/// simulator, so the capture seeds their state instead.
///
/// This type is compiled in every configuration on purpose: the call sites sit
/// in ordinary view code, and guarding each one with `#if DEBUG` would put
/// build-configuration noise in files that should not care. Every property is
/// hard-coded `false` outside DEBUG, so a release build carries no fixture
/// behaviour and no reference to the harness.
enum KioskCaptureSeed {
    static var scannerHelp: Bool {
        #if DEBUG
        return KioskFixtureScenario.active == .scannerHelp
        #else
        return false
        #endif
    }

    static var eventDetail: Bool {
        #if DEBUG
        return KioskFixtureScenario.active == .eventDetail
        #else
        return false
        #endif
    }
}

#if DEBUG
// MARK: - Fixture harness (DEBUG only)
//
// Renders real kiosk screens against canned payloads with no kiosk session and
// no network, so UI review captures are repeatable and never run against
// production with real credentials. Mirrors `PerformanceTestHarness.swift` in
// the main app target, which the kiosk had no equivalent of — every kiosk
// screenshot before this had to be taken against a live activated device.
//
// Select a scenario with the `GT_KIOSK_SCENARIO` environment variable:
//
//   SIMCTL_CHILD_GT_KIOSK_SCENARIO=idle \
//     xcrun simctl launch --terminate-running-process booted com.erikrole.WisconsinKiosk
//
// It lives here rather than in a new file so it needs no `project.pbxproj`
// registration, per the note in `AGENTS.md` about explicit Xcode projects.

enum KioskFixtureScenario: String {
    /// Dashboard + roster: the profile grid and the complete checkout list.
    case idle
    /// One person's hub: what they hold, and the actions on it.
    case operatorHub = "operator-hub"
    /// The custody drawer for a live checkout, opened over the hub.
    case checkoutSheet = "checkout-sheet"
    /// Step 1 of checkout with the booking-name field focused, for capturing
    /// the hardware-keyboard tip.
    case keyboardTip = "keyboard-tip"
    /// Step 1 of checkout — the detail-input step, nothing linked.
    case checkoutDetails = "checkout-details"
    /// Step 1 of checkout with an event linked.
    case checkoutDetailsLinked = "checkout-details-linked"
    /// Step 2 of checkout — the scan stage, with a part-filled cart.
    case scanning = "scanning"
    /// The scan stage in the moment right after a scan lands.
    case scanAccepted = "scan-accepted"
    /// The terminal success screen with an earned badge.
    case badge = "badge"
    /// The "Still here?" inactivity warning over the operator hub.
    case inactivity = "inactivity"
    /// Overnight standby.
    case sleep = "sleep"
    /// Reservation pickup checklist.
    case pickup = "pickup"
    /// Return checklist.
    case returnFlow = "return"
    /// The return checklist in the moment right after a scan lands.
    case returnAccepted = "return-accepted"
    /// Roster-first identity confirmation.
    case identity = "identity"
    /// The un-activated iPad: 6-digit code entry.
    case activation
    /// The scan stage with the scanner help sheet open over it.
    case scannerHelp = "scanner-help"
    /// The idle dashboard with an event's detail sheet open over it.
    case eventDetail = "event-detail"
    /// The cold-launch splash shown while a stored session is revalidated.
    case resume = "resume"

    static var active: KioskFixtureScenario? {
        ProcessInfo.processInfo.environment["GT_KIOSK_SCENARIO"]
            .flatMap(KioskFixtureScenario.init(rawValue:))
    }
}

enum KioskFixtures {
    static let locationId = "loc-fixture"
    static let kioskId = "kiosk-fixture"

    /// The person the hub and checkout scenarios run as.
    static let primaryUser = KioskFixtureUser(
        id: "u-erik-role",
        name: "Erik Role",
        role: "STUDENT",
        affiliationBadge: nil
    )

    struct KioskFixtureUser {
        let id: String
        let name: String
        let role: String
        let affiliationBadge: String?
    }

    /// The capture reference, snapped down to the top of the hour.
    ///
    /// This cannot be a fixed calendar instant. The kiosk decides "Due Today"
    /// with `Calendar.isDateInToday` and refuses a checkout whose due-back is
    /// not in the future (`KioskIdleView`, `KioskCheckoutView`), so pinning to
    /// a past date would change what the screens mean rather than just what
    /// they say. What it *can* do is drop the minutes: an unsnapped launch was
    /// what produced `1:05 AM` and `Aug 21, 2026 at 6:06 AM` in review shots.
    ///
    /// Consequence worth knowing before you read a capture: future-dated
    /// fixtures still shift with the wall clock, so an evening run shows
    /// after-hours times. Capture during the working day for material that
    /// reads like a real gear room. Past-dated fixtures use `at(_:_:_:)`
    /// instead and stay put whenever you run them.
    static let launch: Date = {
        let calendar = Calendar.current
        let now = Date()
        let parts = calendar.dateComponents([.year, .month, .day, .hour], from: now)
        return calendar.date(from: parts) ?? now
    }()

    static func hours(_ value: Double) -> Date {
        launch.addingTimeInterval(value * 3600)
    }

    /// A fixed wall-clock time on a day offset from today, for fixtures that
    /// are unambiguously in the past. Overdue rows read the same at every
    /// capture time because nothing about them depends on how late it is.
    static func at(_ dayOffset: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        let calendar = Calendar.current
        let day = calendar.date(byAdding: .day, value: dayOffset, to: Date()) ?? Date()
        return calendar.date(
            bySettingHour: hour,
            minute: minute,
            second: 0,
            of: calendar.startOfDay(for: day)
        ) ?? day
    }

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    /// Seeds device info so the shell boots straight past the activation numpad.
    static func bootstrap() {
        guard let scenario = KioskFixtureScenario.active else { return }
        // The activation scenario is the *un*-activated iPad, so it must not
        // find saved device info waiting for it.
        guard scenario != .activation else {
            UserDefaults.standard.removeObject(forKey: "kiosk_info_v1")
            return
        }
        let info = KioskInfo(
            kioskId: kioskId,
            name: "Gear Room iPad",
            locationId: locationId,
            locationName: "Camp Randall"
        )
        if let data = try? JSONEncoder().encode(info) {
            UserDefaults.standard.set(data, forKey: "kiosk_info_v1")
        }
    }

    // MARK: Roster

    /// A roster wide enough to fill the grid and exercise the cases the tiles
    /// have to survive: a shared first name (disambiguation), an affiliated
    /// collaborator (badge), and a long name (truncation).
    private static let rosterNames: [(String, String, String?)] = [
        ("Avery Nakamura", "STUDENT", nil),
        ("Bennett Cole", "STUDENT", nil),
        ("Carmen Ruiz-Delgado", "STUDENT", nil),
        ("Dashiell Okonkwo", "STUDENT", nil),
        ("Erik Role", "STUDENT", nil),
        ("Erik Sandoval", "STUDENT", nil),
        ("Fiona Whitaker", "STAFF", nil),
        ("Gabriel Mbeki", "STUDENT", nil),
        ("Harper Lindqvist", "COLLABORATOR", "Athletics"),
        ("Imani Brooks", "STUDENT", nil),
        ("Jonah Petrov", "STUDENT", nil),
        ("Kaia Thornton", "STUDENT", nil),
        ("Liam O'Shaughnessy", "STUDENT", nil),
        ("Maya Fitzgerald", "COLLABORATOR", "Marketing"),
        ("Noor Abdi", "STUDENT", nil),
        ("Oscar Delacroix", "STUDENT", nil),
        ("Priya Ramachandran", "STUDENT", nil),
        ("Quinn Marlowe", "STAFF", nil),
        ("Rosa Villanueva", "STUDENT", nil),
        ("Silas Bergstrom", "STUDENT", nil),
        ("Tessa Nguyen", "STUDENT", nil),
        ("Ulises Cardenas", "STUDENT", nil),
    ]

    /// `GT_KIOSK_ROSTER_SIZE` pads the roster so the fit-to-screen grid can be
    /// captured at sizes a real gear room reaches, instead of only the 22 names
    /// that happen to be written above.
    private static var rosterSize: Int {
        ProcessInfo.processInfo.environment["GT_KIOSK_ROSTER_SIZE"]
            .flatMap(Int.init) ?? rosterNames.count
    }

    private static var paddedRoster: [(String, String, String?)] {
        let target = rosterSize
        guard target > rosterNames.count else { return Array(rosterNames.prefix(target)) }
        // Long first names on purpose: these are the ones that truncate, and a
        // real gear-room roster is staff-heavy, which is what made the old
        // "show the role" rule print "Staff" under half the grid.
        let extras = ["Madeleine", "Christopher", "Alexandra", "Bartholomew", "Genevieve",
                      "Wren", "Xavier", "Yusuf", "Zola", "Adaeze", "Bodhi", "Cleo", "Dmitri",
                      "Esme", "Franco", "Greta", "Hugo", "Ines", "Jasper", "Kenji", "Lucia",
                      "Milo", "Nadia", "Omar", "Petra", "Rafael", "Simone", "Tobias", "Vera",
                      "Willa", "Yara", "Zane", "Anouk", "Bram", "Celia"]
        let surnames = ["Hartley", "Vasquez", "Lindgren", "Okafor", "Marchetti", "Bauer"]
        var padded = rosterNames
        var index = 0
        while padded.count < target {
            let first = extras[index % extras.count]
            let last = surnames[(index / extras.count) % surnames.count]
            padded.append(("\(first) \(last)", index % 4 == 0 ? "STUDENT" : "STAFF", nil))
            index += 1
        }
        return padded
    }

    static func usersJSON() -> String {
        let entries = paddedRoster.enumerated().map { index, entry in
            let (name, role, badge) = entry
            let id = name == primaryUser.name ? primaryUser.id : "u-\(index)"
            let badgeJSON = badge.map { "\"\($0)\"" } ?? "null"
            let affiliationJSON = badge.map { "\"\($0)\"" } ?? "null"
            return """
            {"id":"\(id)","name":"\(name)","avatarUrl":null,"role":"\(role)",\
            "affiliation":\(affiliationJSON),"affiliationBadge":\(badgeJSON)}
            """
        }
        return "{\"data\":[\(entries.joined(separator: ","))]}"
    }

    /// A part-filled checkout cart: three serialized assets and one numbered
    /// battery unit, so the scanned-items rail shows both row kinds.
    static let cart: [KioskCartItem] = [
        KioskCartItem(id: "it-1", name: "Sony FX3", tagName: "CAM-014", type: "serialized",
                      imageUrl: nil, bulkSkuId: nil, unitNumber: nil),
        KioskCartItem(id: "it-2", name: "Sennheiser MKE 600", tagName: "AUD-007", type: "serialized",
                      imageUrl: nil, bulkSkuId: nil, unitNumber: nil),
        KioskCartItem(id: "it-3", name: "Manfrotto 504X Tripod", tagName: "SUP-031", type: "serialized",
                      imageUrl: nil, bulkSkuId: nil, unitNumber: nil),
        KioskCartItem(id: "it-4", name: "V-Mount Battery #4", tagName: "BAT-004", type: "numbered_bulk",
                      imageUrl: nil, bulkSkuId: "sku-bat", unitNumber: 4),
    ]

    static let badge = EarnedBadgeReward(
        id: "eb-1",
        definitionId: "bd-1",
        key: "night_owl",
        name: "Night Owl",
        description: "Checked gear out after 10 PM five times.",
        // A Lucide name, which is what the server sends — `BadgeArtwork` maps
        // those to SF Symbols. An SF Symbol name here falls through to the
        // generic trophy and makes the capture lie about the real artwork.
        icon: "AlarmClockCheck",
        category: "CUSTODY",
        rarity: "rare",
        awardedAt: iso(launch)
    )

    /// Standby is a dashboard-driven state, so the sleep scenario answers the
    /// dashboard differently rather than poking the view.
    static var forcesSleep: Bool { KioskFixtureScenario.active == .sleep }

    // MARK: Dashboard

    static func dashboardJSON() -> String {
        let checkouts = """
        [
          {"id":"co-1","title":"Volleyball vs Minnesota","requesterName":"Imani Brooks",
           "requesterId":"u-9","requesterAvatarUrl":null,"requesterInitials":"IB",
           "items":[{"name":"Sony FX3"},{"name":"Sennheiser MKE 600"},{"name":"Manfrotto 504X"}],
           "itemCount":3,"endsAt":"\(iso(hours(6)))","isOverdue":false},
          {"id":"co-2","title":"Hockey B-Roll","requesterName":"Dashiell Okonkwo",
           "requesterId":"u-3","requesterAvatarUrl":null,"requesterInitials":"DO",
           "items":[{"name":"Canon R5"},{"name":"RF 70-200mm"}],
           "itemCount":2,"endsAt":"\(iso(at(-1, 17, 0)))","isOverdue":true},
          {"id":"co-3","title":"Recruiting Visit Shoot","requesterName":"Priya Ramachandran",
           "requesterId":"u-16","requesterAvatarUrl":null,"requesterInitials":"PR",
           "items":[{"name":"DJI RS 4"},{"name":"Aputure 600d"},{"name":"V-Mount Battery #4"},{"name":"C-Stand"}],
           "itemCount":4,"endsAt":"\(iso(hours(3)))","isOverdue":false},
          {"id":"co-4","title":"Softball Road Kit","requesterName":"Morgan Lee",
           "requesterId":"u-18","requesterAvatarUrl":null,"requesterInitials":"ML",
           "items":[{"name":"Sony A7S III"}],
           "itemCount":1,"endsAt":"\(iso(at(1, 9, 0)))","isOverdue":false}
        ]
        """
        let activeItems = """
        [
          {"id":"ai-1","name":"Sony FX3","tagName":"CAM-014","imageUrl":null,"bulkSkuId":null,
           "unitNumber":null,"checkoutId":"co-1","checkoutTitle":"Volleyball vs Minnesota",
           "requesterId":"u-9","requesterName":"Imani Brooks","requesterAvatarUrl":null,
           "endsAt":"\(iso(hours(6)))","isOverdue":false},
          {"id":"ai-2","name":"Canon R5","tagName":"CAM-021","imageUrl":null,"bulkSkuId":null,
           "unitNumber":null,"checkoutId":"co-2","checkoutTitle":"Hockey B-Roll",
           "requesterId":"u-3","requesterName":"Dashiell Okonkwo","requesterAvatarUrl":null,
           "endsAt":"\(iso(at(-1, 17, 0)))","isOverdue":true}
        ]
        """
        // Standby is suppressed while anything is actually out — that check is
        // real logic, not a fixture detail — so the sleep scenario has to hand
        // back a genuinely quiet gear room.
        if forcesSleep {
            return """
            {"stats":{"itemsOut":0,"checkouts":0,"overdue":0},
             "capabilities":{"eventWorkerDetails":true,"eventCallTimes":true},
             "standby":{"sleepMode":true,"reason":"night_hours","nightHours":true,
                        "nearbyEventCount":0,"nearbyBookingWindowCount":0},
             "events":[],"activeItems":[],"checkouts":[]}
            """
        }
        return """
        {"stats":{"itemsOut":9,"checkouts":4,"overdue":1},
         "capabilities":{"eventWorkerDetails":true,"eventCallTimes":true},
         "standby":{"sleepMode":\(forcesSleep),"reason":"\(forcesSleep ? "night_hours" : "active_window")",
                    "nightHours":\(forcesSleep),
                    "nearbyEventCount":\(forcesSleep ? 0 : 2),"nearbyBookingWindowCount":\(forcesSleep ? 0 : 1)},
         "events":\(dashboardEvents),"activeItems":\(activeItems),"checkouts":\(checkouts)}
        """
    }

    /// The idle dashboard deliberately ships no events, because the screen it
    /// was built to capture is the roster and custody view. The `event-detail`
    /// scenario needs one to open its sheet against, so it -- and only it --
    /// gets a populated list rather than changing what `idle` looks like.
    private static var dashboardEvents: String {
        guard KioskFixtureScenario.active == .eventDetail else { return "[]" }
        return """
        [
          {"id":"ev-1","title":"Volleyball vs Minnesota","startsAt":"\(iso(hours(2)))",
           "endsAt":"\(iso(hours(5)))","allDay":false,"venue":"UW Field House",
           "sport":"Volleyball","classification":"HOME","workers":[],"callTimes":[]}
        ]
        """
    }

    // MARK: Student context

    static func studentContextJSON() -> String {
        """
        {"checkouts":[
           {"id":"co-1","title":"Volleyball vs Minnesota","refNumber":"CO-1043",
            "items":[{"name":"Sony FX3","tagName":"CAM-014"},
                     {"name":"Sennheiser MKE 600","tagName":"AUD-007"},
                     {"name":"Manfrotto 504X","tagName":"SUP-031"}],
            "endsAt":"\(iso(hours(6)))","isOverdue":false},
           {"id":"co-4","title":"Football Practice Cutups","refNumber":"CO-1039",
            "items":[{"name":"Canon R5","tagName":"CAM-021"},
                     {"name":"V-Mount Battery #4","tagName":"BAT-004"}],
            "endsAt":"\(iso(at(-1, 15, 30)))","isOverdue":true}
         ],
         "pendingPickups":[
           {"id":"pk-1","title":"Wrestling Duals Kit","refNumber":"RS-2201",
            "startsAt":"\(iso(hours(2)))",
            "serializedItems":[{"id":"si-1","tagName":"CAM-009","name":"Sony A7S III"},
                               {"id":"si-2","tagName":"LNS-004","name":"Sigma 24-70mm"}],
            "bulkItems":[{"name":"V-Mount Battery","quantity":2}]}
         ],
         "reservations":[
           {"id":"rs-1","title":"Senior Day Portraits","startsAt":"\(iso(hours(52)))"}
         ]}
        """
    }

    // MARK: Checkout detail

    static func checkoutDetailJSON(id: String) -> String {
        """
        {"id":"\(id)","title":"Volleyball vs Minnesota","refNumber":"CO-1043","status":"OPEN",
         "requesterId":"\(primaryUser.id)","endsAt":"\(iso(hours(6)))",
         "scanSummary":{"serializedTotal":3,"numberedBulkTotal":1,"numberedBulkCompleted":0},
         "items":[
           {"id":"it-1","tagName":"CAM-014","name":"Sony FX3","returned":false,"type":"serialized",
            "bulkSkuId":null,"bulkSkuName":null,"unitNumber":null,"imageUrl":null},
           {"id":"it-2","tagName":"AUD-007","name":"Sennheiser MKE 600","returned":false,
            "type":"serialized","bulkSkuId":null,"bulkSkuName":null,"unitNumber":null,"imageUrl":null},
           {"id":"it-3","tagName":"SUP-031","name":"Manfrotto 504X Tripod","returned":false,
            "type":"serialized","bulkSkuId":null,"bulkSkuName":null,"unitNumber":null,"imageUrl":null},
           {"id":"it-4","tagName":"BAT-004","name":"V-Mount Battery #4","returned":false,
            "type":"numbered_bulk","bulkSkuId":"sku-bat","bulkSkuName":"V-Mount Battery",
            "unitNumber":4,"imageUrl":null}
         ]}
        """
    }

    // MARK: Events

    static func eventsJSON() -> String {
        """
        {"data":[
          {"id":"ev-1","title":"Volleyball vs Minnesota","subtitle":null,"sportCode":"VB",
           "startsAt":"\(iso(hours(4)))","endsAt":"\(iso(hours(9)))","allDay":false,
           "locationName":"UW Field House","isAssigned":true},
          {"id":"ev-2","title":"Men's Hockey vs Michigan","subtitle":null,"sportCode":"MH",
           "startsAt":"\(iso(hours(28)))","endsAt":"\(iso(hours(33)))","allDay":false,
           "locationName":"Kohl Center","isAssigned":true},
          {"id":"ev-3","title":"Softball Media Day","subtitle":null,"sportCode":"SB",
           "startsAt":"\(iso(hours(50)))","endsAt":"\(iso(hours(54)))","allDay":false,
           "locationName":"Goodman Diamond","isAssigned":false},
          {"id":"ev-4","title":"Recruiting Visit — Football","subtitle":null,"sportCode":"FB",
           "startsAt":"\(iso(hours(74)))","endsAt":"\(iso(hours(78)))","allDay":false,
           "locationName":"Camp Randall","isAssigned":false}
        ]}
        """
    }
}

/// Answers every `/api/kiosk/*` request locally.
///
/// Claims all `/api/` paths and returns 404 for anything unmapped, rather than
/// letting it reach the network — an unmapped call that 401s would broadcast
/// `kioskSessionUnauthorized` and tear the fixture session down mid-capture,
/// which is the same trap documented for the main app's fixture protocol.
final class KioskFixtureURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        guard KioskFixtureScenario.active != nil else { return false }
        return request.url?.path.hasPrefix("/api/") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let (status, body) = Self.response(for: path)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func response(for path: String) -> (Int, String) {
        switch path {
        case "/api/kiosk/me":
            return (200, """
            {"kioskId":"\(KioskFixtures.kioskId)","locationId":"\(KioskFixtures.locationId)",
             "locationName":"Camp Randall","name":"Gear Room iPad"}
            """)
        case "/api/kiosk/heartbeat":
            return (200, "{\"status\":\"ok\",\"kioskId\":\"\(KioskFixtures.kioskId)\"}")
        case "/api/kiosk/dashboard":
            return (200, KioskFixtures.dashboardJSON())
        case "/api/kiosk/users":
            return (200, KioskFixtures.usersJSON())
        case "/api/kiosk/events":
            return (200, KioskFixtures.eventsJSON())
        default:
            if path.hasPrefix("/api/kiosk/student/") {
                return (200, KioskFixtures.studentContextJSON())
            }
            if path.hasPrefix("/api/kiosk/checkout/") {
                let id = path.replacingOccurrences(of: "/api/kiosk/checkout/", with: "")
                return (200, KioskFixtures.checkoutDetailJSON(id: id.isEmpty ? "co-1" : id))
            }
            // Local 404 — stays with the caller instead of signalling a dead
            // session the way an unfixtured 401 would.
            return (404, "{\"error\":\"unmapped fixture path\"}")
        }
    }
}
#endif
