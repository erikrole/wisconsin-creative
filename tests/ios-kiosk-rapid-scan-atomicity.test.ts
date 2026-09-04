import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkout = readFileSync("ios/Wisconsin/Kiosk/KioskCheckoutView.swift", "utf8");

describe("iOS kiosk rapid-scan atomicity", () => {
  it("merges each admitted scan into fresh cart state", () => {
    expect(checkout).toContain("var updated = store.cart(for: userId)");
    expect(checkout).not.toContain("var updated = cart");
    expect(checkout).toContain("store.setCart(updated, for: userId)");
  });

  it("queues normalized scans while requests are pending and blocks completion", () => {
    expect(checkout).toContain("@State private var pendingScanIdentities: Set<String> = []");
    expect(checkout).toContain("@State private var queuedScanValues: [String] = []");
    expect(checkout).toContain("@State private var isProcessingScan = false");
    expect(checkout).toContain("pendingScanIdentities.contains(normalizedScan)");
    expect(checkout).toContain("pendingScanIdentities.insert(normalizedScan)");
    expect(checkout).toContain("queuedScanValues.append(value)");
    expect(checkout).toContain("processNextScanIfNeeded()");
    expect(checkout).toContain("pendingScanIdentities.remove(normalizedScan)");
    expect(checkout).toContain("queuedScanValues.removeFirst()");
    expect(checkout).toContain("guard !isCompleting, pendingScanIdentities.isEmpty else { return }");
    expect(checkout).toContain("isEnabled: !scannedItems.isEmpty && pendingScanIdentities.isEmpty");
  });

  it("preflights a candidate before adding it or showing an accepted receipt", () => {
    expect(checkout).toContain("let candidateCart = updated + [cartItem]");
    expect(checkout).toContain("refreshAvailability(for: candidateCart, applyResult: false)");
    expect(checkout).toContain("if let candidateIssue = availabilityIssue(for: candidateGroup, result: preflight), candidateIssue.isBlocking");
    expect(checkout).toContain("updated.append(cartItem)");
    expect(checkout).toContain("lastAccepted = KioskAcceptedScan(");
    expect(checkout).not.toContain("added, but availability could not be verified. Check before checkout.");
  });
});
