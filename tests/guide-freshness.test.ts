import { describe, expect, it } from "vitest";
import { guideFreshness, relativeDays, STALE_AFTER_DAYS } from "@/lib/guide-freshness";

const now = new Date("2026-10-21T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("guide freshness", () => {
  it("prefers the verification date over the last edit", () => {
    expect(guideFreshness({ lastVerifiedAt: daysAgo(6), updatedAt: daysAgo(1) }, now)).toEqual({
      label: "Verified 6 days ago",
      stale: false,
      verified: true,
    });
  });

  it("falls back to the last edit for a guide nobody has verified", () => {
    expect(guideFreshness({ lastVerifiedAt: null, updatedAt: daysAgo(21) }, now).label).toBe("Updated 3 weeks ago");
  });

  it("asks for review once the reference date is older than the stale window", () => {
    const stale = guideFreshness({ lastVerifiedAt: daysAgo(STALE_AFTER_DAYS + 1), updatedAt: daysAgo(2) }, now);
    expect(stale).toEqual({ label: "Needs review", stale: true, verified: true });
    expect(guideFreshness({ lastVerifiedAt: null, updatedAt: daysAgo(STALE_AFTER_DAYS) }, now).stale).toBe(false);
  });

  it("reads naturally across the ranges a library shows", () => {
    expect(relativeDays(daysAgo(0), now)).toBe("today");
    expect(relativeDays(daysAgo(1), now)).toBe("yesterday");
    expect(relativeDays(daysAgo(13), now)).toBe("13 days ago");
    expect(relativeDays(daysAgo(45), now)).toBe("6 weeks ago");
    expect(relativeDays(daysAgo(90), now)).toBe("3 months ago");
    expect(relativeDays(daysAgo(400), now)).toBe("a year ago");
    expect(relativeDays(new Date(now.getTime() + 60_000), now)).toBe("today");
  });
});
