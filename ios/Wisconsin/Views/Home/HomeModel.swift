import Foundation
import Observation

// Pure view-model builders for Home. A Swift port of the web Home's
// `home-model.ts` (src/app/(app)/_home/): same rules, same wording, so the two
// surfaces answer "what do I owe today" the same way. Nothing here touches the
// network or SwiftUI, which keeps the rules testable and the views dumb.

// MARK: - Extra feeds

struct HomeCrewPerson: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let avatarUrl: String?
    let area: String
}

/// One event from `/api/users/today`: who is working it now, later, or tomorrow.
struct HomeCrewEvent: Codable, Identifiable, Hashable {
    let id: String
    let summary: String
    let startsAt: Date
    let endsAt: Date
    let when: String
    let people: [HomeCrewPerson]
}

struct HomeActivityPerson: Codable, Hashable {
    let id: String
    let name: String
    let avatarUrl: String?
}

/// One custody move from `/api/dashboard/activity`.
struct HomeActivity: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let bookingId: String
    let title: String
    let person: HomeActivityPerson?
    let at: Date

    var isReturn: Bool { kind == "returned" }
}

/// A secondary feed fails on its own. Home hides a feed that failed rather than
/// letting one 403 blank the dashboard; pull to refresh tries again.
enum HomeFeed<Value: Sendable>: Sendable {
    case loading
    case ready(Value)
    case failed

    var value: Value? {
        if case .ready(let value) = self { return value }
        return nil
    }
}

@MainActor
@Observable
final class HomeFeedsModel {
    var openTrades: HomeFeed<[ShiftTrade]> = .loading
    var claimedTrades: HomeFeed<[ShiftTrade]> = .loading
    var crew: HomeFeed<[HomeCrewEvent]> = .loading
    var activity: HomeFeed<[HomeActivity]> = .loading
    /// Trade with a Claim or Approve in flight, so its button can say so.
    var busyTradeId: String?
    var actionError: String?

    private nonisolated static func feed<T: Sendable>(_ work: @Sendable () async throws -> T) async -> HomeFeed<T> {
        do { return .ready(try await work()) } catch { return .failed }
    }

    /// Students load the open board (to claim); admins load claims waiting on a
    /// decision; staff and admins also load the crew and activity feeds.
    func load(role: String) async {
        let isStudent = role == "STUDENT"
        let isAdmin = role == "ADMIN"
        let isTeam = role == "STAFF" || role == "ADMIN"
        async let open: HomeFeed<[ShiftTrade]> = isStudent
            ? await Self.feed { try await APIClient.shared.shiftTrades(status: "OPEN", limit: 20).data }
            : .ready([])
        async let claimed: HomeFeed<[ShiftTrade]> = isAdmin
            ? await Self.feed { try await APIClient.shared.shiftTrades(status: "CLAIMED", limit: 20).data }
            : .ready([])
        async let crewFeed: HomeFeed<[HomeCrewEvent]> = Self.feed { try await APIClient.shared.homeTodayCrew() }
        async let activityFeed: HomeFeed<[HomeActivity]> = isTeam
            ? await Self.feed { try await APIClient.shared.homeRecentActivity() }
            : .ready([])
        openTrades = await open
        claimedTrades = await claimed
        crew = await crewFeed
        activity = await activityFeed
    }

    func claim(_ id: String, role: String) async {
        await decide(id, role: role) { _ = try await APIClient.shared.claimShiftTrade(id: id) }
    }

    func approve(_ id: String, role: String) async {
        await decide(id, role: role) { try await APIClient.shared.approveShiftTrade(id: id) }
    }

    private func decide(_ id: String, role: String, _ work: () async throws -> Void) async {
        guard busyTradeId == nil else { return }
        busyTradeId = id
        actionError = nil
        do {
            try await work()
        } catch {
            actionError = error.localizedDescription
        }
        busyTradeId = nil
        await load(role: role)
    }
}

// MARK: - Wording helpers

private func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
    "\(count) \(count == 1 ? one : (many ?? one + "s"))"
}

/// When something lands, in the form that reads fastest: minutes or hours out
/// for the next few hours, then a clock time today, "Tomorrow" plus a time, a
/// weekday inside the week, and a date beyond it.
func homeWhen(_ date: Date, now: Date = .now) -> String {
    let time = date.formatted(date: .omitted, time: .shortened)
    let delta = date.timeIntervalSince(now)
    if delta > 0 && delta < 3 * 3_600 {
        let minutes = max(1, Int((delta / 60).rounded()))
        if minutes <= 90 { return "in \(minutes) min" }
        return "in \(Int((Double(minutes) / 60).rounded())) hr"
    }
    let calendar = Calendar.current
    if calendar.dayOffset(of: date, from: now) == 0 { return time }
    if calendar.dayOffset(of: date, from: now) == 1 { return "Tomorrow \(time)" }
    if delta < 6 * 86_400 { return date.formatted(.dateTime.weekday(.abbreviated).hour().minute()) }
    return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
}

