// source-contract: SwiftUI views cannot render in vitest; this pins the Guides list layout and its parity with the web freshness rules
import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Guides list presentation", () => {
  it("keeps guide rows title-first with only type and freshness underneath", () => {
    const view = source("ios/Wisconsin/Views/GuidesView.swift");
    const row = view.slice(
      view.indexOf("private struct GuideRow"),
      view.indexOf("struct GuideReaderView"),
    );

    expect(row).toContain("HStack(alignment: .center, spacing: 12)");
    expect(row).toContain(".fill(Color.cardSurfaceRaised)");
    expect(row).toContain("Text(guide.title)");
    expect(row).toContain("StatusPill(label: guide.type.label, tone: guide.type.tone)");
    expect(row).toContain('parts.append("Draft")');
    expect(row).not.toContain("guide.summary");
    expect(row).toContain("Text(freshness.label)");
    expect(row).toContain("freshness.stale ? Color.statusText(.orange)");
    expect(row).not.toContain("guide.author");
    expect(row).not.toContain("guide.category");
    expect(row).not.toContain("guide.targetRoles");
    expect(row).not.toContain("guide.targetAreas");
  });

  it("opens like the web library: For you, then recently updated, with matching freshness rules", () => {
    const view = source("ios/Wisconsin/Views/GuidesView.swift");

    expect(view).toContain('Text("For you")');
    expect(view).toContain('Text(showsHome ? "Recently updated" : listHeader)');
    expect(view).toContain('$0.personalizationReason != "General"');
    expect(view).toContain("static let staleAfterDays = 180");
    expect(view).toContain('"Needs review"');
    expect(view).toContain("Mirrors `src/lib/guide-freshness.ts`");
  });
});
