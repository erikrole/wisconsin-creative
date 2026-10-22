import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("native Creative Wrapped wiring", () => {
  it("loads the same recap route and opens from the Scoreboard", () => {
    const client = apiClientSource();
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

  it("invites people in once after unlock from the app shell", () => {
    const appTabs = source("ios/Wisconsin/Views/AppTabView.swift");
    const wrapped = source("ios/Wisconsin/Views/WrappedView.swift");
    expect(appTabs).toContain(".modifier(WrappedInvitation(role: session.currentUser?.role, isEnabled: !isReadOnlyPreview))");
    expect(wrapped).toContain('@AppStorage("wrapped.2026-fall.invited") private var invited = false');
    expect(wrapped).toContain("guard isEnabled, !invited, WrappedPromo.state(role: role) == .open else { return }");
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
