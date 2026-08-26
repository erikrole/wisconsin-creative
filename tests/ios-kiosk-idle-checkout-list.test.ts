import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS kiosk idle checkout list", () => {
  it("shows every active checkout by default and returns filters to that list", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");

    expect(idle).toContain("@State private var selectedSummary: KioskSummarySelection = .checkouts");
    expect(idle).toContain('KioskDashboardList(title: "Active Checkouts"');
    expect(idle).toContain("ForEach(checkouts)");
    expect(idle).toContain("selectedSummary = selectedSummary == summary ? .checkouts : summary");
    expect(idle).not.toContain("dueTodayCheckouts");
    expect(idle).not.toContain('KioskDashboardList(title: "Due Today"');
  });

  it("keeps the default Checkouts tile honest instead of presenting a no-op clear action", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");

    expect(idle).toContain('selectedAccessibilityHint: "Showing all active checkouts"');
    expect(idle).toContain("if summary == .checkouts {");
    expect(idle).toContain("selectedSummary = .checkouts");
  });

  it("keeps a future-day checkout in the deterministic idle review fixture", () => {
    const fixture = source("ios/Wisconsin/KioskOnly/KioskOnlyApp.swift");

    expect(fixture).toContain('"title":"Softball Road Kit"');
    expect(fixture).toContain('"endsAt":"\\(iso(at(1, 9, 0)))"');
    expect(fixture).toContain('"checkouts":4');
  });

  it("puts Checkouts first and orders custody by urgency even when payload order drifts", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const stats = idle.slice(
      idle.indexOf("// Stats row"),
      idle.indexOf("// Events used to sit here"),
    );

    expect(stats.indexOf('label: "Checkouts"')).toBeLessThan(stats.indexOf('label: "Items Out"'));
    expect(stats.indexOf('StatTilePlaceholder(label: "Checkouts")')).toBeLessThan(
      stats.indexOf('StatTilePlaceholder(label: "Items Out")'),
    );
    expect(idle).toContain("private func orderedCheckouts(_ checkouts: [KioskActiveCheckout])");
    expect(idle).toContain("if lhs.isOverdue != rhs.isOverdue { return lhs.isOverdue }");
    expect(idle).toContain("if lhs.endsAt != rhs.endsAt { return lhs.endsAt < rhs.endsAt }");
    expect(idle).toContain("let checkouts = orderedCheckouts(dashboard.checkouts)");
    expect(idle).toContain("let overdueCheckouts = orderedCheckouts(dashboard.checkouts.filter(\\.isOverdue))");
  });

  it("uses the checkout row subtitle for holder and scope, not a truncated item manifest", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const row = idle.slice(idle.indexOf("private struct CheckoutRow"));

    expect(row).toContain("Text(holderSummary)");
    expect(row).toContain("private var holderSummary: String");
    expect(row).toContain('"\\(checkout.requesterName) · \\(itemCountSummary)"');
    expect(row).toContain('"\\(checkout.itemCount) \\(checkout.itemCount == 1 ? "item" : "items")"');
    expect(row).toContain("held by \\(checkout.requesterName)");
    expect(row).not.toContain("private var itemSummary");
  });

  it("keeps dashboard due wording relative near a deadline and explicit in VoiceOver", () => {
    const formatting = source("ios/Wisconsin/Kiosk/KioskDateFormatting.swift");
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const row = idle.slice(idle.indexOf("private struct CheckoutRow"));

    expect(formatting).toContain("func kioskDashboardDueStamp(");
    expect(formatting).toContain('return "Due now · \\(time)"');
    expect(formatting).toContain('return "Due in \\(kioskCompactDuration(secondsUntilDue)) · \\(time)"');
    expect(formatting).toContain('return "Today · \\(time)"');
    expect(formatting).toContain('return "Tomorrow · \\(time)"');
    expect(formatting).toContain('formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())');
    expect(formatting).toContain('return "\\(date) · \\(time)"');
    expect(formatting).toContain('return "Overdue · \\(kioskCompactDuration(now.timeIntervalSince(self)))"');
    expect(row).toContain("kioskDashboardDueStamp(isOverdue: checkout.isOverdue)");
    expect(row).toContain("let dueSummary = checkout.endsAt.kioskDashboardDueStamp(isOverdue: checkout.isOverdue)");
  });

  it("explains the metric tiles are list filters in the visual hierarchy", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const stats = idle.slice(idle.indexOf("// Stats row"), idle.indexOf("// Events used to sit here"));

    expect(stats).toContain('Text("Tap a count to filter the list")');
    expect(stats).toContain('Image(systemName: "line.3.horizontal.decrease.circle")');
    expect(idle).toContain('.font(.callout.weight(.semibold))');
  });

  it("uses neutral selection contrast without turning every selected tile red", () => {
    const idle = source("ios/Wisconsin/Kiosk/KioskIdleView.swift");
    const tile = idle.slice(idle.indexOf("private struct StatTile"), idle.indexOf("private struct StatTilePlaceholder"));

    expect(tile).toContain(".foregroundStyle(accent)");
    expect(tile).toContain("isSelected ? KioskText.primary : KioskText.muted");
    expect(tile).toContain("stroke: isSelected ? KioskStroke.selected : KioskStroke.standard");
    expect(tile).toContain(".fill(KioskText.primary)");
    expect(tile).not.toContain("isSelected ? Color.kioskRed");
  });
});
