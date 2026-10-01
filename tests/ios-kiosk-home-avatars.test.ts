import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk home list avatars", () => {
  const home = source("ios/Wisconsin/Kiosk/KioskHomeView.swift");

  it("leads custody and pickup rows with the holder's avatar, falling back to initials", () => {
    expect(home).toContain("HomeRowAvatar(url: checkout.requesterAvatarUrl, initials: checkout.requesterInitials");
    expect(home).toContain('url: pickup.custodyScope == "SHARED" ? nil : pickup.requester?.avatarUrl');
    expect(home).toContain("KioskAvatar(url: url, initials: initials, size: 30)");
  });

  it("shows crew without gear as an avatar group on Events today", () => {
    expect(home).toContain('without gear")');
    expect(home).toContain("HomeAvatarStack(members: group.crewMembers)");
  });

  it("decodes the avatar fields the dashboard route already projects", () => {
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const route = source("src/app/api/kiosk/dashboard/route.ts");
    expect(models).toContain("let requesterAvatarUrl: String?");
    expect(route).toContain("requesterAvatarUrl: c.custodyScope === \"SHARED\" ? null : c.requester.avatarUrl");
    expect(route).toContain("avatarUrl: user.avatarUrl");
  });
});

describe("kiosk event display titles", () => {
  it("drops promo tails and University, and uses the sport code for matchups", () => {
    const home = source("ios/Wisconsin/Kiosk/KioskHomeView.swift");
    expect(home).toContain("func kioskEventDisplayTitle(_ title: String, sportCode: String?)");
    expect(home).toContain('[" University", " College"]');
    expect(home).toContain("Text(kioskEventDisplayTitle(group.event.title, sportCode: group.event.sportCode))");
  });
});
