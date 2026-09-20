import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "@/lib/validation";
import { formatPhoneInput, normalizeProfilePhone } from "@/lib/profile-phone";

const userInfo = readFileSync("src/app/(app)/users/[id]/UserInfoTab.tsx", "utf8");
const settingsProfile = readFileSync("src/app/(app)/settings/profile/page.tsx", "utf8");
const staffRoute = readFileSync("src/app/api/users/[id]/route.ts", "utf8");
const selfRoute = readFileSync("src/app/api/profile/route.ts", "utf8");
const settingsRoute = readFileSync("src/app/api/me/profile/route.ts", "utf8");

describe("user profile phone fields", () => {
  it("accepts exactly ten digits and rejects extensions or non-phone text", () => {
    expect(updateProfileSchema.safeParse({
      personalPhone: "(608) 555-0111",
      workPhone: "608-555-0222",
    }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ workPhone: "608-555-0222 ext 4" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ personalPhone: "call me" }).success).toBe(false);
  });

  it("formats phone input and persisted values consistently", () => {
    expect(formatPhoneInput("6087920676")).toBe("(608) 792-0676");
    expect(formatPhoneInput("16087920676")).toBe("(608) 792-0676");
    expect(normalizeProfilePhone("608-218-0951")).toBe("(608) 218-0951");
  });

  it("shows both phone fields on canonical and Settings profile surfaces", () => {
    expect(userInfo).toContain('label="Personal phone"');
    expect(userInfo).toContain('label="Work phone"');
    expect(userInfo).toContain("patchUser({ personalPhone: v || null })");
    expect(userInfo).toContain("patchUser({ workPhone: v || null })");
    expect(settingsProfile).toContain("Personal phone");
    expect(settingsProfile).toContain("Work phone");
    expect(settingsProfile).toContain("personalPhone: form.personalPhone || null");
    expect(settingsProfile).toContain("workPhone: form.workPhone || null");
    expect(userInfo).toContain("formatInput={formatPhoneInput}");
    expect(settingsProfile).toContain("formatPhoneInput(e.target.value)");
  });

  it("keeps personal phone compatible and work-phone applicability explicit in every update route", () => {
    expect(staffRoute).toContain("updateData.personalPhone = personalPhone");
    expect(staffRoute).toContain("updateData.phone = personalPhone");
    expect(staffRoute).toContain("updateData.workPhone = workPhone");
    expect(staffRoute).toContain("updateData.workPhoneNotApplicable = workPhone === null");
    for (const source of [selfRoute, settingsRoute]) {
      expect(source).toContain("data.personalPhone = personalPhone");
      expect(source).toContain("data.phone = personalPhone");
      expect(source).toContain("data.workPhone = workPhone");
      expect(source).toContain("data.workPhoneNotApplicable = workPhone === null");
    }
  });
});
