import Foundation

/// Centralized date formats so a copy change touches one file.
extension Date {
    /// "Apr 24, 4:30 PM" — list rows, headers.
    var gearShort: String {
        formatted(date: .abbreviated, time: .shortened)
    }

    /// "Friday, April 24, 2026 at 4:30 PM" — detail headers.
    var gearLong: String {
        formatted(date: .complete, time: .shortened)
    }

    /// "4:30 PM" — time-only.
    var gearTime: String {
        formatted(date: .omitted, time: .shortened)
    }

    /// "Apr 24" — calendar header chips.
    var gearDay: String {
        formatted(.dateTime.month(.abbreviated).day())
    }

    /// Context-first day label shared by Booking list and detail.
    /// Nearby dates prioritize recognition; farther dates stay compact and omit the year.
    func operationalDayLabel(now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDate(self, inSameDayAs: now) { return "Today" }
        if calendar.isDateInTomorrow(self) { return "Tomorrow" }
        if calendar.isDateInYesterday(self) { return "Yesterday" }

        let dayDistance = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: self)
        ).day ?? 7
        return abs(dayDistance) < 7
            ? formatted(.dateTime.weekday(.wide))
            : formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    /// "Sep 19, 8:30 AM" — omits the year when it matches `now`.
    func compactReservationDateTime(now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.component(.year, from: self) == calendar.component(.year, from: now) {
            return formatted(.dateTime.month(.abbreviated).day().hour().minute())
        }
        return formatted(date: .abbreviated, time: .shortened)
    }

    /// Same-day windows collapse to "Sep 19, 8:30 AM–9:30 AM".
    static func compactReservationWindow(from start: Date, to end: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDate(start, inSameDayAs: end) {
            let day = calendar.component(.year, from: start) == calendar.component(.year, from: now)
                ? start.formatted(.dateTime.month(.abbreviated).day())
                : start.formatted(date: .abbreviated, time: .omitted)
            return "\(day), \(start.gearTime)–\(end.gearTime)"
        }
        return "\(start.compactReservationDateTime(now: now))–\(end.compactReservationDateTime(now: now))"
    }

    /// "Today at 3:00 PM", "Monday at 8:30 AM", or "Mon, Jul 27 at 8:30 AM".
    func operationalDateTimeLabel(now: Date = .now, capitalizesRelativeDay: Bool = true) -> String {
        let day = operationalDayLabel(now: now)
        let displayDay = !capitalizesRelativeDay && ["Today", "Tomorrow", "Yesterday"].contains(day)
            ? day.lowercased()
            : day
        return "\(displayDay) at \(gearTime)"
    }

    /// "Updated 5m ago" / "Updated just now" — freshness labels.
    var freshnessLabel: String {
        let interval = Date().timeIntervalSince(self)
        if interval < 30 { return "Updated just now" }
        let minutes = Int(interval / 60)
        if minutes < 1 { return "Updated \(Int(interval))s ago" }
        if minutes < 60 { return "Updated \(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "Updated \(hours)h ago" }
        return "Updated \(hours / 24)d ago"
    }
}

// MARK: - Countdown urgency (mirrors src/lib/format.ts)

/// Same four-level urgency taxonomy the web uses on booking detail.
enum UrgencyLevel {
    case overdue, critical, warning, normal

    /// Maps urgency → status tone for the countdown badge.
    var tone: StatusTone {
        switch self {
        case .overdue:  return .red
        case .critical: return .red
        case .warning:  return .orange
        case .normal:   return .blue
        }
    }
}

extension Date {
    /// Web parity with `getUrgency` in src/lib/format.ts. Returns:
    /// - `.overdue` once `endsAt` is in the past
    /// - `.critical` when ≤ 10% of the booking window remains
    /// - `.warning` when ≤ 25% remains
    /// - `.normal` otherwise
    static func bookingUrgency(startsAt: Date, endsAt: Date, now: Date = Date()) -> UrgencyLevel {
        let remaining = endsAt.timeIntervalSince(now)
        if remaining <= 0 { return .overdue }
        let duration = endsAt.timeIntervalSince(startsAt)
        if duration <= 0 { return .critical }
        let pctRemaining = remaining / duration
        if pctRemaining <= 0.10 { return .critical }
        if pctRemaining <= 0.25 { return .warning }
        return .normal
    }

