import { describe, expect, it } from "vitest";
import { parseDateRange } from "../src/lib/time";

describe("parseDateRange", () => {
  it("parses valid range", () => {
    const result = parseDateRange("2026-02-27T12:00:00.000Z", "2026-02-27T13:00:00.000Z");
    expect(result.start.toISOString()).toBe("2026-02-27T12:00:00.000Z");
    expect(result.end.toISOString()).toBe("2026-02-27T13:00:00.000Z");
  });

  it("throws when end is before start", () => {
    expect(() => parseDateRange("2026-02-27T13:00:00.000Z", "2026-02-27T12:00:00.000Z")).toThrow(
      "endsAt must be later than startsAt"
    );
  });

  it("rejects a booking longer than a year (mistyped year)", () => {
    expect(() => parseDateRange("2026-10-21T12:00:00.000Z", "2062-10-21T12:00:00.000Z")).toThrow(
      "A booking can't run longer than a year"
    );
  });

  it("allows a long but plausible booking", () => {
    expect(() => parseDateRange("2026-10-21T12:00:00.000Z", "2027-04-21T12:00:00.000Z")).not.toThrow();
  });
});
