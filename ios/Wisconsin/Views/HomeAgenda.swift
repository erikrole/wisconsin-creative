import SwiftUI

/// Personal Home agenda: the one thing that needs the viewer now and what
/// their week holds. Mirrors `src/lib/home-agenda.ts` so web and iOS pick the
/// same banner for the same data. Home's payload is already personal
/// (`scope=ios-home`), so its pending pickups are the viewer's own.
enum HomeAgenda {
    struct Banner: Equatable {
        enum Kind: String { case overdue, pickup, prepGear = "prep-gear", dueToday = "due-today" }

        let kind: Kind
        /// Stable per item, for per-day dismissal.
        let key: String
        let tone: StatusTone
        let title: String
        let detail: String
        let booking: BookingSummary?
        let eventWorkId: String?

        static func == (lhs: Banner, rhs: Banner) -> Bool { lhs.key == rhs.key && lhs.title == rhs.title }
    }

    struct WeekDay: Identifiable {
        let date: Date
        let isToday: Bool
        var shifts = 0
        var pickups = 0
        var returns = 0

        var id: Date { date }
        var isEmpty: Bool { shifts + pickups + returns == 0 }
    }

    /// Students report at their call time; Staff timing is set outside
    /// Schedule, so their events anchor on the event start. Nil for all-day
    /// events, which have no time at all.
    static func reportTime(for work: DashboardEventWork) -> (date: Date, isCall: Bool)? {
        if work.event.allDay { return nil }
        if work.shift.workerType == "ST", let call = work.shift.callStartsAt,
           let end = work.shift.callEndsAt, end.timeIntervalSince(call) < 24 * 3600 - 60 {
            return (call, true)
        }
        return (work.event.startsAt, false)
    }

    private static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private static func items(_ count: Int) -> String {
        "\(count) item\(count == 1 ? "" : "s")"
    }

    /// Same order as web: gear someone is waiting on, gear waiting for you,
    /// a game today with nothing reserved, then a return due later today.
    static func banner(for dash: DashboardData, currentUserId: String?, now: Date = .now, calendar: Calendar = .current) -> Banner? {
        let overdue = dash.myCheckouts.items.filter(\.isOverdue).sorted { $0.endsAt < $1.endsAt }
        if let first = overdue.first {
            let day = calendar.isDate(first.endsAt, inSameDayAs: now)
                ? "today"
                : first.endsAt.formatted(.dateTime.month(.abbreviated).day())
            let place = first.locationName.map { " · Return to \($0)" } ?? ""
            return Banner(
                kind: .overdue,
                key: "overdue:\(first.id)",
                tone: .red,
                title: overdue.count == 1 ? "Return \(first.title)" : "\(overdue.count) checkouts are overdue",
                detail: "Was due \(day) at \(time(first.endsAt))\(place)",
                booking: first,
                eventWorkId: nil
            )
        }

        let pickups = dash.pendingPickups.items.filter { currentUserId == nil || $0.requesterUserId == currentUserId }
        if let pickup = pickups.first {
            let late = now.timeIntervalSince(pickup.startsAt) > 15 * 60
            let place = pickup.locationName.map { " at \($0)" } ?? ""
            return Banner(
                kind: .pickup,
                key: "pickup:\(pickup.id)",
                tone: .orange,
                title: late ? "Pickup was due at \(time(pickup.startsAt))" : "Your gear is ready for pickup",
                detail: "\(pickup.title) · \(items(pickup.itemCount))\(place)",
                booking: pickup,
                eventWorkId: nil
            )
        }

        let prep = dash.myEventWork
            .filter { $0.needsGear && calendar.isDate($0.event.startsAt, inSameDayAs: now) && $0.event.endsAt > now }
            .sorted { (reportTime(for: $0)?.date ?? $0.event.startsAt) < (reportTime(for: $1)?.date ?? $1.event.startsAt) }
            .first
        if let prep {
            let place = prep.event.locationName.map { " · \($0)" } ?? ""
            let when = reportTime(for: prep).map { "\($0.isCall ? "Call" : "Starts") \(time($0.date))" } ?? "You're working today"
            return Banner(
                kind: .prepGear,
                key: "prep-gear:\(prep.event.id)",
                tone: .blue,
                title: "No gear reserved for \(scheduleEventDisplayTitle(prep.asScheduleEvent))",
                detail: "\(when)\(place)",
                booking: nil,
                eventWorkId: prep.id
            )
        }

        let dueToday = dash.myCheckouts.items
            .filter { !$0.isOverdue && calendar.isDate($0.endsAt, inSameDayAs: now) && $0.endsAt > now }
            .sorted { $0.endsAt < $1.endsAt }
            .first
        if let dueToday {
            let place = dueToday.locationName.map { " · \($0)" } ?? ""
            return Banner(
                kind: .dueToday,
                key: "due-today:\(dueToday.id)",
                tone: .orange,
                title: "Return \(dueToday.title) by \(time(dueToday.endsAt))",
                detail: "\(items(dueToday.itemCount))\(place)",
                booking: dueToday,
                eventWorkId: nil
            )
        }
        return nil
    }

