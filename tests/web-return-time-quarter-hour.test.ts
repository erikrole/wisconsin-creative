import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampToQuarterHour,
  minimumBookingEndDate,
  nextQuarterHourAfter,
  roundUpToQuarterHour,
} from "@/lib/quarter-hour";

function source(relativePath: string) {
  return readFileSync(`${process.cwd()}/${relativePath}`, "utf8");
}

describe("web return-time quarter-hour contract", () => {
  it("rounds forward across an hour without moving an exact boundary", () => {
    const exact = new Date("2026-08-26T13:45:00.000Z");
    expect(roundUpToQuarterHour(exact).toISOString()).toBe(exact.toISOString());
    expect(roundUpToQuarterHour(new Date("2026-08-26T13:52:00.000Z")).toISOString())
      .toBe("2026-08-26T14:00:00.000Z");
  });

  it("uses the first valid quarter-hour after the booking start or current time", () => {
    const start = new Date("2026-08-26T13:45:00.000Z");
    const now = new Date("2026-08-26T13:07:00.000Z");
    expect(minimumBookingEndDate(start, now).toISOString()).toBe("2026-08-26T14:00:00.000Z");

    const laterNow = new Date("2026-08-26T14:07:00.000Z");
    expect(minimumBookingEndDate(start, laterNow).toISOString()).toBe("2026-08-26T14:15:00.000Z");
  });

  it("clamps a choice to a rounded minimum", () => {
    const minimum = new Date("2026-08-26T13:08:00.000Z");
    expect(clampToQuarterHour(new Date("2026-08-26T13:00:00.000Z"), minimum).toISOString())
      .toBe("2026-08-26T13:15:00.000Z");
    expect(nextQuarterHourAfter(new Date("2026-08-26T13:45:00.000Z")).toISOString())
      .toBe("2026-08-26T14:00:00.000Z");
  });

  it("wires the shared policy into every active web return-time surface", () => {
    const picker = source("src/components/ui/date-time-picker.tsx");
    const inline = source("src/components/booking-details/InlineDateField.tsx");
    const wizard = source("src/components/booking-wizard/WizardStep1.tsx");
    const info = source("src/components/booking-details/BookingInfoCard.tsx");
    const sheet = source("src/components/booking-details/BookingSheetOverview.tsx");
    const detail = source("src/app/(app)/bookings/BookingDetailPage.tsx");

    expect(picker).toContain("clampToQuarterHour");
    expect(inline).toContain("clampToQuarterHour");
    expect(wizard).toContain("minDate={minimumEndDate}");
    expect(info).toContain("minDate={minimumEndDate}");
    expect(sheet).toContain("minDate={minimumEndDate}");
    expect(detail).toContain("nextQuarterHourAfter");
  });
});
