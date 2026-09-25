import SwiftUI

// MARK: - Event Row

/// One event in the Schedule master list.
///
/// A venue dot, the title, one quiet meta line, and the time trailing. Your
/// own work is carried by a blue-tinted row (`EventRowBackground`) rather than
/// extra text; a Student call time takes the second time line. Area, gear, and
/// combined-event detail live on Event detail and in the VoiceOver label.
struct EventRow: View {
    let event: ScheduleEvent
    let myShift: MyShift?
    var extraAreas: [String] = []
    /// The day this row is rendered under. For a multi-day event it drives the
    /// "Day n of m" marker and the segment-aware time.
    var contextDay: Date? = nil

    /// When this row represents one day of a multi-day event, its 1-based
    /// position and the total span length.
    private var segment: (index: Int, total: Int)? {
        guard event.isMultiDay, let day = contextDay, let idx = event.dayIndex(for: day) else { return nil }
        return (idx, event.dayCount)
    }

    private var eventDisplayTitle: String {
        scheduleEventDisplayTitle(event)
    }

    /// Drives the "Now" time and the dimming that lets the eye skip work that
    /// is already done. Defined on `ScheduleEvent` so Event detail answers the
    /// same question the same way.
    private var timeState: ScheduleEventTimeState { event.timeState }

    private var isPast: Bool { timeState == .past }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VenueDot(color: venueRailColor(for: event))

            VStack(alignment: .leading, spacing: 3) {
                Text(eventDisplayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(isPast ? Color.secondary : Color.primary)
                    .fixedSize(horizontal: false, vertical: true)

                metaLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            timeColumn
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rowAccessibilityLabel)
    }

    // MARK: Time

    /// The two lines of the trailing time column. Multi-day segments report the
    /// edge that actually falls on this day rather than the whole span.
    private var timeLines: (primary: String, secondary: String?) {
        let start = event.startsAt.formatted(.dateTime.hour().minute())
        let end = event.endsAt.formatted(.dateTime.hour().minute())
        if let seg = segment {
            if event.displayAllDay { return ("All day", nil) }
            if seg.index == 1 { return (start, callTimeText) }
            if seg.index == seg.total { return ("Until", end) }
            return ("All day", nil)
        }
        if event.displayAllDay { return ("All day", nil) }
        return (start, callTimeText ?? end)
    }

