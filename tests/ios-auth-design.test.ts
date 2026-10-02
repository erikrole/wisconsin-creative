import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// The sign-in family mirrors the kiosk's flat dark tokens. `Kiosk/**` is not in
// the Wisconsin target, so AuthDesign.swift carries copies; this keeps them honest.
const MIRRORED: Array<[auth: string, kiosk: string]> = [
  ["base", "base"],
  ["card", "card"],
  ["field", "cardRaised"],
  ["control", "control"],
  ["strokeStandard", "standard"],
  ["strokeStrong", "strong"],
];

function hex(src: string, name: string) {
  const match = src.match(new RegExp(`static let ${name} = \\w+\\(0x([0-9A-Fa-f]{6})`));
  expect(match, name).not.toBeNull();
  const value = match?.[1];
  if (!value) throw new Error(`Missing color token ${name}`);
  return value.toUpperCase();
}

describe("iOS auth design tokens", () => {
  const auth = source("ios/Wisconsin/Core/AuthDesign.swift");
  const kiosk = source("ios/Wisconsin/Kiosk/KioskDesign.swift");

  it("mirrors the kiosk surface, stroke, and text values", () => {
    for (const [a, k] of MIRRORED) expect(hex(auth, a), a).toBe(hex(kiosk, k));
    expect(hex(auth, "selected")).toBe(hex(kiosk, "selected"));
    expect(hex(auth, "textPrimary")).toBe(hex(kiosk, "primary"));
    expect(hex(auth, "textSecondary")).toBe(hex(kiosk, "secondary"));
    expect(hex(auth, "textTertiary")).toBe(hex(kiosk, "tertiary"));
    expect(hex(auth, "onPrimary")).toBe(hex(kiosk, "onPrimary"));
  });

  it("keeps the sign-in family flat: no glass, material, or light pin", () => {
    for (const file of ["LoginView", "PasswordSetupView", "LaunchView"]) {
      const text = source(`ios/Wisconsin/Views/${file}.swift`);
      expect(text, file).not.toMatch(/\.glass(Prominent)?\b|\.regularMaterial|\.ultraThinMaterial/);
      expect(text, file).not.toMatch(/brandLoginCardChrome|authCard|BrandSplash/);
    }
    expect(auth).not.toMatch(/Material|LinearGradient/);
  });
});