/// Compact due time for a trailing column: "1h overdue", "Due 5:00 PM", "Due Fri".
func homeShortDue(_ endsAt: Date, now: Date = .now) -> String {
    if endsAt <= now { return endsAt.overdueLabel }
    let calendar = Calendar.current
    if calendar.dayOffset(of: endsAt, from: now) == 0 {
        return "Due \(endsAt.formatted(date: .omitted, time: .shortened))"
    }
    if endsAt.timeIntervalSince(now) < 6 * 86_400 {
        return "Due \(endsAt.formatted(.dateTime.weekday(.abbreviated)))"
    }
    return "Due \(endsAt.formatted(.dateTime.month(.abbreviated).day()))"
}

/// "in 45m", "in 5h", "in 2d": how soon the featured card's event starts.
func homeStartsIn(_ date: Date, now: Date = .now) -> String {
    let diff = date.timeIntervalSince(now)
    if diff <= 0 { return "happening now" }
    let minutes = Int((diff / 60).rounded())
    if minutes < 60 { return "in \(minutes)m" }
    let hours = Int((Double(minutes) / 60).rounded())
    if hours < 24 { return "in \(hours)h" }
    return "in \(Int((Double(hours) / 24).rounded()))d"
}

// MARK: - Needs attention

struct HomeAttentionItem: Identifiable {
    enum Tone: Int { case critical = 0, warning, info, neutral }

    enum Target {
        case booking(String)
        case eventWork(DashboardEventWork)
        case flagged(DashboardFlaggedItem)
        case draft(DashboardDraft)
        case bookingsTab
        case none
    }

    let id: String
    let tone: Tone
    let systemImage: String
    let title: String
    let detail: String
    let target: Target
    /// A one-tap decision the row offers instead of opening a screen.
    var quickLabel: String?
    var quickTradeId: String?

    /// Red is reserved for overdue custody; every other row speaks in neutral
    /// or amber so the one red thing on Home is the thing that is late.
    var isOverdue: Bool { id.hasPrefix("overdue-") || id.hasPrefix("my-overdue-") }
}

enum HomeModel {
    static func isTeam(_ dash: DashboardData) -> Bool { dash.isStaff }

    static func eventTitle(_ event: DashboardShiftEvent) -> String {
        scheduleEventDisplayTitle(ScheduleEvent(
            id: event.id, summary: event.summary, startsAt: event.startsAt, endsAt: event.startsAt,
            allDay: event.allDay ?? false, status: "CONFIRMED", sportCode: event.sportCode,
            opponent: event.opponent, isHome: event.isHome, site: event.site, location: nil
        ))
    }

    static func eventTitle(_ event: DashboardEventWorkEvent) -> String {
        scheduleEventDisplayTitle(ScheduleEvent(
            id: event.id, summary: event.summary, startsAt: event.startsAt, endsAt: event.endsAt,
            allDay: event.allDay, status: "CONFIRMED", sportCode: event.sportCode,
            opponent: event.opponent, isHome: event.isHome, site: event.site, location: nil
        ))
    }

    static func eventTitle(_ event: DashboardUpcomingEvent) -> String {
        scheduleEventDisplayTitle(event.asScheduleEvent)
    }

    static func eventTitle(_ event: ShiftTradeEvent) -> String {
        event.compactTitle
    }

