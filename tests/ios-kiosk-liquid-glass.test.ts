import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS 26 kiosk Liquid Glass hierarchy", () => {
  it("uses native glass for shared interactive controls", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");

    expect(components).toContain("private struct KioskHeaderButton: View");
    expect(components).toContain("struct KioskCompletionButton: View");
    expect(components).toContain(".buttonStyle(.glass)");
    expect(components).toContain(".buttonStyle(.glassProminent)");
    expect(components).toContain(".tint(Color.kioskRed)");
  });

  it("keeps glass on actions rather than operational content", () => {
    const detail = source("ios/Wisconsin/Kiosk/KioskCheckoutDetailSheet.swift");

    expect(detail).toContain(".buttonStyle(.glass)");
    expect(detail).toContain(".buttonStyle(.glassProminent)");
    expect(detail).not.toContain(".glassEffect(");
    expect(detail).not.toContain(".kioskGlassSurface(");
    // Destructive removal stays off glass: it is operational content, and a
    // plain trash glyph keeps it quieter than the primary Return Gear CTA.
    expect(detail).toContain('Image(systemName: "trash.fill")');
    expect(detail).not.toContain('Label("Remove", systemImage: "minus.circle.fill")');
  });
});
