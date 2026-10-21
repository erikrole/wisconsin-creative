import { describe, expect, it } from "vitest";
import { displayBookingTitle } from "../src/lib/booking-display-title";

describe("displayBookingTitle", () => {
  it("expands a leading sport code to the sport name", () => {
    expect(displayBookingTitle("MSOC vs Evansville")).toBe("Men's Soccer vs Evansville");
    expect(displayBookingTitle("FB at Ohio State")).toBe("Football at Ohio State");
  });

  it("leaves full sport names alone", () => {
    expect(displayBookingTitle("Men's Soccer vs Evansville")).toBe("Men's Soccer vs Evansville");
  });

  it("drops the legacy (Neutral) tag and promotion qualifier", () => {
    expect(displayBookingTitle("WBB vs Iowa (Neutral)")).toBe("Women's Basketball vs Iowa");
    expect(displayBookingTitle("Football vs Michigan State - Homecoming")).toBe("Football vs Michigan State");
  });

  it("does not touch custom titles that only start with a code-like word", () => {
    expect(displayBookingTitle("FB staff shoot")).toBe("FB staff shoot");
    expect(displayBookingTitle("Camera checkout")).toBe("Camera checkout");
  });

  it("cleans the opponent like Schedule does", () => {
    expect(displayBookingTitle("MHKY vs #2 North Dakota (Neutral)")).toBe("Men's Hockey vs North Dakota");
    expect(displayBookingTitle("Women's Swimming & Diving vs University of Notre Dame")).toBe(
      "Women's Swimming & Diving vs Notre Dame",
    );
    expect(displayBookingTitle("SB vs Baylor- Austin Regional Tournament Central (Neutral)")).toBe("Softball vs Baylor");
    expect(displayBookingTitle("MBB vs UW-Parkside - Exhibition")).toBe("Men's Basketball vs UW-Parkside");
  });

  it("keeps dashes in titles that are not games", () => {
    expect(displayBookingTitle("Media Day – Kohl Center")).toBe("Media Day – Kohl Center");
    expect(displayBookingTitle("WBB Practice - Will")).toBe("WBB Practice - Will");
  });

  it("expands a title that is only a sport code", () => {
    expect(displayBookingTitle("WSOC")).toBe("Women's Soccer");
  });
});

describe("new event-derived booking titles", () => {
  it("store the clean scheme", async () => {
    const { generateEventTitle } = await import("../src/lib/sports");
    expect(displayBookingTitle(generateEventTitle("FB", "#4 Michigan State - Homecoming / Red Out", true))).toBe(
      "Football vs Michigan State",
    );
    expect(displayBookingTitle(generateEventTitle("WSWIM", "University of Notre Dame", false))).toBe(
      "Women's Swimming & Diving at Notre Dame",
    );
  });
});
