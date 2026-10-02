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
}
