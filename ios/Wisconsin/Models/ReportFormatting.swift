import Foundation

/// Quiet labels for the read-only report screens. Product words, not enum words.
enum ReportFormatting {
    static func phrase(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { word -> String in
                switch word.lowercased() {
                case "ios": "iOS"
                case "macos": "macOS"
                case "·": "·"
                default:
                    let lower = word.lowercased()
                    guard let first = lower.first else { return "" }
                    return first.uppercased() + lower.dropFirst()
                }
            }
            .joined(separator: " ")
    }

    static func percent(_ rate: Double) -> String {
        let pct = rate * 100
        if abs(pct) < 10 { return String(format: "%.1f%%", pct) }
        return "\(Int(pct.rounded()))%"
    }

    static func days(_ value: Double) -> String {
        if value < 10 { return String(format: "%.1f", value) }
        return "\(Int(value.rounded()))"
    }

    static func count(_ value: Int) -> String {
        value.formatted()
    }

    static func timestamp(_ iso: String) -> String {
        guard let date = parsedTimestamp(iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    static func dayLabel(_ ymd: String) -> String {
        guard let date = ReportTrendPoint.parseDay(ymd) else { return ymd }
        return date.formatted(
            Date.FormatStyle(timeZone: TimeZone(secondsFromGMT: 0) ?? .gmt)
                .month(.abbreviated)
                .day()
        )
    }

    static func bookingStatus(status: String, isOverdue: Bool) -> (label: String, tone: StatusTone) {
        if isOverdue { return ("Overdue", .red) }
        switch status {
        case "OPEN": return ("Checked out", .blue)
        case "COMPLETED": return ("Completed", .gray)
        case "CANCELLED": return ("Cancelled", .gray)
        case "BOOKED": return ("Reserved", .purple)
        case "PENDING_PICKUP": return ("Pending pickup", .orange)
        case "DRAFT": return ("Draft", .gray)
        default: return (phrase(status), .gray)
        }
    }

    static func unitStatus(_ status: String) -> (label: String, tone: StatusTone) {
        switch status {
        case "LOST": return ("Missing", .red)
        case "CHECKED_OUT": return ("Checked out", .blue)
        case "AVAILABLE": return ("Available", .green)
        case "RETIRED": return ("Retired", .gray)
        default: return (phrase(status), .gray)
        }
    }

    static func scanPhase(_ phase: String?) -> String {
        switch phase {
        case "CHECKOUT": "Checkout"
        case "CHECKIN": "Check-in"
        case .none, "": "Scan"
        default: phrase(phase ?? "")
        }
    }

    /// Prior-window comparison. An empty prior window shows the raw difference
    /// so the label never claims an infinite percentage.
    static func countDelta(current: Int, previous: Int?, window: String) -> ReportDelta? {
        guard let previous else { return nil }
        let difference = current - previous
        if difference == 0 {
            return ReportDelta(
                text: "No change",
                systemImage: "minus",
                tone: .gray,
                accessibilityText: "no change from the previous \(window)"
            )
        }
        let rising = difference > 0
        let text: String
        if previous == 0 {
            text = "\(rising ? "+" : "")\(difference)"
        } else {
            let pct = (Double(difference) / Double(previous)) * 100
            let magnitude = abs(pct) < 10 ? String(format: "%.1f", pct) : "\(Int(pct.rounded()))"
            text = "\(rising ? "+" : "")\(magnitude)%"
        }
        return ReportDelta(
            text: text,
            systemImage: rising ? "arrow.up.right" : "arrow.down.right",
            tone: rising ? .green : .red,
            accessibilityText: "\(text) versus the previous \(window)"
        )
    }

    static func scanWindowStart(days: Int, now: Date = Date()) -> String? {
        guard days > 0 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: now.addingTimeInterval(-Double(days) * 86_400))
    }

    static func parsedTimestamp(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

struct ReportDelta: Equatable {
    let text: String
    let systemImage: String
    let tone: StatusTone
    let accessibilityText: String
}
