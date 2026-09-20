import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk all-day event contract", () => {
  it("keeps all-day kiosk events date-only and call-time free", () => {
    const route = source("src/app/api/kiosk/dashboard/route.ts");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const formatting = source("ios/Wisconsin/Kiosk/KioskDateFormatting.swift");
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const eventSheet = source("ios/Wisconsin/Kiosk/KioskEventDetailSheet.swift");

    expect(route).toContain("allDay: true");
    expect(route).toContain("isAllDaySpan(e.startsAt, e.endsAt, env.appTimezone)");
    expect(route).toContain("callStartsAt: allDay ? null : callStartsAt");
    expect(models).toContain("let allDay: Bool");
    expect(models).toContain("decodeIfPresent(Bool.self, forKey: .allDay) ?? false");
    expect(models).toContain("var displayAllDay: Bool");
    expect(models).toContain("allDay || hasLocalMidnightSpan");
    expect(formatting).toContain("var kioskDisplayStartDay: Date");
    expect(formatting).toContain('TimeZone(identifier: "UTC")');
    expect(formatting).toContain("func kioskOccurs(on day: Date, calendar: Calendar = .current) -> Bool");
    expect(idle).toContain("let todayEvents = dashboard.events.filter { $0.kioskOccurs(on: today, calendar: calendar) }");
    expect(idle).toContain("let tomorrowEvents = dashboard.events.filter { $0.kioskOccurs(on: tomorrow, calendar: calendar) }");
    expect(idle).not.toContain("Calendar.current.isDateInToday($0.startsAt)");
    expect(idle).not.toContain("Calendar.current.isDateInTomorrow($0.startsAt)");
    expect(eventSheet).toContain("if event.displayAllDay {\n            return \"All day\"");
    expect(eventSheet).toContain("let displayDay = event.kioskDisplayStartDay");
    expect(eventSheet).toContain("let start = event.kioskDisplayStartDay");
    expect(eventSheet).toContain("let end = event.kioskDisplayEndDay");
    expect(eventSheet).toContain("if !event.displayAllDay {\n                        KioskEventTimeRow(label: \"Call\", value: callTimeLabel)");
    expect(eventSheet).toContain("KioskEventWorkerRow(user: user, eventAllDay: event.displayAllDay)");
  });
});
