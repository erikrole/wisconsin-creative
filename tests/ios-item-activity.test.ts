import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS item activity", () => {
  const itemDetail = source("ios/Wisconsin/Views/ItemDetailView.swift");
  const screen = source("ios/Wisconsin/Views/ItemActivityView.swift");
  const models = source("ios/Wisconsin/Models/ItemActivityModels.swift");
  const client = source("ios/Wisconsin/Core/APIClient.swift");
  const route = source("src/app/api/assets/[id]/activity/route.ts");
  const project = source("ios/Wisconsin.xcodeproj/project.pbxproj");

  const method = client.slice(
    client.indexOf("func assetActivity("),
    client.indexOf("func assetsLookup("),
  );

  it("reads the website history route and leaves writes on the web", () => {
    expect(route).toContain('requirePermission(user.role, "asset", "audit")');
    expect(route).toContain('if (!["all", "asset", "booking"].includes(scope))');
    expect(method).toContain('path: "/api/assets/\\(assetId)/activity"');
    expect(method).toContain('name: "scope", value: scope.rawValue');
    expect(method).toContain('name: "cursor", value: cursor');
    expect(method).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(screen).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(models).toContain('case all');
    expect(models).toContain('case asset');
    expect(models).toContain('case booking');
    expect(models).toContain('"Item updates"');
    expect(models).toContain('"Bookings"');
  });

  it("keeps reserve as the item action and shows activity only to staff", () => {
    const reserve = itemDetail.indexOf("ReserveButton(title:");
    const bookings = itemDetail.indexOf("ItemBookingsLinkCard(");
    const activity = itemDetail.indexOf("ItemActivityLink(");
    expect(reserve).toBeGreaterThan(-1);
    expect(bookings).toBeGreaterThan(reserve);
    expect(activity).toBeGreaterThan(bookings);
    const history = itemDetail.slice(bookings, itemDetail.indexOf("if let notes = asset.notes"));
    expect(history).toContain("if canEditAsset {");
    expect(history).toContain("ItemActivityLink(");
    expect(screen).toContain('role == "STAFF" || role == "ADMIN"');
    expect(screen).toContain("Activity is available to staff.");
    expect(screen).not.toContain('"COLLABORATOR"');
    expect(screen).not.toContain('"STUDENT"');
  });

  it("has one booking action, quiet status color, and an honest older page", () => {
    expect(screen).toContain("@ViewBuilder");
    expect(screen).toContain("if model.isLoading && model.entries.isEmpty {");
    expect(screen).toContain("} else if let message = model.error, model.entries.isEmpty {");
    expect(screen).toContain("} else {");
    expect(screen).toContain("if entry.linksToBooking {");
    expect(screen).toContain("} else {");
    expect(screen).toContain("NavigationLink(destination: BookingDetailView(bookingId: entry.entityId))");
    expect(screen).toContain('Text("Load older entries")');
    expect(screen).toContain('Text("No activity recorded for this scope.")');
    expect(screen).toContain('self.error = "Couldn\'t load activity."');
    expect(screen).toContain('self.error = "Couldn\'t refresh. The list is unchanged."');
    expect(screen).toContain('self.olderError = "Couldn\'t load older entries."');
    expect(screen).toContain("Color.statusText(.red)");
    expect(screen).toContain("Color.statusText(.orange)");
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);
    expect(models).toContain('return "Cancelled \\(bookingPhrase(entry, fallback: "the booking"))"');
    expect(models).toContain('return "Marked as needs maintenance"');
    expect(models).toContain('return "Created this item"');
    expect(models).not.toMatch(/let \w+: \w+\? =/);
  });

  it("registers the new files in the XcodeGen project", () => {
    expect(project).toContain("ItemActivityView.swift in Sources");
    expect(project).toContain("ItemActivityModels.swift in Sources");
    expect(project).toContain("path = ItemActivityView.swift");
    expect(project).toContain("path = ItemActivityModels.swift");
  });
});
