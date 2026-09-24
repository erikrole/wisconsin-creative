import SwiftUI

// MARK: - Scroll tracking

/// Which day sections of the Schedule list are on screen.
///
/// Rows report their own appear/disappear, and only the week strip reads
/// `topDay`, so scrolling re-renders the strip and not the whole Schedule
/// screen. It is one-way: the strip follows the list but never scrolls it,
/// except when someone taps a day.
@MainActor
@Observable
final class ScheduleScrollTracker {
    private(set) var topDay: Date?
    @ObservationIgnored private var visibleRows: [Date: Int] = [:]
    /// Visible rows by scroll id, with their day and position in it, so the
    /// list can find the topmost row to hold its place on after rows above
    /// the viewport are removed.
    @ObservationIgnored private var visibleAnchors: [AnyHashable: (day: Date, index: Int)] = [:]

    var topAnchor: AnyHashable? {
        visibleAnchors.min { lhs, rhs in
            lhs.value.day != rhs.value.day
                ? lhs.value.day < rhs.value.day
                : lhs.value.index < rhs.value.index
        }?.key
    }

    /// True while any row from before `day` is on screen.
    func hasVisibleRow(before day: Date) -> Bool {
        visibleRows.keys.contains { $0 < day }
    }
    /// The last days of the list can never scroll to the top, so at the
    /// bottom the strip follows the last visible day instead. Without this
    /// the week bar stalled on the second-to-last week however far you
    /// scrolled.
    @ObservationIgnored private var isAtBottom = false

    func setAtBottom(_ atBottom: Bool) {
        guard atBottom != isAtBottom else { return }
        isAtBottom = atBottom
        publish()
    }

    func rowAppeared(on day: Date, anchor: AnyHashable? = nil, index: Int = 0) {
        visibleRows[day, default: 0] += 1
        if let anchor { visibleAnchors[anchor] = (day, index) }
        publish()
    }

    func rowDisappeared(on day: Date, anchor: AnyHashable? = nil) {
        if let anchor { visibleAnchors[anchor] = nil }
        guard let count = visibleRows[day] else { return }
        if count <= 1 {
            visibleRows[day] = nil
        } else {
            visibleRows[day] = count - 1
        }
        publish()
    }

    private func publish() {
        let next = isAtBottom ? visibleRows.keys.max() : visibleRows.keys.min()
        if next != topDay { topDay = next }
    }
}

/// What the strip and month grid draw under one day number. Up to three dots
/// are drawn, but the shift mark and the VoiceOver counts cover every event
/// that day, so a fourth event that is yours still marks the day.
struct ScheduleDayMarks {
    let dots: [DotInfo]
    let eventCount: Int
    let hasShift: Bool
    let venueCounts: [ScheduleVenue: Int]
}

struct DotInfo {
    let color: Color
    let isShift: Bool
    let venue: ScheduleVenue

    var label: String {
        switch venue {
        case .home: return "home"
        case .away: return "away"
        case .neutral: return "neutral"
        case .nonGame: return "non-game"
        }
    }
}

// MARK: - Week strip

/// The jump bar above the Schedule list.
///
/// A paged week of days with venue marks. Tapping a day scrolls the one master
/// list to it; the strip never filters the list down to a single day. The month
/// title expands the strip into a month grid that jumps the same way.
struct ScheduleWeekStrip: View {
    let marksByDay: [Date: ScheduleDayMarks]
    /// The loaded weeks, oldest first. The list grows this as it scrolls, so
    /// the strip pages exactly as far as the list can go.
    let weeks: [Date]
    let tracker: ScheduleScrollTracker
    /// The first upcoming day in the list. "Today" returns here.
    let todayAnchor: Date?
    @Binding var isExpanded: Bool
    let onJump: (Date) -> Void
    /// Returns to today and folds the past away again.
    let onToday: () -> Void
    /// Swiping the strip onto its first or last loaded week asks for more, so
    /// the strip never stops at the edge of what the list happens to hold.
    var onReachStart: () -> Void = {}
    var onReachEnd: () -> Void = {}
    /// The month grid asks for the month it shows, so its days are not drawn
    /// as empty just because their weeks have not loaded.
    var onShowMonth: (Date) -> Void = { _ in }

    @State private var visibleWeek: Date?
    @State private var displayedMonth: Date = Self.monthStart(of: .now)
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection

    private static var calendar: Calendar { .current }
    private var calendar: Calendar { Self.calendar }

    private static func monthStart(of date: Date) -> Date {
        let c = Calendar.current
        return c.date(from: c.dateComponents([.year, .month], from: date)) ?? date
    }

    private func weekStart(of date: Date) -> Date {
        calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? calendar.startOfDay(for: date)
    }

    private var focusedDay: Date? { tracker.topDay }

