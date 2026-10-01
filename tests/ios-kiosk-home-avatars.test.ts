import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk home list avatars", () => {
  const home = source("ios/Wisconsin/Kiosk/KioskHomeView.swift");

  it("leads custody and pickup rows with the holder's avatar, falling back to initials", () => {
    expect(home).toContain("HomeRowAvatar(url: checkout.requesterAvatarUrl, initials: checkout.requesterInitials");
    expect(home).toContain('url: pickup.custodyScope == "SHARED" ? nil : pickup.requester?.avatarUrl');
    expect(home).toContain("KioskAvatar(url: url, initials: initials, size: 30)");
  });

  it("keeps crew without gear to a count in the game-day header", () => {
    expect(home).toContain('without gear")');
    expect(home).not.toContain("HomeAvatarStack");
  });

  it("decodes the avatar fields the dashboard route already projects", () => {
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const route = source("src/app/api/kiosk/dashboard/route.ts");
    expect(models).toContain("let requesterAvatarUrl: String?");
    expect(route).toContain("requesterAvatarUrl: c.custodyScope === \"SHARED\" ? null : c.requester.avatarUrl");
    expect(route).toContain("avatarUrl: user.avatarUrl");
  });
});
