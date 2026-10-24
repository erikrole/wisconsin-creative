import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS Profile refresh", () => {
  it("keeps the last good data when a refresh fails or is cancelled", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    const load = profile.slice(
      profile.indexOf("private func loadOwnProfile"),
      profile.indexOf("/// Your own week and month"),
    );

    expect(load).toContain("guard !Task.isCancelled else { return }");
    expect(load).toContain("if let checkouts { ownCheckouts = checkouts.data }");
    expect(load).toContain("if let shifts { ownShifts = shifts }");
    expect(load).not.toContain("?? []");
  });

  it("does not hand one account's profile data to the next", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");
    expect(profile).toContain("@State private var ownLoadedFor: String?");
    expect(profile).toContain("if ownLoadedFor != id {");
  });
});