    private var showsTodayButton: Bool {
        guard let todayAnchor else { return false }
        guard let focusedDay else { return false }
        return !calendar.isDate(focusedDay, inSameDayAs: todayAnchor)
    }

    private var headerMonth: Date {
        if isExpanded { return displayedMonth }
        let anchor = visibleWeek ?? focusedDay ?? .now
        // Mid-week decides the month, so a week that straddles two months is
        // named for the one most of its days are in.
        return calendar.date(byAdding: .day, value: 3, to: weekStart(of: anchor)) ?? anchor
    }

    var body: some View {
        VStack(spacing: 4) {
            header
            weekdayLabels
            if isExpanded {
                monthGrid
                    .transition(.opacity)
            } else {
                weekPager
            }
        }
        .padding(.bottom, 4)
        .onAppear {
            visibleWeek = weekStart(of: focusedDay ?? .now)
        }
        .onChange(of: focusedDay) { _, day in
            guard let day else { return }
            let target = weekStart(of: day)
            guard target != visibleWeek else { return }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                visibleWeek = target
            }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Button {
                if !isExpanded {
                    displayedMonth = Self.monthStart(of: headerMonth)
                    onShowMonth(displayedMonth)
                }
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                    isExpanded.toggle()
                }
                Haptics.selection()
            } label: {
                HStack(spacing: 4) {
                    Text(headerMonth.formatted(.dateTime.month(.wide).year()))
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.brandPrimary)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("schedule-month-toggle")
            .accessibilityLabel(headerMonth.formatted(.dateTime.month(.wide).year()))
            .accessibilityHint(isExpanded ? "Shows one week" : "Shows the whole month")

            Spacer(minLength: 0)

            if showsTodayButton {
                Button("Today") {
                    isExpanded = false
                    onToday()
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .tint(Color.brandPrimary)
            }

            if isExpanded {
                monthStepButton(delta: -1, systemImage: "chevron.backward", label: "Previous month")
                monthStepButton(delta: 1, systemImage: "chevron.forward", label: "Next month")
            }
        }
        .padding(.horizontal, 16)
    }

    private func monthStepButton(delta: Int, systemImage: String, label: String) -> some View {
        Button { changeMonth(by: delta) } label: {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 36, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var weekdayLabels: some View {
        let symbols = calendar.veryShortWeekdaySymbols
        let fullNames = calendar.weekdaySymbols
        let first = max(0, calendar.firstWeekday - 1)
        return HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { idx in
                Text(symbols[(first + idx) % symbols.count])
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel(fullNames[(first + idx) % fullNames.count])
            }
        }
        .padding(.horizontal, 8)
    }

    // MARK: Week pager

    private var weekPager: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(weeks, id: \.self) { week in
                    weekRow(week)
                        .containerRelativeFrame(.horizontal)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $visibleWeek, anchor: .leading)
        // Earlier weeks are inserted ahead of the current page, which leaves
        // the old offset between pages. A new first week rebuilds the pager,
        // and it reopens on the week it was showing.
        .id(weeks.first)
        .onAppear {
            let target = visibleWeek ?? weekStart(of: focusedDay ?? .now)
            visibleWeek = nil
            Task { @MainActor in visibleWeek = target }
        }
        .onChange(of: visibleWeek) { _, week in
            guard let week else { return }
            if week == weeks.last {
                onReachEnd()
            } else if week == weeks.first {
                onReachStart()
            }
        }
        .frame(height: 48)
    }

    private func weekRow(_ week: Date) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { offset in
                if let day = calendar.date(byAdding: .day, value: offset, to: week) {
                    dayButton(day)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 8)
    }

    private func dayButton(_ day: Date, isOutsideMonth: Bool = false) -> some View {
        let marks = marksByDay[day]
        return Button {
            Haptics.selection()
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                isExpanded = false
            }
            onJump(day)
        } label: {
            DayCell(
                date: day,
                isToday: calendar.isDateInToday(day),
                isSelected: focusedDay.map { calendar.isDate($0, inSameDayAs: day) } ?? false,
                dots: marks?.dots ?? [],
                eventCount: marks?.eventCount ?? 0,
                hasShift: marks?.hasShift ?? false,
                venueCounts: marks?.venueCounts ?? [:],
                isOutsideMonth: isOutsideMonth
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: Month grid

    private var monthGrid: some View {
        VStack(spacing: 4) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 1) {
                ForEach(monthGridDays(), id: \.self) { day in
                    dayButton(day, isOutsideMonth: !calendar.isDate(day, equalTo: displayedMonth, toGranularity: .month))
                }
            }
            .padding(.horizontal, 8)
            .gesture(
                DragGesture(minimumDistance: 24)
                    .onEnded { value in
                        let dx = value.translation.width
                        guard abs(dx) > 50 else { return }
                        let movingTowardNext = layoutDirection == .rightToLeft ? dx > 0 : dx < 0
                        changeMonth(by: movingTowardNext ? 1 : -1)
                    }
            )

            dotLegend
        }
    }

