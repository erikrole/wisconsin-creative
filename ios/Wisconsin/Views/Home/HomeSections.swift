import SwiftUI

// The Home sections, laid out as a native inset-grouped List. Rows are plain
// system rows; the only custom chrome is the featured Up next card and the
// section headers (title, count, see-all). Colour budget: red is overdue and
// nothing else, green is the one primary action on a row (Claim, Approve),
// and venue / booking-status tones stay on the small markers that already
// carried them.

struct HomeActions {
    var openBooking: (String) -> Void
    var openBookingSummary: (BookingSummary) -> Void
    var openEventWork: (DashboardEventWork) -> Void
    var openShift: (DashboardShift) -> Void
    var openFlagged: (DashboardFlaggedItem) -> Void
    var openDraft: (DashboardDraft) -> Void
    var openBookings: () -> Void
    var openSchedule: () -> Void
    var openSearch: () -> Void
    var claimTrade: (String) -> Void
    var approveTrade: (String) -> Void
}

struct HomeDashboardList<Top: View>: View {
    let dash: DashboardData
    let feeds: HomeFeedsModel
    let actions: HomeActions
    @ViewBuilder let top: Top

    @Environment(\.today) private var today
    @State private var showAllAttention = false
    @State private var expanded: Set<String> = HomeDashboardList.initiallyExpanded

    /// DEBUG captures can open the staff sections up front; shipping builds
    /// always start them closed.
    private static var initiallyExpanded: Set<String> {
        #if DEBUG
        if ProcessInfo.processInfo.environment["GT_HOME_EXPANDED"] == "1" {
            return ["crew", "activity"]
        }
        #endif
        return []
    }

    private var now: Date { .now }
    private var isTeam: Bool { dash.isStaff }

