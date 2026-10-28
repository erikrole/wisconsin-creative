import Foundation

/// One student worker from `GET /api/availability/team` (ADMIN/STAFF only).
/// Blocks reuse `AvailabilityBlock`; dates are YYYY-MM-DD, times HH:mm.
struct TeamAvailabilityStudent: Decodable, Identifiable {
    let id: String
    let name: String
    let avatarUrl: String?
    let blocks: [AvailabilityBlock]
}

struct TeamAvailabilityResponse: Decodable {
    let data: [TeamAvailabilityStudent]
}

/// Calendar-day math for the team grid. Everything is a `yyyy-MM-dd` key so
/// the venue timezone (America/Chicago) never shifts a block to the wrong
/// day; mirrors `src/lib/team-availability.ts`.
enum TeamAvailabilityDays {
    static let timeZone = TimeZone(identifier: "America/Chicago") ?? .current

    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static func formatter(_ zone: TimeZone) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = zone
        return f
    }

    /// Today's key in America/Chicago.
    static func todayKey(now: Date = .now) -> String {
        formatter(timeZone).string(from: now)
    }

    private static func date(_ key: String) -> Date? {
        formatter(utc.timeZone).date(from: key)
    }

    static func addDays(_ key: String, _ days: Int) -> String {
        guard let d = date(key), let r = utc.date(byAdding: .day, value: days, to: d) else { return key }
        return formatter(utc.timeZone).string(from: r)
    }

    /// 0 = Sunday … 6 = Saturday.
    static func weekday(_ key: String) -> Int {
        guard let d = date(key) else { return 0 }
        return utc.component(.weekday, from: d) - 1
    }

    static func weekStart(of key: String) -> String {
        addDays(key, -((weekday(key) + 6) % 7))
    }

    static func weekKeys(of key: String) -> [String] {
        let start = weekStart(of: key)
        return (0..<7).map { addDays(start, $0) }
    }

    static func dayNumber(_ key: String) -> Int {
        Int(key.suffix(2)) ?? 0
    }

    static func title(_ key: String) -> String {
        guard let d = date(key) else { return key }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = utc.timeZone
        f.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        return f.string(from: d)
    }

    static func weekRangeTitle(_ key: String) -> String {
        let keys = weekKeys(of: key)
        guard let a = date(keys[0]), let b = date(keys[6]) else { return "" }
        let f = DateIntervalFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = utc.timeZone
        f.dateTemplate = "MMMd"
        return f.string(from: a, to: b)
    }

    /// Blocks that apply on a calendar day, denied ones excluded, all-day first.
    static func blocks(_ blocks: [AvailabilityBlock], on key: String) -> [AvailabilityBlock] {
        let dow = weekday(key)
        return blocks
            .filter { b in
                if b.status == "DENIED" { return false }
                if b.kind == "AD_HOC" {
                    guard let start = b.date.map({ String($0.prefix(10)) }) else { return false }
                    let end = b.dateEndsOn.map { String($0.prefix(10)) } ?? start
                    return key >= start && key <= end
                }
                guard b.dayOfWeek == dow else { return false }
                if let s = b.semesterStartsOn, key < String(s.prefix(10)) { return false }
                if let e = b.semesterEndsOn, key > String(e.prefix(10)) { return false }
                return true
            }
            .sorted {
                let la = $0.allDay == true, lb = $1.allDay == true
                if la != lb { return la }
                return $0.startsAt < $1.startsAt
            }
    }
}
