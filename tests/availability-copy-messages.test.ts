import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availabilityConflictMessage,
  availabilityRiskBadgeLabel,
  availabilityRiskMessage,
  formatAvailabilityDeadline,
  formatAvailabilityDuration,
  kioskAvailabilityBlockMessage,
  kioskHeldItemMessage,
  riskLabel,
  riskTitle,
  statusText,
  upcomingCommitmentLabel,
  upcomingCommitmentTitle,
} from "@/lib/availability-copy";

const conflict = {
  conflictingBookingTitle: "Football travel case",
  startsAt: "2026-10-31T15:00:00.000Z",
  endsAt: "2026-10-31T23:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("conflict times", () => {
  it("are written in the app's timezone, not the server's", () => {
    // The kiosk builds this sentence on the server, which runs in UTC.
    vi.stubEnv("APP_TIMEZONE", "America/Denver");

    expect(availabilityConflictMessage(conflict)).toBe(
      "Conflict with Football travel case (Oct 31, 9:00 AM–Oct 31, 5:00 PM); choose another item or change the dates.",
    );
  });

  it("say when to return or when the item frees up, with the one-hour turnaround", () => {
    expect(availabilityConflictMessage(conflict, { currentEndsAt: "2026-10-31T12:00:00.000Z" }))
      .toBe("Conflict with Football travel case (Oct 31, 10:00 AM–Oct 31, 6:00 PM); return by Oct 31, 9:00 AM.");
    expect(availabilityConflictMessage(conflict, { currentStartsAt: "2026-11-01T02:00:00.000Z" }))
      .toBe("Conflict with Football travel case (Oct 31, 10:00 AM–Oct 31, 6:00 PM); available after Oct 31, 7:00 PM.");
  });

  it("fall back to plain advice without usable times or a title", () => {
    expect(availabilityConflictMessage({ startsAt: "soon", endsAt: "later" }))
      .toBe("Conflict with another booking. Choose another item or change the dates.");
  });

  it("use the scheduled end time when the deadline is unreadable", () => {
    expect(formatAvailabilityDeadline("not a date")).toBe("the scheduled end time");
  });
});

describe("kiosk block messages", () => {
  it.each([
    ["RETIRED", "ROAM2 is retired"],
    ["NOT_AVAILABLE_FOR_CHECKOUT", "ROAM2 is not enabled for checkout"],
    ["NOT_AVAILABLE_FOR_RESERVATION", "ROAM2 is not enabled for reservations"],
    ["NOT_AVAILABLE_FOR_COLLABORATORS", "ROAM2 is not available to collaborators"],
    ["NOT_FOUND", "ROAM2 was not found"],
    ["LOST", "ROAM2 is unavailable"],
  ])("names a %s item", (status, message) => {
    expect(kioskAvailabilityBlockMessage({ unavailableAssets: [{ status }] }, "ROAM2")).toBe(message);
  });

  it("falls back to the conflict sentence for a shared travel case with no named holder", () => {
    expect(kioskAvailabilityBlockMessage({ conflicts: [conflict] }, "ROAM2")).toMatch(/^Conflict with Football travel case/);
  });

  it("names a generic item when the name is blank", () => {
    expect(kioskAvailabilityBlockMessage({ unavailableAssets: [{ status: "MAINTENANCE" }] }, "  ")).toBe("This item is in maintenance");
    expect(kioskAvailabilityBlockMessage({ shortages: [{ requested: 3, available: 0 }] }, " ")).toBe("Only 0 that counted item available; this request needs 3");
    expect(kioskAvailabilityBlockMessage({}, "")).toBe("This item is not available");
  });

  it("explains a held unit by its own status when nobody holds it", () => {
    expect(kioskHeldItemMessage({ itemName: "Battery #7", status: "MAINTENANCE" })).toBe("Battery #7 is in maintenance");
    expect(kioskHeldItemMessage({ itemName: "Battery #7", status: "BOOKED" })).toBe("Battery #7 is already checked out");
    expect(kioskHeldItemMessage({ itemName: "" })).toBe("This item is already checked out");
  });
});