    var body: some View {
        let attention = HomeModel.attention(dash: dash, claimedTrades: feeds.claimedTrades.value ?? [], now: now)
        let upNext = HomeModel.upNext(dash: dash, now: now)
        let claimable = HomeModel.claimable(feeds.openTrades.value ?? [])
        let crew = HomeModel.crewToday(feeds.crew.value ?? [])
        let activity = feeds.activity.value ?? []
        let everythingQuiet = attention.isEmpty && upNext.isEmpty && dash.myCheckouts.items.isEmpty && claimable.isEmpty

        ScrollViewReader { proxy in
        List {
            Section {
                top
                    .listRowInsets(EdgeInsets(top: 0, leading: Brand.Space.md, bottom: 0, trailing: Brand.Space.md))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if everythingQuiet {
                Section {
                    AllClearEmptyState(next: HomeModel.nextUp(dash: dash, now: now), openSearch: actions.openSearch)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            } else {
                attentionSection(attention)
            }

            if !upNext.isEmpty { upNextSection(upNext).id("upnext") }

            if !dash.myCheckouts.items.isEmpty { gearSection.id("gear") }

            if !claimable.isEmpty { tradesSection(claimable).id("trades") }

            if isTeam {
                if !crew.isEmpty { crewSection(crew).id("crew") }
                if !activity.isEmpty { activitySection(activity) }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListHeaderHeight, 0)
        .onAppear {
            #if DEBUG
            if let target = ProcessInfo.processInfo.environment["GT_HOME_SCROLL"] {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { proxy.scrollTo(target, anchor: .top) }
            }
            #endif
        }
        }
    }

    // MARK: Needs attention

    @ViewBuilder
    private func attentionSection(_ items: [HomeAttentionItem]) -> some View {
        // Critical rows are never hidden behind "show more": the most urgent
        // thing on the screen must not need a tap to be seen.
        let limit = 5
        let visible = showAllAttention
            ? items
            : items.enumerated().filter { $0.offset < limit || $0.element.tone == .critical }.map(\.element)
        let hidden = items.count - visible.count
        Section {
            if items.isEmpty {
                HStack(spacing: Brand.Space.sm) {
                    Image(systemName: "checkmark.circle")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("You\u{2019}re all caught up")
                            .font(.gothamBold(size: 16))
                        Text("Nothing is overdue or waiting on you right now.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            } else {
                ForEach(visible) { item in
                    AttentionRow(
                        item: item,
                        busy: feeds.busyTradeId == item.quickTradeId && item.quickTradeId != nil,
                        open: { open(item) },
                        quick: { if let id = item.quickTradeId { actions.approveTrade(id) } }
                    )
                }
                if hidden > 0 {
                    Button {
                        withAnimation { showAllAttention = true }
                    } label: {
                        Text("Show \(hidden) more")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                } else if showAllAttention && items.count > limit {
                    Button {
                        withAnimation { showAllAttention = false }
                    } label: {
                        Text("Show less")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: {
            HomeSectionHeader(title: "Needs attention", count: items.count)
        }
    }

    private func open(_ item: HomeAttentionItem) {
        switch item.target {
        case .booking(let id): actions.openBooking(id)
        case .eventWork(let work): actions.openEventWork(work)
        case .flagged(let flag): actions.openFlagged(flag)
        case .draft(let draft): actions.openDraft(draft)
        case .bookingsTab: actions.openBookings()
        case .none: break
        }
    }

    // MARK: Up next

    @ViewBuilder
    private func upNextSection(_ items: [HomeModel.UpNextItem]) -> some View {
        let featured = items[0]
        let rest = Array(items.dropFirst().prefix(4))
        Section {
            FeaturedNextCard(item: featured, now: now) { openUpNext(featured) }
            ForEach(rest) { item in
                UpNextRow(item: item, now: now) { openUpNext(item) }
            }
        } header: {
            HomeSectionHeader(title: "Up next", seeAll: ("Schedule", actions.openSchedule))
        }
    }

    private func openUpNext(_ item: HomeModel.UpNextItem) {
        if let shift = item.shift { actions.openShift(shift) }
        if let booking = item.booking { actions.openBookingSummary(booking) }
    }

    // MARK: My gear

    private var gearSection: some View {
        let rows = Array(dash.myCheckouts.items.prefix(4))
        let total = dash.myCheckouts.total
        return Section {
            ForEach(rows) { booking in
                GearRow(booking: booking, showsPerson: false, now: now) { actions.openBookingSummary(booking) }
            }
            if total > rows.count {
                Button(action: actions.openBookings) {
                    Text("\(total - rows.count) more in Bookings")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        } header: {
            HomeSectionHeader(
                title: isTeam ? "Checked out to you" : "My gear",
                count: total,
                seeAll: ("Bookings", actions.openBookings)
            )
        }
    }

    // MARK: Open trades

    private func tradesSection(_ trades: [ShiftTrade]) -> some View {
        Section {
            ForEach(trades.prefix(3)) { trade in
                TradeRow(trade: trade, busy: feeds.busyTradeId == trade.id) { actions.claimTrade(trade.id) }
            }
        } header: {
            HomeSectionHeader(title: "Open trades", count: trades.count)
        }
    }

    // MARK: Staff and admin, collapsed behind quiet headers

    private func crewSection(_ events: [HomeCrewEvent]) -> some View {
        CollapsibleSection(id: "crew", title: "Working today", count: events.count, expanded: $expanded) {
            ForEach(events.prefix(5)) { event in
                CrewRow(event: event)
            }
        }
    }

    private func activitySection(_ rows: [HomeActivity]) -> some View {
        CollapsibleSection(id: "activity", title: "Recent activity", count: nil, expanded: $expanded) {
            ForEach(rows.prefix(6)) { row in
                ActivityRow(row: row, now: now) { actions.openBooking(row.bookingId) }
            }
        }
    }


}

// MARK: - Headers

/// Title, count, and an optional quiet "see all" on the trailing edge.
private struct HomeSectionHeader: View {
    let title: String
    var count: Int?
    var seeAll: (label: String, action: () -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title)
                .font(.gothamBold(size: 18))
                .foregroundStyle(Color(.label))
                .accessibilityAddTraits(.isHeader)
            if let count, count > 0 {
                Text("\(count)")
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let seeAll {
                Button(action: seeAll.action) {
                    HStack(spacing: 2) {
                        Text(seeAll.label)
                        Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("See all in \(seeAll.label)")
            }
        }
        .textCase(nil)
        .padding(.top, Brand.Space.xs)
    }
}

/// A staff section that starts closed. The header is the toggle, so a quiet
/// Home stays quiet until someone asks for the team view.
private struct CollapsibleSection<Content: View>: View {
    let id: String
    let title: String
    let count: Int?
    @Binding var expanded: Set<String>
    @ViewBuilder let content: Content

    private var isOpen: Bool { expanded.contains(id) }

    var body: some View {
        Section {
            if isOpen { content }
        } header: {
            Button {
                withAnimation(.snappy) {
                    if isOpen { expanded.remove(id) } else { expanded.insert(id) }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    if let count, count > 0 {
                        Text("\(count)")
                            .font(.subheadline)
                            .monospacedDigit()
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(.secondary)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .textCase(nil)
            .accessibilityLabel(title)
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
            .accessibilityHint(isOpen ? "Collapses the section" : "Expands the section")
        }
    }
}

// MARK: - Rows

private struct AttentionRow: View {
    let item: HomeAttentionItem
    let busy: Bool
    let open: () -> Void
    let quick: () -> Void

    private var glyphStyle: AnyShapeStyle {
        if item.isOverdue { return AnyShapeStyle(Color.statusText(.red)) }
        if item.tone == .warning || item.tone == .critical { return AnyShapeStyle(Color.statusText(.orange)) }
        return AnyShapeStyle(.secondary)
    }

    private var hasTarget: Bool {
        if case .none = item.target { return false }
        return true
    }

    @ViewBuilder
    var body: some View {
        if hasTarget && item.quickLabel == nil {
            Button(action: open) { rowContent }
                .buttonStyle(.plain)
        } else {
            rowContent
        }
    }

    private var rowContent: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: item.systemImage)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(glyphStyle)
                .frame(width: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(item.detail)
                    .font(.caption)
                    .foregroundStyle(item.isOverdue ? AnyShapeStyle(Color.statusText(.red)) : AnyShapeStyle(.secondary))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let label = item.quickLabel {
                Button(action: quick) {
                    Text(busy ? "\u{2026}" : label)
                        .font(.subheadline.weight(.semibold))
                        .frame(minWidth: 56)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.statusText(.green))
                .controlSize(.small)
                .disabled(busy)
            } else if hasTarget {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: item.quickLabel == nil ? .combine : .contain)
    }
}

/// The next shift or pickup, given room. Everything after it is a quiet row.
private struct FeaturedNextCard: View {
    let item: HomeModel.UpNextItem
    let now: Date
    let action: () -> Void

    private var eyebrow: String {
        let kind = item.kind == .pickup ? "Next pickup" : "Next shift"
        return "\(kind) \u{00B7} \(homeStartsIn(item.startsAt, now: now))"
    }

    private var rail: Color {
        guard let shift = item.shift else { return Color.secondary.opacity(0.4) }
        return venueRailColor(for: shift.asScheduleEvent)
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Capsule()
                    .fill(rail)
                    .frame(width: 4)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(eyebrow)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .tracking(0.6)
                    Text(item.title)
                        .font(.gothamBlack(size: 22))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(item.time)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.primary)
                    if !item.detail.isEmpty {
                        Text(item.detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let badge = item.gearBadge {
                        Text(badge)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color(.tertiarySystemFill), in: Capsule())
                            .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

private struct UpNextRow: View {
    let item: HomeModel.UpNextItem
    let now: Date
    let action: () -> Void

    private var dayLabel: String {
        let calendar = Calendar.current
        let offset = calendar.dayOffset(of: item.startsAt, from: now)
        if offset <= 0 { return item.time }
        if offset == 1 { return "Tomorrow" }
        return item.startsAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    if !item.detail.isEmpty {
                        Text(item.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(dayLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

/// Booking-status tone for a gear row's marker: the same vocabulary the
/// Bookings list uses, rendered small.
private func homeGearTone(_ booking: BookingSummary, now: Date) -> StatusTone {
    if booking.isOverdue { return .red }
    switch booking.status {
    case .booked: return .purple
    case .pendingPickup: return .orange
    case .open:
        return Calendar.current.dayOffset(of: booking.endsAt, from: now) == 0 ? .orange : .blue
    default: return .gray
    }
}

private struct GearRow: View {
    let booking: BookingSummary
    let showsPerson: Bool
    let now: Date
    let action: () -> Void

    private var tone: StatusTone { homeGearTone(booking, now: now) }
    private var items: String { "\(booking.itemCount) item\(booking.itemCount == 1 ? "" : "s")" }
    private var due: String { homeShortDue(booking.endsAt, now: now) }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if showsPerson {
                    UserAvatarView(name: booking.requesterName, avatarUrl: booking.requesterAvatarUrl, size: 32)
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: "shippingbox.fill")
                        .font(.footnote)
                        .foregroundStyle(Color.statusText(tone))
                        .frame(width: 32, height: 32)
                        .background(Color.statusText(tone).opacity(0.12), in: Circle())
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(booking.title)
                        .font(.gothamBold(size: 16))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Text(showsPerson ? "\(booking.requesterName) \u{00B7} \(items)" : items)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(due)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(booking.isOverdue ? AnyShapeStyle(Color.statusText(.red)) : AnyShapeStyle(.secondary))
                    .multilineTextAlignment(.trailing)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

private struct TradeRow: View {
    let trade: ShiftTrade
    let busy: Bool
    let claim: () -> Void

    private var title: String {
        trade.shiftAssignment.shift.shiftGroup?.event.map(HomeModel.eventTitle) ?? "Shift"
    }

    private var detail: String {
        let shift = trade.shiftAssignment.shift
        return [
            shift.area.shiftAreaLabel,
            homeWhen(shift.startsAt),
            "from \(trade.postedBy.name)",
        ].joined(separator: " \u{00B7} ")
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: claim) {
                Text(busy ? "\u{2026}" : "Claim")
                    .font(.subheadline.weight(.semibold))
                    .frame(minWidth: 56)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.statusText(.green))
            .controlSize(.small)
            .disabled(busy)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
    }
}

private struct CrewRow: View {
    let event: HomeCrewEvent

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(event.summary)
                    .font(.gothamBold(size: 16))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text(HomeModel.crewWhen(event))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            AvatarStack(people: event.people)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(event.summary), \(HomeModel.crewWhen(event)), \(event.people.count) working")
    }
}

private struct AvatarStack: View {
    let people: [HomeCrewPerson]
    private let size: CGFloat = 26

    var body: some View {
        let shown = Array(people.prefix(4))
        HStack(spacing: -4) {
            ForEach(shown) { person in
                UserAvatarView(name: person.name, avatarUrl: person.avatarUrl, size: size)
                    .overlay(Circle().strokeBorder(Color(.secondarySystemGroupedBackground), lineWidth: 2))
            }
            if people.count > shown.count {
                Text("+\(people.count - shown.count)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: size, height: size)
                    .background(Color(.tertiarySystemFill), in: Circle())
                    .overlay(Circle().strokeBorder(Color(.secondarySystemGroupedBackground), lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}

private struct ActivityRow: View {
    let row: HomeActivity
    let now: Date
    let action: () -> Void

    private var who: String { row.person?.name ?? "Someone" }
    private var verb: String { row.isReturn ? "returned" : "took out" }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                UserAvatarView(name: who, avatarUrl: row.person?.avatarUrl, size: 32)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(who) \(verb)")
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                    Text(row.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(HomeModel.agoLabel(row.at, now: now))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - All clear

/// Nothing overdue, due, or waiting. Says what is next so a quiet Home still
/// answers "what now", and keeps Search one tap away.
struct AllClearEmptyState: View {
    let next: String
    let openSearch: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(spacing: 4) {
                Text("You\u{2019}re all caught up")
                    .font(.system(size: 20, weight: .heavy))
                Text(next)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                openSearch()
            } label: {
                Label("Search or Scan", systemImage: "magnifyingglass")
            }
            .authButton(.primary, adaptive: true)
            .frame(maxWidth: 280)
            .padding(.top, 4)
        }
        .flatCard(padding: Brand.Space.xl, radius: Brand.Radius.md, alignment: .center)
        .accessibilityElement(children: .contain)
    }
}