    private var timeColumn: some View {
        let lines = timeLines
        return VStack(alignment: .trailing, spacing: 2) {
            if timeState == .live {
                Text("Now")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.brandPrimary)
                Text(event.displayAllDay ? "All day" : event.endsAt.formatted(.dateTime.hour().minute()))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                Text(lines.primary)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(isPast ? Color.secondary : Color.primary)
                if let secondary = lines.secondary {
                    Text(secondary)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(callTimeText != nil && secondary == callTimeText
                            ? Color.statusText(.blue)
                            : Color.secondary)
                }
            }
        }
        .lineLimit(1)
        .fixedSize()
        .padding(.top, 1)
        .accessibilityHidden(true)
    }

    // MARK: Meta

    private var metaLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let metaText {
                Text(metaText)
                    .lineLimit(2)
            }
            if let cov = event.coverage, cov.total > 0 {
                coverageChip(cov)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    /// "Day 2 of 3 · Away · 3M Arena". Home is carried by the dot, so only the
    /// exceptions spend a word. Neutral and non-game share the grey dot and the
    /// title already says which one it is, so the word loses to a venue name.
    private var metaText: String? {
        var parts: [String] = []
        if let segment { parts.append("Day \(segment.index) of \(segment.total)") }
        if let eventTypeLabel { parts.append(eventTypeLabel) }
        if let venueName { parts.append(venueName) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var eventTypeLabel: String? {
        switch event.venue {
        case .home: return nil
        case .away: return "Away"
        case .neutral, .nonGame:
            guard venueName == nil else { return nil }
            return event.venue == .nonGame ? "Non-game" : "Neutral"
        }
    }

    private var accessibilityTypeLabel: String {
        switch event.venue {
        case .home: return "Home"
        case .away: return "Away"
        case .neutral: return "Neutral"
        case .nonGame: return "Non-game"
        }
    }

    /// Shared with Event detail via `scheduleEventVenueName` -- the row and the
    /// detail header must name the same venue the same way.
    private var venueName: String? {
        scheduleEventVenueName(event)
    }

    /// Shared with Event detail's hero via `CoverageChip` -- the list and the
    /// detail screen must report the same staffing the same way.
    @ViewBuilder
    private func coverageChip(_ cov: ShiftCoverage) -> some View {
        CoverageChip(coverage: cov, emphasis: .dense)
            .accessibilityHidden(true) // surfaced via the combined row label
    }

    // MARK: Personal work

    /// "Call 5:30 PM" for your own Student shift; nil otherwise. Staff and
    /// all-day work have no call time to state.
    private var callTimeText: String? {
        guard let myShift, !event.displayAllDay, myShift.workerType == "ST",
              let callStartsAt = myShift.callStartsAt else { return nil }
        return "Call " + callStartsAt.formatted(date: .omitted, time: .shortened)
    }

    // MARK: Accessibility

    private var rowAccessibilityLabel: String {
        var parts: [String] = []
        switch timeState {
        case .live: parts.append("In progress")
        case .past: parts.append("Ended")
        case .upcoming: break
        }
        if myShift != nil { parts.append(extraAreas.isEmpty ? "My shift" : "My shifts") }
        parts.append(eventDisplayTitle)
        if event.combinedMemberCount > 1 {
            parts.append("\(event.combinedMemberCount) events, shared crew")
        }
        if let cov = event.coverage, cov.total > 0 {
            parts.append("Crew \(cov.filled) of \(cov.total)")
        }
        parts.append(accessibilityTypeLabel)
        if event.displayAllDay {
            parts.append("All day")
        } else if let shift = myShift {
            let eventTime = event.startsAt.formatted(.dateTime.hour().minute())
            let eventEndTime = event.endsAt.formatted(.dateTime.hour().minute())
            if shift.workerType == "ST",
               let callStartsAt = shift.callStartsAt,
               let callEndsAt = shift.callEndsAt {
                let callTime = callStartsAt.formatted(.dateTime.hour().minute())
                let endTime = callEndsAt.formatted(.dateTime.hour().minute())
                if calendarSame(callStartsAt, event.startsAt) {
                    parts.append("Event \(eventTime) to \(endTime)")
                } else {
                    parts.append("Call \(callTime), event \(eventTime), end \(endTime)")
                }
            } else {
                parts.append("Event \(eventTime) to \(eventEndTime)")
            }
            parts.append(([shift.area] + extraAreas).map(\.shiftAreaLabel).joined(separator: ", "))
            parts.append(shift.gear.gearLabel)
        } else {
            parts.append(eventTimeLabel)
        }
        if let segment {
            parts.append("Day \(segment.index) of \(segment.total)")
        }
        if let venueName {
            parts.append(venueName)
        }
        return parts.joined(separator: ", ")
    }

    private var eventTimeLabel: String {
        if event.displayAllDay { return "All day" }
        let start = event.startsAt.formatted(.dateTime.hour().minute())
        let end = event.endsAt.formatted(.dateTime.hour().minute())
        return "\(start) – \(end)"
    }
}

/// Where a row sits in its day, so the row background can draw the right slice
/// of the day's rounded group.
enum EventRowGroupPosition {
    case only, first, middle, last

    init(index: Int, count: Int) {
        if count <= 1 {
            self = .only
        } else if index == 0 {
            self = .first
        } else if index == count - 1 {
            self = .last
        } else {
            self = .middle
        }
    }

    fileprivate var roundsTop: Bool { self == .only || self == .first }
    fileprivate var roundsBottom: Bool { self == .only || self == .last }
    fileprivate var hasSeparator: Bool { self == .first || self == .middle }
}

/// One slice of a day's rounded group. Your own work tints the whole slice
/// blue instead of adding a line of text or an edge bar.
///
/// The list is plain so day headers stay pinned; this is what makes a plain
/// list read as inset grouped sections.
struct EventRowBackground: View {
    let isMine: Bool
    var position: EventRowGroupPosition = .only

    private static let radius: CGFloat = 20

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: position.roundsTop ? Self.radius : 0,
            bottomLeadingRadius: position.roundsBottom ? Self.radius : 0,
            bottomTrailingRadius: position.roundsBottom ? Self.radius : 0,
            topTrailingRadius: position.roundsTop ? Self.radius : 0,
            style: .continuous
        )
    }

    var body: some View {
        (isMine ? Color.myShiftSurface : Color.cardSurface)
            .overlay(alignment: .bottom) {
                if position.hasSeparator {
                    // Starts under the title, past the venue dot.
                    Rectangle()
                        .fill(Color(.separator))
                        .frame(height: 0.5)
                        .padding(.leading, 36)
                }
            }
            .clipShape(shape)
            .padding(.horizontal, 16)
            .background(Color(.systemGroupedBackground))
    }
}

