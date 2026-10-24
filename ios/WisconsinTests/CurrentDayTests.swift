import Testing
import Foundation
@testable import Wisconsin

/// Relative-day labels must measure from an injected day, never the wall
/// clock. An app left open overnight showed Friday's events under "Tomorrow"
/// on Friday morning because the label was computed against Thursday.
struct CurrentDayTests {
    private func local(_ month: Int, _ day: Int, _ hour: Int = 12) -> Date {
        Calendar.current.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour))!
    }

    @Test func dayOffsetCountsCalendarDaysNotIntervals() {
        let cal = Calendar.current
        // 11 PM Thursday to 1 AM Friday is two hours but one calendar day.
        #expect(cal.dayOffset(of: local(10, 2, 1), from: local(10, 1, 23)) == 1)
        #expect(cal.dayOffset(of: local(10, 2, 23), from: local(10, 2, 0)) == 0)
        #expect(cal.dayOffset(of: local(10, 1, 23), from: local(10, 2, 1)) == -1)
    }

    @Test func operationalDayLabelFollowsInjectedDayAcrossMidnight() {
        let friday = local(10, 2)
        #expect(friday.operationalDayLabel(now: local(10, 1, 23)) == "Tomorrow")
        #expect(friday.operationalDayLabel(now: local(10, 2, 0)) == "Today")
        #expect(friday.operationalDayLabel(now: local(10, 3, 7)) == "Yesterday")
    }

    /// The app installs America/Chicago as the default zone at launch. Tonight's
    /// 7 PM game is still "Today" at 8:30 PM Central even though UTC has already
    /// rolled to the next day (2026-10-24T01:30Z).
    @Test func chicagoDefaultKeepsTonightOnToday() {
        let previous = NSTimeZone.default
        NSTimeZone.default = NotificationPrefsViewModel.appTimeZone
        defer { NSTimeZone.default = previous }
        let now = Date(timeIntervalSince1970: 1_792_805_400) // 2026-10-24T01:30:00Z
        let later = Date(timeIntervalSince1970: 1_792_808_400) // 2026-10-24T02:20:00Z
        #expect(later.operationalDayLabel(now: now) == "Today")
        #expect(Calendar.current.component(.day, from: now) == 23)
    }
}

extension CurrentDayTests {
    /// `.formatted` ignores NSTimeZone.default, so the app pins Central itself:
    /// 2027-02-01T18:00Z is 12:00 PM in Chicago whatever zone the system is in.
    @Test func formattedTimesAreCentralNotSystem() {
        let date = Date(timeIntervalSince1970: 1_801_504_800) // 2027-02-01T18:00:00Z
        let text = date.formatted(Date.FormatStyle(date: .omitted, time: .shortened))
        let styled = date.formatted(.dateTime.hour().minute())
        #expect(text.contains("12:00"))
        #expect(styled.contains("12:00"))
    }
}