    /// One ordered list of things someone owes an action on. Students see only
    /// their own work; staff also see flagged gear and review queues. Same
    /// rules and wording as the web `buildAttention`.
    static func attention(
        dash: DashboardData,
        claimedTrades: [ShiftTrade],
        now: Date = .now
    ) -> [HomeAttentionItem] {
        var items: [HomeAttentionItem] = []
        let team = dash.isStaff

        for b in dash.myCheckouts.items where b.isOverdue {
            items.append(HomeAttentionItem(
                id: "my-overdue-\(b.id)", tone: .critical, systemImage: "exclamationmark.triangle.fill",
                title: "Return \(b.title)",
                detail: "\(b.endsAt.overdueLabel) · \(plural(b.itemCount, "item"))", target: .booking(b.id)
            ))
        }
        let hidden = dash.myCheckouts.overdue - dash.myCheckouts.items.filter(\.isOverdue).count
        if hidden > 0 {
            items.append(HomeAttentionItem(
                id: "my-overdue-more", tone: .critical, systemImage: "exclamationmark.triangle.fill",
                title: plural(hidden, "more overdue checkout"),
                detail: "See the rest of your overdue gear", target: .bookingsTab
            ))
        }

        if dash.isAdmin {
            for t in claimedTrades {
                guard let event = t.shiftAssignment.shift.shiftGroup?.event else { continue }
                let when = homeWhen(t.shiftAssignment.shift.startsAt, now: now)
                let area = t.shiftAssignment.shift.area.shiftAreaLabel
                var item = HomeAttentionItem(
                    id: "trade-\(t.id)", tone: .warning, systemImage: "arrow.left.arrow.right",
                    title: "Approve trade: \(HomeModel.eventTitle(event))",
                    detail: "\(t.postedBy.name) to \(t.claimedBy?.name ?? "a claimer") · \(area) · \(when)",
                    target: .none
                )
                item.quickLabel = "Approve"
                item.quickTradeId = t.id
                items.append(item)
            }
        }

        // My shifts in the next week with no gear arranged.
        let weekOut = now.addingTimeInterval(7 * 86_400)
        for w in dash.myEventWork where w.needsGear && w.event.startsAt >= now && w.event.startsAt <= weekOut {
            let when = w.event.allDay
                ? w.event.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
                : homeWhen(w.event.startsAt, now: now)
            items.append(HomeAttentionItem(
                id: "gear-\(w.id)", tone: .warning, systemImage: "shippingbox",
                title: "Reserve gear for \(eventTitle(w.event))",
                detail: "\(w.shift.area.shiftAreaLabel) · \(when)", target: .eventWork(w)
            ))
        }

        for p in dash.pendingPickups.items {
            items.append(HomeAttentionItem(
                id: "pickup-\(p.id)", tone: .warning, systemImage: "shippingbox.fill",
                title: p.title,
                detail: "Pickup was due \(homeWhen(p.startsAt, now: now))",
                target: .booking(p.id)
            ))
        }
        if team {
            for f in dash.flaggedItems where !f.isMaintenanceFlag {
                let lost = f.type == "LOST"
                items.append(HomeAttentionItem(
                    id: "flag-\(f.id)", tone: lost ? .critical : .warning, systemImage: "flag.fill",
                    title: "\(lost ? "Lost" : "Damaged"): \(f.assetName ?? f.assetTag)",
                    detail: [f.assetTag, f.reportedBy.map { "Reported by \($0)" }].compactMap { $0 }.joined(separator: " · "),
                    target: .flagged(f)
                ))
            }
        }

        if dash.isAdmin {
            for l in dash.lostBulkUnits {
                items.append(HomeAttentionItem(
                    id: "lost-\(l.skuName)", tone: .info, systemImage: "questionmark.circle",
                    title: "\(plural(l.count, "\(l.skuName) unit")) marked lost",
                    detail: "Confirm the loss or restock", target: .none
                ))
            }
        }

        // Due today, not yet overdue: a reminder, not an alarm.
        let calendar = Calendar.current
        for b in dash.myCheckouts.items where !b.isOverdue && calendar.dayOffset(of: b.endsAt, from: now) == 0 {
            items.append(HomeAttentionItem(
                id: "due-\(b.id)", tone: .info, systemImage: "clock",
                title: "Return \(b.title) today",
                detail: "\(homeShortDue(b.endsAt, now: now)) · \(plural(b.itemCount, "item"))", target: .booking(b.id)
            ))
        }

        if team {
            for d in dash.drafts {
                items.append(HomeAttentionItem(
                    id: "draft-\(d.id)", tone: .neutral, systemImage: "doc.text",
                    title: "Finish draft: \(d.title.isEmpty ? "Untitled reservation" : d.title)",
                    detail: "\(plural(d.itemCount, "item")) · Saved \(homeWhen(d.updatedAt, now: now))",
                    target: .draft(d)
                ))
            }
        }

        // Stable sort keeps each group's own order inside a tone.
        return items.enumerated()
            .sorted { a, b in
                a.element.tone.rawValue == b.element.tone.rawValue
                    ? a.offset < b.offset
                    : a.element.tone.rawValue < b.element.tone.rawValue
            }
            .map(\.element)
    }

    // MARK: Up next