    /// Seven days from today with what the viewer has on each.
    static func week(for dash: DashboardData, currentUserId: String?, now: Date = .now, calendar: Calendar = .current) -> [WeekDay] {
        let start = calendar.startOfDay(for: now)
        var days = (0..<7).compactMap { offset -> WeekDay? in
            calendar.date(byAdding: .day, value: offset, to: start).map { WeekDay(date: $0, isToday: offset == 0) }
        }
        func index(for date: Date) -> Int? {
            days.firstIndex { calendar.isDate($0.date, inSameDayAs: date) }
        }

        for work in dash.myEventWork {
            let date = reportTime(for: work)?.date ?? work.asScheduleEvent.spannedDays.first ?? work.event.startsAt
            if let i = index(for: date) { days[i].shifts += 1 }
        }
        var seen = Set<String>()
        let pickups = dash.pendingPickups.items.filter { currentUserId == nil || $0.requesterUserId == currentUserId }
        for booking in pickups + dash.myReservations where seen.insert(booking.id).inserted {
            // A pickup already due still belongs on today.
            if let i = index(for: max(booking.startsAt, start)) { days[i].pickups += 1 }
        }
        for booking in dash.myCheckouts.items {
            if let i = booking.isOverdue ? 0 : index(for: booking.endsAt), days.indices.contains(i) {
                days[i].returns += 1
            }
        }
        return days
    }
}

// MARK: - Dismissal

/// Banner dismissals last for the local day, so a hidden reminder comes back
/// tomorrow if the thing it is about is still true.
private struct DismissedBanners {
    static let storageKey = "home.dismissedBanners"

    static func dayKey(_ now: Date) -> String {
        now.formatted(.iso8601.year().month().day())
    }

    static func keys(from raw: String, now: Date) -> Set<String> {
        let parts = raw.split(separator: "|", maxSplits: 1).map(String.init)
        guard parts.count == 2, parts[0] == dayKey(now) else { return [] }
        return Set(parts[1].split(separator: ",").map(String.init))
    }

    static func encode(_ keys: Set<String>, now: Date) -> String {
        "\(dayKey(now))|\(keys.sorted().joined(separator: ","))"
    }
}

// MARK: - Banner view

struct HomeContextBanner: View {
    let dash: DashboardData
    let currentUserId: String?
    let openBooking: (BookingSummary) -> Void
    let openEventWork: (DashboardEventWork) -> Void
    @AppStorage(DismissedBanners.storageKey) private var dismissedRaw = ""