    private func changeMonth(by delta: Int) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
            displayedMonth = calendar.date(byAdding: .month, value: delta, to: displayedMonth) ?? displayedMonth
        }
        onShowMonth(displayedMonth)
    }

    /// Whole weeks covering the displayed month, like Calendar: the leading
    /// and trailing days bleed in from the neighbouring months, muted, so the
    /// grid keeps a steady shape and those days stay tappable.
    private func monthGridDays() -> [Date] {
        guard let interval = calendar.dateInterval(of: .month, for: displayedMonth),
              let lastDay = calendar.date(byAdding: .day, value: -1, to: interval.end)
        else { return [] }
        let start = weekStart(of: interval.start)
        let end = calendar.dateInterval(of: .weekOfYear, for: lastDay)?.end ?? interval.end
        var days: [Date] = []
        var cursor = start
        while cursor < end, days.count < 42 {
            days.append(cursor)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return days
    }

    private var dotLegend: some View {
        // Grey is the third venue colour, not an absence of one: every neutral
        // game and every non-game day draws one.
        HStack(spacing: 12) {
            LegendAssignmentMark(label: "My shift")
            LegendDot(color: Color.statusText(.green), label: "Home")
            LegendDot(color: Color.statusText(.orange), label: "Away")
            LegendDot(color: Color.statusText(.gray), label: "Other")
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Legend: my shift, home, away, other")
    }
}

private struct LegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private struct LegendAssignmentMark: View {
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Capsule()
                .fill(Color.statusText(.blue))
                .frame(width: 10, height: 2)
                .accessibilityHidden(true)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Day Cell

private struct DayCell: View {
    let date: Date
    let isToday: Bool
    let isSelected: Bool
    let dots: [DotInfo]
    let eventCount: Int
    let hasShift: Bool
    let venueCounts: [ScheduleVenue: Int]
    /// A leading or trailing day borrowed from the neighbouring month.
    var isOutsideMonth = false

    private var numeralStyle: Color {
        if isSelected && isToday { return .white }
        if isSelected || isToday { return Color.brandPrimary }
        if isOutsideMonth { return Color(.tertiaryLabel) }
        return eventCount == 0 ? Color.secondary : Color.primary
    }

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                if isSelected {
                    Circle()
                        .fill(isToday ? Color.brandPrimary : Color.brandPrimary.opacity(0.18))
                        .frame(width: 28, height: 28)
                } else if isToday {
                    Circle()
                        .strokeBorder(Color.brandPrimary, lineWidth: 1.5)
                        .frame(width: 28, height: 28)
                }
                Text(date.formatted(.dateTime.day()))
                    .font(.subheadline)
                    .fontWeight(isToday || isSelected ? .semibold : .regular)
                    .foregroundStyle(numeralStyle)
            }
            .frame(width: 28, height: 28)

            // One plain venue dot per event, up to three. VoiceOver reads the
            // venue counts from the cell label; the blue assignment mark stays
            // separate.
            HStack(spacing: 3) {
                ForEach(dots.indices, id: \.self) { i in
                    Circle()
                        .fill(dots[i].color)
                        .frame(width: 5, height: 5)
                        .accessibilityHidden(true)
                }
            }
            .frame(height: 7)
            .opacity(isOutsideMonth ? 0.45 : 1)

            Capsule()
                .fill(hasShift ? Color.statusText(.blue) : Color.clear)
                .frame(width: 9, height: 2)
                .accessibilityHidden(true)
        }
        // Keep the day numeral compact while giving the entire cell a full
        // system-sized interaction target.
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var accessibilityLabel: String {
        var parts: [String] = []
        parts.append(date.formatted(.dateTime.weekday(.wide).month(.wide).day()))
        if isToday { parts.append("today") }
        let hasMyShift = hasShift
        if eventCount == 0 {
            parts.append("no events")
        } else if eventCount == 1 {
            parts.append(hasMyShift ? "1 event including my shift" : "1 event")
        } else {
            parts.append(hasMyShift ? "\(eventCount) events including my shift" : "\(eventCount) events")
        }
        let venueParts: [String] = [
            (venueCounts[.home] ?? 0) > 0 ? "\(venueCounts[.home]!) home" : nil,
            (venueCounts[.away] ?? 0) > 0 ? "\(venueCounts[.away]!) away" : nil,
            (venueCounts[.neutral] ?? 0) > 0 ? "\(venueCounts[.neutral]!) neutral" : nil,
            (venueCounts[.nonGame] ?? 0) > 0 ? "\(venueCounts[.nonGame]!) non-game" : nil
        ].compactMap { $0 }
        if !venueParts.isEmpty {
            parts.append(venueParts.joined(separator: ", "))
        }
        return parts.joined(separator: ", ")
    }
}