    /// "DUE BACK IN 3 hours 12 minutes" / "OVERDUE BY 2 days 4 hours" — matches
    /// the web's `formatCountdown` so the live badge reads the same on both
    /// platforms.
    static func countdownLabel(for endsAt: Date, now: Date = Date()) -> String {
        let diff = endsAt.timeIntervalSince(now)
        let body = explicitDuration(seconds: diff)
        return diff <= 0 ? "OVERDUE BY \(body)" : "DUE BACK IN \(body)"
    }

    /// Live countdown to a booking's pickup/start window. Mirrors the due-back
    /// countdown but for the gap before custody begins, so an Awaiting-Pickup
    /// booking gets the same first-class urgency treatment as an active one.
    /// Returns the explicit duration body plus whether the window has passed
    /// (late) and the matching badge tone (blue → orange within 2h → red late).
    static func startCountdown(for startsAt: Date, now: Date = Date()) -> (body: String, isLate: Bool, tone: StatusTone) {
        let diff = startsAt.timeIntervalSince(now)
        if diff <= 0 {
            return (explicitDuration(seconds: diff), true, .red)
        }
        return (explicitDuration(seconds: diff), false, diff <= 7_200 ? .orange : .blue)
    }

    /// "5h" / "2d" / "12m" / "<1m" — bare magnitude of the distance from `now`,
    /// for compact list-row labels like "Due in 5h" or "Pickup 12m late".
    func compactMagnitude(now: Date = Date()) -> String {
        let absSec = Swift.abs(Int(self.timeIntervalSince(now).rounded()))
        if absSec >= 86_400 { return "\(absSec / 86_400)d" }
        if absSec >= 3_600 { return "\(absSec / 3_600)h" }
        if absSec >= 60 { return "\(absSec / 60)m" }
        return "<1m"
    }

    /// "2 days 3 hours" / "5 hours 12 minutes" / "8 minutes" / "less than a minute"
    /// — matches `formatExplicitDuration` on the web.
    private static func explicitDuration(seconds: TimeInterval) -> String {
        let abs = Swift.abs(Int(seconds.rounded()))
        let days = abs / 86_400
        let hours = (abs % 86_400) / 3_600
        let minutes = (abs % 3_600) / 60

        if days > 0 {
            var parts = ["\(days) \(days == 1 ? "day" : "days")"]
            if hours > 0 { parts.append("\(hours) \(hours == 1 ? "hour" : "hours")") }
            return parts.joined(separator: ", ")
        }
        if hours > 0 {
            var parts = ["\(hours) \(hours == 1 ? "hour" : "hours")"]
            if minutes > 0 { parts.append("\(minutes) \(minutes == 1 ? "minute" : "minutes")") }
            return parts.joined(separator: ", ")
        }
        if minutes > 0 { return "\(minutes) \(minutes == 1 ? "minute" : "minutes")" }
        return "less than a minute"
    }
}

extension Date {
    /// Elapsed-time phrasing for a deadline already passed, for the compact
    /// dashboard queue rows. Full booking rows state the absolute due time
    /// instead, matching how every other row reads.
    var overdueLabel: String {
        let hours = Int(-self.timeIntervalSinceNow / 3600)
        if hours < 24 { return "\(hours)h overdue" }
        let days = hours / 24
        return "\(days)d overdue"
    }

    var lateLabel: String {
        let minutes = Int(-self.timeIntervalSinceNow / 60)
        if minutes < 60 { return "\(max(minutes, 1))m late" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h late" }
        let days = hours / 24
        return "\(days)d late"
    }
}