private func calendarSame(_ a: Date, _ b: Date) -> Bool {
    abs(a.timeIntervalSince(b)) < 60
}

// MARK: - Venue Dot

/// The one venue mark Schedule surfaces share: an 8pt dot aligned to the
/// first text line. It replaces the 4pt colored bar those surfaces used to
/// draw down their leading edge.
struct VenueDot: View {
    let color: Color
    var topPadding: CGFloat = 7

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .padding(.top, topPadding)
            .accessibilityHidden(true)
    }
}

// MARK: - Date Header

struct ScheduleDateHeader: View {
    let date: Date
    let eventCount: Int

    private var cal: Calendar { .current }
    private var isToday: Bool { cal.isDateInToday(date) }
    private var isTomorrow: Bool { cal.isDateInTomorrow(date) }

    private var primaryLabel: String {
        if isToday { return "Today" }
        if isTomorrow { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.wide))
    }

    /// "Today"/"Tomorrow" already spend the primary slot, so those two carry the
    /// weekday here; a named weekday elsewhere would only repeat itself.
    private var dateLabel: String {
        let year = cal.component(.year, from: date)
        let currentYear = cal.component(.year, from: .now)
        guard year == currentYear else {
            return date.formatted(.dateTime.month(.abbreviated).day().year())
        }
        return (isToday || isTomorrow)
            ? date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            : date.formatted(.dateTime.month(.abbreviated).day())
    }

    private var countText: String {
        eventCount == 1 ? "1 event" : "\(eventCount) events"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(primaryLabel)
                .font(.headline)
                .foregroundStyle(isToday ? Color.brandPrimary : Color.primary)
            Text(dateLabel)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(countText)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .textCase(nil)
        .padding(.horizontal, 32)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGroupedBackground))
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(headerAccessibilityLabel)
    }

    private var headerAccessibilityLabel: String {
        var parts: [String] = []
        if isToday {
            parts.append("Today")
        } else if isTomorrow {
            parts.append("Tomorrow")
        } else {
            parts.append(date.formatted(.dateTime.month(.wide).year()))
        }
        parts.append(date.formatted(.dateTime.weekday(.wide).day()))
        parts.append(countText)
        return parts.joined(separator: ", ")
    }
}

// MARK: - Week Header

/// Header for a stretch with nothing in it: "Sep 27 – Oct 3", or a longer
/// run like "Oct 11 – Nov 7", in the same place and style as a day header so
/// the list reads as one continuous calendar.
struct ScheduleWeekHeader: View {
    let weekStart: Date
    var weekCount = 1

    private var rangeLabel: String {
        let cal = Calendar.current
        let end = cal.date(byAdding: .day, value: 7 * weekCount - 1, to: weekStart) ?? weekStart
        let sameYear = cal.component(.year, from: weekStart) == cal.component(.year, from: .now)
        let style: Date.FormatStyle = sameYear
            ? .dateTime.month(.abbreviated).day()
            : .dateTime.month(.abbreviated).day().year()
        return weekStart.formatted(style) + " – " + end.formatted(style)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(rangeLabel)
                .font(.headline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
        }
        .lineLimit(1)
        .textCase(nil)
        .padding(.horizontal, 32)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGroupedBackground))
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel("Week of " + weekStart.formatted(.dateTime.month(.wide).day()))
    }
}
