import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

// The 2026-09-25 kiosk redesign (tasks/kiosk-redesign-brief-2026-09-25.md):
// SF Pro only, nothing below 14 pt, one white primary pill, section colors
// with fixed meanings, and no brand red or Liquid Glass on kiosk controls.

const kioskDirs = ["ios/Wisconsin/Kiosk", "ios/Wisconsin/KioskOnly"];

function kioskSwiftFiles(): { file: string; text: string }[] {
  return kioskDirs.flatMap((dir) =>
    readdirSync(path.join(process.cwd(), dir))
      .filter((name) => name.endsWith(".swift"))
      .map((name) => ({ file: `${dir}/${name}`, text: source(`${dir}/${name}`) })),
  );
}

describe("kiosk design tokens", () => {
  it("uses SF Pro only", () => {
    for (const { file, text } of kioskSwiftFiles()) {
      expect(text, file).not.toMatch(/gotham/i);
    }
    expect(source("ios/Wisconsin/KioskOnly/Info.plist")).not.toContain("UIAppFonts");
  });

  it("keeps every text style at 14 pt or larger", () => {
    for (const { file, text } of kioskSwiftFiles()) {
      expect(text, file).not.toMatch(/\.font\(\.(caption2?|footnote)\b/);
      expect(text, file).not.toMatch(/Font\.system\(size: *([0-9]|1[0-3])(\.\d+)?[,)]/);
    }
    const design = source("ios/Wisconsin/Kiosk/KioskDesign.swift");
    const sizes = [...design.matchAll(/Font\.system\(size: (\d+)/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBe(14);
  });

  it("gives each section one color and never uses brand red", () => {
    const design = source("ios/Wisconsin/Kiosk/KioskDesign.swift");
    expect(design).toContain("enum KioskSection");
    for (const section of ["takingOut", "comingBack", "pickingUp", "shared", "problem"]) {
      expect(design).toContain(`case .${section}:`);
    }
    // Selection is a white outline, never a status color.
    expect(design).toContain("static let selected = kioskHex(0xF2F2F4)");
    for (const { file, text } of kioskSwiftFiles()) {
      expect(text, file).not.toContain("kioskRed");
    }
  });

  it("makes the primary action a solid white pill instead of glass", () => {
    const design = source("ios/Wisconsin/Kiosk/KioskDesign.swift");
    expect(design).toContain("struct KioskPillButtonStyle: ButtonStyle");
    expect(design).toContain("case .primary: KioskText.primary");
    for (const { file, text } of kioskSwiftFiles()) {
      expect(text, file).not.toMatch(/\.buttonStyle\(\.glass(Prominent)?\)/);
    }
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");
    expect(components).toMatch(/struct KioskCompletionButton: View[\s\S]*?\.kioskButtonRole\(\.primary\)/);
  });

  it("keeps destructive removal a quiet glyph in the custody drawer", () => {
    const detail = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");
    expect(detail).toContain('Image(systemName: "trash.fill")');
    expect(detail).not.toContain(".glassEffect(");
  });
});
