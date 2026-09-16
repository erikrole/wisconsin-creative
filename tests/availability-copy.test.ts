import { describe, expect, it } from "vitest";
import {
  availabilityBlockedItemMessage,
  availabilityConflictMessage,
  availabilityRiskBadgeLabel,
  availabilityRiskMessage,
  formatAvailabilityDuration,
  kioskAvailabilityBlockMessage,
  kioskHeldItemMessage,
  upcomingCommitmentLabel,
} from "@/lib/availability-copy";

describe("availability copy", () => {
  it("states the next-needed time and return-by time for a close handoff", () => {
    const label = upcomingCommitmentLabel(
      { startsAt: "2026-06-29T15:00:00.000Z", bookingTitle: "Next shoot" },
      "2026-06-29T13:30:00.000Z",
    );

    expect(label).toContain("Needed next at");
    expect(label).toContain("return by");
    expect(label).toContain("(1h 30m gap)");
  });

  it("uses explicit language for zero and multi-hour durations", () => {
    expect(formatAvailabilityDuration(0)).toBe("now");
    expect(formatAvailabilityDuration(150)).toBe("2h 30m");
  });

  it("keeps distant future use concise", () => {
    expect(upcomingCommitmentLabel(
      { startsAt: "2026-07-15T15:00:00.000Z" },
      "2026-06-29T13:30:00.000Z",
    )).toContain("Next scheduled use at");
    expect(upcomingCommitmentLabel(
      { startsAt: "2026-07-15T15:00:00.000Z" },
      "2026-06-29T13:30:00.000Z",
    )).not.toContain("return by");
  });

  it("explains the recovery time for a buffered conflict", () => {
    const message = availabilityConflictMessage(
      {
        conflictingBookingTitle: "Next shoot",
        startsAt: "2026-06-29T15:00:00.000Z",
        endsAt: "2026-06-29T17:00:00.000Z",
      },
      { currentStartsAt: "2026-06-29T10:00:00.000Z", currentEndsAt: "2026-06-29T13:30:00.000Z" },
    );

    expect(message).toContain("Conflict with Next shoot");
    expect(message).toContain("return by");
    expect(message).toContain("Next shoot");
  });

  it("names the person, item, and local deadline when a kiosk add is blocked", () => {
    expect(availabilityBlockedItemMessage({
      conflictingBookingRequesterName: "Erik Role",
      conflictingBookingKind: "RESERVATION",
      conflictingBookingStatus: "BOOKED",
      startsAt: "2026-09-12T19:00:00.000Z",
      endsAt: "2026-09-12T21:30:00.000Z",
    }, "FX3 2")).toBe("Erik Role has reserved the FX3 2 until Sep 12 at 4:30 PM");

    expect(availabilityBlockedItemMessage({
      conflictingBookingRequesterName: "Maya Fitzgerald",
      conflictingBookingKind: "CHECKOUT",
      conflictingBookingStatus: "OPEN",
      startsAt: "2026-09-12T19:00:00.000Z",
      endsAt: "2026-09-12T21:30:00.000Z",
    }, "FX3 2")).toBe("Maya Fitzgerald has checked out the FX3 2 until Sep 12 at 4:30 PM");

    expect(availabilityBlockedItemMessage({
      conflictingBookingRequesterName: "David Saddler",
      conflictingBookingKind: "CHECKOUT",
      conflictingBookingStatus: "PENDING_PICKUP",
      startsAt: "2026-09-12T19:00:00.000Z",
      endsAt: "2026-09-12T21:30:00.000Z",
    }, "FX3 2")).toBe("David Saddler has a pending pickup for the FX3 2 until Sep 12 at 4:30 PM");
  });

  it("names kiosk add blocks for maintenance, shortage, and held units", () => {
    expect(kioskAvailabilityBlockMessage({
      unavailableAssets: [{ status: "MAINTENANCE" }],
    }, "FX3 2")).toBe("FX3 2 is in maintenance");

    expect(kioskAvailabilityBlockMessage({
      shortages: [{ requested: 4, available: 1 }],
    }, "Sony Battery")).toBe("Only 1 Sony Battery available; this request needs 4");

    expect(kioskHeldItemMessage({
      itemName: "Sony Battery #7",
      holder: "Bucky Badger",
      dueAt: "2026-09-12T21:30:00.000Z",
      status: "OPEN",
      kind: "CHECKOUT",
    })).toBe("Bucky Badger has checked out the Sony Battery #7 until Sep 12 at 4:30 PM");

    expect(kioskHeldItemMessage({
      itemName: "Sony Battery #7",
      holder: "Bucky Badger",
    })).toBe("Sony Battery #7 is already checked out to Bucky Badger");
  });

  it("keeps timing, transfer, and condition notices distinct", () => {
    expect(availabilityRiskMessage({
      code: "SHORT_TURNAROUND",
      startsAt: "2026-06-29T15:00:00.000Z",
      gapMinutes: 90,
    })).toContain("return by");
    expect(availabilityRiskMessage({
      code: "LOCATION_TRANSFER",
      message: "Needed next at Camp Randall; confirm transfer time",
    })).toContain("transfer");
    expect(availabilityRiskMessage({ code: "RECENT_CHECKIN_REPORT", reportType: "LOST" })).toContain("lost");
    expect(availabilityRiskBadgeLabel({ code: "LOCATION_TRANSFER" })).toBe("Transfer");
    expect(availabilityRiskBadgeLabel({ code: "RECENT_CHECKIN_REPORT", reportType: "DAMAGED" })).toBe("Condition");
  });
});
