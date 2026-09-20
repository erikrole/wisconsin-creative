import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const info = readFileSync("src/app/(app)/users/[id]/UserInfoTab.tsx", "utf8");
const page = readFileSync("src/app/(app)/users/[id]/page.tsx", "utf8");
const cropDialog = readFileSync("src/app/(app)/users/[id]/AvatarCropDialog.tsx", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("annotated user profile contract", () => {
  it("uses split Wiscard fields and keeps Slack hidden", () => {
    expect(info).toContain('label="Wiscard"');
    expect(info).toContain('aria-label="Wiscard number"');
    expect(info).toContain('aria-label="Issue code"');
    expect(info).toContain("Issue code can be found in the bottom right of your Wiscard");
    expect(info).not.toContain('label="Slack handle"');
    expect(info).not.toContain('label="Slack profile"');
    expect(info).not.toContain('label="Slack Profile URL"');
    expect(schema).toContain("slackHandle");
    expect(schema).toContain("slackProfileUrl");
  });

  it("shows the real name and moves password changes into profile actions", () => {
    expect(page).toContain("{profile.name}");
    expect(page).not.toContain('isSelf ? "My Profile"');
    expect(page).toContain('href="/settings/security"');
    expect(info).not.toContain("Password Change Card");
  });

  it("standardizes sizing, removes direct-report linkage badges, and adds birthday", () => {
    expect(info).toContain('ariaLabel="Top fit"');
    expect(info).toContain('label="Clothing"');
    expect(info).toContain('label="Shoes"');
    expect(info).toContain('ariaLabel="Shoe sizing"');
    expect(info).not.toContain(">Linked</Badge>");
    expect(info).toContain('label="Birthday"');
    expect(info).toContain('placeholder="MM/DD"');
    expect(info).not.toContain("birthdayIso");
    expect(schema).toContain("birthYear");
    expect(info).toContain("options={TOP_SIZE_OPTIONS.map");
    expect(info).not.toContain("String(24 + index * 2)");
    expect(info).not.toContain("canViewBirthYear");
    expect(info).not.toContain('aria-label="Birth year"');
  });

  it("lets users crop, zoom, and reposition profile photos before upload", () => {
    expect(page).toContain("<AvatarCropDialog");
    expect(page).toContain("setPendingAvatarFile(file)");
    expect(cropDialog).toContain("Crop profile photo");
    expect(cropDialog).toContain('aria-label="Photo zoom"');
    expect(cropDialog).toContain("onPointerMove={moveCrop}");
  });

  it("adds Live Production as an assignment area", () => {
    expect(schema).toContain("LIVE_PRODUCTION");
    expect(schema).toContain("SOCIAL");
    expect(info).toContain("AREA_OPTIONS");
  });
});