    var body: some View {
        let now = Date.now
        if let banner = HomeAgenda.banner(for: dash, currentUserId: currentUserId, now: now),
           !DismissedBanners.keys(from: dismissedRaw, now: now).contains(banner.key) {
            HomeContextBannerCard(
                banner: banner,
                action: action(for: banner),
                onDismiss: {
                    var keys = DismissedBanners.keys(from: dismissedRaw, now: now)
                    keys.insert(banner.key)
                    withAnimation(.snappy) { dismissedRaw = DismissedBanners.encode(keys, now: now) }
                }
            )
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private func action(for banner: HomeAgenda.Banner) -> (label: String, run: () -> Void)? {
        if let booking = banner.booking {
            return (banner.kind == .pickup ? "View Pickup" : "View Checkout", { openBooking(booking) })
        }
        if let id = banner.eventWorkId, let work = dash.myEventWork.first(where: { $0.id == id }) {
            return ("Prep Gear", { openEventWork(work) })
        }
        return nil
    }
}

private struct HomeContextBannerCard: View {
    let banner: HomeAgenda.Banner
    let action: (label: String, run: () -> Void)?
    let onDismiss: () -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    private var icon: String {
        switch banner.kind {
        case .overdue: "exclamationmark.triangle.fill"
        case .pickup: "shippingbox.fill"
        case .prepGear: "bag.badge.plus"
        case .dueToday: "alarm.fill"
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.statusText(banner.tone))
                .frame(width: 36, height: 36)
                .background(Color.statusIconBackground(banner.tone), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(banner.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text(banner.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let action {
                Button(action: action.run) {
                    Text(action.label)
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                }
                .buttonStyle(.plain)
                .background(Color.statusText(banner.tone), in: Capsule())
                .foregroundStyle(Color.statusControlForeground(banner.tone, contrast: contrast))
                .frame(minHeight: 44)
                .contentShape(Capsule())
            }

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hide for today")
        }
        .padding(.leading, Brand.Space.md)
        .padding(.trailing, 6)
        .padding(.vertical, Brand.Space.sm)
        .background(Color.cardSurface, in: RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: Brand.Radius.card, bottomLeadingRadius: Brand.Radius.card, style: .continuous)
                .fill(Color.statusText(banner.tone))
                .frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Week strip

struct HomeWeekStrip: View {
    let days: [HomeAgenda.WeekDay]
    let openSchedule: () -> Void

    private static let legend: [(key: KeyPath<HomeAgenda.WeekDay, Int>, label: String, tone: StatusTone)] = [
        (\.shifts, "Shift", .red),
        (\.pickups, "Pickup", .purple),
        (\.returns, "Return", .blue),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Brand.Space.sm) {
            HStack {
                BrandSectionHeader("This Week")
                Spacer()
                HStack(spacing: 10) {
                    ForEach(Self.legend, id: \.label) { item in
                        HStack(spacing: 4) {
                            Circle().fill(Color.statusText(item.tone)).frame(width: 6, height: 6)
                            Text(item.label).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityHidden(true)
            }

            Button(action: openSchedule) {
                HStack(spacing: 4) {
                    ForEach(days) { day in
                        dayCell(day)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilitySummary)
            .accessibilityHint("Opens your schedule")
        }
        .brandCard(padding: Brand.Space.md, radius: Brand.Radius.card)
    }

    private func dayCell(_ day: HomeAgenda.WeekDay) -> some View {
        VStack(spacing: 4) {
            Text(day.date.formatted(.dateTime.weekday(.narrow)))
                .font(.caption2.weight(.medium))
                .foregroundStyle(day.isToday ? Color(.systemBackground).opacity(0.75) : .secondary)
            Text(day.date.formatted(.dateTime.day()))
                .font(.subheadline.weight(.bold).monospacedDigit())
                .foregroundStyle(day.isToday ? Color(.systemBackground) : .primary)
            HStack(spacing: 2) {
                ForEach(Self.legend, id: \.label) { item in
                    if day[keyPath: item.key] > 0 {
                        Circle().fill(Color.statusText(item.tone)).frame(width: 5, height: 5)
                    }
                }
            }
            .frame(height: 5)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(day.isToday ? Color.primary : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var accessibilitySummary: String {
        let busy = days.filter { !$0.isEmpty }.map { day -> String in
            let name = day.isToday ? "Today" : day.date.formatted(.dateTime.weekday(.wide))
            let parts = Self.legend.compactMap { item -> String? in
                let n = day[keyPath: item.key]
                return n > 0 ? "\(n) \(item.label.lowercased())\(n == 1 ? "" : "s")" : nil
            }
            return "\(name): \(parts.joined(separator: ", "))"
        }
        return busy.isEmpty ? "This week: nothing scheduled" : "This week. " + busy.joined(separator: ". ")
    }
}
