import { describe, expect, it } from "vitest";
import { sportDotColor } from "@/lib/sport-color";

describe("sportDotColor", () => {
  it("returns null without a sport", () => {
    expect(sportDotColor(null)).toBeNull();
    expect(sportDotColor("")).toBeNull();
  });

  it("is stable and shared across a sport family", () => {
    expect(sportDotColor("FB")).toBe(sportDotColor("fb"));
    expect(sportDotColor("MSOC")).toBe(sportDotColor("WSOC"));
    expect(sportDotColor("VB")).toMatch(/^hsl\(/);
  });
});
