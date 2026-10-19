#if DEBUG
import SwiftUI

/// The real app shell with the announcement splash over it, signed in as a
/// fixture staff user. Which announcements wait is chosen by the scenario.
struct AnnouncementHarnessView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        AppTabView()
            .announcementSplash(eligibilityKey: "announcement-fixture")
            .onAppear { session.currentUser = ScheduleFixtures.staffUser }
    }
}

/// Banner art for fixture announcements. A `fixture-image:N` URL draws a
/// gradient scene locally, so a capture never depends on the network.
struct AnnouncementFixtureArt: View {
    private let index: Int

    init?(urlString: String) {
        guard urlString.hasPrefix("fixture-image:"),
              let index = Int(urlString.dropFirst("fixture-image:".count)) else { return nil }
        self.index = index
    }

    private var symbol: String { ["camera.aperture", "calendar", "shippingbox"][index % 3] }

    private var colors: [Color] {
        [
            [Color(red: 0.77, green: 0.02, blue: 0.05), Color(red: 0.23, green: 0.02, blue: 0.04)],
            [Color(red: 0.10, green: 0.18, blue: 0.36), Color(red: 0.03, green: 0.05, blue: 0.14)],
            [Color(red: 0.88, green: 0.45, blue: 0.10), Color(red: 0.40, green: 0.10, blue: 0.05)],
        ][index % 3]
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: symbol)
                .font(.system(size: 72, weight: .light))
                .foregroundStyle(.white.opacity(0.9))
        }
    }
}

/// Canned `/api/announcements` responses. Dismissals are remembered for the
/// life of the process, so closing one reveals the next exactly as the server would.
enum AnnouncementFixtureAPI {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var dismissed: Set<String> = []

    private struct Block: Encodable {
        let type: String
        var text: String?
        var items: [String]?
    }

    private struct Item: Encodable {
        let id: String
        let kind: String
        let kindLabel: String
        let title: String
        let blocks: [Block]
        let ctaLabel: String?
        let ctaUrl: String?
        let imageUrls: [String]
        let imageAlt: String?
        let publishedAt: String
    }

