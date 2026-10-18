import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kit return time without a holder name", () => {
  const kitDetail = source("ios/Wisconsin/Views/KitDetailView.swift");
  const holderLine = kitDetail.slice(
    kitDetail.indexOf("private var holderLine"),
    kitDetail.indexOf("private struct KitFamilyRow"),
  );

  it("shows Back plus the return time when the name is omitted", () => {
    expect(holderLine).toContain("let name = holder.holderName.nonBlankText");
    expect(holderLine).toContain('return "With \\(name) · \\(due)"');
    expect(holderLine).toContain('return "With \\(name)"');
    expect(holderLine).toContain('return "Back \\(due)"');
    expect(holderLine).toContain("return nil");
    expect(holderLine).not.toContain("!holder.holderName.isEmpty");
  });
});
