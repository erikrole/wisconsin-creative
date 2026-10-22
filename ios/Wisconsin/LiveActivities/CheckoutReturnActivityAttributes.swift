import ActivityKit
import Foundation

struct CheckoutReturnActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var endsAt: Date
        var now: Date
        var nextNeedAt: Date?
        /// Deliberately never rendered. Extend is an action taken on booking
        /// detail, not offered from a glance surface. The field stays on the
        /// wire because installed builds decode it as required, so the server
        /// dropping the key would break their updates.
        var allowsExtend: Bool
        var urgency: Urgency

        enum Urgency: String, Hashable {
            case normal
            case warning
            case critical
            case overdue
            case returned
        }
    }

    var bookingId: String
    var bookingTitle: String
    var requesterName: String
    var requesterInitials: String
    var requesterAvatarUrl: String?
    var returnTimeText: String
}

extension CheckoutReturnActivityAttributes.ContentState.Urgency: Codable {
    /// Tolerant decoding so an older installed build never fails to decode a
    /// content-state payload just because the server started sending an
    /// urgency value it doesn't know about yet. Unknown values fall back to
    /// `.normal` rather than throwing and dropping the whole update.
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = Self(rawValue: raw) ?? .normal
    }
}

extension CheckoutReturnActivityAttributes.ContentState {
    var isOverdue: Bool { now >= endsAt }

    func isOverdue(at date: Date) -> Bool {
        date >= endsAt
    }

    func minuteLabel(at date: Date) -> String {
        let seconds = Int(abs(endsAt.timeIntervalSince(date)).rounded())
        let minutes = max(1, seconds / 60)
        return isOverdue(at: date)
            ? "\(minutes) min overdue"
            : "\(minutes) min"
    }

    /// The countdown split into a large figure and a small unit, so the card
    /// can set the number big and the word quiet. Under an hour it is whole
    /// minutes; past that it is hours and minutes, which reads faster than
    /// "95 min" on a lock screen.
    func countdown(at date: Date) -> (value: String, unit: String) {
        let seconds = Int(abs(endsAt.timeIntervalSince(date)).rounded())
        let minutes = max(1, seconds / 60)
        let overdue = isOverdue(at: date)
        if minutes < 60 {
            return ("\(minutes)", overdue ? "min overdue" : "min left")
        }
        let value = "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m"
        return (value, overdue ? "overdue" : "left")
    }

    /// How much of the final two hours remains, for the thin track under the
    /// countdown: full at two hours out, empty at the return time. Overdue
    /// reads as empty rather than negative; the accent colour carries it.
    func remainingFraction(at date: Date) -> Double {
        let remaining = endsAt.timeIntervalSince(date)
        return min(1, max(0, remaining / (2 * 60 * 60)))
    }

    func urgency(at date: Date) -> Urgency {
        if urgency == .returned { return .returned }
        if endsAt <= date { return .overdue }
        let remaining = endsAt.timeIntervalSince(date)
        if remaining <= 10 * 60 { return .critical }
        if remaining <= 30 * 60 { return .warning }
        return urgency
    }

    /// Anchor for the glance surfaces' 60-second refresh lattice.
    ///
    /// A schedule anchored on render time ticks at whatever phase the activity
    /// happened to start or update on, so the minute label, the status symbol,
    /// and the 30- and 10-minute accent steps all trail their real boundary by
    /// up to 59 seconds -- the card can still read "1 min" once the return time
    /// has passed. Anchoring on `endsAt` puts every tick exactly where the
    /// displayed minute count changes. The returned date is the most recent
    /// lattice point at or before `date`, so the first entry the system asks
    /// for is never in the future.
    func minuteBoundaryAnchor(at date: Date) -> Date {
        var phase = endsAt.timeIntervalSince(date).truncatingRemainder(dividingBy: 60)
        if phase <= 0 { phase += 60 }
        return date.addingTimeInterval(phase - 60)
    }
}
