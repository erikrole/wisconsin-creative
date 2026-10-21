import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS UA Gear: My kit", () => {
  const view = source("ios/Wisconsin/Views/GearPicksView.swift");
  const models = source("ios/Wisconsin/Models/GearPickModels.swift");
  const client = source("ios/Wisconsin/Core/APIClient.swift");
  const order = source("src/lib/gear-picks/order.ts");

  it("reads the kit route and hides the card when it is absent or not allowed", () => {
    expect(client).toContain('request(path: "/api/gear-picks/me/kit")');
    expect(client).toContain("catch APIError.notFound");
    expect(client).toContain("status == 403");
    // A failed kit fetch never takes the picks screen down with it.
    expect(view).toContain("async let kitTask: GearMyKit? = try? await APIClient.shared.myGearKit()");
  });

  it("decodes defensively and keeps the web status precedence", () => {
    expect(models).toContain("quantity = max(1, try c.decodeIfPresent(Int.self, forKey: .quantity) ?? 1)");
    expect(models).toContain("let source: String");
    const sizeNeeded = /SIZE_NEEDED = "([^"]+)"/.exec(order)?.[1];
    expect(sizeNeeded).toBe("Size needed");
    expect(models).toContain(`static let sizeNeeded = "${sizeNeeded}"`);
    const status = models.slice(models.indexOf("func status(order:"));
    expect(status.indexOf("if handed")).toBeLessThan(status.indexOf("if needsSize"));
    expect(status.indexOf("if needsSize")).toBeLessThan(status.indexOf("onOrder"));
  });

  it("shows few rows, one detail line each, and status as plain text with a glyph", () => {
    expect(view).toContain("private let glance = 4");
    for (const label of ["Add your size", "Planned", "On order", "In hand"]) expect(view).toContain(label);
    expect(view).not.toContain("StatusPill(label: status");
    expect(view).toContain("case .notOnList where model.kit != nil:");
  });
});