describe("risk messages", () => {
  it("adds the gap only when the turnaround is critical", () => {
    const startsAt = "2026-10-31T15:00:00.000Z";

    expect(availabilityRiskMessage({ code: "SHORT_TURNAROUND", startsAt, gapMinutes: 90 }))
      .toBe("Needed next at Oct 31, 10:00 AM · return by Oct 31, 9:00 AM (1h 30m gap)");
    expect(availabilityRiskMessage({ code: "SHORT_TURNAROUND", startsAt, gapMinutes: 300 }))
      .toBe("Needed next at Oct 31, 10:00 AM · return by Oct 31, 9:00 AM");
    expect(availabilityRiskMessage({ code: "BULK_SHORT_TURNAROUND", startsAt, plannedQuantity: 4, gapMinutes: 30 }))
      .toBe("Next booking needs 4 at Oct 31, 10:00 AM · return by Oct 31, 9:00 AM (30m gap)");
    expect(availabilityRiskMessage({ code: "BULK_SHORT_TURNAROUND", startsAt }))
      .toBe("Next booking needs the next quantity at Oct 31, 10:00 AM · return by Oct 31, 9:00 AM");
  });

  it("uses the server's message or a default when timing is missing", () => {
    expect(availabilityRiskMessage({ code: "SHORT_TURNAROUND", message: "Due back soon" })).toBe("Due back soon");
    expect(availabilityRiskMessage({ code: "BULK_SHORT_TURNAROUND" })).toBe("Tight timing — confirm the return time.");
    expect(availabilityRiskMessage({ code: "LOCATION_TRANSFER", nextLocationName: "Kohl Center" })).toBe("Needed next at Kohl Center; confirm transfer time.");
    expect(availabilityRiskMessage({ code: "LOCATION_TRANSFER" })).toBe("Needed next at another location; confirm transfer time.");
    expect(availabilityRiskMessage({ code: "RECENT_CHECKIN_REPORT", reportType: "DAMAGED" })).toBe("Recent damage report — inspect before reserving.");
    expect(availabilityRiskMessage({ code: "RECENT_CHECKIN_REPORT" })).toBe("Recent condition report — inspect before reserving.");
    expect(availabilityRiskMessage({})).toBe("Availability notice — confirm the handoff timing.");
  });

  it("labels badges by kind and severity", () => {
    expect(availabilityRiskBadgeLabel({ code: "RECENT_CHECKIN_REPORT", reportType: "LOST" })).toBe("Lost report");
    expect(availabilityRiskBadgeLabel({ code: "SHORT_TURNAROUND", severity: "critical" })).toBe("Tight timing");
    expect(availabilityRiskBadgeLabel({ code: "BULK_SHORT_TURNAROUND", severity: "warning" })).toBe("Turnaround");
    expect(availabilityRiskBadgeLabel({ severity: "critical" })).toBe("Tight timing");
    expect(availabilityRiskBadgeLabel({})).toBe("Notice");
  });

  it("leads with the critical risk and counts the rest", () => {
    const risks = [
      { message: "Watch the return", severity: "warning" as const },
      { message: "Needed right after", severity: "critical" as const },
    ];

    expect(riskLabel(risks)).toBe("Needed right after +1");
    expect(riskLabel([risks[0]!])).toBe("Watch the return");
    expect(riskLabel([])).toBeNull();
    expect(riskTitle(risks)).toBe("Watch the return · Needed right after");
    expect(riskTitle(undefined)).toBe("Availability notice");
  });
});

describe("small labels", () => {
  it("formats durations, statuses and the next commitment", () => {
    expect(formatAvailabilityDuration(45)).toBe("45m");
    expect(formatAvailabilityDuration(120)).toBe("2h");
    expect(statusText("PENDING_PICKUP")).toBe("pending pickup");
    expect(upcomingCommitmentTitle({ startsAt: "2026-10-31T15:00:00.000Z", bookingTitle: "Volleyball" })).toBe("Needed next for Volleyball");
    expect(upcomingCommitmentTitle({ startsAt: "2026-10-31T15:00:00.000Z" })).toBe("Needed next by another booking");
  });

  it("labels the next commitment without a usable window", () => {
    expect(upcomingCommitmentLabel({ startsAt: "nope" })).toBe("Needed next");
    expect(upcomingCommitmentLabel({ startsAt: "2026-10-31T15:00:00.000Z" })).toBe("Needed next at Oct 31, 10:00 AM");
    expect(upcomingCommitmentLabel({ startsAt: "2026-10-31T15:00:00.000Z" }, "nope")).toBe("Needed next at Oct 31, 10:00 AM");
    expect(upcomingCommitmentLabel({ startsAt: "2026-10-31T15:00:00.000Z" }, "2026-10-31T09:00:00.000Z"))
      .toBe("Needed next at Oct 31, 10:00 AM · return by Oct 31, 9:00 AM");
  });
});
