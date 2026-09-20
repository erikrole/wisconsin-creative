import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("native TipKit feature discovery", () => {
  const app = source("ios/Wisconsin/App/WisconsinApp.swift");
  const bookings = source("ios/Wisconsin/Views/BookingsView.swift");
  const composer = source("ios/Wisconsin/Views/CreateBookingSheet.swift");
  const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");
  const tabs = source("ios/Wisconsin/Views/AppTabView.swift");
  const profile = source("ios/Wisconsin/Views/ProfileView.swift");
  const search = source("ios/Wisconsin/Views/Search/GlobalSearchSheet.swift");

  it("configures persistent tips once in the main app", () => {
    expect(app).toContain("import TipKit");
    expect(app).toContain("try? Tips.configure(");
    expect(app.match(/Tips\.configure\(/g)).toHaveLength(1);
  });

  it("defines one-display tips for reservations and Schedule Open Work", () => {
    expect(app).toContain("struct NewReservationTip: Tip");
    expect(app).toContain("struct MinimizeReservationTip: Tip");
    expect(app).toContain("struct ScheduleOpenWorkTip: Tip");
    expect(app).toContain("struct ShiftCalendarTip: Tip");
    expect(app).toContain("struct MyAvailabilityTip: Tip");
    expect(app).toContain("struct ScanReservationGearTip: Tip");
    expect(app).toContain("struct ResumeReservationTip: Tip");
    expect(app.match(/MaxDisplayCount\(1\)/g)).toHaveLength(7);
  });

  it("attaches and completes the reservation creation tip", () => {
    expect(bookings).toContain("private let newReservationTip = NewReservationTip()");
    expect(bookings).toContain(".popoverTip(newReservationTip, arrowEdge: .top)");
    expect(bookings).toContain(
      "newReservationTip.invalidate(reason: .actionPerformed)",
    );
  });

  it("attaches and completes the reservation minimization tip", () => {
    expect(composer).toContain(
      "private let minimizeReservationTip = MinimizeReservationTip()",
    );
    expect(composer).toContain(
      ".popoverTip(minimizeReservationTip, arrowEdge: .top)",
    );
    expect(composer).toContain(
      "minimizeReservationTip.invalidate(reason: .actionPerformed)",
    );
  });

  it("attaches and completes the Schedule Open Work tip", () => {
    expect(schedule).toContain(
      "private let scheduleOpenWorkTip = ScheduleOpenWorkTip()",
    );
    expect(schedule).toContain(
      ".popoverTip(scheduleOpenWorkTip, arrowEdge: .top)",
    );
    expect(schedule).toContain(
      "scheduleOpenWorkTip.invalidate(reason: .actionPerformed)",
    );
  });

  it("waits for repeated Schedule use before surfacing calendar and availability", () => {
    expect(app).toContain(
      'static let openedSchedule = Tips.Event(id: "internal-schedule-opened")',
    );
    expect(app.match(/#Rule\(ShiftCalendarTip\.openedSchedule\)/g)).toHaveLength(
      1,
    );
    expect(app).toContain("#Rule(Self.openedSchedule)");
    expect(app.match(/\$0\.donations\.count >= 3/g)).toHaveLength(2);
    expect(tabs).toContain(
      "await ShiftCalendarTip.openedSchedule.donate()",
    );
    expect(tabs).toContain("guard newValue == 4 else { return }");
    expect(schedule).toContain(
      ".popoverTip(shiftCalendarTip, arrowEdge: .top)",
    );
    expect(schedule).toContain(
      "shiftCalendarTip.invalidate(reason: .actionPerformed)",
    );
    expect(profile).toContain(
      ".popoverTip(myAvailabilityTip, arrowEdge: .bottom)",
    );
    expect(profile).toContain(
      "myAvailabilityTip.invalidate(reason: .actionPerformed)",
    );
  });

  it("surfaces continuous scan only after entering reservation Gear", () => {
    expect(app).toContain(
      'static let openedGearStep = Tips.Event(id: "reservation-gear-step-opened")',
    );
    expect(composer).toContain(
      "await ScanReservationGearTip.openedGearStep.donate()",
    );
    expect(composer).toContain(
      ".popoverTip(scanReservationGearTip, arrowEdge: .top)",
    );
    expect(composer).toContain(
      "scanReservationGearTip.invalidate(reason: .actionPerformed)",
    );
  });

  it("surfaces the resume card only after a reservation is minimized", () => {
    expect(app).toContain(
      'static let minimizedReservation = Tips.Event(id: "reservation-minimized")',
    );
    expect(tabs).toContain(
      "await ResumeReservationTip.minimizedReservation.donate()",
    );
    expect(tabs).toContain(
      ".popoverTip(resumeReservationTip, arrowEdge: .bottom)",
    );
    expect(tabs).toContain(
      "resumeReservationTip.invalidate(reason: .actionPerformed)",
    );
  });

  it("does not duplicate the existing Scan discovery and permission UI", () => {
    expect(search).not.toContain("popoverTip");
    expect(search).not.toContain("TipView");
  });
});
