import SwiftUI

// MARK: - Form Card Components

struct FormCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content()
        }
        .brandCard()
    }
}

struct FormPickerRow<Leading: View>: View {
    let label: String
    let value: String
    @ViewBuilder var leading: () -> Leading

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            leading()
            Text(value)
                .font(.body)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .frame(minHeight: 36)
        .contentShape(Rectangle())
    }
}

extension FormPickerRow where Leading == EmptyView {
    init(label: String, value: String) {
        self.init(label: label, value: value) { EmptyView() }
    }
}

extension ScheduleEvent {
    var shortBookingEventTitle: String {
        let code = sportCode?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let code, !code.isEmpty, let opponent, !opponent.isEmpty {
            let prefix = isHome == false ? "at" : "vs"
            return "\(code) \(prefix) \(opponent)"
        }
        return summary
    }

    var bookingEventSubtitle: String {
        let venueName = location?.name
        let venuePrefix: String? = switch venue {
        case .home: "Home"
        case .away: "Away"
        case .neutral, .nonGame: nil
        }
        return [bookingEventDateText, venuePrefix, venueName]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    /// The resolved venue, not the raw `isHome` tri-state.
    ///
    /// This picker reads `/api/calendar-events`, the one payload that carries
    /// `site` -- so a game stored as neutral but flagged `isHome == true` was
    /// listed here as "Home" with a green rail while the Schedule tab, which
    /// resolves venue properly, showed the same row as Neutral.
    var bookingEventScopeLabel: String {
        switch venue {
        case .home: return "Home"
        case .away: return "Away"
        case .neutral: return "Neutral"
        case .nonGame: return "Non-game"
        }
    }

    /// Date-only for all-day events, and read off the resolved calendar day.
    /// The raw instant of an imported all-day event is UTC midnight, so this
    /// used to name the previous evening and stamp a meaningless "12:00 AM"
    /// on it.
    private var bookingEventDateText: String {
        displayAllDay
            ? displayStartDay.formatted(date: .abbreviated, time: .omitted)
            : startsAt.formatted(date: .abbreviated, time: .shortened)
    }

    var bookingEventPickerDate: String {
        let day = displayAllDay ? displayStartDay : startsAt
        let month = day.formatted(.dateTime.month(.abbreviated))
        let formatted = displayAllDay
            ? day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            : day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
        return formatted.replacingOccurrences(of: "\(month) ", with: "\(month). ")
    }

    /// The same venue Schedule rows and Event detail name — see
    /// `scheduleEventVenueName`.
    ///
    /// This used to keep only the last comma component and rewrite
    /// "Track/Soccer" to "Soccer". That read correctly for the one feed shape it
    /// was written against ("Madison, WI, McClimon Track/Soccer Complex") and
    /// wrongly for the others: a venue-last string like "Camp Randall Stadium,
    /// Madison, WI" named the venue "WI". The venue-specific rewrite went with
    /// it — the row is one truncating line and was never short on the six
    /// characters it bought.
    var bookingEventPickerVenue: String? {
        scheduleEventVenueName(self)
    }

    var bookingEventPickerDetail: String {
        guard let venue = bookingEventPickerVenue else { return bookingEventPickerDate }
        return "\(bookingEventPickerDate), \(venue)"
    }

    var bookingEventRailColor: Color {
        venueRailColor(for: self)
    }
}
