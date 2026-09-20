import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Items row accessibility", () => {
  it("keeps item rows combined and announces the detail navigation action", () => {
    const itemsView = source("ios/Wisconsin/Views/ItemsView.swift");

    expect(itemsView).toContain(".accessibilityElement(children: .combine)");
    expect(itemsView).toContain(".accessibilityLabel(rowAccessibilityLabel)");
    expect(itemsView).toContain('.accessibilityHint("Double-tap to view item details")');
  });
});
