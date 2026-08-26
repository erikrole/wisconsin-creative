import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkout = readFileSync("ios/Wisconsin/Kiosk/KioskCheckoutView.swift", "utf8");

describe("iOS kiosk rapid-scan atomicity", () => {
  it("merges out-of-order scan responses into fresh cart state", () => {
    expect(checkout).toContain("var updated = store.cart(for: userId)");
    expect(checkout).not.toContain("var updated = cart");
    expect(checkout).toContain("store.setCart(updated, for: userId)");
  });

  it("owns normalized scans while requests are pending and blocks completion", () => {
    expect(checkout).toContain("@State private var pendingScanIdentities: Set<String> = []");
    expect(checkout).toContain("pendingScanIdentities.contains(normalizedScan)");
    expect(checkout).toContain("pendingScanIdentities.insert(normalizedScan)");
    expect(checkout).toContain("defer { pendingScanIdentities.remove(normalizedScan) }");
    expect(checkout).toContain("guard !isCompleting, pendingScanIdentities.isEmpty else { return }");
    expect(checkout).toContain("isEnabled: !scannedItems.isEmpty && pendingScanIdentities.isEmpty");
  });

  it("does not turn a stale availability response into a scan success receipt", () => {
    expect(checkout).toContain("} else if preflight == nil {");
    expect(checkout).toContain("availability could not be verified. Check before checkout.");
  });
});
