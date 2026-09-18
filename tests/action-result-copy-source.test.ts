import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("action result copy", () => {
  it("keeps Trade Board failures on object-specific recovery copy", () => {
    const tradeBoard = source("src/components/TradeBoard.tsx");

    expect(tradeBoard).toContain("const TRADE_OUTCOME_COPY");
    expect(tradeBoard).toContain("Could not claim the trade. Refresh the Trade Board and try again.");
    expect(tradeBoard).toContain("Could not approve the trade. The shift assignment was not changed.");
    expect(tradeBoard).toContain("Could not decline the trade. The claim stayed in review.");
    expect(tradeBoard).toContain("Could not approve the request. Nobody was added to the shift.");
    expect(tradeBoard).toContain("Could not decline the request. It stayed in review.");
    expect(tradeBoard).toContain("Could not cancel the trade. The shift stays assigned to the poster.");
    expect(tradeBoard).toContain("Could not withdraw the claim. Refresh the Trade Board and try again.");
    expect(tradeBoard).toContain("Could not withdraw the request. Refresh the Trade Board and try again.");
    // Open-shift pickups are instant claims, not requests.
    expect(tradeBoard).toContain("Could not claim the shift. Refresh the Trade Board and try again.");
    expect(tradeBoard).toContain("Open shifts did not load. Retry before acting on shift or trade coverage.");

    expect(tradeBoard).not.toContain("Failed to claim trade");
    expect(tradeBoard).not.toContain("Failed to approve trade");
    expect(tradeBoard).not.toContain("Failed to decline trade");
    expect(tradeBoard).not.toContain("Failed to cancel trade");
    expect(tradeBoard).not.toContain("Failed to claim shift");
    expect(tradeBoard).not.toContain("Network error:");
    expect(tradeBoard).not.toContain("Failed to load open work.");
  });

  it("keeps booking-list failures on consequence-aware copy", () => {
    const bookingList = source("src/components/BookingListPage.tsx");

    expect(bookingList).toContain("Could not extend the booking. Refresh and check for conflicts.");
    expect(bookingList).toContain("Could not reach the server. The booking was not extended.");
    expect(bookingList).toContain("Retry before acting on this");

    expect(bookingList).not.toContain("Extend failed");
    expect(bookingList).not.toContain("Network error");
    expect(bookingList).not.toContain("Something went wrong");
  });
});
