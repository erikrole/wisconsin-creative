import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("native Creative Wrapped wiring", () => {
  it("loads the same recap route and opens from the Scoreboard", () => {
    const client = source("ios/Wisconsin/Core/APIClient.swift");
    const teamView = source("ios/Wisconsin/Views/TeamScoreboardView.swift");
    const wrapped = source("ios/Wisconsin/Views/WrappedView.swift");

    expect(client).toContain('request(path: "/api/wrapped", queryItems: items)');
    expect(teamView).toContain("WrappedPromo.state(role: session.currentUser?.role)");
    expect(teamView).toContain(".fullScreenCover(isPresented: $showsWrapped)");
    // Unlock and promo window mirror src/lib/wrapped/dates.ts.
    expect(wrapped).toContain('"2026-12-01T06:00:00Z"');
    expect(wrapped).toContain('"2027-01-16T06:00:00Z"');
    expect(wrapped).toContain('guard let role, role != "COLLABORATOR" else { return .hidden }');
  });

  it("plays as accessible stories that respect Reduce Motion", () => {
    const wrapped = source("ios/Wisconsin/Views/WrappedView.swift");
    expect(wrapped).toContain("private var autoPlay: Bool { allowsAutoPlay && !reduceMotion }");
    expect(wrapped).toContain(".accessibilityAdjustableAction");
    expect(wrapped).toContain('.sensoryFeedback(.impact(weight: .light), trigger: index)');
    expect(wrapped).toContain('WrappedChromeButton(systemImage: "xmark", label: "Close"');
    expect(wrapped).toContain("ShareLink(");
    expect(wrapped).toContain("ImageRenderer(content: content)");
  });
});
