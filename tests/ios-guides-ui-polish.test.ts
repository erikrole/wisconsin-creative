import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Guides list presentation", () => {
  it("keeps guide rows title-first without landing metadata", () => {
    const view = source("ios/Wisconsin/Views/GuidesView.swift");
    const row = view.slice(
      view.indexOf("private struct GuideRow"),
      view.indexOf("private struct GuideReaderView"),
    );

    expect(row).toContain("HStack(alignment: .center, spacing: 12)");
    expect(row).toContain(".fill(Color.cardSurfaceRaised)");
    expect(row).toContain("Text(guide.title)");
    expect(row).toContain("StatusPill(label: guide.type.label, tone: guide.type.tone)");
    expect(row).toContain('parts.append("Draft")');
    expect(row).not.toContain("guide.summary");
    expect(row).not.toContain("guide.updatedSummary");
    expect(row).not.toContain("guide.author");
    expect(row).not.toContain("guide.category");
    expect(row).not.toContain("guide.targetRoles");
    expect(row).not.toContain("guide.targetAreas");
  });
});
