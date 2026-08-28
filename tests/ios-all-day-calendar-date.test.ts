import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calendarDate } from "@/lib/format";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
const eventDetail = source("ios/Wisconsin/Views/EventDetailSheet.swift");
const bookingRows = source("ios/Wisconsin/Views/CreateBooking/CreateBookingFormRows.swift");
const bookingViews = source("ios/Wisconsin/Views/CreateBooking/CreateBookingEventViews.swift");
const calendarSync = source("src/lib/services/calendar-sync.ts");

describe("iOS all-day events display their encoded calendar date", () => {
  it("still stores imported all-day events at UTC midnight", () => {
    // The premise for everything below. If this write ever changes, the iOS
    // UTC-component read has to change with it.
    expect(calendarSync).toContain("return { date: new Date(Date.UTC(year, month, day)), allDay: true };");
  });

  it("web already reads that instant back as a calendar date", () => {
    // Central: 2026-06-17T00:00:00Z is Jun 16 in local time. `calendarDate` is
    // the behaviour the native surfaces are matching.
    const utcMidnight = "2026-06-17T00:00:00.000Z";
    expect(calendarDate(utcMidnight, true).getDate()).toBe(17);
    expect(calendarDate(utcMidnight, true).getMonth()).toBe(5);
  });

  it("exposes the resolved span days the views need", () => {
    expect(models).toContain("var displayStartDay: Date { spanStartDay }");
    expect(models).toContain("var displayEndDay: Date { spanEndDay }");
  });

  it("decides live/ended by calendar day for all-day events", () => {
    // Comparing the raw instants marked a one-day all-day event live from ~7pm
    // the evening before and "Ended" at ~7pm on the day itself.
    expect(models).toContain("func timeState(now: Date) -> ScheduleEventTimeState");
    expect(models).toContain("guard displayAllDay else {");
    expect(models).toContain("if today > displayEndDay { return .past }");
    expect(models).toContain("if today >= displayStartDay { return .live }");
    // Timed events keep instant precision.
    expect(models).toContain("if endsAt <= now { return .past }");
    expect(models).toContain("if startsAt <= now { return .live }");
  });

  it("titles Event detail with the resolved day, not the raw instant", () => {
    expect(eventDetail).toContain("detailDateLabel(event.displayStartDay, abbreviatedWeekday: false)");
    expect(eventDetail).toContain("detailDateLabel(event.displayStartDay, abbreviatedWeekday: true)");
    expect(eventDetail).toContain("detailDateLabel(event.displayEndDay, abbreviatedWeekday: true)");
    expect(eventDetail).not.toContain("detailDateLabel(event.startsAt");
    // The countdown reads the same day the header prints.
    expect(eventDetail).toContain("let eventDay = event.displayStartDay");
    expect(eventDetail).not.toContain("calendar.startOfDay(for: event.startsAt)");
  });

  it("dates the Create Booking event picker the same way", () => {
    expect(bookingRows).toContain("displayStartDay.formatted(date: .abbreviated, time: .omitted)");
    expect(bookingRows).toContain("let day = displayAllDay ? displayStartDay : startsAt");
    // An all-day row has no clock time to show.
    expect(bookingRows).toContain(
      "? day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())"
    );
  });
});

describe("iOS Create Booking resolves venue like Schedule does", () => {
  it("labels, colours, and filters from the resolved venue", () => {
    // Same payload (/api/calendar-events) and same model as Schedule, so a
    // neutral game flagged isHome == true was listed Home here while the
    // Schedule tab showed it as Neutral.
    expect(bookingRows).toContain("switch venue {");
    expect(bookingRows).toContain("venueRailColor(for: self)");
    expect(bookingRows).not.toContain("venueRailColor(isHome: isHome)");
    expect(bookingViews).toContain("case .home: return event.venue == .home");
    expect(bookingViews).toContain("case .neutral: return event.venue == .neutral");
    expect(bookingViews).not.toContain("event.isHome == nil");
  });

  it("treats a blank opponent as a non-game, the way web does", () => {
    // venueToneFromEvent tests `!event.opponent`, so "" is a non-game there.
    expect(models).toContain(
      "guard let opponent, !opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {"
    );
    const iosTests = source("ios/WisconsinTests/ScheduleDateMathTests.swift");
    expect(iosTests).toContain("blankOpponentIsANonGame");
  });
});
