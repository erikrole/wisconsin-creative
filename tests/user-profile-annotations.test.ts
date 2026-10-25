import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitSource } from "./_helpers/source";

// The rendered fields (Wiscard, sizing, birthday, no Slack or password card)
// are checked in tests/user-info-tab.test.ts.
const info = splitSource("src/app/(app)/staff/[id]/UserInfoTab.tsx");
const page = readFileSync("src/app/(app)/staff/[id]/page.tsx", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("annotated user profile contract", () => {
  it("uses split Wiscard fields and keeps Slack hidden", () => {
    expect(info).toContain("Issue code can be found in the bottom right of your Wiscard");
    expect(schema).toContain("slackHandle");
    expect(schema).toContain("slackProfileUrl");
  });

  it("shows the real name and moves password changes into profile actions", () => {
    expect(page).toContain("{profile.name}");
    expect(page).not.toContain('isSelf ? "My Profile"');
    expect(page).toContain('href="/settings/security"');
  });

  it("standardizes sizing, removes direct-report linkage badges, and adds birthday", () => {
    expect(info).not.toContain("birthdayIso");
    expect(schema).toContain("birthYear");
    expect(info).toContain("options={TOP_SIZE_OPTIONS.map");
    expect(info).not.toContain("String(24 + index * 2)");
    expect(info).not.toContain("canViewBirthYear");
  });

  it("routes roster photo selection through the shared crop editor", () => {
    expect(page).toContain("<AvatarCropDialog");
    expect(page).toContain("setPendingAvatarFile(file)");
  });

  it("adds Live Production as an assignment area", () => {
    expect(schema).toContain("LIVE_PRODUCTION");
    expect(schema).toContain("SOCIAL");
    expect(info).toContain("AREA_OPTIONS");
  });
});
