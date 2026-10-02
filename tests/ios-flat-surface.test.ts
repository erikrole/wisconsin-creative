import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// The dark values of the adaptive flat surfaces are the kiosk's own.
const PAIRS: Array<[flat: string, kiosk: string]> = [
  ["flatCard", "card"],
  ["flatRaised", "cardRaised"],
  ["flatStroke", "standard"],
  ["flatDivider", "divider"],
];

function hexAfter(src: string, name: string) {
  const match = src.match(new RegExp(`static let ${name} = [\\s\\S]*?0x([0-9A-Fa-f]{6})`));
  expect(match, name).not.toBeNull();
  const value = match?.[1];
  if (!value) throw new Error(`Missing color token ${name}`);
  return value.toUpperCase();
}

describe("iOS flat surface tokens", () => {
  const flat = source("ios/Wisconsin/Core/FlatSurface.swift");
  const kiosk = source("ios/Wisconsin/Kiosk/KioskDesign.swift");

  it("uses the kiosk hex values in dark mode", () => {
    for (const [f, k] of PAIRS) {
      const kioskName = k === "divider" ? "divider" : k;
      expect(hexAfter(flat, f), f).toBe(hexAfter(kiosk, kioskName));
    }
  });

  it("keeps cards to a solid fill and a hairline", () => {
    expect(flat).not.toMatch(/Material|LinearGradient|\.shadow\(/);
  });

  it("renders Home on flat cards, not brandCard", () => {
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    expect(home).not.toContain(".brandCard(");
    expect(home).toContain(".flatCard(");
  });
});
