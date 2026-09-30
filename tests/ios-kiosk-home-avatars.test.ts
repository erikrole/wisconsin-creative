import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("iOS kiosk home list avatars", () => {
  const home = source("ios/Wisconsin/Kiosk/KioskHomeView.swift");

  it("leads custody and pickup rows with the holder's avatar, falling back to initials", () => {
    expect(home).toContain("HomeRowAvatar(url: checkout.requesterAvatarUrl, initials: checkout.requesterInitials");
    expect(home).toContain('url: pickup.custodyScope == "SHARED" ? nil : pickup.requester?.avatarUrl');
    expect(home).toContain("KioskAvatar(url: url, initials: initials, size: 30)");
  });

  it("shows crew-without-gear avatars on game-day cards", () => {
    expect(home).toContain("HomeAvatarStack(members: group.crewMembers)");
    expect(home).toContain("KioskAvatar(url: member.avatarUrl");
  });

  it("decodes the avatar fields the dashboard route already projects", () => {
    const models = source("ios/Wisconsin/Kiosk/KioskModels.swift");
    const route = source("src/app/api/kiosk/dashboard/route.ts");
    expect(models).toContain("let requesterAvatarUrl: String?");
    expect(route).toContain("requesterAvatarUrl: c.custodyScope === \"SHARED\" ? null : c.requester.avatarUrl");
    expect(route).toContain("avatarUrl: user.avatarUrl");
  });
});