    private static var items: [Item] {
        switch AppRuntimeMode.performanceScenario {
        case .announcementNone, .announcementError:
            return []
        case .announcementLong:
            return [
                Item(
                    id: "fx-long", kind: "FEATURE", kindLabel: "New",
                    title: "Everything you need to run a long, busy Saturday all in one place on your phone.",
                    blocks: [
                        Block(type: "paragraph", text: "This is a deliberately long announcement to see how the sheet behaves when the message outgrows the screen on any iPhone, at any text size. It keeps going so the body has to scroll while the buttons stay reachable, and so we can check that the title, the paragraphs and the checklist all wrap cleanly without clipping or overlapping the pinned button bar at the bottom of the sheet."),
                        Block(type: "list", items: [
                            "Claim open trades without leaving Schedule",
                            "See who is on your crew and what they carry",
                            "Scan gear in and out with a confirmation",
                            "Get a heads-up when a booking is due back",
                            "Offload cards with live progress",
                            "Find any item, booking, or person",
                            "Read the badge shelf for your crew",
                            "Everything works offline for reading",
                        ]),
                        Block(type: "paragraph", text: "Shift trades now sit at the top of Schedule, so you can claim one without digging through the week. Gear scans confirm before they change anything, due dates follow the booking instead of the checkout, and the Home tab shows what needs you first. If something looks wrong, tell us in the usual channel and we will sort it out the same day, even on a game weekend when the equipment room is at its busiest."),
                        Block(type: "paragraph", text: "Card offloads run from your phone with live progress and a verified copy at the end, so you know the footage is safe before you wipe the card. Search finds items, bookings and people from one box, and the new badge shelf shows what your crew has earned this season. Everything here works offline for reading, and syncs the moment you are back on Wi-Fi or cellular, so a dead spot in the stadium never costs you a scan."),
                    ],
                    ctaLabel: "Open Schedule", ctaUrl: "/schedule",
                    imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
            ]
        case .announcementQueue:
            return [
                Item(
                    id: "fx-q1", kind: "FEATURE", kindLabel: "New",
                    title: "Open trades come first",
                    blocks: [Block(type: "paragraph", text: "Open trades now sit at the top of Schedule.")],
                    ctaLabel: nil, ctaUrl: nil, imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
                Item(
                    id: "fx-q2", kind: "UPDATE", kindLabel: "Update",
                    title: "Scans confirm before they change anything",
                    blocks: [Block(type: "paragraph", text: "A scan now asks you to confirm first.")],
                    ctaLabel: nil, ctaUrl: nil, imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-17T15:00:00.000Z"
                ),
                Item(
                    id: "fx-q3", kind: "NOTICE", kindLabel: "Heads up",
                    title: "Equipment room closed Friday",
                    blocks: [Block(type: "paragraph", text: "Pick up gear Thursday before 5 p.m.")],
                    ctaLabel: nil, ctaUrl: nil, imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-16T15:00:00.000Z"
                ),
            ]
        case .announcementBrokenImage:
            return [
                Item(
                    id: "fx-broken", kind: "FEATURE", kindLabel: "New",
                    title: "A banner that cannot load",
                    blocks: [Block(type: "paragraph", text: "The image below points at nothing, so the sheet shows its placeholder and the text still reads.")],
                    ctaLabel: nil, ctaUrl: nil,
                    imageUrls: ["http://127.0.0.1:9/missing.png"], imageAlt: "A missing banner",
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
            ]
        case .announcementCtaRoute:
            return [
                Item(
                    id: "fx-route", kind: "UPDATE", kindLabel: "Update",
                    title: "Licenses live in Browse",
                    blocks: [Block(type: "paragraph", text: "The button opens the Licenses screen in the app, not the website.")],
                    ctaLabel: "Open Licenses", ctaUrl: "/licenses", imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
            ]
        case .announcementStress:
            return [
                Item(
                    id: "fx-stress", kind: "FEATURE", kindLabel: "New",
                    title: "Everything you need to run a long, busy Saturday from one place on your phone",
                    blocks: [
                        Block(type: "paragraph", text: "This is a deliberately long announcement to see how the sheet behaves when the message outgrows the screen. It keeps going so the body has to scroll while the buttons stay reachable."),
                        Block(type: "video", text: "an unknown block type the app must skip"),
                        Block(type: "list", items: [
                            "Claim open trades without leaving Schedule",
                            "See who is on your crew and what they are carrying",
                            "Scan gear in and out with a confirmation before anything changes",
                            "Get a heads-up when a booking is due back within the hour",
                            "Offload cards with live progress and a verified copy",
                            "Find any item, booking, or person from one search",
                        ]),
                        Block(type: "paragraph", text: "Questions? Ask in the usual channel."),
                    ],
                    ctaLabel: "Read the full guide", ctaUrl: "https://wisconsincreative.com/releases",
                    imageUrls: ["fixture-image:0", "fixture-image:1", "fixture-image:2", "fixture-image:3"],
                    imageAlt: "Four screens from the app",
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
            ]
        case .announcementImages:
            return [
                Item(
                    id: "fx-images", kind: "FEATURE", kindLabel: "New",
                    title: "Fetch and Offload, built into the app",
                    blocks: [
                        Block(type: "paragraph", text: "Card offloads now run from your phone, with live progress and a checklist when the copy finishes."),
                        Block(type: "list", items: [
                            "Start an offload from any booking",
                            "Verified copies, with a clear done state",
                            "Swipe the photos to see each step",
                        ]),
                    ],
                    ctaLabel: "Open Schedule", ctaUrl: "/schedule",
                    imageUrls: ["fixture-image:0", "fixture-image:1", "fixture-image:2"],
                    imageAlt: "Three screens from the new offload flow",
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
            ]
        case .announcementPlain:
            return [
                Item(
                    id: "fx-plain", kind: "NOTICE", kindLabel: "Heads up",
                    title: "Equipment room closed Friday",
                    blocks: [
                        Block(type: "paragraph", text: "The equipment room is closed Friday morning for inventory."),
                        Block(type: "paragraph", text: "Anything you need that day, pick up Thursday before 5 p.m."),
                    ],
                    ctaLabel: nil, ctaUrl: nil, imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-17T15:00:00.000Z"
                ),
            ]
        default:
            return [
                Item(
                    id: "fx-banner", kind: "FEATURE", kindLabel: "New",
                    title: "Shift trades are easier to find",
                    blocks: [
                        Block(type: "paragraph", text: "Open trades now sit at the top of Schedule, so you can claim one without digging."),
                        Block(type: "list", items: [
                            "Open trades first",
                            "One tap to claim",
                            "Staff review stays in one place",
                        ]),
                    ],
                    ctaLabel: "See what's new", ctaUrl: "/releases",
                    imageUrls: ["fixture-image:0"], imageAlt: "The Schedule tab with an open trade",
                    publishedAt: "2026-10-18T15:00:00.000Z"
                ),
                Item(
                    id: "fx-update", kind: "UPDATE", kindLabel: "Update",
                    title: "Safer due dates and scans",
                    blocks: [Block(type: "paragraph", text: "Due dates now follow the booking, and scans confirm before they change anything.")],
                    ctaLabel: nil, ctaUrl: nil, imageUrls: [], imageAlt: nil,
                    publishedAt: "2026-10-16T15:00:00.000Z"
                ),
            ]
        }
    }

    static func active() -> Data {
        lock.lock()
        defer { lock.unlock() }
        let waiting = items.filter { !dismissed.contains($0.id) }
        guard let first = waiting.first,
              let data = try? JSONEncoder().encode(Envelope(data: Active(item: first, remaining: waiting.count - 1))) else {
            return Data(#"{"data":null}"#.utf8)
        }
        return data
    }

    static func dismiss(path: String) -> Data {
        let id = path.dropFirst("/api/announcements/".count).dropLast("/dismiss".count)
        lock.lock()
        dismissed.insert(String(id))
        lock.unlock()
        return Data(#"{"data":{"dismissed":true}}"#.utf8)
    }

    private struct Envelope: Encodable { let data: Active }

    private struct Active: Encodable {
        let item: Item
        let remaining: Int

        func encode(to encoder: Encoder) throws {
            try item.encode(to: encoder)
            var container = encoder.container(keyedBy: Key.self)
            try container.encode(remaining, forKey: .remaining)
        }

        enum Key: String, CodingKey { case remaining }
    }
}
#endif