    struct UpNextItem: Identifiable {
        enum Kind { case shift, pickup }
        let id: String
        let kind: Kind
        let startsAt: Date
        let allDay: Bool
        let time: String
        let title: String
        let detail: String
        let gearBadge: String?
        let shift: DashboardShift?
        let booking: BookingSummary?
    }

    static func upNext(dash: DashboardData, now: Date = .now) -> [UpNextItem] {
        var rows: [UpNextItem] = []
        for s in dash.myShifts where s.endsAt >= now {
            let allDay = s.event.allDay ?? false
            let studentCall = s.workerType == "ST" && !allDay && s.callStartsAt != nil
            let display = (studentCall ? s.callStartsAt : nil) ?? s.event.startsAt
            let detail = [
                s.area.shiftAreaLabel,
                studentCall ? "Call time" : nil,
                s.event.locationName,
            ].compactMap { $0 }.joined(separator: " · ")
            let badge: String?
            switch s.gearStatus {
            case "checked_out": badge = "Gear out"
            case "pickup_ready": badge = "Gear ready"
            case "reserved": badge = "Gear reserved"
            case "draft": badge = "Gear draft"
            default: badge = nil
            }
            rows.append(UpNextItem(
                id: "shift-\(s.id)", kind: .shift, startsAt: display, allDay: allDay,
                time: allDay ? "All day" : display.formatted(date: .omitted, time: .shortened),
                title: eventTitle(s.event), detail: detail, gearBadge: badge, shift: s, booking: nil
            ))
        }
        for r in dash.myReservations {
            let items = plural(r.itemCount, "item")
            rows.append(UpNextItem(
                id: "pickup-\(r.id)", kind: .pickup, startsAt: r.startsAt, allDay: false,
                time: r.startsAt.formatted(date: .omitted, time: .shortened),
                title: "Pick up \(r.title)",
                detail: [items, r.locationName].compactMap { $0 }.joined(separator: " · "),
                gearBadge: r.startsAt < now ? "Pickup was due" : nil, shift: nil, booking: r
            ))
        }
        return Array(rows.sorted { $0.startsAt < $1.startsAt }.prefix(8))
    }

    // MARK: Day summary

    /// One sentence under the greeting that says what today holds, so the page
    /// answers "what do I have to do today" before anyone reads a card.
    static func daySummary(dash: DashboardData, now: Date = .now) -> String {
        var sentences: [String] = []
        let calendar = Calendar.current
        let today = upNext(dash: dash, now: now).first {
            $0.kind == .shift && calendar.dayOffset(of: $0.startsAt, from: now) <= 0
        }
        if let today {
            sentences.append(today.allDay
                ? "You\u{2019}re on \(today.title) today."
                : "You\u{2019}re on \(today.title) at \(today.time).")
        }
        let overdue = dash.stats.overdue
        let due = dash.stats.dueToday
        var gear: [String] = []
        if overdue > 0 { gear.append("\(overdue) overdue") }
        if due > 0 { gear.append("\(due) due back today") }
        if !gear.isEmpty {
            sentences.append("Your gear: \(gear.joined(separator: ", ")).")
        }
        return sentences.isEmpty ? "Nothing due today. You\u{2019}re clear." : sentences.joined(separator: " ")
    }

    /// What to say when nothing is overdue, due, or waiting: the next thing.
    static func nextUp(dash: DashboardData, now: Date = .now) -> String {
        if let next = upNext(dash: dash, now: now).first(where: { $0.startsAt > now }) {
            return "Next: \(next.title), \(homeWhen(next.startsAt, now: now))."
        }
        return "Nothing on your calendar yet."
    }

    // MARK: Trades

    /// Open trades this student can pick up.
    static func claimable(_ trades: [ShiftTrade]) -> [ShiftTrade] {
        trades.filter { $0.status == .open && $0.viewerCanClaim == true }
    }

    // MARK: Crew

    static func crewToday(_ events: [HomeCrewEvent]) -> [HomeCrewEvent] {
        events.filter { $0.when != "tomorrow" }
    }

    static func crewWhen(_ event: HomeCrewEvent) -> String {
        let end = event.endsAt.formatted(date: .omitted, time: .shortened)
        if event.when == "now" { return "On now · until \(end)" }
        return "\(event.startsAt.formatted(date: .omitted, time: .shortened)) – \(end)"
    }

    static func agoLabel(_ date: Date, now: Date = .now) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        if minutes < 1 { return "Just now" }
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        return hours < 24 ? "\(hours)h ago" : "\(hours / 24)d ago"
    }
}
