import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

function between(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to);
}

describe("iOS kiosk custody robustness", () => {
  it("refreshes pickup and return lists when a scan response is missing or already claimed", () => {
    const pickup = source("ios/Wisconsin/Kiosk/KioskPickupView.swift");
    const returning = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");
    const pickupScan = between(pickup, "private func processNextScanIfNeeded()", "private func acceptScan");
    const returnScan = between(returning, "private func processNextScanIfNeeded()", "private func showFeedback");

    expect(pickupScan).toContain('result.errorCode == "duplicate"');
    expect(pickupScan).toContain("await loadDetail(showLoading: false)");
    expect(returnScan).toContain("await loadDetail(showLoading: false)");
    expect(returning).toContain("private func loadDetail(showLoading: Bool = true)");
  });

  it("buckets kiosk due days and night hours in America/Chicago", () => {
    const formatting = source("ios/Wisconsin/Kiosk/KioskDateFormatting.swift");
    const app = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");
    const home = source("ios/Wisconsin/Kiosk/KioskHomeView.swift");
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const hub = source("ios/Wisconsin/Kiosk/KioskOperatorHubView.swift");
    const details = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailsStep.swift");
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");

    expect(formatting).toContain('TimeZone(identifier: "America/Chicago")');
    expect(formatting).toContain("func providesKioskDay()");
    expect(formatting).toContain(".NSCalendarDayChanged");
    expect(app).toContain(".providesKioskDay()");
    expect(app).not.toContain(".providesCurrentDay()");
    expect(home).toContain("checkout.isDueToday");
    expect(home).toContain("KioskTime.calendar");
    expect(idle).toContain("KioskTime.calendar");
    expect(idle).not.toContain("Calendar.current.component(.hour, from: date)");
    expect(hub).toContain("checkout.isDueToday");
    expect(hub).toContain("KioskTime.calendar");
    expect(details).toContain("KioskTime.calendar");
    expect(models).toContain("let isDueToday: Bool?");
    expect(source("ios/Wisconsin/App/WisconsinApp.swift")).toContain(".providesCurrentDay()");
  });
});
