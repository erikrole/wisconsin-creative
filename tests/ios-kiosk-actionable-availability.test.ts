import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Kiosk actionable availability recovery contract", () => {
  it("rejects a blocking candidate before it enters the visible cart", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("let candidateCart = updated + [cartItem]");
    expect(checkout).toContain("refreshAvailability(for: candidateCart, applyResult: false)");
    expect(checkout).toContain("candidateIssue.isBlocking");
    expect(checkout).toContain("Scan rejected; it was not added.");
    expect(checkout).toContain("KioskScanFeedbackSound.playFailure()");
  });

  it("offers item-local recovery actions for blocking scan results", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("onChangeReturnTime: issue?.canChangeReturnTime == true");
    expect(checkout).toContain("onScanAnother: issue?.isBlocking == true");
    expect(checkout).toContain("Text(\"What now?\")");
    expect(checkout).toContain("title: group.count == 1 ? \"Remove item\" : \"Remove \\(group.count) units\"");
    expect(checkout).toContain("title: \"Change return time\"");
    expect(checkout).toContain("title: group.isBulkGroup ? \"Scan another unit\" : \"Scan another item\"");
  });

  it("keeps recovery presentation-only and refreshes availability after time edits", () => {
    const checkout = source("ios/Wisconsin/Kiosk/KioskCheckoutView.swift");

    expect(checkout).toContain("isBlocking: true,\n                canChangeReturnTime: true");
    expect(checkout).toContain("isBlocking: false");
    expect(checkout).toContain("Scanned items will stay in the cart.");
    expect(checkout).toContain("Task { await refreshAvailability(for: cart, endsAt: dueBackAt) }");
    expect(checkout).toContain("guard !preflight.hasBlockingIssue else {");
    expect(checkout).toContain("KioskAPI.shared.kioskCheckoutComplete(");
  });
});
