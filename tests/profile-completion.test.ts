import { describe, expect, it } from "vitest";
import { getProfileCompletion } from "@/lib/profile-completion";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Person",
    role: "STAFF",
    email: "person@wisc.edu",
    athleticsEmail: null,
    phone: null,
    personalPhone: null,
    workPhone: null,
    workPhoneNotApplicable: false,
    wiscardCardNumber: null,
    wiscardIssueCode: null,
    studentYearOverride: null,
    gradYear: null,
    graduationTerm: null,
    topSizeFit: null,
    topSize: null,
    shoeSizeSystem: null,
    shoeSize: null,
    avatarUrl: null,
    profilePromptSnoozedUntil: null,
    ...overrides,
  } as Parameters<typeof getProfileCompletion>[0];
}

describe("profile completion", () => {
  it("requires the requested contact, Wiscard, and apparel details", () => {
    const result = getProfileCompletion(profile());

    expect(result.isComplete).toBe(false);
    expect(result.completedCount).toBe(1);
    expect(result.totalCount).toBe(8);
    expect(result.firstIncompleteStep).toBe("EMAIL");
    expect(result.missingFields).toEqual([
      "athleticsEmail",
      "personalPhone",
      "workPhone",
      "wiscard",
      "clothingSize",
      "shoeSize",
      "photo",
    ]);
  });

  it("does not guess whether a legacy phone is personal or work", () => {
    const result = getProfileCompletion(profile({ phone: "608-555-0100" }));

    expect(result.completeByField.personalPhone).toBe(false);
    expect(result.completeByField.workPhone).toBe(false);
    expect(result.firstIncompleteStep).toBe("EMAIL");
  });

  it("accepts an explicit no-work-phone answer and complete typed Wiscard parts", () => {
    const result = getProfileCompletion(profile({
      athleticsEmail: "person@athletics.wisc.edu",
      personalPhone: "608-555-0100",
      workPhoneNotApplicable: true,
      wiscardCardNumber: "907032481",
      wiscardIssueCode: "02",
      topSizeFit: "WOMENS",
      topSize: "M",
      shoeSizeSystem: "US_WOMENS",
      shoeSize: "9.5",
      avatarUrl: "https://example.com/avatar.webp",
    }));

    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("requires year and anticipated graduation for students", () => {
    const result = getProfileCompletion(profile({ role: "STUDENT" }));

    expect(result.totalCount).toBe(8);
    expect(result.missingFields).not.toContain("workPhone");
    expect(result.missingFields).not.toContain("athleticsEmail");
    expect(result.missingFields).toContain("studentYear");
    expect(result.missingFields).toContain("anticipatedGraduation");
  });

  it("accepts complete student academic details", () => {
    const result = getProfileCompletion(profile({
      role: "STUDENT",
      athleticsEmail: "person@athletics.wisc.edu",
      personalPhone: "608-555-0100",
      workPhoneNotApplicable: true,
      wiscardCardNumber: "907032481",
      wiscardIssueCode: "02",
      studentYearOverride: "JUNIOR",
      gradYear: 2027,
      graduationTerm: "SPRING",
      topSizeFit: "UNISEX",
      topSize: "M",
      shoeSizeSystem: "US_MENS",
      shoeSize: "10",
      avatarUrl: "https://example.com/avatar.webp",
    }));

    expect(result.isComplete).toBe(true);
    expect(result.completedCount).toBe(8);
  });

  it("separates operational readiness from profile completion", () => {
    const result = getProfileCompletion(profile({
      athleticsEmail: "person@athletics.wisc.edu",
      personalPhone: "608-555-0100",
      workPhoneNotApplicable: true,
      wiscardCardNumber: "907032481",
      wiscardIssueCode: "2",
    }));

    expect(result.operationalReady).toBe(true);
    expect(result.profileComplete).toBe(false);
    expect(result.missingFields).toEqual(["clothingSize", "shoeSize", "photo"]);
  });

  it("lets collaborators enter the app without completing optional profile setup", () => {
    const incomplete = getProfileCompletion(profile({ role: "COLLABORATOR", email: "guest@example.com" }));
    const complete = getProfileCompletion(profile({
      role: "COLLABORATOR",
      email: "guest@example.com",
      avatarUrl: "https://example.com/avatar.webp",
    }));

    expect(incomplete.operationalReady).toBe(true);
    expect(incomplete.missingFields).toEqual(["photo"]);
    expect(incomplete.firstIncompleteStep).toBe("PHOTO");
    expect(complete.profileComplete).toBe(true);
  });

  it("suppresses the automatic prompt only until the 24-hour snooze expires", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const snoozed = getProfileCompletion(profile({
      profilePromptSnoozedUntil: "2026-07-16T11:59:59.000Z",
    }), now);
    const expired = getProfileCompletion(profile({
      profilePromptSnoozedUntil: "2026-07-15T11:59:59.000Z",
    }), now);

    expect(snoozed.shouldPrompt).toBe(false);
    expect(snoozed.isSnoozed).toBe(true);
    expect(expired.shouldPrompt).toBe(true);
  });

  it("does not prompt hidden smoke identities for campus profile details", () => {
    const result = getProfileCompletion(profile({
      email: "admin@creative.local",
      hiddenFromRoster: true,
    }));

    expect(result.shouldPrompt).toBe(false);
    expect(result.isComplete).toBe(true);
    expect(result.operationalReady).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.firstIncompleteStep).toBeNull();
  });
});
