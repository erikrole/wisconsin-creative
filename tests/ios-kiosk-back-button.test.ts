import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("iOS Kiosk back-button ownership contract", () => {
  it("keeps the shell status reveal out of flow headers", () => {
    const shell = source("ios/Wisconsin/Kiosk/KioskShellView.swift");

    expect(shell).toContain("private var showsSystemStatusButton: Bool");
    expect(shell).toContain("case .idle, .success:");
    expect(shell).toContain("case .activation, .operatorHub, .identity, .checkout, .pickup, .return:");
    expect(shell).toContain("if showsSystemStatusButton {");
    expect(shell).toContain("Image(systemName: \"info.circle\")");
  });

  it("leaves the flow header as the top-left navigation owner", () => {
    const components = source("ios/Wisconsin/Kiosk/KioskComponents.swift");

    expect(components).toContain("systemImage: \"chevron.left\"");
    expect(components).toContain("label: \"Back\"");
    expect(components).toContain("action: onBack");
  });
});
